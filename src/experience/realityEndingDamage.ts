import { Matrix4, Vector3 } from 'three';
import type { Point3 } from '../boundary/geometry.ts';

export const REALITY_USER_CLEARANCE = 4;
export interface RealityDamageCapture {
  rawToRoute: number[];
  safeRange: [number, number];
  endRange: [number, number];
}

/** Capture metric source depth, excluding sparse distant records with a histogram. */
export function captureRealityDamage(centers: Float32Array, rawToRoute: Matrix4, positionRoute: Point3,
  openingRange: readonly [number, number], boundaryDepths: readonly number[] = []): RealityDamageCapture | null {
  const e = rawToRoute.elements;
  if (!centers.length || centers.length % 3 || positionRoute.length!==3 || openingRange.length!==2 ||
      openingRange[0]>=openingRange[1] || !e.every(Number.isFinite) ||
      Math.abs(rawToRoute.determinant() - 1) > 1e-5 ||
      Math.abs(e[3])+Math.abs(e[7])+Math.abs(e[11])+Math.abs(e[15]-1)>1e-8 ||
      ![...positionRoute, ...openingRange, ...boundaryDepths].every(Number.isFinite)) return null;
  const axes = [new Vector3(e[0],e[1],e[2]),new Vector3(e[4],e[5],e[6]),new Vector3(e[8],e[9],e[10])];
  if (axes.some(a => Math.abs(a.length()-1)>1e-5) ||
      axes.some((a,i)=>axes.some((b,j)=>i!==j&&Math.abs(a.dot(b))>1e-5))) return null;
  const p = new Vector3(); let low = Infinity, high = -Infinity, count = 0;
  const each = (visit: (z:number)=>void) => {
    for(let i=0;i<centers.length;i+=3) {
      p.set(centers[i],centers[i+1],centers[i+2]).applyMatrix4(rawToRoute);
      if (!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z)|| Math.abs(p.x-positionRoute[0])>3 || p.y<-.3 || p.y>3.5 || Math.abs(p.z)>500) continue;
      visit(p.z);
    }
  };
  each(z=>{low=Math.min(low,z);high=Math.max(high,z);count++;});
  if(count<32 || high-low<2) return null;
  const bins = new Uint32Array(256), span=high-low;
  each(z=>{bins[Math.min(255,Math.floor((z-low)/span*256))]++;});
  const percentile = (fraction:number) => {
    let total=0;
    for(let i=0;i<256;i++) {total+=bins[i];if(total>=count*fraction)return low+(i+.5)/256*span;}
    return high;
  };
  return { rawToRoute:rawToRoute.toArray(), endRange:[percentile(.01),percentile(.99)],
    safeRange:[Math.min(positionRoute[2]-REALITY_USER_CLEARANCE, ...openingRange.map(z=>z-1),...boundaryDepths.map(z=>z-1)),
      Math.max(positionRoute[2]+REALITY_USER_CLEARANCE,...openingRange.map(z=>z+1),...boundaryDepths.map(z=>z+1))] };
}

/** Protection grows while exploring the original dimension, never shrinks. */
export function protectRealityUser(capture: RealityDamageCapture, depth: number): void {
  if(!Number.isFinite(depth)) return;
  capture.safeRange[0]=Math.min(capture.safeRange[0],depth-REALITY_USER_CLEARANCE);
  capture.safeRange[1]=Math.max(capture.safeRange[1],depth+REALITY_USER_CLEARANCE);
}
