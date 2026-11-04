import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Object3D, Vector3 } from 'three';
import { calibratedWallRoute, createWallRouteFrame } from '../src/viewer/wallRouteFrame.ts';
import { WallApproach } from '../src/viewer/wallApproach.ts';

test('calibrated wall stations preserve hallway side under opposite and transverse XR axes', () => {
  const scan = new Object3D();
  scan.rotation.x = Math.PI / 2; scan.position.set(2, 1.45, -18.6); scan.updateMatrixWorld();
  const authored = scan.matrixWorld.clone();
  for (const yaw of [0, Math.PI, Math.PI / 2, -.73]) {
    const horizontal = new Matrix4().makeRotationY(yaw).setPosition(3, 0, -4);
    const live = horizontal.clone().multiply(authored);
    live.elements[13] += .12;
    const frame = createWallRouteFrame(scan);
    frame.set(calibratedWallRoute(authored, live));
    scan.matrixAutoUpdate = false; scan.matrix.copy(live); scan.updateMatrixWorld(true);
    const start = frame.worldPoint(new Vector3(0, 0, -8));
    const end = frame.worldPoint(new Vector3(0, 0, -2));
    assert.ok(start.distanceTo(new Vector3(0, 0, -8).applyMatrix4(horizontal)) < 1e-9);
    assert.ok(Math.abs(start.distanceTo(end) - 6) < 1e-9);
    assert.equal(start.y, 0);
    const raw = frame.root.worldToLocal(new Vector3(0, 0, -8));
    assert.ok(scan.localToWorld(raw).distanceTo(start) < 1e-9);
    const approach = new WallApproach(); approach.start(-8, -2, .3);
    const physicalPlayer = frame.worldPoint(new Vector3(0, 1.7, -6.8));
    approach.update(10, { player: frame.routePoint(physicalPlayer).toArray(), centerX: 0,
      halfWidth: 1.05, halfDepth: .25, clearance: .75, resumeExtra: .15 });
    assert.ok(Math.abs(approach.snapshot().z + 7.8) < 1e-9);
    assert.equal(approach.snapshot().waitingFor, 'player');
  }
});

test('wall route rejects scale, reflection, tilt and invalid transforms', () => {
  for (const bad of [new Matrix4().makeScale(2, 1, .5), new Matrix4().makeScale(-1, 1, 1),
    new Matrix4().makeRotationX(.1), new Matrix4().setPosition(NaN, 0, 0)]) {
    assert.throws(() => calibratedWallRoute(new Matrix4(), bad), /rigid, metric yaw/);
  }
});

test('desktop wall route remains identity and preserves missing or invalid player blocking', () => {
  const frame = createWallRouteFrame(new Object3D()); frame.set();
  assert.deepEqual(frame.worldPoint(new Vector3(0, 0, -8)).toArray(), [0, 0, -8]);
  const approach = new WallApproach(); approach.start(-8, -2, .3);
  approach.update(5, { player: null, centerX: 0, halfWidth: 1, halfDepth: .25, clearance: .75, resumeExtra: .15 });
  assert.equal(approach.snapshot().z, -8);
  assert.equal(approach.snapshot().waitingFor, 'tracking');
});
