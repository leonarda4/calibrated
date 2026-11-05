import type { HallwayCenterResult } from '../experience/hallwayCenter.ts';

type Section = Extract<HallwayCenterResult, { ok: true }>;

/** Fit once and anchor the final midpoint; the route owns no scan/cache state. */
export function lockWallTrajectory(sections: readonly Section[], depth: number) {
  if (sections.length < 2 || !Number.isFinite(depth) || depth <= 0) throw new Error('Wall route needs supported sections and full slab depth.');
  // Centre the standing endpoint exactly between its fitted wall planes.
  // Constrain the least-squares line through that point once, before sizing it.
  const endpoint = sections[sections.length - 1].centerWorld;
  const endX = endpoint[0], endZ = endpoint[2];
  const variance = sections.reduce((sum, fit) => sum + (fit.centerWorld[2] - endZ) ** 2, 0);
  if (!Number.isFinite(variance) || variance < 1e-8) throw new Error('Wall route needs distinct finite stations.');
  const slope = sections.reduce((sum, fit) => sum + (fit.centerWorld[2] - endZ) * (fit.centerWorld[0] - endX), 0) / variance;
  const xAt = (z: number) => endX + slope * (z - endZ);
  const sign = sections[0].directionWorld[2] < 0 ? -1 : 1;
  const length = Math.hypot(slope, 1);
  const normal = Object.freeze([-sign * slope / length, 0, -sign / length] as const);
  const across = Object.freeze([normal[2], 0, -normal[0]] as const);
  let halfWidth = 0;
  for (const section of sections) {
    const z = section.centerWorld[2], x = xAt(z), y = section.centerWorld[1];
    for (const wall of [section.wallPlanes.left, section.wallPlanes.right]) {
      const n = wall.normal;
      const distance = n[0] * (x - wall.point[0]) + n[1] * (y - wall.point[1]) + n[2] * (z - wall.point[2]);
      const cross = Math.abs(n[0] * across[0] + n[2] * across[2]);
      if (!Number.isFinite(distance) || distance <= 0 || cross < .25) throw new Error('The fixed wall route leaves the supported hallway.');
      const along = Math.abs(n[0] * normal[0] + n[2] * normal[2]);
      halfWidth = Math.max(halfWidth, (distance + along * depth / 2) / cross);
    }
  }
  // A centimetre at each edge hides scan noise at the wall join. Width and
  // orientation never change in response to a later section or root offset.
  const width = halfWidth * 2 + .02;
  if (![slope, endX, endZ, width].every(Number.isFinite)) throw new Error('Wall route must be finite.');
  return Object.freeze({ xAt, slope, normal, across, width });
}
