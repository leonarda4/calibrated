import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestScenario, type TestScenarioAction } from '../src/experience/testScenario.ts';
import type { VoiceCue } from '../src/audio/voiceCues.ts';

function fixture() {
  const events: string[] = [];
  let now = 100;
  const scenario = createTestScenario({
    onCue(cue: VoiceCue) { events.push(`cue:${cue}`); },
    onAction(action: TestScenarioAction) { events.push(`action:${action}`); return true; },
  });
  const advanceTo = (target: number) => {
    while (now < 100 + target) {
      now = Math.min(now + .25, 100 + target);
      scenario.update(now);
    }
  };
  return { scenario, events, advanceTo };
}

test('fresh calibration narrates immediately and runs guarded actions exactly at 10, 15 and 20 seconds', () => {
  const { scenario, events, advanceTo } = fixture();
  scenario.update(100);
  assert.deepEqual(events, []);
  scenario.start(100);
  assert.deepEqual(events, ['cue:scenarioWelcome']);
  advanceTo(9.999);
  assert.equal(scenario.snapshot().stage, 'waitingBox');
  assert.equal(events.length, 1);
  advanceTo(10);
  assert.deepEqual(events.slice(-2), ['action:showBox', 'cue:scenarioBox']);
  assert.equal(scenario.snapshot().nextActionSeconds, 15);
  advanceTo(14.999);
  assert.equal(events.length, 3);
  advanceTo(15);
  assert.deepEqual(events.slice(-2), ['action:rotate', 'cue:scenarioTurn']);
  advanceTo(19.999);
  assert.equal(events.length, 5);
  advanceTo(20);
  assert.deepEqual(events.slice(-2), ['action:showSecondBox', 'cue:scenarioSeat']);
  assert.deepEqual(scenario.snapshot(), {
    stage: 'complete', status: 'Test scenario complete.', running: false, elapsedSeconds: 20, nextActionSeconds: null,
  });
  scenario.update(1000);
  assert.equal(events.length, 7);
});

test('cancellation prevents every later action and only a fresh start creates another welcome', () => {
  const { scenario, events, advanceTo } = fixture();
  scenario.start(100);
  advanceTo(10);
  scenario.cancel('Tracking lost.');
  advanceTo(30);
  assert.equal(scenario.snapshot().status, 'Tracking lost.');
  assert.equal(events.length, 3);
  scenario.start(200);
  assert.equal(scenario.snapshot().elapsedSeconds, 0);
  assert.equal(scenario.snapshot().stage, 'waitingBox');
  assert.equal(events.at(-1), 'cue:scenarioWelcome');
  scenario.update(200.5);
  assert.equal(scenario.snapshot().running, true);
});

test('a failed or throwing placement/action cancels without narrating success or advancing later', () => {
  for (const throws of [false, true]) {
    const actions: TestScenarioAction[] = [];
    const cues: VoiceCue[] = [];
    const scenario = createTestScenario({
      onCue(cue) { cues.push(cue); },
      onAction(action) {
        actions.push(action);
        if (throws) throw new Error('Synthetic fit rejection');
        return false;
      },
    });
    scenario.start(0);
    for (let now = .5; now <= 30; now += .5) scenario.update(now);
    assert.deepEqual(actions, ['showBox']);
    assert.deepEqual(cues, ['scenarioWelcome']);
    assert.equal(scenario.snapshot().stage, 'cancelled');
    assert.match(scenario.snapshot().status, /showBox could not run/);
  }
});

test('paused frames and invalid or reversed clocks cancel instead of fast-forwarding actions', () => {
  for (const badTime of [20, .501, NaN, Infinity, -.1]) {
    const { scenario, events } = fixture();
    scenario.start(0);
    scenario.update(badTime);
    assert.equal(scenario.snapshot().stage, 'cancelled');
    assert.deepEqual(events, ['cue:scenarioWelcome']);
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

test('reentrant clock update cannot repeat an action and restart cannot receive an old action cue', () => {
  const actions: TestScenarioAction[] = [];
  const cues: VoiceCue[] = [];
  let scenario: ReturnType<typeof createTestScenario>;
  scenario = createTestScenario({
    onCue(cue) { cues.push(cue); },
    onAction(action) {
      actions.push(action);
      scenario.update(10);
      scenario.start(10);
      return true;
    },
  });
  scenario.start(0);
  for (let now = .5; now <= 10; now += .5) scenario.update(now);
  assert.deepEqual(actions, ['showBox']);
  assert.deepEqual(cues, ['scenarioWelcome', 'scenarioWelcome']);
  assert.equal(scenario.snapshot().elapsedSeconds, 0);
});

test('cancelling synchronously from a change notification cannot leak the welcome cue', () => {
  const cues: VoiceCue[] = [];
  let scenario: ReturnType<typeof createTestScenario>;
  scenario = createTestScenario({
    onCue(cue) { cues.push(cue); },
    onAction() { return true; },
    onChange() {
      if (scenario.snapshot().running) scenario.cancel('Disabled by operator.');
    },
  });
  scenario.start(0);
  assert.deepEqual(cues, []);
  assert.equal(scenario.snapshot().status, 'Disabled by operator.');
});
