// src/viewer: ray→splat-centers intersection, used to pick a scan landmark by
// aiming the controller at the hallway. Works on the CPU against the splat
// center Float32Array (only on click — not per frame — so the brute force is
// fine at ~266k points).

import * as THREE from 'three';

export interface RaycastOptions {
  /** Max distance [m] between the ray line and a splat center to count as a hit. */
  hitRadius?: number;
  /** Splats within this radius [m] of the first hit are averaged for the result. */
  refineRadius?: number;
}

/**
 * Cast a ray (in the scan's LOCAL frame) against the splat centers.
 * Returns the refined hit point (local frame) or null when nothing is hit.
 * Heuristic, v1: among centers within hitRadius of the ray, take the one
 * nearest to the ray origin, then average all centers within refineRadius of
 * it — mitigates lone flyer splats in front of the surface.
 */
export function raycastSplatCenters(
  centers: Float32Array,
  rayOriginLocal: THREE.Vector3,
  rayDirLocal: THREE.Vector3,
  options?: RaycastOptions,
): THREE.Vector3 | null {
  const hitRadius = options?.hitRadius ?? 0.12;
  const refineRadius = options?.refineRadius ?? 0.15;
  const d = rayDirLocal.clone().normalize();
  const ox = rayOriginLocal.x, oy = rayOriginLocal.y, oz = rayOriginLocal.z;
  const dx = d.x, dy = d.y, dz = d.z;

  let bestT = Infinity;
  let found = false;
  for (let i = 0; i < centers.length; i += 3) {
    const vx = centers[i] - ox, vy = centers[i + 1] - oy, vz = centers[i + 2] - oz;
    const t = vx * dx + vy * dy + vz * dz;
    if (t <= 0 || t >= bestT) continue;
    const perp2 = vx * vx + vy * vy + vz * vz - t * t;
    if (perp2 > hitRadius * hitRadius) continue;
    bestT = t;
    found = true;
  }
  if (!found) return null;

  const hit = new THREE.Vector3(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);

  // refine: centroid of nearby splat centers
  let sx = 0, sy = 0, sz = 0, n = 0;
  const r2 = refineRadius * refineRadius;
  for (let i = 0; i < centers.length; i += 3) {
    const ex = centers[i] - hit.x, ey = centers[i + 1] - hit.y, ez = centers[i + 2] - hit.z;
    if (ex * ex + ey * ey + ez * ez <= r2) {
      sx += centers[i]; sy += centers[i + 1]; sz += centers[i + 2];
      n++;
    }
  }
  if (n > 0) hit.set(sx / n, sy / n, sz / n);
  return hit;
}