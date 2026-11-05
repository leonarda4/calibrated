import { Matrix4, Vector3 } from 'three';
import type { HoleTurnGeometry } from './holeWorldRotation.ts';

type Point3 = readonly [number, number, number];

export const HOLE_PORTAL_HYSTERESIS = .08;
export const HOLE_PORTAL_MAX_STEP = .75;
export const HOLE_PORTAL_MAX_SPEED = 4;
const POSITION_ALLOWANCE = .10;
const APERTURE_EPSILON = .0001;

function rigid(matrix: Matrix4): boolean {
  const e = matrix.elements;
  const axes = [new Vector3(e[0],e[1],e[2]), new Vector3(e[4],e[5],e[6]), new Vector3(e[8],e[9],e[10])];
  return e.every(Number.isFinite) && Math.abs(e[3])+Math.abs(e[7])+Math.abs(e[11])+Math.abs(e[15]-1)<1e-8 &&
    Math.abs(matrix.determinant()-1)<1e-6 && axes.every(axis => Math.abs(axis.length()-1)<1e-6) &&
    Math.abs(axes[0].dot(axes[1]))+Math.abs(axes[0].dot(axes[2]))+Math.abs(axes[1].dot(axes[2]))<1e-6;
}

/** A physical viewer sweep through the frozen, vertically presented hole. */
export class HolePortalCrossing {
  private worldToRoute: Matrix4 | null = null;
  private corners: number[][] | null = null;
  private normal: number[] | null = null;
  private floorY = 0;
  private startZ = 0;
  private endZ = 0;
  private near: [number,number] = [0,0];
  private far: [number,number] = [0,0];
  private previous: { world: Vector3; route: Vector3 } | null = null;
  private armed = false;
  private pending = false;
  private crossings = 0;

  capture(hole: HoleTurnGeometry, finalPresentation: Matrix4 | readonly number[]): boolean {
    this.reset();
    const validBounds = (bounds: readonly number[] | null) => bounds?.length === 2 && bounds.every(Number.isFinite) && bounds[1]>bounds[0];
    if (!hole.open || !validBounds(hole.nearBounds) || !validBounds(hole.farBounds) ||
        ![hole.floorY,hole.startZ,hole.endZ].every(Number.isFinite) || hole.endZ<=hole.startZ ||
        hole.routeToWorld.length!==16 || !hole.routeToWorld.every(Number.isFinite)) return false;
    if (!(finalPresentation instanceof Matrix4) && (finalPresentation.length!==16 || !finalPresentation.every(Number.isFinite))) return false;
    const route = new Matrix4().fromArray(hole.routeToWorld);
    const final = finalPresentation instanceof Matrix4 ? finalPresentation.clone() : new Matrix4().fromArray(finalPresentation);
    if (!rigid(route) || !rigid(final) || new Vector3(0,1,0).transformDirection(route).distanceTo(new Vector3(0,1,0))>1e-6) return false;
    const combined = final.multiply(route), normal = new Vector3(0,1,0).transformDirection(combined);
    if (Math.abs(normal.y)>1e-6) return false;
    this.floorY=hole.floorY; this.startZ=hole.startZ; this.endZ=hole.endZ;
    this.near=[hole.nearBounds![0],hole.nearBounds![1]]; this.far=[hole.farBounds![0],hole.farBounds![1]];
    this.worldToRoute=combined.clone().invert(); this.normal=normal.toArray();
    this.corners=[
      [this.near[0],this.floorY,this.startZ], [this.near[1],this.floorY,this.startZ],
      [this.far[1],this.floorY,this.endZ], [this.far[0],this.floorY,this.endZ],
    ].map(p => new Vector3(...p).applyMatrix4(combined).toArray());
    return true;
  }

  clearSamples(): void { this.previous=null; this.armed=false; this.pending=false; }
  reset(): void {
    this.clearSamples(); this.worldToRoute=null; this.corners=null; this.normal=null; this.crossings=0;
  }

  private inside(point: Vector3): boolean {
    if (point.z<=this.startZ+APERTURE_EPSILON || point.z>=this.endZ-APERTURE_EPSILON) return false;
    const along=(point.z-this.startZ)/(this.endZ-this.startZ);
    const left=this.near[0]+along*(this.far[0]-this.near[0]), right=this.near[1]+along*(this.far[1]-this.near[1]);
    return point.x>left+APERTURE_EPSILON && point.x<right-APERTURE_EPSILON;
  }

  update(sample: { position: Point3 | null; deltaSeconds: number; eligible: boolean }): boolean {
    const {position,deltaSeconds,eligible}=sample;
    if (!this.worldToRoute || !eligible || !position || position.length!==3 || !position.every(Number.isFinite) ||
        !Number.isFinite(deltaSeconds) || deltaSeconds<=0 || deltaSeconds>.5) { this.clearSamples(); return false; }
    const world=new Vector3(...position), point=world.clone().applyMatrix4(this.worldToRoute);
    if (!point.toArray().every(Number.isFinite)) { this.clearSamples(); return false; }
    const signed=point.y-this.floorY, previous=this.previous;
    if (previous) {
      const distance=world.distanceTo(previous.world);
      if (distance>HOLE_PORTAL_MAX_STEP || distance>HOLE_PORTAL_MAX_SPEED*deltaSeconds+POSITION_ALLOWANCE) {
        this.clearSamples(); return false;
      }
    }
    this.previous={world,route:point};
    if (!previous || !this.armed) {
      if (signed<=-HOLE_PORTAL_HYSTERESIS) { this.armed=true; this.pending=false; }
      return false;
    }
    const from=previous.route.y-this.floorY;
    if (from<=0 && signed>=0 && signed-from>1e-9) {
      const hit=previous.route.clone().lerp(point,-from/(signed-from));
      if (!this.inside(hit)) { this.armed=false; this.pending=false; return false; }
      this.pending=true;
    }
    if (this.pending && !this.inside(point)) { this.armed=false; this.pending=false; return false; }
    if (signed<0) this.pending=false;
    if (this.pending && signed>=HOLE_PORTAL_HYSTERESIS) {
      this.pending=false; this.armed=false; this.crossings++; return true;
    }
    return false;
  }

  snapshot() { return { captured:this.worldToRoute!==null, armed:this.armed, pendingHit:this.pending, crossings:this.crossings,
    signedDistance:this.previous ? this.previous.route.y-this.floorY : null,
    worldCorners:this.corners?.map(p=>[...p]) ?? null, normalWorld:this.normal ? [...this.normal] : null }; }
}
