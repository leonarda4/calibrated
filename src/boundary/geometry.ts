// Boundary coordinates stay in metres; no rendering, XR or calibration imports.
export type Point3 = readonly [number, number, number];

export interface ManualRectangleConfig {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  yawDegrees: number;
  floorY: number;
}

const POINT_EPSILON = 1e-7;

/** Keep the supplied perimeter, including concave sections; never replace it by an AABB. */
export function normalizeBoundary(points: readonly Point3[]): Point3[] | null {
  if (!Array.isArray(points) || points.length < 3 || points.length > 4096) return null;
  const result: Point3[] = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) return null;
    const previous = result.at(-1);
    if (!previous || Math.hypot(...point.map((value, i) => value - previous[i])) > POINT_EPSILON) {
      result.push([point[0], point[1], point[2]]);
    }
  }
  if (result.length >= 2) {
    const first = result[0], last = result[result.length - 1];
    if (Math.hypot(...first.map((value, i) => value - last[i])) <= POINT_EPSILON) result.pop();
  }
  if (result.length < 3) return null;
  // Compute around the first point to avoid cancellation for offset spaces.
  const origin = result[0];
  let twiceArea = 0;
  for (let i = 0; i < result.length; i++) {
    const a = result[i], b = result[(i + 1) % result.length];
    twiceArea += (a[0] - origin[0]) * (b[2] - origin[2]) - (b[0] - origin[0]) * (a[2] - origin[2]);
  }
  return Number.isFinite(twiceArea) && Math.abs(twiceArea) > 1e-6 ? result : null;
}

/** An operator-authored outline, independent of the headset-reported polygon. */
export function manualRectangle(config: ManualRectangleConfig): Point3[] {
  const keys = ['centerX', 'centerZ', 'width', 'depth', 'yawDegrees', 'floorY'] as const;
  if (keys.some(key => !Number.isFinite(config[key]))) throw new Error('Manual boundary values must be finite numbers.');
  if (config.width <= 0 || config.depth <= 0 || config.width > 100 || config.depth > 100) {
    throw new Error('Manual boundary width and depth must be greater than zero and at most 100 metres.');
  }
  const yaw = config.yawDegrees * Math.PI / 180;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const points: Point3[] = [
    [-config.width / 2, 0, -config.depth / 2],
    [config.width / 2, 0, -config.depth / 2],
    [config.width / 2, 0, config.depth / 2],
    [-config.width / 2, 0, config.depth / 2],
  ];
  const rectangle = points.map(([x, , z]): Point3 => [
    config.centerX + c * x + s * z,
    config.floorY,
    config.centerZ - s * x + c * z,
  ]);
  const result = normalizeBoundary(rectangle);
  if (!result) throw new Error('Manual boundary is too small or its coordinates are invalid.');
  return result;
}

/** Column-major WebXR matrix maps bounded-floor coordinates into active XR space. */
export function transformBoundary(points: readonly Point3[], matrix: ArrayLike<number>): Point3[] | null {
  const perimeter = normalizeBoundary(points);
  if (!perimeter || matrix.length !== 16 || Array.from(matrix).some(value => !Number.isFinite(value))) return null;
  const result: Point3[] = [];
  for (const [x, y, z] of perimeter) {
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (!Number.isFinite(w) || Math.abs(w - 1) > 1e-5) return null;
    result.push([
      matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
      matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
      matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    ]);
  }
  return normalizeBoundary(result);
}
