import { measureWallDistances, type HallwayPoint, type HallwayWallPlanes } from './hallwayCenter.ts';

/** Keep the seat's world-Z station, with one full footprint edge on a fitted wall. */
export function alignBoxToWall(options: {
  walls: HallwayWallPlanes;
  reference: HallwayPoint;
  direction: HallwayPoint;
  preferredNormal?: HallwayPoint;
  width?: number;
  depth?: number;
}) {
  const { walls, reference, direction, preferredNormal } = options;
  const width = options.width ?? .36, depth = options.depth ?? .36;
  const finite = (p: HallwayPoint) => p.length === 3 && p.every(Number.isFinite);
  if (!finite(reference) || !finite(direction) || (preferredNormal && !finite(preferredNormal)) ||
    !Number.isFinite(width) || width <= 0 || !Number.isFinite(depth) || depth <= 0) {
    throw new Error('Seat alignment needs finite metric coordinates and dimensions.');
  }
  const distances = measureWallDistances(walls, reference);
  const dot = (a: HallwayPoint, b: HallwayPoint) => a[0] * b[0] + a[2] * b[2];
  const side = preferredNormal
    ? (dot(walls.left.normal, preferredNormal) >= dot(walls.right.normal, preferredNormal) ? 'left' : 'right')
    : (Math.abs(distances.left) <= Math.abs(distances.right) ? 'left' : 'right');
  const wall = walls[side], n = wall.normal;
  if (Math.abs(n[1]) > 1e-6 || Math.abs(n[0]) < .15 || Math.hypot(direction[0], direction[2]) < 1e-9) {
    throw new Error('The seat wall must run along the world-Z station.');
  }
  const z = reference[2], y = reference[1];
  const x = (width / 2 + dot(n, wall.point) - n[2] * z) / n[0];
  const sign = dot([-n[2], 0, n[0]], direction) >= 0 ? 1 : -1;
  const tangent: [number, number, number] = [-n[2] * sign, 0, n[0] * sign];
  const base: [number, number, number] = [x, y, z];
  const corners = [-1, 1].flatMap(across => [-1, 1].map(along => [
    x + across * n[0] * width / 2 + along * tangent[0] * depth / 2, y,
    z + across * n[2] * width / 2 + along * tangent[2] * depth / 2,
  ] as [number, number, number]));
  const opposite = side === 'left' ? 'right' : 'left';
  if (corners.some(point => measureWallDistances(walls, point)[opposite] < -1e-6)) {
    throw new Error('The seat footprint does not fit between the current walls.');
  }
  return { base, direction: tangent, yaw: Math.atan2(tangent[0], tangent[2]),
    inwardNormal: [...n] as [number, number, number], wallSide: side, corners };
}
