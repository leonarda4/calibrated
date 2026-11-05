import type { HallwayCenterResult, HallwayPoint } from './hallwayCenter.ts';

type WallFit = Extract<HallwayCenterResult, { ok: true }>;
type Point = [number, number, number];

export interface SecondBoxPlacementOptions {
  wallFit: WallFit;
  /** Operator-supplied location transformed through the PRE-TURN scan matrix. */
  guideWorld: HallwayPoint;
  /** A corner guide marks a transverse line; a centre guide marks the box station. */
  guideMode: 'corner' | 'center';
  /** Optional separately picked/entered transverse floor-line guide. Not detected geometry. */
  floorLineWorld?: HallwayPoint;
  /** Which side of the operator's line receives the box, relative to fitted +Z. */
  tangentSign?: 1 | -1;
  floorY: number;
  boxWidth?: number;
  boxDepth?: number;
  boxHeight?: number;
  wallClearance?: number;
}

export type SecondBoxPlacementResult = {
  ok: true;
  baseWorld: Point;
  centerWorld: Point;
  directionWorld: Point;
  yaw: number;
  wallSide: 'left' | 'right';
  /** Projection of the supplied guide onto the selected fitted wall at floorY. */
  wallPoint: Point;
  /** Fitted separation of the opposing walls, in world metres. */
  width: number;
  /** Perpendicular centre-to-selected-wall distance: half width plus clearance. */
  wallDistance: number;
  /** Signed shift from the approximate box guide's station to the final centre. */
  tangentOffset: number;
  /** Signed centre-to-line offset; null when no line guide was supplied. */
  floorLineOffset: number | null;
  /** Four floor-contact corners in perimeter order, independent of future scan rotation. */
  footprint: readonly [Point, Point, Point, Point];
  evidence: {
    guideMode: 'corner' | 'center';
    guideSource: 'operator';
    guideWorld: Point;
    floorLineSource: 'operator' | null;
    floorLineWorld: Point | null;
    guideToWallDistance: number;
    oppositeWallClearance: number;
    wallFitResidual: number;
  };
} | { ok: false; reason: string };

function finitePoint(value: HallwayPoint): boolean {
  return value.length === 3 && value.every(Number.isFinite);
}

/**
 * Freeze a metric wall-adjacent footprint in XR world space. The fitted walls are
 * appearance estimates; the transverse line is an operator guide, never a line
 * detected from splat colour/geometry. No scan objects or mutable transforms are
 * retained, so showing the box later cannot follow the artistic hallway turn.
 */
