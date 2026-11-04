import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Scene, Vector3 } from 'three';
import { createBroomPlacement } from '../src/viewer/broomPlacement.ts';

test('broom placement uses the supplied current section centre/floor at world Z6', () => {
  const scene = new Scene(), scanRoot = new Group(), object = new Group();
  scene.add(scanRoot, object);
  let pivot = { centerX: .24, floorY: .03 };
  const broom = createBroomPlacement({ object, getPivot: () => pivot, blockReason: () => null });
  assert.equal(object.visible, false);
  assert.equal(broom.show(), true);
  const before = object.matrixWorld.clone();
  assert.deepEqual(object.getWorldPosition(new Vector3()).toArray(), [.24, .03, 6]);
  object.updateWorldMatrix(true, false);
  before.copy(object.matrixWorld);
  scanRoot.position.set(3, 0, -2); scanRoot.rotation.y = Math.PI;
  scene.updateMatrixWorld(true);
  assert.deepEqual(object.matrixWorld.toArray(), before.toArray());
  assert.deepEqual(new Vector3(0, 1, 0).applyQuaternion(object.getWorldQuaternion(object.quaternion.clone())).toArray(), [0, 1, 0]);
  broom.reset();
  pivot = { centerX: -.3, floorY: .1 };
  assert.equal(broom.show(), true);
  assert.deepEqual(broom.snapshot().baseWorld, [-.3, .1, 6]);
});

test('broom blocks invalid/live-disarmed reveals and reset does not revive it', () => {
  const object = new Group();
  let reason: string | null = 'Complete fresh calibration.';
  let pivot = { centerX: 0, floorY: 0 };
  const broom = createBroomPlacement({ object, getPivot: () => pivot, blockReason: () => reason });
  assert.equal(broom.show(), false); assert.equal(object.visible, false);
  reason = null;
  assert.equal(broom.show(), true);
  reason = 'Tracking interrupted.';
  assert.equal(broom.toggle(), true); assert.equal(object.visible, false);
  assert.equal(broom.show(), false); assert.equal(object.visible, false);
  reason = null; pivot = { centerX: Number.NaN, floorY: 0 };
  assert.equal(broom.show(), false); assert.equal(object.visible, false);
  pivot = { centerX: 0, floorY: 0 }; broom.show(); broom.reset();
  assert.equal(broom.snapshot().visible, false);
  assert.equal(broom.snapshot().baseWorld, null);
});
