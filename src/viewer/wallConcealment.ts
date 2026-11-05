type Point3 = readonly [number, number, number];

export interface WallConcealmentGeometry {
  position: Point3;
  normal: Point3;
  right: Point3;
  width: number;
  height: number;
  halfDepth: number;
}

/** A small inward overlap avoids revealing an aperture along a noisy wall edge. */
export const WALL_CONCEALMENT_MARGIN = .001;
const EPSILON = 1e-7;
const BASIS_TOLERANCE = 1e-5;

const point = (p: readonly number[] | null | undefined): p is Point3 =>
  p?.length === 3 && p.every(Number.isFinite);
const dot = (a: readonly number[], b: readonly number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const difference = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Test the complete floor aperture against the actual upright, full-depth wall.
 * All inputs share one metric hallway frame. The eye-facing slab face must lie
 * strictly between the eye and every corner; its projected convex quadrilateral
 * must then fit inside the wall rectangle. Four contained corners therefore
 * conceal the entire fitted floor trapezoid, not merely its centre.
 */
export function wallConcealsHole(playerRoute: Point3 | null, wall: WallConcealmentGeometry,
  corners: readonly Point3[] | null): boolean {
  if (!point(playerRoute) || !wall || !point(wall.position) || !point(wall.normal) || !point(wall.right) ||
      ![wall.width, wall.height, wall.halfDepth].every(Number.isFinite) ||
      wall.width <= WALL_CONCEALMENT_MARGIN * 2 || wall.height <= WALL_CONCEALMENT_MARGIN * 2 || wall.halfDepth < 0 ||
      corners?.length !== 4 || !corners.every(point)) return false;

  const normalLength = Math.hypot(...wall.normal), rightLength = Math.hypot(...wall.right);
  if (Math.abs(normalLength - 1) > BASIS_TOLERANCE || Math.abs(rightLength - 1) > BASIS_TOLERANCE ||
      Math.abs(wall.normal[1]) > BASIS_TOLERANCE || Math.abs(wall.right[1]) > BASIS_TOLERANCE ||
      Math.abs(dot(wall.normal, wall.right)) > BASIS_TOLERANCE) return false;
  const normal = wall.normal.map(value => value / normalLength), right = wall.right.map(value => value / rightLength);

  // The floor snapshot stores near-left, near-right, far-left, far-right, so
  // checking triangle areas avoids assuming a perimeter order or winding.
  if (corners.some(p => Math.abs(p[1] - corners[0][1]) > EPSILON)) return false;
  const triangleAreas = [1, 2, 3].flatMap((a, index) => [1, 2, 3].slice(index + 1).map(b =>
    Math.abs((corners[a][0] - corners[0][0]) * (corners[b][2] - corners[0][2]) -
      (corners[a][2] - corners[0][2]) * (corners[b][0] - corners[0][0]))));
  if (Math.max(...triangleAreas) <= EPSILON) return false;

  const eyeDistance = dot(difference(playerRoute, wall.position), normal);
  if (Math.abs(eyeDistance) <= wall.halfDepth + EPSILON) return false;
  const faceDistance = Math.sign(eyeDistance) * wall.halfDepth;
  const halfWidth = wall.width / 2 - WALL_CONCEALMENT_MARGIN;
  const bottom = wall.position[1] + WALL_CONCEALMENT_MARGIN;
  const top = wall.position[1] + wall.height - WALL_CONCEALMENT_MARGIN;
  return corners.every(corner => {
    const ray = difference(corner, playerRoute);
    const denominator = dot(ray, normal);
    if (Math.abs(denominator) <= EPSILON) return false;
    const t = (faceDistance - eyeDistance) / denominator;
    if (t <= EPSILON || t >= 1 - EPSILON) return false;
    const hit: Point3 = [playerRoute[0] + t * ray[0], playerRoute[1] + t * ray[1], playerRoute[2] + t * ray[2]];
    const across = dot(difference(hit, wall.position), right);
    return Math.abs(across) <= halfWidth && hit[1] >= bottom && hit[1] <= top;
  });
}
