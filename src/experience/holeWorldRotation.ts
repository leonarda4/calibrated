import { Matrix4, Vector3 } from 'three';

export const HOLE_WORLD_ROTATION_SECONDS = 4;
export type HoleTurnPhase = 'idle' | 'turning' | 'complete' | 'returning' | 'original' | 'cancelled';
export interface HoleTurnGeometry {
  open: boolean;
  floorY: number;
  startZ: number;
  endZ: number;
  nearBounds: readonly number[] | null;
  farBounds: readonly number[] | null;
  routeToWorld: readonly number[];
  floorSide: 'start' | 'end';
}

/** Zero velocity and acceleration at both endpoints. */
export function easeHoleTurn(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** A rigid visual turn around the source FLOOR edge, never the viewer. */
export class HoleWorldRotation {
  private phase: HoleTurnPhase = 'idle';
  private elapsed = 0;
  private hinge: Vector3 | null = null;
  private axis = new Vector3(1, 0, 0);
  private transform = new Matrix4();
  private floorSide: 'start' | 'end' | null = null;
  private captured: HoleTurnGeometry | null = null;

  private angle(): number {
    const fraction = easeHoleTurn(this.elapsed / HOLE_WORLD_ROTATION_SECONDS);
    if (this.phase === 'returning') return Math.PI / 2 * (1 - fraction);
    if (this.phase === 'complete') return Math.PI / 2;
    return this.phase === 'turning' ? Math.PI / 2 * fraction : 0;
  }

  private applyAngle(): void {
    const angle = this.angle(), p = this.hinge!;
    if (angle === 0) { this.transform.identity(); return; }
    this.transform.makeTranslation(p.x,p.y,p.z)
      .multiply(new Matrix4().makeRotationAxis(this.axis,angle))
      .multiply(new Matrix4().makeTranslation(-p.x,-p.y,-p.z));
  }

  start(hole: HoleTurnGeometry): boolean {
    if (this.phase !== 'idle') return false;
    const bounds = hole.floorSide === 'end' ? hole.farBounds : hole.nearBounds;
    const validBounds = (edge: readonly number[] | null) => edge?.length === 2 && edge.every(Number.isFinite) && edge[1]>edge[0];
    if (!hole.open || !['start','end'].includes(hole.floorSide) || !bounds || !validBounds(hole.nearBounds) || !validBounds(hole.farBounds) ||
      hole.endZ <= hole.startZ || hole.routeToWorld.length !== 16 ||
      ![hole.floorY,hole.startZ,hole.endZ,...bounds,...hole.routeToWorld].every(Number.isFinite)) return false;
    const route = new Matrix4().fromArray(hole.routeToWorld);
    const x = new Vector3(1,0,0).transformDirection(route), up = new Vector3(0,1,0).applyMatrix4(route).sub(new Vector3().applyMatrix4(route));
    const scales = new Vector3().setFromMatrixScale(route);
    if (Math.abs(route.determinant()-1) > 1e-6 || scales.toArray().some(v=>Math.abs(v-1)>1e-6) || up.distanceTo(new Vector3(0,1,0))>1e-6 ||
      Math.abs(route.elements[3])+Math.abs(route.elements[7])+Math.abs(route.elements[11])+Math.abs(route.elements[15]-1)>1e-8) return false;
    this.floorSide = hole.floorSide;
    this.hinge = new Vector3((bounds[0]+bounds[1])/2,hole.floorY,hole.floorSide === 'end' ? hole.endZ : hole.startZ).applyMatrix4(route);
    this.axis.copy(x).multiplyScalar(hole.floorSide === 'end' ? 1 : -1);
    this.captured = { ...hole, nearBounds: hole.nearBounds ? [...hole.nearBounds] : null,
      farBounds: hole.farBounds ? [...hole.farBounds] : null, routeToWorld: [...hole.routeToWorld] };
    this.elapsed = 0; this.transform.identity(); this.phase = 'turning';
    return true;
  }

  /** Return through the captured doorway without changing its hinge or rig. */
  returnToOriginal(): boolean {
    if (this.phase !== 'complete') return false;
    this.elapsed = 0; this.phase = 'returning';
    return true;
  }

  /** A later visit reuses the same geometry, never accumulates another pitch. */
  rotateIntoCutout(): boolean {
    if (this.phase !== 'original' || !this.hinge || !this.captured) return false;
    this.elapsed = 0; this.phase = 'turning';
    return true;
  }

  update(seconds: number, eligible: boolean): void {
    if (!['turning','complete','returning','original'].includes(this.phase)) return;
    if (!eligible || !Number.isFinite(seconds) || seconds < 0 || seconds > .5) { this.cancel(); return; }
    if (this.phase === 'complete' || this.phase === 'original' || seconds === 0) return;
    const returning = this.phase === 'returning';
    this.elapsed = Math.min(HOLE_WORLD_ROTATION_SECONDS,this.elapsed+seconds);
    if (this.elapsed + 1e-9 >= HOLE_WORLD_ROTATION_SECONDS) {
      this.elapsed = HOLE_WORLD_ROTATION_SECONDS; this.phase = returning ? 'original' : 'complete';
    }
    this.applyAngle();
  }

  cancel(): void { this.phase = 'cancelled'; this.elapsed = 0; this.transform.identity(); }
  reset(): void { this.phase = 'idle'; this.elapsed = 0; this.hinge = null; this.floorSide = null;
    this.captured = null; this.axis.set(1,0,0); this.transform.identity(); }
  matrix(): Matrix4 { return this.transform.clone(); }
  geometry(): HoleTurnGeometry | null {
    return this.captured ? { ...this.captured, nearBounds: this.captured.nearBounds ? [...this.captured.nearBounds] : null,
      farBounds: this.captured.farBounds ? [...this.captured.farBounds] : null, routeToWorld: [...this.captured.routeToWorld] } : null;
  }
  snapshot() { return { phase:this.phase, seconds:this.elapsed, durationSeconds:HOLE_WORLD_ROTATION_SECONDS,
    angleDegrees:this.angle()*180/Math.PI, floorSide:this.floorSide,
    hingeWorld:this.hinge?.toArray() ?? null, axisWorld:this.axis.toArray(), matrix:this.transform.toArray() }; }
}
