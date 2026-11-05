import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Matrix4, Vector3 } from 'three';
import { captureRealityDamage, protectRealityUser, REALITY_USER_CLEARANCE } from '../src/experience/realityEndingDamage.ts';
import type { Point3 } from '../src/boundary/geometry.ts';

const near = (actual: number, expected: number, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
function corridor(rawToRoute = new Matrix4(), sparseOutliers = false) {
  const inverse = rawToRoute.clone().invert(), points: number[] = [];
  const add = (x: number, y: number, z: number) => points.push(...new Vector3(x, y, z).applyMatrix4(inverse).toArray());
  for (let z = -24; z <= 26.00001; z += .25) for (const x of [-1, 1]) for (const y of [.1, 1.3, 2.5]) add(x, y, z);
  if (sparseOutliers) {
    add(0, 1, -400); add(0, 1, 400); // Finite, plausible in-frame records, below the 1% threshold.
    for (const z of [-450, 450]) {
      for (let count = 0; count < 100; count++) { add(8, 1, z); add(0, 9, z); }
    }
    add(0, 1, 900); add(0, 1, -900); // Beyond the bounded source interval.
    points.push(NaN, 0, 0, 0, Infinity, 0, 0, 0, -Infinity);
  }
  return new Float32Array(points);
}
const position: Point3 = [.1, 1.6, 1];
const opening: readonly [number, number] = [-2.9, -.3];

test('captures the two original-corridor ends in metres under nonzero scan yaw and translation', () => {
  const baseline = captureRealityDamage(corridor(), new Matrix4(), position, opening)!;
  assert.ok(baseline); assert.ok(baseline.endRange[0] < -23 && baseline.endRange[1] > 25);
  for (const yaw of [0, Math.PI / 2, Math.PI, -.63]) {
    const matrix = new Matrix4().makeRotationFromEuler(new Euler(.12, yaw, -.08)).setPosition(3.2, .45, -7.1);
    const result = captureRealityDamage(corridor(matrix), matrix, position, opening);
    assert.ok(result, `Valid rigid capture rejected at yaw ${yaw}`);
    result.endRange.forEach((value, index) => near(value, baseline.endRange[index], .21));
    assert.deepEqual(result.safeRange, baseline.safeRange);
    assert.deepEqual(result.rawToRoute, matrix.toArray());
    assert.ok([...result.endRange, ...result.safeRange, ...result.rawToRoute].every(Number.isFinite));
  }
});

test('dense end ranges ignore sparse long-distance records and unrelated side-room or ceiling records', () => {
  const matrix = new Matrix4().makeRotationY(.93).setPosition(-6, .2, 11);
  const result = captureRealityDamage(corridor(matrix, true), matrix, position, opening);
  assert.ok(result);
  assert.ok(result.endRange[0] > -27 && result.endRange[0] < -20, `Sparse negative outlier changed the end: ${result.endRange}`);
  assert.ok(result.endRange[1] > 22 && result.endRange[1] < 29, `Sparse positive outlier changed the end: ${result.endRange}`);
  assert.ok(result.endRange[1] - result.endRange[0] > 44, 'Robust selection must retain both ends rather than just the central corridor');
});

test('the captured hole, four-metre player vicinity and optional physical bounds all enlarge protection', () => {
  assert.equal(REALITY_USER_CLEARANCE, 4);
  const source = corridor(), matrix = new Matrix4();
  const base = captureRealityDamage(source, matrix, position, opening)!;
  near(base.safeRange[0], -3.9); near(base.safeRange[1], 5);
  const distantHole = captureRealityDamage(source, matrix, position, [-12, -9])!;
  assert.deepEqual(distantHole.safeRange, [-13, 5]);
  const boundary = captureRealityDamage(source, matrix, position, opening, [-7, 9])!;
  assert.deepEqual(boundary.safeRange, [-8, 10]);
  const shiftedPlayer = captureRealityDamage(source, matrix, [.1, 1.6, 16], opening, [-7, 9])!;
  assert.deepEqual(shiftedPlayer.safeRange, [-8, 20]);
});

test('current-user protection grows in both directions and never shrinks or edits captured geometry', () => {
  const capture = captureRealityDamage(corridor(), new Matrix4(), position, opening, [-7, 9])!;
  const frame = [...capture.rawToRoute], ends = [...capture.endRange];
  protectRealityUser(capture, -12); assert.deepEqual(capture.safeRange, [-16, 10]);
  protectRealityUser(capture, 22); assert.deepEqual(capture.safeRange, [-16, 26]);
  for (const value of [0, 7, -2, NaN, Infinity, -Infinity]) {
    protectRealityUser(capture, value); assert.deepEqual(capture.safeRange, [-16, 26]);
  }
  assert.deepEqual(capture.rawToRoute, frame); assert.deepEqual(capture.endRange, ends);
});

test('capture and high-water updates leave all supplied source arrays, points and transforms unchanged', () => {
  const matrix = new Matrix4().makeRotationY(-.78).setPosition(4, .1, -8), beforeMatrix = matrix.toArray();
  const source = corridor(matrix), beforeSource = new Uint8Array(source.buffer.slice(0));
  const point = Object.freeze([.1, 1.6, 1]) as Point3;
  const hole = Object.freeze([-2.9, -.3]) as readonly [number, number];
  const bounds = Object.freeze([-7, 9]);
  const result = captureRealityDamage(source, matrix, point, hole, bounds)!;
  assert.ok(result); protectRealityUser(result, 32); result.rawToRoute[12] += 100;
  assert.deepEqual(matrix.toArray(), beforeMatrix);
  assert.deepEqual(new Uint8Array(source.buffer), beforeSource);
  assert.deepEqual(point, [.1, 1.6, 1]); assert.deepEqual(hole, [-2.9, -.3]); assert.deepEqual(bounds, [-7, 9]);
});

test('nonmetric, singular, nonfinite and projective transforms cannot capture metre-based damage', () => {
  const source = corridor();
  const invalid = [new Matrix4().makeScale(2, 1, 1), new Matrix4().makeScale(-1, 1, 1), new Matrix4().makeScale(0, 1, 1)];
  const shear = new Matrix4(); shear.elements[4] = .15; invalid.push(shear);
  for (const [element, value] of [[3, 1e-4], [7, 1e-4], [11, 1e-4], [15, 1.000001], [12, NaN], [13, Infinity]] as const) {
    const matrix = new Matrix4(); matrix.elements[element] = value; invalid.push(matrix);
  }
  for (const matrix of invalid) {
    const before = matrix.toArray();
    assert.equal(captureRealityDamage(source, matrix, position, opening), null, `Invalid matrix accepted: ${JSON.stringify(before)}`);
    assert.deepEqual(matrix.toArray(), before);
  }
});

test('empty, unsupported, degenerate and nonfinite capture inputs never produce unsafe ranges', () => {
  const matrix = new Matrix4(), source = corridor();
  for (const centers of [new Float32Array(), new Float32Array(4),
    new Float32Array(Array.from({ length: 31 }, (_, index) => [1, 1, index - 15]).flat()),
    new Float32Array(Array.from({ length: 40 }, () => [1, 1, 2]).flat()),
    new Float32Array(Array.from({ length: 40 }, () => [NaN, Infinity, -Infinity]).flat())]) {
    assert.equal(captureRealityDamage(centers, matrix, position, opening), null);
  }
  for (const point of [[NaN, 1, 0], [0, Infinity, 0], [0, 1, -Infinity], [], [0, 1]] as unknown as Point3[]) {
    assert.equal(captureRealityDamage(source, matrix, point, opening), null);
  }
  for (const range of [[NaN, 2], [-2, Infinity], [2, -2], [1, 1], [], [-2], [-2, 2, 5]] as unknown as (readonly [number, number])[]) {
    assert.equal(captureRealityDamage(source, matrix, position, range), null);
  }
  assert.equal(captureRealityDamage(source, matrix, position, opening, [NaN]), null);
  assert.equal(captureRealityDamage(source, matrix, position, opening, [Infinity]), null);
});
