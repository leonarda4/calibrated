import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateHallwayCenter, type HallwayPoint, type HallwayCenterResult } from '../src/experience/hallwayCenter.ts';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const near = (actual: number, expected: number, tolerance = 0.012) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} expected ${expected} ±${tolerance}`);
const success = (result: HallwayCenterResult) => {
  if (!result.ok) assert.fail(result.reason);
  return result;
};

function walls(options: { left?: boolean; right?: boolean; slope?: number; rightSlope?: number; floor?: number; denseLeft?: number } = {}) {
  const points: number[] = [];
  const floor = options.floor ?? 0;
  for (const [side, enabled] of [[-1, options.left !== false], [1, options.right !== false]] as const) {
    if (!enabled) continue;
    const intercept = side < 0 ? -0.9 : 1.2;
    const slope = side > 0 ? options.rightSlope ?? options.slope ?? 0 : options.slope ?? 0;
    for (let along = -1; along < 1.001; along += 0.05) {
      for (let height = 0.45; height < 1.76; height += 0.1) {
        for (let copy = 0; copy < (side < 0 ? options.denseLeft ?? 1 : 1); copy++) {
          points.push(intercept + slope * along, floor + height, along);
        }
      }
    }
  }
  return points;
}

const fit = (points: ArrayLike<number>, seedRaw: HallwayPoint = [0, 0, 0], floorY = 0) =>
  estimateHallwayCenter({ centers: points, seedRaw, floorY, modelMatrix: IDENTITY, corridorDirectionRaw: [0, 0, 1] });

test('opposing walls yield the equal-distance midpoint without changing longitudinal station', () => {
  const result = success(fit(walls(), [0, 0, 0.15]));
  near(result.centerWorld[0], 0.15);
  near(result.centerWorld[2], 0.15, 1e-12);
  near(result.width, 2.1);
  near(result.clearanceLeft, 1.05);
  near(result.clearanceRight, 1.05);
  near(result.residual, 0, 1e-10);
  assert.ok(result.evidence.left!.occupiedCells > 24);
  assert.ok(result.evidence.right!.heightSpan > 1);
});

test('an already centred seed stays centred', () => {
  const result = success(fit(walls(), [0.15, 0, 0]));
  near(result.centerWorld[0], 0.15);
  near(result.centerWorld[2], 0, 1e-12);
});

test('unequal splat densities do not pull the midpoint towards the dense side', () => {
  const regular = success(fit(walls()));
  const unequal = success(fit(walls({ denseLeft: 19 })));
  near(unequal.centerWorld[0], regular.centerWorld[0], 1e-9);
  near(unequal.width, regular.width, 1e-9);
});

test('parallel wall direction is fitted within the approximate corridor heading', () => {
  const slope = 0.14;
  const result = success(fit(walls({ slope })));
  near(result.centerWorld[0], 0.15);
  near(result.width, 2.1 / Math.sqrt(1 + slope * slope));
  near(result.directionWorld[0], slope / Math.sqrt(1 + slope * slope));
  near(result.directionWorld[2], 1 / Math.sqrt(1 + slope * slope));
});

test('yaw and translation are applied once and the returned raw point maps back to world', () => {
  const angle = 0.73, c = Math.cos(angle), s = Math.sin(angle);
  const matrix = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 8, 2, -6, 1];
  const result = success(estimateHallwayCenter({
    centers: walls(), modelMatrix: matrix, seedRaw: [0, 0, 0.2], floorY: 2,
    corridorDirectionRaw: [0, 0, 1],
  }));
  near(result.centerRaw[0], 0.15);
  near(result.centerRaw[1], 0, 1e-12);
  near(result.centerRaw[2], 0.2, 1e-12);
  near(result.centerWorld[0], 8 + c * 0.15 + s * 0.2);
  near(result.centerWorld[2], -6 - s * 0.15 + c * 0.2);
  assert.equal(result.centerWorld[1], 2);
  near(result.directionWorld[0], s);
  near(result.directionWorld[2], c);
});

test('the current raw-Y corridor orientation preserves the station and existing XR floor', () => {
  // Current profile maps raw (x,y,z) to world (-x,z,y), then subtracts the rotated start.
  const matrix = [-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 1.45, -18.6, 1];
  const points: number[] = [];
  for (let along = -1; along <= 1.001; along += 0.05) {
    for (let height = 0.45; height <= 1.75; height += 0.1) {
      points.push(0.9, 21.1 + along, -1.45 + height, 3.05, 21.1 + along, -1.45 + height);
    }
  }
  const result = success(estimateHallwayCenter({ centers: points, modelMatrix: matrix, seedRaw: [2, 21.1, -1.45], floorY: 0 }));
  near(result.centerRaw[0], 1.975);
  near(result.centerRaw[1], 21.1, 1e-12);
  near(result.centerRaw[2], -1.45, 1e-12);
  near(result.centerWorld[0], 0.025);
  near(result.centerWorld[2], 2.5, 1e-12);
  assert.equal(result.centerWorld[1], 0);
});

test('supplied floor height takes precedence over a seed above the floor', () => {
  const result = success(fit(walls({ floor: 1.2 }), [0, 1.8, 0], 1.2));
  assert.equal(result.centerWorld[1], 1.2);
  assert.equal(result.centerRaw[1], 1.2);
});

test('XYZW input ignores its fourth values and agrees with XYZ input', () => {
  const xyz = walls({ slope: 0.08 });
  const xyzw: number[] = [];
  for (let i = 0; i < xyz.length; i += 3) xyzw.push(xyz[i], xyz[i + 1], xyz[i + 2], NaN);
  const expected = success(fit(xyz));
  const result = success(estimateHallwayCenter({ centers: xyzw, stride: 4, modelMatrix: IDENTITY, seedRaw: [0, 0, 0], floorY: 0, corridorDirectionRaw: [0, 0, 1] }));
  near(result.centerWorld[0], expected.centerWorld[0], 1e-12);
  near(result.width, expected.width, 1e-12);
  assert.equal(result.evidence.scannedPoints, xyz.length / 3);
});

test('floor, ceiling, low floaters and scattered outliers do not define the walls', () => {
  const points = walls({ slope: 0.05 });
  let randomState = 12345;
  const random = () => { randomState = (randomState * 1664525 + 1013904223) >>> 0; return randomState / 0x100000000; };
  for (let n = 0; n < 1800; n++) points.push(random() * 6 - 3, random() * 1.4 + 0.4, random() * 2 - 1);
  for (let n = 0; n < 5000; n++) {
    const along = random() * 2 - 1;
    points.push(random() * 6 - 3, n % 2 ? 0.2 : 2.4, along);
  }
  points.push(NaN, 1, 0, Infinity, 1, 0);
  const result = success(fit(points));
  near(result.centerWorld[0], 0.15, 0.025);
  near(result.width, 2.1 / Math.sqrt(1 + 0.05 ** 2), 0.035);
  assert.ok(result.evidence.eligiblePoints < result.evidence.scannedPoints - 4000);
});

test('a missing wall is rejected instead of mirroring the available wall', () => {
  const result = fit(walls({ right: false }));
  assert.equal(result.ok, false);
});

test('a short or low object opposite a wall cannot supply the second wall', () => {
  const points = walls({ right: false });
  for (let along = -0.1; along <= 0.1; along += 0.01) {
    for (let height = 0.45; height < 1.8; height += 0.05) points.push(1.2, height, along);
  }
  assert.equal(fit(points).ok, false);
  const low = walls({ right: false });
  for (let along = -1; along <= 1; along += 0.02) {
    for (let height = 0.41; height < 0.7; height += 0.02) low.push(1.2, height, along);
  }
  assert.equal(fit(low).ok, false);
});

test('inconsistent nonparallel wall lines are rejected', () => {
  assert.equal(fit(walls({ slope: -0.1, rightSlope: 0.1 })).ok, false);
});

test('invalid transforms, directions, input layout and empty scans fail cleanly', () => {
  const base = { centers: walls(), modelMatrix: IDENTITY, seedRaw: [0, 0, 0] as HallwayPoint, floorY: 0, corridorDirectionRaw: [0, 0, 1] as HallwayPoint };
  for (const matrix of [[...IDENTITY.slice(0, 15), NaN], new Array(16).fill(0), [...IDENTITY.slice(0, 3), 1, ...IDENTITY.slice(4)]]) {
    assert.equal(estimateHallwayCenter({ ...base, modelMatrix: matrix }).ok, false);
  }
  assert.equal(estimateHallwayCenter({ ...base, centers: [] }).ok, false);
  assert.equal(estimateHallwayCenter({ ...base, centers: [1, 2, 3, 4] }).ok, false);
  assert.equal(estimateHallwayCenter({ ...base, corridorDirectionRaw: [0, 1, 0] }).ok, false);
  assert.equal(estimateHallwayCenter({ ...base, floorY: NaN }).ok, false);
  assert.equal(estimateHallwayCenter({ ...base, seedRaw: [0, Infinity, 0] }).ok, false);
  assert.equal(estimateHallwayCenter({ ...base, longitudinalHalfWindow: 30 }).ok, false);
});
