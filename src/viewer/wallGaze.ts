type Point3 = readonly [number, number, number];

export const WALL_GAZE_STOP_DELAY_SECONDS = .7;
export const WALL_GAZE_ARRIVAL_SECONDS = 5;
export const WALL_GAZE_MAX_FRAME_SECONDS = .5;

/** The tracked viewing ray, including pitch, must point toward the wall centre. */
export function lookingAtWall(player: Point3 | null, forward: Point3 | null,
  target: Point3, degrees = 45): boolean | null {
  if (!player || !forward || !player.every(Number.isFinite) || !forward.every(Number.isFinite) ||
      !target.every(Number.isFinite) || !Number.isFinite(degrees) || degrees < 0 || degrees >= 180) return null;
  const toward = target.map((value, i) => value - player[i]);
  const towardLength = Math.hypot(...toward), forwardLength = Math.hypot(...forward);
  if (!Number.isFinite(towardLength) || !Number.isFinite(forwardLength) || towardLength < 1e-9 || forwardLength < 1e-9) return null;
  const dot = toward.reduce((sum, value, i) => sum + value / towardLength * forward[i] / forwardLength, 0);
  return dot >= Math.cos(degrees * Math.PI / 180) - 1e-12;
}

export type WallGazeStage = 'idle' | 'stealth' | 'arrival';
export interface WallGazeInput {
  looking: boolean | null;
  /** Actual route coordinate after player clearance has constrained movement. */
  z: number;
  /** Completion comes from the movement controller, after side entry finishes. */
  arrived: boolean;
}
export interface WallGazeSnapshot {
  stage: WallGazeStage;
  allowedSeconds: number;
  /** Travel remains bounded by the caller's fixed route and player clearance. */
  maxTravel: number;
  /** Compatibility alias for the endpoint continuous-look disappearance gate. */
  arrivalReady: boolean;
  vanishReady: boolean;
  looking: boolean | null;
  /** Continuous valid gaze since actual endpoint arrival. */
  lookSeconds: number;
  /** Remaining look-back stopping time; null means no active stopping fade. */
  stopInSeconds: number | null;
  /** Normalized motion volume: a look back fades it out over the stopping delay. */
  movementSoundGain: number;
}

/** Revealed walls move unseen; route geometry and player clearance stay caller-owned. */
export class WallGaze {
  private stage: WallGazeStage = 'idle';
  private looking: boolean | null = null;
  private lookSeconds = 0;
  private stopLookSeconds = 0;
  private allowedSeconds = 0;

  snapshot(): WallGazeSnapshot {
    return { stage: this.stage, allowedSeconds: this.allowedSeconds,
      maxTravel: Infinity,
      arrivalReady: this.stage === 'arrival' && this.lookSeconds >= WALL_GAZE_ARRIVAL_SECONDS,
      vanishReady: this.stage === 'arrival' && this.lookSeconds >= WALL_GAZE_ARRIVAL_SECONDS,
      looking: this.looking, lookSeconds: this.lookSeconds,
      stopInSeconds: this.stage === 'stealth' && this.looking === true
        ? Math.max(0, WALL_GAZE_STOP_DELAY_SECONDS - this.stopLookSeconds) : null,
      movementSoundGain: this.allowedSeconds > 0 && this.stage === 'stealth'
        ? this.looking ? Math.max(0, 1 - this.stopLookSeconds / WALL_GAZE_STOP_DELAY_SECONDS) : 1
        : 0 };
  }

  start(startZ: number, targetZ: number): void {
    if (![startZ, targetZ].every(Number.isFinite)) throw new Error('Wall gaze requires finite route coordinates.');
    this.reset(); this.stage = 'stealth';
  }

  reset(): void {
    this.stage = 'idle'; this.looking = null;
    this.lookSeconds = this.stopLookSeconds = this.allowedSeconds = 0;
  }

  /** Feed the result of movement, never a proposed position or elapsed travel time. */
  observePosition(z: number, arrived = false): void {
    if (this.stage === 'idle' || !Number.isFinite(z)) return;
    if (arrived && this.stage !== 'arrival') {
      this.stage = 'arrival'; this.lookSeconds = this.allowedSeconds = 0;
    }
  }

  update(deltaSeconds: number, input: WallGazeInput): WallGazeSnapshot {
    this.allowedSeconds = 0;
    this.looking = typeof input.looking === 'boolean' ? input.looking : null;
    this.observePosition(input.z, input.arrived);
    if (this.stage === 'idle') return this.snapshot();
    const validFrame = Number.isFinite(deltaSeconds) && deltaSeconds > 0 && deltaSeconds <= WALL_GAZE_MAX_FRAME_SECONDS;
    if (!validFrame || !Number.isFinite(input.z) || this.looking === null) {
      // A paused or untracked frame has no catch-up budget. Do not grant a
      // fresh stopping grace on every lost/reacquired gaze sample.
      if (deltaSeconds !== 0 || this.looking === null || !Number.isFinite(input.z)) {
        this.lookSeconds = 0;
        this.stopLookSeconds = WALL_GAZE_STOP_DELAY_SECONDS;
      }
      return this.snapshot();
    }
    const elapsed = this.stage === 'arrival' && this.looking ? this.lookSeconds + deltaSeconds : 0;
    this.lookSeconds = elapsed >= WALL_GAZE_ARRIVAL_SECONDS - 1e-9 ? WALL_GAZE_ARRIVAL_SECONDS : elapsed;
    if (this.stage === 'stealth') {
      if (!this.looking) {
        this.stopLookSeconds = 0; this.allowedSeconds = deltaSeconds;
      } else {
        this.allowedSeconds = Math.min(deltaSeconds, Math.max(0, WALL_GAZE_STOP_DELAY_SECONDS - this.stopLookSeconds));
        this.stopLookSeconds = Math.min(WALL_GAZE_STOP_DELAY_SECONDS, this.stopLookSeconds + deltaSeconds);
      }
    }
    return this.snapshot();
  }
}
