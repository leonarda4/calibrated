export const WALL_REVEAL_WATCH_SECONDS = 5;

/** Hidden-wall gate: look away now, or watch continuously for five valid seconds. */
export class WallRevealGate {
  private watched = 0;

  reset(): void { this.watched = 0; }

  remainingSeconds(): number { return Math.max(0, WALL_REVEAL_WATCH_SECONDS - this.watched); }

  update(seconds: number, looking: boolean | null): boolean {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > .5 || looking === null) {
      this.reset(); return false;
    }
    if (!looking) { this.reset(); return true; }
    const elapsed = this.watched + seconds;
    this.watched = elapsed >= WALL_REVEAL_WATCH_SECONDS - 1e-9 ? WALL_REVEAL_WATCH_SECONDS : elapsed;
    return this.watched === WALL_REVEAL_WATCH_SECONDS;
  }
}
