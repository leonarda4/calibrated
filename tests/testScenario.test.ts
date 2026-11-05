import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestScenario, type TestScenarioAction } from '../src/experience/testScenario.ts';
import { GAMEPLAY_TIMING } from '../src/experience/gameplayTiming.ts';
import type { VoiceCue } from '../src/audio/voiceCues.ts';

function fixture(headsetTriggered = false) {
  const events: string[] = [];
  let now = 100;
  const scenario = createTestScenario({
    onCue(cue: VoiceCue) { events.push(`cue:${cue}`); },
    onAction(action: TestScenarioAction) { events.push(`action:${action}`); return true; },
  });
  const advanceTo = (target: number, inside = false) => {
    while (now < 100 + target) {
      now = Math.min(now + .25, 100 + target);
      scenario.update(now, inside);
    }
  };
  scenario.start(100, headsetTriggered);
  return { scenario, events, advanceTo };
}

test('welcome waits one second; autoplay explores for 20 seconds before music, then turns two seconds later', () => {
  const { scenario, events, advanceTo } = fixture();
  assert.deepEqual(events, []);
  assert.equal(scenario.snapshot().stage, 'waitingWelcome');
  assert.equal(scenario.snapshot().nextActionSeconds, GAMEPLAY_TIMING.welcomeSeconds);
  advanceTo(.999);
  assert.deepEqual(events, []);
  advanceTo(1);
  assert.deepEqual(events, ['cue:scenarioWelcome']);
  advanceTo(7.999);
  assert.equal(scenario.snapshot().stage, 'waitingBox');
  advanceTo(8);
  assert.deepEqual(events.slice(-2), ['action:showBox', 'cue:scenarioBox']);
  assert.equal(scenario.snapshot().nextActionSeconds, 20);
  advanceTo(19.999);
  assert.equal(events.length, 3);
  advanceTo(20);
  assert.deepEqual(events.slice(-1), ['action:anticipateTurn']);
  assert.equal(scenario.snapshot().stage, 'anticipatingTurn');
  assert.equal(scenario.snapshot().nextActionSeconds, 22);
  advanceTo(21.999);
  assert.equal(events.length, 4);
  advanceTo(22);
  assert.deepEqual(events.slice(-2), ['action:rotate', 'cue:scenarioTurn']);
  advanceTo(26.999);
  assert.equal(events.length, 6);
  advanceTo(27);
  assert.deepEqual(events.slice(-2), ['action:showSecondBox', 'cue:scenarioSeat']);
  assert.deepEqual(scenario.snapshot(), {
    stage: 'complete', status: 'Test scenario complete.', running: false, elapsedSeconds: 27, nextActionSeconds: null,
  });
  scenario.update(1000);
  assert.equal(events.length, 8);
});

test('live scenario waits for actual headset entry and starts seat delay from actual turn onset', () => {
  const { scenario, events, advanceTo } = fixture(true);
  advanceTo(30);
  assert.deepEqual(events, ['cue:scenarioWelcome', 'action:showBox', 'cue:scenarioBox']);
  assert.equal(scenario.snapshot().nextActionSeconds, null);
  advanceTo(30.25, true);
  assert.deepEqual(events.slice(-1), ['action:anticipateTurn']);
  assert.equal(scenario.snapshot().nextActionSeconds, 32.25);
  advanceTo(32.249, false);
  assert.equal(scenario.snapshot().stage, 'anticipatingTurn');
  advanceTo(32.25, false);
  assert.deepEqual(events.slice(-2), ['action:rotate', 'cue:scenarioTurn']);
  assert.equal(scenario.snapshot().nextActionSeconds, 37.25);
  advanceTo(37.249);
  assert.equal(scenario.snapshot().stage, 'waitingSeat');
  advanceTo(37.25);
  assert.deepEqual(events.slice(-2), ['action:showSecondBox', 'cue:scenarioSeat']);
});

test('headset already above the box waits the full announcement before starting the music lead', () => {
  const { scenario, events, advanceTo } = fixture(true);
  advanceTo(12.999, true);
  assert.equal(scenario.snapshot().stage, 'waitingTurn');
  assert.deepEqual(events, ['cue:scenarioWelcome', 'action:showBox', 'cue:scenarioBox']);
  advanceTo(13, true);
  assert.equal(scenario.snapshot().stage, 'anticipatingTurn');
  assert.deepEqual(events.slice(-1), ['action:anticipateTurn']);
  advanceTo(14.999, true);
  assert.equal(scenario.snapshot().stage, 'anticipatingTurn');
  advanceTo(15, true);
  assert.deepEqual(events.slice(-2), ['action:rotate', 'cue:scenarioTurn']);
});

test('late valid frames retain full announcement and transition anticipation from actual callbacks', () => {
  const actions: Array<[TestScenarioAction, number]> = [];
  let now = 0;
  const scenario = createTestScenario({ onCue() {}, onAction(action) { actions.push([action, now]); return true; } });
  scenario.start(0, true);
  const step = (time: number) => { now = time; scenario.update(time, true); };
  for (let time = .5; time <= 7.5; time += .5) step(time);
  step(7.9);
  step(8.4);
  for (let time = 8.9; time < 13.3; time += .5) step(time);
  step(13.3);
  assert.equal(scenario.snapshot().stage, 'waitingTurn');
  step(13.401);
  assert.equal(scenario.snapshot().stage, 'anticipatingTurn');
  for (let time = 13.901; time < 15.4; time += .5) step(time);
  step(15.4);
  assert.equal(scenario.snapshot().stage, 'anticipatingTurn');
  step(15.402);
  assert.deepEqual(actions, [['showBox', 8.4], ['anticipateTurn', 13.401], ['rotate', 15.402]]);
  assert.equal(scenario.snapshot().nextActionSeconds, 20.402);
});

