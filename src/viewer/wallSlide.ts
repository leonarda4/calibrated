export type WallMotion = 'hidden' | 'entering' | 'visible' | 'exiting';

/** Both legs move rightward: off-left -> centre -> off-right. */
export class WallSlide {
  private motion: WallMotion = 'hidden';
  private elapsed = 0;
  private distance = 0;
  private readonly seconds: number;

  constructor(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Wall slide duration must be positive.');
    this.seconds = seconds;
  }

  snapshot() {
    const progress = Math.min(1, this.elapsed / this.seconds);
    const eased = progress * progress * (3 - 2 * progress);
    const offset = this.motion === 'entering' ? this.distance * (eased - 1)
      : this.motion === 'exiting' ? this.distance * eased
      : this.motion === 'visible' ? 0 : this.distance;
    return { motion: this.motion, offset, progress,
      animating: this.motion === 'entering' || this.motion === 'exiting' };
  }

  show(distance: number): boolean {
    if (!Number.isFinite(distance) || distance <= 0) throw new Error('Wall slide distance must be positive.');
    if (this.motion !== 'hidden') return false;
    this.distance = distance;
    this.elapsed = 0;
    this.motion = 'entering';
    return true;
  }

  hide(): boolean {
    if (this.motion !== 'visible') return false;
    this.elapsed = 0;
    this.motion = 'exiting';
    return true;
  }

  update(deltaSeconds: number): void {
    if (!this.snapshot().animating || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.elapsed = Math.min(this.seconds, this.elapsed + deltaSeconds);
    if (this.elapsed === this.seconds) this.motion = this.motion === 'entering' ? 'visible' : 'hidden';
  }

  /** Recovery cancels rather than queuing another visible motion. */
  reset(): void {
    this.motion = 'hidden';
    this.distance = 0;
    this.elapsed = 0;
  }
}
