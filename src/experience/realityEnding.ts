export const REALITY_ENDING = Object.freeze({
  relightSeconds: 1, dimensionSeconds: 5, glitchSeconds: 1, afterExplosionsSeconds: 5,
  boundaryMetres: 1, defaultSeed: 0x35ead026,
});

export type RealityWorldPhase = 'idle' | 'turning' | 'complete' | 'returning' | 'original' | 'cancelled';
export type RealityEndingPhase = 'idle' | 'armed' | 'returning' | 'relighting' | 'holding' | 'glitching' | 'white' | 'cancelled';
export interface RealityEndingSample {
  dt: number;
  eligible: boolean;
  worldPhase: RealityWorldPhase;
  /** Actual automatic collapse onset, never manual broom Hide or an open hole. */
  collapseStarted: boolean;
  brightness: number;
  /** Last actual burst has ended; residual Gaussian clearing may still be running. */
  explosionsFinished?: boolean;
  /** Signed distance to the live far-end headset boundary; null when unavailable. */
  farBoundaryMetres?: number | null;
}
type Keyframe = readonly [number, number];
const worldPhases: readonly string[] = ['idle', 'turning', 'complete', 'returning', 'original', 'cancelled'];
// Time reversal of the earlier diminishing relight pattern: .3 -> full light.
const relight: readonly Keyframe[] = [[0, 0], [.16, .15], [.25, 0], [.34, .35], [.45, 0],
  [.53, .6], [.61, 0], [.71, .8], [.78, .08], [.87, .95], [.93, 0], [1, 1]];
const glitch: readonly Keyframe[] = [[0, 1], [.06, .35], [.12, .92], [.18, .18], [.26, .82], [.33, .08],
  [.42, .58], [.50, 0], [.58, .42], [.66, 0], [.73, .25], [.81, 0], [.89, .12], [1, 0]];

const clamp = (value: number) => Math.max(0, Math.min(1, value));
function validSeed(seed: number): boolean { return Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff; }
function seededCurve(curve: readonly Keyframe[], seed: number): Keyframe[] {
  let state = seed >>> 0;
  return curve.map(([time, level], index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    // Keep all exact dark/bright endpoints and change only intermediate peaks.
    return [time, index === 0 || index === curve.length - 1 || level === 0 || level === 1
      ? level : clamp(level + (state / 4294967296 - .5) * .12)];
  });
}
function sampleCurve(curve: readonly Keyframe[], time: number): number {
  if (time <= 0) return curve[0][1];
  if (time >= 1) return curve.at(-1)![1];
  for (let index = 1; index < curve.length; index++) {
    const [end, value] = curve[index], [start, previous] = curve[index - 1];
    if (time > end) continue;
    const t = clamp((time - start) / (end - start));
    return previous + (value - previous) * t * t * (3 - 2 * t);
  }
  return curve.at(-1)![1];
}

/** Automatic collapse ends on return, a post-blast deadline or the far boundary.
 * No rendering, audio, timer, calibration authority or tracked-pose ownership.
 */
export class RealityEnding {
  private phase: RealityEndingPhase = 'idle';
  private previousWorld: RealityWorldPhase | null = null;
  private originalDamage = false;
  private seconds = 0;
  private capturedBrightness: number | null = null;
  private returnedCount = 0;
  private narrationCount = 0;
  private paused = false;
  private trigger: 'return' | 'timeout' | 'boundary' | null = null;
  private afterExplosions: number | null = null;
  private glitchStart: number = REALITY_ENDING.dimensionSeconds;
  private seed: number;
  private relightCurve: Keyframe[];
  private glitchCurve: Keyframe[];

  constructor(options: { seed?: number } = {}) {
    const seed = options.seed ?? REALITY_ENDING.defaultSeed;
    if (!validSeed(seed)) throw new Error('Reality ending needs a uint32 seed.');
    this.seed = seed;
    this.relightCurve = seededCurve(relight, seed);
    this.glitchCurve = seededCurve(glitch, seed ^ 0x71d8a3c5);
  }

  reset(options: { seed?: number } = {}): void {
    const seed = options.seed ?? this.seed;
    if (!validSeed(seed)) throw new Error('Reality ending needs a uint32 seed.');
    this.seed = seed;
    this.relightCurve = seededCurve(relight, seed);
    this.glitchCurve = seededCurve(glitch, seed ^ 0x71d8a3c5);
    this.phase = 'idle'; this.previousWorld = null; this.originalDamage = false; this.seconds = 0;
    this.capturedBrightness = null; this.returnedCount = 0; this.narrationCount = 0; this.paused = false;
    this.trigger = null; this.afterExplosions = null; this.glitchStart = REALITY_ENDING.dimensionSeconds;
  }