test('cancellation at every active phase suppresses old cues and actions until a fresh one-second welcome', () => {
  for (const cancelledAt of [0, .75, 1, 8, 20, 22, 27]) {
    const { scenario, events, advanceTo } = fixture();
    advanceTo(cancelledAt);
    scenario.cancel('Tracking lost.');
    const oldEvents = [...events];
    advanceTo(40);
    assert.equal(scenario.snapshot().status, 'Tracking lost.');
    assert.deepEqual(events, oldEvents);
    scenario.start(200);
    assert.equal(scenario.snapshot().elapsedSeconds, 0);
    assert.equal(scenario.snapshot().stage, 'waitingWelcome');
    scenario.update(200.5);
    assert.deepEqual(events, oldEvents);
    scenario.update(201);
    assert.deepEqual(events, [...oldEvents, 'cue:scenarioWelcome']);
  }
});

test('failed or throwing actions cancel without narrating success, including anticipation and rotation', () => {
  for (const failedAction of ['showBox', 'anticipateTurn', 'rotate', 'showSecondBox'] as const) {
    for (const throws of [false, true]) {
      const actions: TestScenarioAction[] = [];
      const cues: VoiceCue[] = [];
      const scenario = createTestScenario({
        onCue(cue) { cues.push(cue); },
        onAction(action) {
          actions.push(action);
          if (action !== failedAction) return true;
          if (throws) throw new Error('Synthetic rejection');
          return false;
        },
      });
      scenario.start(0);
      for (let now = .5; now <= 40; now += .5) scenario.update(now);
      assert.equal(actions.at(-1), failedAction);
      assert.equal(scenario.snapshot().stage, 'cancelled');
      assert.match(scenario.snapshot().status, new RegExp(`${failedAction} could not run`));
      const failedCue = { showBox: 'scenarioBox', anticipateTurn: 'scenarioTurn', rotate: 'scenarioTurn', showSecondBox: 'scenarioSeat' }[failedAction];
      assert.ok(!cues.includes(failedCue as VoiceCue));
    }
  }
});

test('paused frames and invalid or reversed clocks cancel without playing delayed welcome', () => {
  for (const badTime of [20, .501, NaN, Infinity, -.1]) {
    const events: VoiceCue[] = [];
    const scenario = createTestScenario({ onCue(cue) { events.push(cue); }, onAction() { return true; } });
    scenario.start(0);
    scenario.update(badTime);
    assert.equal(scenario.snapshot().stage, 'cancelled');
    assert.deepEqual(events, []);
  }
  for (const badStart of [NaN, Infinity, -1]) {
    const { scenario, events } = fixture();
    scenario.start(badStart);
    assert.equal(scenario.snapshot().running, false);
    assert.equal(scenario.snapshot().stage, 'cancelled');
    assert.deepEqual(events, []);
  }
});

test('reentrant cancellation during an installation action suppresses its cue and later actions', () => {
  const cues: VoiceCue[] = [];
  let scenario: ReturnType<typeof createTestScenario>;
  scenario = createTestScenario({
    onCue(cue) { cues.push(cue); },
    onAction() { scenario.cancel('Interrupted during placement.'); return true; },
  });
  scenario.start(0);
  for (let now = .5; now <= 30; now += .5) scenario.update(now);
  assert.equal(scenario.snapshot().status, 'Interrupted during placement.');
  assert.deepEqual(cues, ['scenarioWelcome']);
});

test('reentrant clock update cannot repeat an action and a restarted clock receives no old cue', () => {
  const actions: TestScenarioAction[] = [];
  const cues: VoiceCue[] = [];
  let scenario: ReturnType<typeof createTestScenario>;
  scenario = createTestScenario({
    onCue(cue) { cues.push(cue); },
    onAction(action) {
      actions.push(action);
      scenario.update(8);
      scenario.start(8);
      return true;
    },
  });
  scenario.start(0);
  for (let now = .5; now <= 8; now += .5) scenario.update(now);
  assert.deepEqual(actions, ['showBox']);
  assert.deepEqual(cues, ['scenarioWelcome']);
  assert.equal(scenario.snapshot().stage, 'waitingWelcome');
  assert.equal(scenario.snapshot().elapsedSeconds, 0);
  scenario.update(8.5);
  scenario.update(9);
  assert.deepEqual(cues, ['scenarioWelcome', 'scenarioWelcome']);
});

test('synchronous change notifications can cancel the start or welcome without leaking later callbacks', () => {
  for (const cancelStage of ['waitingWelcome', 'waitingBox']) {
    const cues: VoiceCue[] = [];
    let scenario: ReturnType<typeof createTestScenario>;
    scenario = createTestScenario({
      onCue(cue) { cues.push(cue); }, onAction() { return true; },
      onChange() {
        if (scenario.snapshot().stage === cancelStage) scenario.cancel('Disabled by operator.');
      },
    });
    scenario.start(0);
    scenario.update(.5);
    scenario.update(1);
    assert.deepEqual(cues, cancelStage === 'waitingWelcome' ? [] : ['scenarioWelcome']);
    assert.equal(scenario.snapshot().status, 'Disabled by operator.');
  }
});
