/** Visual-only disappearance, armed once the wall actually reaches its endpoint. */
export class WallGlitch {
  private elapsed: number | null = null;
  readonly holdSeconds: number;
  readonly seconds: number;

  constructor(options: { holdSeconds?: number; seconds?: number } = {}) {
    this.holdSeconds = options.holdSeconds ?? .15;
    this.seconds = options.seconds ?? .55;
    if (!Number.isFinite(this.holdSeconds) || this.holdSeconds < 0 ||
        !Number.isFinite(this.seconds) || this.seconds <= 0) {
      throw new Error('Wall disappearance needs a nonnegative hold and positive glitch duration.');
    }
  }

  snapshot() {
    const elapsed = this.elapsed;
    const progress = elapsed === null ? 0 : Math.min(1, Math.max(0, (elapsed - this.holdSeconds) / this.seconds));
    const phase = elapsed === null ? 'idle' : elapsed < this.holdSeconds ? 'waiting'
      : progress < 1 ? 'glitching' : 'hidden';
    return { phase, progress } as const;
  }

  /** Repeated endpoint notifications cannot restart an exit or revive a hidden wall. */
  arm(): boolean {
    if (this.elapsed !== null) return false;
    this.elapsed = 0;
    return true;
  }

  reset(): void { this.elapsed = null; }

  update(deltaSeconds: number): void {
    if (this.elapsed === null || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.elapsed = Math.min(this.holdSeconds + this.seconds, this.elapsed + deltaSeconds);
  }
}