  /** Past event counts remain historical; only an explicit new game clears them. */
  cancel(): void {
    this.phase = 'cancelled'; this.previousWorld = null; this.originalDamage = false;
    this.seconds = 0; this.capturedBrightness = null; this.paused = false;
    this.trigger = null; this.afterExplosions = null; this.glitchStart = REALITY_ENDING.dimensionSeconds;
  }

  update(sample: RealityEndingSample): void {
    if (this.phase === 'cancelled') return;
    const valid = Number.isFinite(sample.dt) && sample.dt >= 0 && sample.dt <= .5 &&
      Number.isFinite(sample.brightness) && sample.brightness >= 0 && sample.brightness <= 1 && worldPhases.includes(sample.worldPhase) &&
      (sample.explosionsFinished === undefined || typeof sample.explosionsFinished === 'boolean') &&
      (sample.farBoundaryMetres == null || Number.isFinite(sample.farBoundaryMetres));
    if (this.phase === 'idle') {
      // Unaccepted idle samples cannot synthesize an earlier return edge.
      if (!sample.eligible || !valid || !sample.collapseStarted || ['idle', 'cancelled'].includes(sample.worldPhase)) return;
      this.phase = 'armed';
      this.previousWorld = sample.worldPhase;
    }
    if (!sample.eligible || !valid || ['idle', 'cancelled'].includes(sample.worldPhase)) { this.cancel(); return; }
    if (this.trigger === null) {
      if (sample.worldPhase === 'complete' && sample.farBoundaryMetres != null &&
          sample.farBoundaryMetres >= 0 && sample.farBoundaryMetres <= REALITY_ENDING.boundaryMetres + 1e-9) {
        this.trigger = 'boundary'; this.glitchStart = 0; this.seconds = 0; this.phase = 'glitching';
        return;
      }
      if (sample.worldPhase === 'returning') { this.phase = 'returning'; this.originalDamage = true; }
      if (this.originalDamage && this.previousWorld === 'returning' && sample.worldPhase === 'original') {
        this.returnedCount = 1; this.seconds = 0; this.capturedBrightness = sample.brightness; this.phase = 'relighting';
        this.trigger = 'return'; this.previousWorld = sample.worldPhase;
        return; // Actual return wins if it arrives before a fallback fires.
      }
      if (this.afterExplosions !== null) this.afterExplosions += sample.dt;
      else if (sample.explosionsFinished) this.afterExplosions = 0;
      if (this.afterExplosions !== null && this.afterExplosions + 1e-9 >= REALITY_ENDING.afterExplosionsSeconds) {
        this.trigger = 'timeout'; this.glitchStart = 0;
        this.seconds = Math.max(0, this.afterExplosions - REALITY_ENDING.afterExplosionsSeconds);
        this.phase = 'glitching';
      }
      this.previousWorld = sample.worldPhase;
      return; // The observed endpoint frame starts the dimension clock at zero.
    }
    this.previousWorld = sample.worldPhase;
    this.paused = this.trigger === 'return' && sample.worldPhase !== 'original';
    if (this.paused || sample.dt === 0 || this.phase === 'white') return;
    const end = this.glitchStart + REALITY_ENDING.glitchSeconds;
    this.seconds = Math.min(end, this.seconds + sample.dt);
    if (this.seconds + 1e-9 >= end) {
      this.seconds = end; this.phase = 'white'; this.narrationCount = 1;
    } else if (this.seconds + 1e-9 >= this.glitchStart) {
      this.phase = 'glitching';
    } else if (this.seconds + 1e-9 >= REALITY_ENDING.relightSeconds) {
      this.phase = 'holding';
    } else this.phase = 'relighting';
  }

  snapshot() {
    const active = this.phase !== 'idle' && this.phase !== 'cancelled';
    const arrived = active && this.trigger === 'return';
    const brightness = !arrived || this.capturedBrightness === null ? null
      : this.seconds + 1e-9 >= REALITY_ENDING.relightSeconds ? 1
      : this.capturedBrightness + (1 - this.capturedBrightness) * sampleCurve(this.relightCurve, this.seconds / REALITY_ENDING.relightSeconds);
    const glitchProgress = !active || this.trigger === null || this.seconds < this.glitchStart ? 0
      : clamp((this.seconds - this.glitchStart) / REALITY_ENDING.glitchSeconds);
    const environmentOpacity = this.phase === 'white' ? 0 : this.phase === 'glitching'
      ? sampleCurve(this.glitchCurve, glitchProgress) : 1;
    return { phase: this.phase, active, originalDamage: this.originalDamage,
      dimensionSeconds: this.seconds, brightness, capturedBrightness: this.capturedBrightness,
      glitchProgress, environmentOpacity, returnedCount: this.returnedCount, narrationCount: this.narrationCount,
      trigger: this.trigger, afterExplosionsSeconds: this.afterExplosions,
      blocksPortal: active && (this.originalDamage || this.trigger !== null), paused: this.paused, seed: this.seed };
  }
}
