export type WallTravelMode = 'stopped' | 'forward' | 'backward' | 'loop';

export function validateWallTravel(distance: number, speed: number): void {
  if (!Number.isFinite(distance) || distance <= 0 || distance > 10) throw new Error('Wall travel must be above 0 and at most 10 metres.');
  if (!Number.isFinite(speed) || speed <= 0 || speed > 1) throw new Error('Wall speed must be above 0 and at most 1 m/s.');
}

/** Distance along the hallway; independent of rendering and the side slide. */
export class WallTravel {
  private mode: WallTravelMode = 'stopped';
  private elapsed = 0;
  private offset = 0;
  private distance = 1;
  private speed = .15;

  snapshot() { return { mode: this.mode, offset: this.offset, distance: this.distance, speed: this.speed, moving: this.mode !== 'stopped' }; }

  start(mode: Exclude<WallTravelMode, 'stopped'>, distance: number, speed: number): void {
    if (!['forward', 'backward', 'loop'].includes(mode)) throw new Error('Unknown wall motion.');
    validateWallTravel(distance, speed);
    this.mode = mode; this.distance = distance; this.speed = speed;
    this.elapsed = 0; this.offset = 0;
  }

  update(deltaSeconds: number): void {
    if (this.mode === 'stopped' || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.elapsed += deltaSeconds;
    const travelled = this.elapsed * this.speed;
    if (this.mode === 'loop') {
      // Smooth reversals at +/- distance; speed is the maximum speed.
      this.offset = this.distance * Math.sin(travelled / this.distance);
    } else {
      this.offset = (this.mode === 'forward' ? 1 : -1) * Math.min(this.distance, travelled);
      if (travelled >= this.distance) this.mode = 'stopped';
    }
  }

  reset(): void { this.mode = 'stopped'; this.elapsed = 0; this.offset = 0; }
}
