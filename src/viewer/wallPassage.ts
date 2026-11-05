import { Vector3 } from 'three';

type Point3 = readonly [number, number, number];
export interface WallPassageGeometry {
  position: Point3;
  normal: Point3;
  right: Point3;
  width: number;
  height: number;
  halfDepth: number;
}

/** Detect physical passage through both faces, never passage caused by wall motion. */
export class WallPassage {
  private previous: Vector3 | null = null;
  private signature = '';
  private side = 0;
  private pending = 0;

  reset(): void { this.previous = null; this.signature = ''; this.side = 0; this.pending = 0; }

  update(player: Point3 | null, dt: number, wall: WallPassageGeometry): { playerRoute: Point3; direction: 1 | -1 } | null {
    if (!player || !player.every(Number.isFinite) || !Number.isFinite(dt) || dt <= 0 || dt > .5 ||
        ![...wall.position, ...wall.normal, ...wall.right, wall.width, wall.height, wall.halfDepth].every(Number.isFinite) ||
        wall.width <= 0 || wall.height <= 0 || wall.halfDepth < 0) { this.reset(); return null; }
    const point = new Vector3(...player), previous = this.previous;
    const signature = JSON.stringify(wall);
    const moved = signature !== this.signature;
    if (previous && (point.distanceTo(previous) > .75 || point.distanceTo(previous) > 4 * dt + .1)) {
      this.reset(); return null;
    }
    this.previous = point; this.signature = signature;
    const base = new Vector3(...wall.position), normal = new Vector3(...wall.normal), right = new Vector3(...wall.right);
    const signed = point.clone().sub(base).dot(normal);
    const inside = (p: Vector3) => Math.abs(p.clone().sub(base).dot(right)) < wall.width / 2 - 1e-9 &&
      p.y > base.y + 1e-9 && p.y < base.y + wall.height - 1e-9;
    const outside = wall.halfDepth + .05;
    if (!previous || moved) { this.pending = 0; this.side = Math.abs(signed) >= outside ? Math.sign(signed) : 0; return null; }
    const from = previous.clone().sub(base).dot(normal);
    if (this.side && this.side * from >= 0 && this.side * signed <= 0 && Math.abs(signed - from) > 1e-9) {
      const hit = previous.clone().lerp(point, -from / (signed - from));
      if (!inside(hit)) { this.side = 0; this.pending = 0; return null; }
      this.pending = -this.side;
    }
    if (!inside(point)) { this.side = 0; this.pending = 0; return null; }
    if (this.pending && this.pending * signed >= outside) {
      const direction = Math.sign(this.pending * normal.z) || Math.sign(point.z - previous.z);
      this.reset();
      return { playerRoute: [...player], direction: direction < 0 ? -1 : 1 };
    }
    if (this.pending && this.pending * signed < 0) this.pending = 0;
    if (!this.pending && Math.abs(signed) >= outside) this.side = Math.sign(signed);
    return null;
  }
}
