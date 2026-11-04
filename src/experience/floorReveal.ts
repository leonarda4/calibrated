export type FloorRevealMotion = 'hidden' | 'entering' | 'visible' | 'exiting';

/** Visual displacement only: the placement and interaction volume stay fixed. */
export class FloorReveal {
  private motion: FloorRevealMotion = 'hidden';
  private elapsed = 0;
  readonly seconds: number;

  constructor(seconds = 1.5) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Floor reveal duration must be positive.');
    this.seconds = seconds;
  }

  snapshot() {
    const progress = Math.min(1, this.elapsed / this.seconds);
    const eased = progress * progress * (3 - 2 * progress);
    const fraction = this.motion === 'entering' ? eased : this.motion === 'exiting' ? 1 - eased
      : this.motion === 'visible' ? 1 : 0;
    return { motion: this.motion, fraction, animating: this.motion === 'entering' || this.motion === 'exiting' };
  }

  show(): boolean {
    if (this.motion === 'visible') return true;
    if (this.motion !== 'hidden') return false;
    this.motion = 'entering'; this.elapsed = 0;
    return true;
  }

  hide(): boolean {
    if (this.motion !== 'visible') return false;
    this.motion = 'exiting'; this.elapsed = 0;
    return true;
  }

  update(deltaSeconds: number): void {
    if (!this.snapshot().animating || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.elapsed = Math.min(this.seconds, this.elapsed + deltaSeconds);
    if (this.elapsed === this.seconds) this.motion = this.motion === 'entering' ? 'visible' : 'hidden';
  }

  reset(): void { this.motion = 'hidden'; this.elapsed = 0; }
}
