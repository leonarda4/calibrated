import { boundaryClearance } from '../boundary/approachWarning.ts';
import { normalizeBoundary } from '../boundary/geometry.ts';
import type { RuntimeBoundarySnapshot } from '../xr/movementBoundary.ts';

/** Current physical headset bounds only; added-hallway +depth points away from the portal. */
export function endingBoundaryDistance(boundary: Pick<RuntimeBoundarySnapshot,'live'|'points'|'head'>,
  worldToOpening: readonly number[] | null): number | null {
  if (!boundary.live || !boundary.head || !worldToOpening || worldToOpening.length !== 16 ||
      !worldToOpening.every(Number.isFinite)) return null;
  const points = normalizeBoundary(boundary.points);
  if (!points) return null;
  // Row Z of this rigid inverse projects a world displacement onto corridor depth.
  return boundaryClearance(boundary.head, points, [worldToOpening[2], 0, worldToOpening[10]], 'forward');
}
