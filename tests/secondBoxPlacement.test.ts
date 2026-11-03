import test from 'node:test';
import assert from 'node:assert/strict';
import { placeWallAdjacentBox, type SecondBoxPlacementResult } from '../src/experience/secondBoxPlacement.ts';
import type { HallwayCenterResult, HallwayPoint } from '../src/experience/hallwayCenter.ts';

type Fit = Extract<HallwayCenterResult, { ok: true }>;
const near = (actual: number, expected: number, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} expected ${expected}`);
const nearPoint = (actual: HallwayPoint, expected: HallwayPoint) => actual.forEach((value, axis) => near(value, expected[axis]));
const success = (result: SecondBoxPlacementResult) => {
  if (!result.ok) assert.fail(result.reason);
  return result;
};
const fit = (centerWorld: [number, number, number] = [0, 0, 4.7], directionWorld: [number, number, number] = [0, 0, 1]): Fit => {
  const length = Math.hypot(directionWorld[0], directionWorld[2]);
  const nx = directionWorld[2] / length, nz = -directionWorld[0] / length;
  return {
  ok: true, centerWorld, directionWorld, centerRaw: [...centerWorld], width: 2.1,
  clearanceLeft: 1.05, clearanceRight: 1.05, residual: 0.02,
  wallPlanes: {
    left: { point: [centerWorld[0] - nx * 1.05, centerWorld[1], centerWorld[2] - nz * 1.05],
      normal: [nx, 0, nz], residual: 0.02 },
    right: { point: [centerWorld[0] + nx * 1.05, centerWorld[1], centerWorld[2] + nz * 1.05],
      normal: [-nx, 0, -nz], residual: 0.02 },
  },
  evidence: { scannedPoints: 1000, eligiblePoints: 800, occupiedCells: 300 },
  };
};

test('corner guide gives one edge on the nearest wall and another on the operator line', () => {
  const result = success(placeWallAdjacentBox({ wallFit: fit(), guideWorld: [-0.85, 0, 4.7], guideMode: 'corner', tangentSign: 1, floorY: 0 }));
  nearPoint(result.wallPoint, [-1.05, 0, 4.7]);
  nearPoint(result.baseWorld, [-0.87, 0, 4.88]);
  nearPoint(result.centerWorld, [-0.87, 0.215, 4.88]);
  near(result.wallDistance, 0.18);
  near(result.tangentOffset, 0.18);
  assert.equal(result.wallSide, 'left');
  assert.equal(result.footprint.filter(point => Math.abs(point[0] + 1.05) < 1e-10).length, 2);
  assert.equal(result.footprint.filter(point => Math.abs(point[2] - 4.7) < 1e-10).length, 2);
  assert.equal(result.evidence.guideSource, 'operator');
  near(result.evidence.guideToWallDistance, 0.2);
  near(result.evidence.oppositeWallClearance, 1.74);
});

test('the opposite wall and marked side are handled symmetrically', () => {
  const result = success(placeWallAdjacentBox({ wallFit: fit(), guideWorld: [1, 0, 4.7], guideMode: 'corner', tangentSign: -1, floorY: 0 }));
  nearPoint(result.wallPoint, [1.05, 0, 4.7]);
  nearPoint(result.baseWorld, [0.87, 0, 4.52]);
  assert.equal(result.wallSide, 'right');
  near(result.tangentOffset, -0.18);
  assert.equal(result.footprint.filter(point => Math.abs(point[2] - 4.7) < 1e-10).length, 2);
});

test('centre guide preserves the operator longitudinal station while snapping the wall-side edge', () => {
  const result = success(placeWallAdjacentBox({ wallFit: fit(), guideWorld: [0.8, 0, 5.1], guideMode: 'center', floorY: 0 }));
  nearPoint(result.baseWorld, [0.87, 0, 5.1]);
  assert.equal(result.tangentOffset, 0);
  assert.equal(result.floorLineOffset, null);
});

test('a centre guide can use an independent operator floor line without treating it as detected geometry', () => {
  const result = success(placeWallAdjacentBox({
    wallFit: fit(), guideWorld: [-0.8, 0, 4.7], guideMode: 'center',
    floorLineWorld: [0.2, 7, 4.4], tangentSign: 1, floorY: 0,
  }));
  nearPoint(result.baseWorld, [-0.87, 0, 4.58]);
  near(result.tangentOffset, -0.12);
  near(result.floorLineOffset!, 0.18);
  assert.equal(result.evidence.floorLineSource, 'operator');
  nearPoint(result.evidence.floorLineWorld!, [0.2, 7, 4.4]);
  assert.equal(result.footprint.filter(point => Math.abs(point[2] - 4.4) < 1e-10).length, 2);
});

test('nonzero yaw and translation preserve exact metric corner distances', () => {
  const yaw = 0.63, c = Math.cos(yaw), s = Math.sin(yaw);
  const transform = (point: HallwayPoint): [number, number, number] => [5 + c * point[0] + s * point[2], point[1], -3 - s * point[0] + c * point[2]];
  const result = success(placeWallAdjacentBox({
    wallFit: fit(transform([0, 0, 4.7]), [s, 0, c]),
    guideWorld: transform([-0.85, 0, 4.7]), guideMode: 'corner', tangentSign: 1, floorY: 0,
  }));
  nearPoint(result.baseWorld, transform([-0.87, 0, 4.88]));
  near(result.yaw, yaw);
  const n = [c, 0, -s], d = [s, 0, c];
  const normalOffsets = result.footprint.map(point => (point[0] - result.wallPoint[0]) * n[0] + (point[2] - result.wallPoint[2]) * n[2]);
  const alongOffsets = result.footprint.map(point => (point[0] - result.wallPoint[0]) * d[0] + (point[2] - result.wallPoint[2]) * d[2]);
  near(Math.min(...normalOffsets), 0);
  near(Math.max(...normalOffsets), 0.36);
  near(Math.min(...alongOffsets), 0);
  near(Math.max(...alongOffsets), 0.36);
});

test('floor is the supplied XR plane regardless of guide or wall-fit height', () => {
  const result = success(placeWallAdjacentBox({ wallFit: fit([0, 12, 4.7]), guideWorld: [-0.8, 37, 4.7], guideMode: 'center', floorY: 0 }));
  assert.equal(result.baseWorld[1], 0);
  assert.equal(result.wallPoint[1], 0);
  assert.equal(result.centerWorld[1], 0.215);
  assert.ok(result.footprint.every(point => point[1] === 0));
});

test('custom metric width, depth and height affect only their corresponding offsets', () => {
  const result = success(placeWallAdjacentBox({
    wallFit: fit(), guideWorld: [-0.8, 0, 4.7], guideMode: 'corner', tangentSign: -1, floorY: 0,
    boxWidth: 0.4, boxDepth: 0.6, boxHeight: 0.8,
  }));
  nearPoint(result.baseWorld, [-0.85, 0, 4.4]);
  nearPoint(result.centerWorld, [-0.85, 0.4, 4.4]);
  near(result.wallDistance, 0.2);
  near(result.tangentOffset, -0.3);
});

test('placement is a detached world snapshot and retains no live wall-fit or guide references', () => {
  const wallFit = fit();
  const guide: [number, number, number] = [-0.85, 0, 4.7];
  const result = success(placeWallAdjacentBox({ wallFit, guideWorld: guide, guideMode: 'corner', tangentSign: 1, floorY: 0 }));
  const before = JSON.stringify(result);
  wallFit.centerWorld[0] = 300;
  wallFit.directionWorld[2] = -1;
  guide[0] = 500;
  assert.equal(JSON.stringify(result), before);
});

test('reversing the fitted direction preserves a centre-guided physical footprint', () => {
  const normal = success(placeWallAdjacentBox({ wallFit: fit(), guideWorld: [0.85, 0, 4.7], guideMode: 'center', floorY: 0 }));
  const reversed = success(placeWallAdjacentBox({ wallFit: fit([0, 0, 4.7], [0, 0, -2]), guideWorld: [0.85, 0, 4.7], guideMode: 'center', floorY: 0 }));
  nearPoint(normal.baseWorld, reversed.baseWorld);
  for (const corner of normal.footprint) {
    assert.ok(reversed.footprint.some(other => Math.hypot(corner[0] - other[0], corner[2] - other[2]) < 1e-10));
  }
});

test('ambiguous walls, missing corner side and invalid geometry fail without inventing a placement', () => {
  const base = { wallFit: fit(), guideWorld: [-0.8, 0, 4.7] as const, guideMode: 'center' as const, floorY: 0 };
  assert.equal(placeWallAdjacentBox({ ...base, guideWorld: [0, 0, 4.7] }).ok, false);
  assert.equal(placeWallAdjacentBox({ ...base, guideMode: 'corner' }).ok, false);
  assert.equal(placeWallAdjacentBox({ ...base, floorLineWorld: [0, 0, 4.4] }).ok, false);
  assert.equal(placeWallAdjacentBox({ ...base, floorLineWorld: [0, NaN, 4.4], tangentSign: 1 }).ok, false);
  assert.equal(placeWallAdjacentBox({ ...base, guideWorld: [Infinity, 0, 4.7] }).ok, false);
  assert.equal(placeWallAdjacentBox({ ...base, floorY: NaN }).ok, false);
  assert.equal(placeWallAdjacentBox({ ...base, boxWidth: 2.1 }).ok, false);
  assert.equal(placeWallAdjacentBox({ ...base, boxHeight: -1 }).ok, false);
  assert.equal(placeWallAdjacentBox({ ...base, wallFit: { ...fit(), directionWorld: [0, 0, 0] } }).ok, false);
  assert.equal(placeWallAdjacentBox({ ...base, wallFit: { ...fit(), directionWorld: [0, 0.2, 1] } }).ok, false);
  assert.equal(placeWallAdjacentBox({ ...base, wallFit: { ...fit(), width: NaN } }).ok, false);
});
