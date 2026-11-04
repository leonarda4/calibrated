/** Visual-only exit, timed from the frame that actually completes the turn. */
export class BoxGlitch {
  private elapsed: number | null = null;
  readonly delay = 1;
  readonly seconds = .55;

  snapshot() {
    const elapsed = this.elapsed;
    const progress = elapsed === null ? 0 : Math.min(1, Math.max(0, (elapsed - this.delay) / this.seconds));
    const phase = elapsed === null ? 'idle' : elapsed < this.delay ? 'waiting'
      : progress < 1 ? 'glitching' : 'hidden';
    return { phase, progress } as const;
  }

  arm(): void { this.elapsed = 0; }
  reset(): void { this.elapsed = null; }
  update(deltaSeconds: number): void {
    if (this.elapsed === null || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.elapsed = Math.min(this.delay + this.seconds, this.elapsed + deltaSeconds);
  }
}
