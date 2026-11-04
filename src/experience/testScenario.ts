import type { VoiceCue } from '../audio/voiceCues.ts';

export type TestScenarioAction = 'showBox' | 'rotate' | 'showSecondBox';
export type TestScenarioStage = 'idle' | 'waitingBox' | 'waitingTurn' | 'waitingSeat' | 'complete' | 'cancelled';

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

const waitingStages: readonly TestScenarioStage[] = ['waitingBox', 'waitingTurn', 'waitingSeat'];
const steps = {
  waitingBox: { seconds: 10, action: 'showBox', cue: 'scenarioBox', next: 'waitingTurn' },
  waitingTurn: { seconds: 15, action: 'rotate', cue: 'scenarioTurn', next: 'waitingSeat' },
  waitingSeat: { seconds: 20, action: 'showSecondBox', cue: 'scenarioSeat', next: 'complete' },
} as const;
const descriptions: Record<TestScenarioStage, string> = {
  idle: 'Test scenario waits for a fresh calibration.',
  waitingBox: 'Test scenario: first box at 10 seconds after calibration.',
  waitingTurn: 'Test scenario: hallway turn at 15 seconds after calibration.',
  waitingSeat: 'Test scenario: second box at 20 seconds after calibration.',
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
  let seatSeconds = 20;
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

  return {
    snapshot(): TestScenarioSnapshot {
      const next = stage === 'waitingBox' || stage === 'waitingTurn' || stage === 'waitingSeat'
        ? stage === 'waitingTurn' && waitForHeadset ? null : stage === 'waitingSeat' ? seatSeconds : steps[stage].seconds : null;
      return { stage, status, running: running(), elapsedSeconds, nextActionSeconds: next };
    },
    start(nowSeconds: number, headsetTriggered = false): void {
      generation += 1;
      waitForHeadset = headsetTriggered;
      seatSeconds = 20;
      if (!Number.isFinite(nowSeconds) || nowSeconds < 0) {
        cancel('Test scenario cancelled: invalid start time.');
        return;
      }
      const token = generation;
      startedAt = lastUpdatedAt = nowSeconds;
      elapsedSeconds = 0;
      stage = 'waitingBox';
      status = descriptions[stage];
      changed();
      if (token === generation) cue('scenarioWelcome', token);
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
      if (stage !== 'waitingBox' && stage !== 'waitingTurn' && stage !== 'waitingSeat') return;
      const step = steps[stage];
      if (stage === 'waitingTurn' && waitForHeadset) {
        if (!headsetInsideBox) return;
      } else if (elapsedSeconds < (stage === 'waitingSeat' ? seatSeconds : step.seconds)) return;
      if (stage === 'waitingTurn' && waitForHeadset) seatSeconds = elapsedSeconds + 5;
      const token = generation;
      // The action can publish installation state synchronously. Advance first
      // so reentrant callbacks cannot execute the same action twice.
      stage = step.next;
      status = descriptions[stage];
      if (stage === 'waitingTurn' && waitForHeadset) status = 'Box ready: move the headset inside or above its footprint to turn the hallway.';
      if (stage === 'waitingSeat' && waitForHeadset) status = 'Test scenario: second box five seconds after the headset-triggered turn.';
      let succeeded = false;
      try { succeeded = options.onAction(step.action); }
      catch { /* Guard failures cancel below without leaking an exception. */ }
      if (token !== generation) return;
      if (!succeeded) {
        cancel(`Test scenario cancelled: ${step.action} could not run. Review placement and tracking, then recalibrate.`);
        return;
      }
      cue(step.cue, token);
      if (token === generation) changed();
    },
    cancel,
  };
}
