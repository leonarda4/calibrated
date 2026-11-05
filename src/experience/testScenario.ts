import type { VoiceCue } from '../audio/voiceCues.ts';
import { GAMEPLAY_TIMING } from './gameplayTiming.ts';

export type TestScenarioAction = 'showBox' | 'anticipateTurn' | 'rotate' | 'showSecondBox';
export type TestScenarioStage = 'idle' | 'waitingWelcome' | 'waitingBox' | 'waitingTurn' | 'anticipatingTurn' | 'waitingSeat' | 'complete' | 'cancelled';

export interface TestScenarioSnapshot {
  stage: TestScenarioStage;
  status: string;
  running: boolean;
  elapsedSeconds: number;
  /** Deadline measured from start, rather than an absolute clock value. */
  nextActionSeconds: number | null;
}

export interface TestScenarioOptions {
  onCue(cue: VoiceCue): void;
  /** Use the same guarded actions as the operator buttons. */
  onAction(action: TestScenarioAction): boolean;
  onChange?(): void;
}

const waitingStages: readonly TestScenarioStage[] = ['waitingWelcome', 'waitingBox', 'waitingTurn', 'anticipatingTurn', 'waitingSeat'];
const descriptions: Record<TestScenarioStage, string> = {
  idle: 'Test scenario waits for a fresh calibration.',
  waitingWelcome: 'Welcome one second after calibration.',
  waitingBox: `Test scenario: first box at ${GAMEPLAY_TIMING.firstBoxSeconds} seconds after calibration.`,
  waitingTurn: `Explore: transition music starts at ${GAMEPLAY_TIMING.explorationSeconds} seconds, then the hallway turns ${GAMEPLAY_TIMING.transitionLeadSeconds} seconds later.`,
  anticipatingTurn: `Transition music: hallway turn in ${GAMEPLAY_TIMING.transitionLeadSeconds} seconds.`,
  waitingSeat: `Test scenario: second box ${GAMEPLAY_TIMING.secondBoxDelaySeconds} seconds after the turn starts.`,
  complete: 'Test scenario complete.',
  cancelled: 'Test scenario cancelled.',
};

/** Pure clock: no timers, audio APIs, renderer, or calibration authority. */
export function createTestScenario(options: TestScenarioOptions) {
  let stage: TestScenarioStage = 'idle';
  let status = descriptions.idle;
  let elapsedSeconds = 0;
  let startedAt = 0;
  let lastUpdatedAt = 0;
  let generation = 0;
  let waitForHeadset = false;
  let seatSeconds = 0;
  let turnReadySeconds = 0;
  let turnSeconds = 0;
  const running = () => waitingStages.includes(stage);
  const changed = () => options.onChange?.();
  const cancel = (reason = descriptions.cancelled): void => {
    generation += 1;
    stage = 'cancelled';
    status = reason;
    changed();
  };
  const cue = (name: VoiceCue, token: number): void => {
    try { options.onCue(name); }
    catch {
      if (token === generation) cancel('Test scenario cancelled: narration could not be started.');
    }
  };
  const action = (name: TestScenarioAction, token: number): boolean => {
    let succeeded = false;
    try { succeeded = options.onAction(name); }
    catch { /* Guard failures cancel below without leaking an exception. */ }
    if (token !== generation) return false;
    if (!succeeded) cancel(`Test scenario cancelled: ${name} could not run. Review placement and tracking, then recalibrate.`);
    return succeeded;
  };
  const enter = (next: TestScenarioStage): void => {
    stage = next;
    status = descriptions[next];
  };

  return {
    snapshot(): TestScenarioSnapshot {
      let next: number | null = null;
      if (stage === 'waitingWelcome') next = GAMEPLAY_TIMING.welcomeSeconds;
      else if (stage === 'waitingBox') next = GAMEPLAY_TIMING.firstBoxSeconds;
      else if (stage === 'waitingTurn') {
        next = waitForHeadset ? elapsedSeconds < turnReadySeconds ? turnReadySeconds : null
          : Math.max(GAMEPLAY_TIMING.explorationSeconds, turnReadySeconds);
      } else if (stage === 'anticipatingTurn') next = turnSeconds;
      else if (stage === 'waitingSeat') next = seatSeconds;
      return { stage, status, running: running(), elapsedSeconds, nextActionSeconds: next };
    },
    start(nowSeconds: number, headsetTriggered = false): void {
      generation += 1;
      waitForHeadset = headsetTriggered;
      seatSeconds = turnReadySeconds = turnSeconds = 0;
      if (!Number.isFinite(nowSeconds) || nowSeconds < 0) {
        cancel('Test scenario cancelled: invalid start time.');
        return;
      }
      startedAt = lastUpdatedAt = nowSeconds;
      elapsedSeconds = 0;
      enter('waitingWelcome');
      changed();
    },
    update(nowSeconds: number, headsetInsideBox = false): void {
      if (!running()) return;
      if (!Number.isFinite(nowSeconds) || nowSeconds < lastUpdatedAt) {
        cancel('Test scenario cancelled: invalid or reversed clock. Recalibrate to restart.');
        return;
      }
      // A suspended frame must never replay several physical actions at once.
      if (nowSeconds - lastUpdatedAt > 0.5) {
        cancel('Test scenario cancelled: frames paused. Recalibrate to restart.');
        return;
      }
      lastUpdatedAt = nowSeconds;
      elapsedSeconds = nowSeconds - startedAt;
      const token = generation;
      // Advance before invoking callbacks so a reentrant update cannot repeat a cue/action.
      if (stage === 'waitingWelcome') {
        if (elapsedSeconds + 1e-9 < GAMEPLAY_TIMING.welcomeSeconds) return;
        enter('waitingBox');
        cue('scenarioWelcome', token);
      } else if (stage === 'waitingBox') {
        if (elapsedSeconds + 1e-9 < GAMEPLAY_TIMING.firstBoxSeconds) return;
        turnReadySeconds = elapsedSeconds + GAMEPLAY_TIMING.boxAnnouncementSeconds;
        enter('waitingTurn');
        if (waitForHeadset) status = 'Listen to the box announcement, then move the headset inside or above its footprint to start the transition.';
        if (!action('showBox', token)) return;
        cue('scenarioBox', token);
      } else if (stage === 'waitingTurn') {
        if (elapsedSeconds + 1e-9 < turnReadySeconds) return;
        if (waitForHeadset ? !headsetInsideBox : elapsedSeconds + 1e-9 < GAMEPLAY_TIMING.explorationSeconds) return;
        turnSeconds = elapsedSeconds + GAMEPLAY_TIMING.transitionLeadSeconds;
        enter('anticipatingTurn');
        if (!action('anticipateTurn', token)) return;
      } else if (stage === 'anticipatingTurn') {
        if (elapsedSeconds + 1e-9 < turnSeconds) return;
        seatSeconds = elapsedSeconds + GAMEPLAY_TIMING.secondBoxDelaySeconds;
        enter('waitingSeat');
        if (!action('rotate', token)) return;
        cue('scenarioTurn', token);
      } else if (stage === 'waitingSeat') {
        if (elapsedSeconds + 1e-9 < seatSeconds) return;
        enter('complete');
        if (!action('showSecondBox', token)) return;
        cue('scenarioSeat', token);
      }
      if (token === generation) changed();
    },
    cancel,
  };
}
