import test from 'node:test';
import assert from 'node:assert/strict';
import { scanOriginForStart } from '../src/viewer/scanPlacement.ts';

const rawStart = [3, -2.1, 4.5] as const;
const identityRotation = [0, 0, 0, 1] as const;
const nearPoint = (actual: readonly number[], expected: readonly number[]) => {
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-12,
    `axis ${axis}: ${actual[axis]} versus ${expected[axis]}`);
};

test('Y-up raw PLY starting floor point maps exactly to the XR origin', () => {
  const translation = scanOriginForStart(rawStart, identityRotation);
  nearPoint(translation, [-3, 2.1, -4.5]);
  nearPoint(rawStart.map((coordinate, axis) => coordinate + translation[axis]), [0, 0, 0]);
});

test('raw box base remains on the same floor at world Z minus 2.5 metres', () => {
  const rawBoxBase = [3, -2.1, 2] as const;
  const translation = scanOriginForStart(rawStart, identityRotation);
  nearPoint(rawBoxBase.map((coordinate, axis) => coordinate + translation[axis]), [0, 0, -2.5]);
});

test('nonidentity scan orientation rotates the raw anchor before deriving translation', () => {
  const oldZUpRotation = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
  const translation = scanOriginForStart(rawStart, oldZUpRotation);
  // Analytically, -90° about X maps (x,y,z) to (x,z,-y).
  nearPoint(translation, [-3, -4.5, -2.1]);
  const rotatedStart = [rawStart[0], rawStart[2], -rawStart[1]];
  nearPoint(rotatedStart.map((coordinate, axis) => coordinate + translation[axis]), [0, 0, 0]);
});

test('placement math leaves raw coordinates and supplied quaternion unchanged', () => {
  const start = Object.freeze([3, -2.1, 4.5] as const);
  const rotation = Object.freeze([0, 0, 0, 2] as const);
  nearPoint(scanOriginForStart(start, rotation), [-3, 2.1, -4.5]);
  assert.deepEqual(start, [3, -2.1, 4.5]);
  assert.deepEqual(rotation, [0, 0, 0, 2]);
});

test('nonfinite raw coordinates and invalid rotations cannot create a placement', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => scanOriginForStart([value, -2.1, 4.5], identityRotation), /finite/i);
    assert.throws(() => scanOriginForStart(rawStart, [0, value, 0, 1]), /finite/i);
  }
  assert.throws(() => scanOriginForStart(rawStart, [0, 0, 0, 0]), /rotation/i);
});