export function placeWallAdjacentBox(options: SecondBoxPlacementOptions): SecondBoxPlacementResult {
  const fail = (reason: string): SecondBoxPlacementResult => ({ ok: false, reason });
  const { wallFit, guideWorld } = options;
  if (!wallFit.ok || !finitePoint(wallFit.centerWorld) || !finitePoint(wallFit.directionWorld)
    || !finitePoint(guideWorld) || !Number.isFinite(options.floorY)
    || !Number.isFinite(wallFit.width) || wallFit.width <= 0
    || !Number.isFinite(wallFit.residual) || wallFit.residual < 0) {
    return fail('The second box needs a finite wall fit, guide and floor.');
  }
  if (options.guideMode !== 'corner' && options.guideMode !== 'center') {
    return fail('Choose whether the operator guide marks a corner or the box centre.');
  }
  const floorLine = options.floorLineWorld ?? (options.guideMode === 'corner' ? guideWorld : null);
  if (floorLine && !finitePoint(floorLine)) return fail('The operator floor-line guide must be finite.');
  if (floorLine && options.tangentSign !== 1 && options.tangentSign !== -1) {
    return fail('Choose which side of the operator line receives the second box.');
  }
  const boxWidth = options.boxWidth ?? 0.36;
  const boxDepth = options.boxDepth ?? 0.36;
  const boxHeight = options.boxHeight ?? 0.43;
  const clearance = options.wallClearance ?? 0;
  if (![boxWidth, boxDepth, boxHeight].every(value => Number.isFinite(value) && value > 0 && value <= 5)
    || !Number.isFinite(clearance) || clearance < 0 || boxWidth + clearance >= wallFit.width) {
    return fail('The box dimensions must be positive metres and fit between the walls.');
  }
  const length = Math.hypot(wallFit.directionWorld[0], wallFit.directionWorld[2]);
  if (!Number.isFinite(length) || length < 1e-9 || Math.abs(wallFit.directionWorld[1]) > length * 1e-6) {
    return fail('The fitted wall direction must be horizontal.');
  }
  const dx = wallFit.directionWorld[0] / length, dz = wallFit.directionWorld[2] / length;
  const nx = dz, nz = -dx;
  const gx = guideWorld[0] - wallFit.centerWorld[0], gz = guideWorld[2] - wallFit.centerWorld[2];
  const lateral = gx * nx + gz * nz;
  const along = gx * dx + gz * dz;
  const lineAlong = floorLine
    ? (floorLine[0] - wallFit.centerWorld[0]) * dx + (floorLine[2] - wallFit.centerWorld[2]) * dz
    : along;
  const halfHallway = wallFit.width / 2;
  const leftDistance = Math.abs(lateral + halfHallway), rightDistance = Math.abs(lateral - halfHallway);
  if (!Number.isFinite(lateral) || !Number.isFinite(along) || !Number.isFinite(lineAlong)
    || Math.abs(leftDistance - rightDistance) < 1e-6) {
    return fail('The guide does not identify a nearest wall. Place it nearer the intended wall.');
  }
  const wallSign = leftDistance < rightDistance ? -1 : 1;
  const wallPoint: Point = [
    wallFit.centerWorld[0] + nx * wallSign * halfHallway + dx * lineAlong,
    options.floorY,
    wallFit.centerWorld[2] + nz * wallSign * halfHallway + dz * lineAlong,
  ];
  const floorLineOffset = floorLine ? options.tangentSign! * boxDepth / 2 : null;
  const tangentOffset = lineAlong - along + (floorLineOffset ?? 0);
  const baseWorld: Point = [
    wallPoint[0] - nx * wallSign * (boxWidth / 2 + clearance) + dx * (floorLineOffset ?? 0),
    options.floorY,
    wallPoint[2] - nz * wallSign * (boxWidth / 2 + clearance) + dz * (floorLineOffset ?? 0),
  ];
  const footprint = [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([widthSign, depthSign]) => [
    baseWorld[0] + nx * widthSign * boxWidth / 2 + dx * depthSign * boxDepth / 2,
    options.floorY,
    baseWorld[2] + nz * widthSign * boxWidth / 2 + dz * depthSign * boxDepth / 2,
  ] as Point) as [Point, Point, Point, Point];
  if (![...baseWorld, ...wallPoint, ...footprint.flat()].every(Number.isFinite)) {
    return fail('The second-box placement exceeds finite world coordinates.');
  }
  return {
    ok: true, baseWorld,
    centerWorld: [baseWorld[0], options.floorY + boxHeight / 2, baseWorld[2]],
    directionWorld: [dx, 0, dz], yaw: Math.atan2(dx, dz),
    wallSide: wallSign < 0 ? 'left' : 'right', wallPoint, width: wallFit.width,
    wallDistance: boxWidth / 2 + clearance, tangentOffset, floorLineOffset, footprint,
    evidence: {
      guideMode: options.guideMode, guideSource: 'operator', guideWorld: [...guideWorld],
      floorLineSource: floorLine ? 'operator' : null, floorLineWorld: floorLine ? [...floorLine] : null,
      guideToWallDistance: Math.min(leftDistance, rightDistance),
      oppositeWallClearance: wallFit.width - boxWidth - clearance, wallFitResidual: wallFit.residual,
    },
  };
}
