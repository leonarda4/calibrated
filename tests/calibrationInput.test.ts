import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCalibrationInput } from '../src/xr/calibrationInput.ts';

const controller = () => ({
  profiles: ['oculus-touch', 'generic-trigger-squeeze-thumbstick'],
  gamepad: { axes: [0, 0, 0, 0], buttons: Array(7).fill({ pressed: false }) },
  gripSpace: {},
});
const joints = () => new Map(Array.from({ length: 25 }, (_, index) => [index, {}]));

test('Oculus Touch remains a controller with optional OpenXR skeletal data', () => {
  for (const hand of [undefined, null, new Map(), joints()]) {
    assert.equal(classifyCalibrationInput({ ...controller(), hand }), 'controller');
  }
});

test('explicit hand profiles outrank controller fallbacks and never become landmark controllers', () => {
  for (const profile of ['generic-hand-select', 'generic-hand-select-grasp', 'hand-interaction', 'meta-hand-aim']) {
    assert.equal(classifyCalibrationInput({ ...controller(), profiles: [profile, 'oculus-touch'], hand: joints() }), 'hand');
    assert.equal(classifyCalibrationInput({ ...controller(), profiles: [profile, 'oculus-touch'], hand: null }), 'hand');
  }
});

test('unknown skeletal inputs stay excluded even with a gamepad and grip', () => {
  for (const profiles of [[], ['unknown-device']]) {
    assert.equal(classifyCalibrationInput({ ...controller(), profiles, hand: joints() }), 'hand');
  }
});

test('a controller needs both a gamepad and grip, including when joints are present', () => {
  for (const hand of [undefined, joints()]) {
    assert.notEqual(classifyCalibrationInput({ ...controller(), hand, gamepad: null }), 'controller');
    assert.notEqual(classifyCalibrationInput({ ...controller(), hand, gripSpace: null }), 'controller');
  }
});

test('legacy controller grips work without hand data and missing inputs remain unavailable', () => {
  assert.equal(classifyCalibrationInput({ gamepad: {}, gripSpace: {} }), 'controller');
  assert.equal(classifyCalibrationInput({}), 'unavailable');
  assert.equal(classifyCalibrationInput({ gamepad: {} }), 'unavailable');
});
