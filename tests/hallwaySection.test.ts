import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Group, Quaternion, Vector3 } from 'three';
import { createHallwaySections } from '../src/experience/hallwaySection.ts';
import { measureWallDistances, type HallwayCenterResult } from '../src/experience/hallwayCenter.ts';

const near = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} versus ${expected}`);
const success = (result: HallwayCenterResult) => {
  if (!result.ok) assert.fail(result.reason);
  return result;
};

function fixture(options: { yaw?: number; x?: number; z?: number; floor?: number; leftSlope?: number; rightSlope?: number; denseLeft?: number } = {}) {
  const source: number[] = [];
  for (let along = -12; along <= 12.001; along += .05) {
    for (let height = .45; height <= 1.751; height += .1) {
      for (let repeat = 0; repeat < (options.denseLeft ?? 1); repeat++) source.push(-.9 + (options.leftSlope ?? 0) * along, along, height);
      source.push(1.2 + (options.rightSlope ?? 0) * along, along, height);
    }
  }
  let centers = new Float32Array(source);
  const scan = new Group();
  // Same raw-axis convention as the protected profile: raw (X,Y,Z)->(-X,Z,Y).
  scan.quaternion.setFromEuler(new Euler(Math.PI / 2, Math.PI, 0));
  scan.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), options.yaw ?? 0));
  scan.position.set(options.x ?? 0, options.floor ?? 0, options.z ?? 0);
  scan.updateMatrixWorld(true);
  const helper = createHallwaySections({ scanRoot: scan, getCenters: () => centers.subarray(), floorY: options.floor ?? 0 });
  return { scan, helper, replaceSource() { centers = centers.slice(); }, centers,
    plane(side: 'left' | 'right') {
      const slope = side === 'left' ? options.leftSlope ?? 0 : options.rightSlope ?? 0;
      const sign = side === 'left' ? 1 : -1;
      return {
        point: new Vector3(side === 'left' ? -.9 : 1.2, 0, 0).applyMatrix4(scan.matrixWorld),
        normal: new Vector3(sign, -sign * slope, 0).transformDirection(scan.matrixWorld),
      };
    },
  };
}

test('current sections preserve exact world Z and independently equal wall distances under translation/yaw/180 degrees', () => {
  for (const yaw of [0, .63, Math.PI]) {
    const f = fixture({ yaw, x: 7, z: -2, floor: .2 });
    const result = success(f.helper.at(-1.137));
    assert.equal(result.centerWorld[1], .2); assert.equal(result.centerWorld[2], -1.137);
    const projected = new Vector3(...result.centerRaw).applyMatrix4(f.scan.matrixWorld);
    result.centerWorld.forEach((value, axis) => near(projected.getComponent(axis), value, 1e-10));
    const measured = measureWallDistances(result.wallPlanes, result.centerWorld);
    near(measured.left, 1.05); near(measured.right, 1.05); near(measured.imbalance, 0, 1e-10);
    near(result.width, measured.left + measured.right, 1e-12);
    const left = f.plane('left'), right = f.plane('right');
    const p = new Vector3(...result.centerWorld);
    near(p.clone().sub(left.point).dot(left.normal), 1.05);
    near(p.clone().sub(right.point).dot(right.normal), 1.05);
  }
});

test('nonparallel wall sections use normalised planes at each exact station, independent of unequal density', () => {
  const f = fixture({ yaw: .4, x: .8, z: -1, leftSlope: -.02, rightSlope: .05, denseLeft: 9 });
  for (const station of [-1.04, -.97, -.86, -.72]) {
    const result = success(f.helper.at(station));
    const left = f.plane('left'), right = f.plane('right');
    const constant = left.normal.dot(left.point) - right.normal.dot(right.point);
    const normal = left.normal.clone().sub(right.normal);
    const x = (constant - normal.z * station) / normal.x;
    near(result.centerWorld[0], x, .002); assert.equal(result.centerWorld[2], station);
    near(measureWallDistances(result.wallPlanes, result.centerWorld).imbalance, 0, 1e-12);
    const independent = new Vector3(...result.centerWorld);
    const dl = independent.clone().sub(left.point).dot(left.normal);
    const dr = independent.clone().sub(right.point).dot(right.normal);
    near(dl, dr, .003); near(result.width, dl + dr, .003);
  }
});

test('quarter-metre cache survives fresh source views and invalidates for source storage or root pose', () => {
  const f = fixture({ leftSlope: .02, rightSlope: -.01 });
  const a = success(f.helper.at(.01));
  const fits = f.helper.snapshot().fits;
  const b = success(f.helper.at(.09));
  assert.equal(f.helper.snapshot().fits, fits, 'fresh subarray identity must not trigger another full scan');
  assert.equal(b.centerWorld[2], .09);
  assert.ok(Math.abs(a.width - b.width) > .001, 'cached planes must be evaluated at each exact station');
  (a.wallPlanes.left.point as [number, number, number])[0] += 99;
  near(measureWallDistances(success(f.helper.at(.09)).wallPlanes, b.centerWorld).imbalance, 0, 1e-12);
  f.helper.at(.14); assert.ok(f.helper.snapshot().fits > fits, 'another station bucket requires its own supported fit');
  const beforeMove = f.helper.snapshot().fits;
  f.scan.position.x += .1;
  const moved = success(f.helper.at(.09));
  assert.ok(f.helper.snapshot().fits > beforeMove); near(moved.centerWorld[0] - b.centerWorld[0], .1);
  const beforeSource = f.helper.snapshot().fits;
  f.replaceSource(); f.helper.at(.09);
  assert.ok(f.helper.snapshot().fits > beforeSource);
  f.helper.clear(); assert.equal(f.helper.snapshot().cachedSections, 0);
});

test('unsupported inputs fail without moving the scan and cache storage stays bounded', () => {
  const scan = new Group();
  const absent = createHallwaySections({ scanRoot: scan, getCenters: () => undefined });
  assert.equal(absent.at(0).ok, false); assert.equal(absent.at(NaN).ok, false);
  const f = fixture(); const baseline = f.scan.matrixWorld.toArray();
  assert.equal(f.helper.at(Infinity).ok, false);
  f.scan.scale.setScalar(2); assert.equal(f.helper.at(0).ok, false);
  f.scan.scale.setScalar(1);
  f.scan.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));
  const transverse = f.helper.at(0); assert.equal(transverse.ok, false);
  if (!transverse.ok) assert.match(transverse.reason, /transverse/);
  f.scan.quaternion.setFromEuler(new Euler(Math.PI / 2, Math.PI, 0));
  for (let station = -10; station <= 10; station += .25) f.helper.at(station);
  assert.ok(f.helper.snapshot().cachedSections <= 64);
  f.scan.updateMatrixWorld(true); assert.deepEqual(f.scan.matrixWorld.toArray(), baseline);
  const missingWall = createHallwaySections({ scanRoot: f.scan,
    getCenters: () => new Float32Array(Array.from(f.centers).filter((_, index) => Math.floor(index / 3) % 2 === 0)) });
  const unsupported = missingWall.at(0); assert.equal(unsupported.ok, false);
});
