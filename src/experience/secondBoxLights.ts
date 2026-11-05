import { GAMEPLAY_TIMING } from './gameplayTiming.ts';

export const SECOND_BOX_LIGHT_DELAY = 2;
export const LIGHT_FLICKER_SECONDS = GAMEPLAY_TIMING.flickerDurationSeconds;
export const SECOND_BOX_DARK_BRIGHTNESS = .30;

type Phase = 'idle' | 'waiting' | 'flickering' | 'dark' | 'cancelled';
// Irregular, diminishing relights. Smooth each transition without a random
// per-frame value, so frame rate never changes the character of the effect.
const relights = [[0, 1], [.07, 0], [.13, .95], [.22, .08], [.29, .8], [.39, 0],
  [.47, .6], [.55, 0], [.66, .35], [.75, 0], [.84, .15], [1, 0]] as const;

/** Pure timing/appearance only; settled visibility comes from the installation. */
export class SecondBoxLights {
  private readonly delaySeconds: number;
  constructor(delaySeconds = SECOND_BOX_LIGHT_DELAY) { this.delaySeconds = delaySeconds; }
  private phase: Phase = 'idle';
  private elapsed = 0;
  private visible = false;
  private needsHidden = false;
  private fresh = false;

  observe(visible: boolean): void {
    if (!visible) {
      this.visible = false; this.needsHidden = false;
      if (this.phase === 'waiting' || this.phase === 'flickering') this.phase = 'cancelled';
    } else if (!this.visible && !this.needsHidden) {
      this.visible = true; this.phase = 'waiting'; this.elapsed = 0; this.fresh = true;
    }
  }

  cancel(): void {
    this.phase = 'cancelled'; this.elapsed = 0; this.needsHidden = true; this.fresh = false;
  }

  update(deltaSeconds: number): void {
    if (!['waiting', 'flickering'].includes(this.phase) || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    if (deltaSeconds > .5) { this.cancel(); return; }
    if (this.fresh) { this.fresh = false; return; }
    this.elapsed += deltaSeconds;
    if (this.phase === 'waiting' && this.elapsed + 1e-9 >= this.delaySeconds) {
      this.phase = 'flickering'; this.elapsed = 0;
    } else if (this.phase === 'flickering' && this.elapsed + 1e-9 >= LIGHT_FLICKER_SECONDS) {
      this.phase = 'dark'; this.elapsed = LIGHT_FLICKER_SECONDS;
    }
  }

  snapshot() {
    let relight = 0;
    if (this.phase === 'flickering') {
      for (let i = 1; i < relights.length; i++) {
        const [time, level] = relights[i], [previousTime, previousLevel] = relights[i - 1];
        if (this.elapsed > time) continue;
        const t = Math.min(1, Math.max(0, (this.elapsed - previousTime) / (time - previousTime)));
        relight = previousLevel + (level - previousLevel) * t * t * (3 - 2 * t);
        break;
      }
    }
    return { phase: this.phase, relight, remainingSeconds: this.phase === 'waiting'
      ? Math.max(0, this.delaySeconds - this.elapsed) : null };
  }
}
