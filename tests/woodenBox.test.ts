import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { FloorReveal } from '../src/experience/floorReveal.ts';
import { createInstallation } from '../src/experience/installation.ts';
import { createWoodenBoxVisuals, WOODEN_BOX, woodenBoxSourceTransform, woodenBoxSourceRotation } from '../src/viewer/woodenBox.ts';

test('floor reveal eases symmetrically, clamps both endpoints and never revives after recovery', () => {
  const reveal = new FloorReveal(1.5);
  assert.equal(reveal.snapshot().fraction, 0);
  assert.ok(reveal.show()); reveal.update(.15);
  assert.ok(Math.abs(reveal.snapshot().fraction - .028) < 1e-12);
  assert.equal(reveal.hide(), false, 'a repeated button must not reverse an active entrance');
  reveal.update(.6); assert.equal(reveal.snapshot().fraction, .5);
  reveal.update(.75); assert.equal(reveal.snapshot().fraction, 1);
  assert.ok(reveal.hide()); reveal.update(.15);
  assert.ok(Math.abs(reveal.snapshot().fraction - .972) < 1e-12);
  reveal.update(100); assert.equal(reveal.snapshot().motion, 'hidden');
  for (const delta of [NaN, Infinity, -1, 0]) reveal.update(delta);
  reveal.show(); reveal.reset(); reveal.update(100);
  assert.equal(reveal.snapshot().motion, 'hidden');
});

test('original wooden-box bounds map to an upright metric box with bottom-centre origin', () => {
  const matrix = woodenBoxSourceTransform(.36, .43, .36);
  const inverse = woodenBoxSourceRotation().invert();
  const bounds = new THREE.Box3();
  for (const x of [WOODEN_BOX.alignedMin[0], WOODEN_BOX.alignedMax[0]])
    for (const y of [WOODEN_BOX.alignedMin[1], WOODEN_BOX.alignedMax[1]])
      for (const z of [WOODEN_BOX.alignedMin[2], WOODEN_BOX.alignedMax[2]]) bounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inverse).applyMatrix4(matrix));
  assert.ok(bounds.min.distanceTo(new THREE.Vector3(-.18, 0, -.18)) < 1e-12);
  assert.ok(bounds.max.distanceTo(new THREE.Vector3(.18, .43, .18)) < 1e-12);
  assert.ok(matrix.determinant() > 0, 'must preserve handedness and the original Gaussian covariance');
  const up = new THREE.Vector3(0, 0, -1).transformDirection(matrix);
  assert.ok(up.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-12, 'source -Z must point upward');
  const side = new THREE.Vector3(Math.cos(19 * Math.PI / 180), Math.sin(19 * Math.PI / 180), 0).transformDirection(matrix);
  assert.ok(side.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-12, 'source face direction must match the mock box axis');
});

test('both splat boxes cancel the scan turn and keep floor/metric pose while animating', () => {
  const scene = new THREE.Scene(), scan = new THREE.Group(); scene.add(scan);
  const objects = Array.from({ length: 5 }, () => {
    const group = new THREE.Group() as THREE.Group & { updateTransform(): void };
    group.updateTransform = () => group.updateWorldMatrix(true, false); return group;
  });
  const material = new THREE.ShaderMaterial({ vertexShader: 'gl_Position = quadPos;', fragmentShader: 'void main () {' });
  Object.assign(scan, { getSceneCount: () => 5, getSplatScene: (index: number) => objects[index], viewer: { splatMesh: { material } } });
  const visuals = createWoodenBoxVisuals(scan as unknown as DropInViewer); visuals.initialize();
  const poses = [0, 1].map(slot => {
    const anchor = new THREE.Group(); anchor.position.set(slot * .7, .315, 3 + slot);
    anchor.rotation.y = .4; anchor.scale.set(.36, .43, .36); scene.add(anchor);
    return { anchor, height: .43, floorY: .1, fraction: 1, visible: true };
  });
  const expected = poses.map(p => p.anchor.position.clone());
  const sourceCenter = new THREE.Vector3(...WOODEN_BOX.alignedMin).add(new THREE.Vector3(...WOODEN_BOX.alignedMax)).multiplyScalar(.5)
    .applyMatrix4(woodenBoxSourceRotation().invert());
  for (const angle of [0, .7, Math.PI]) {
    scan.rotation.set(-Math.PI / 2, .1, angle); scan.position.set(4, .2, -6);
    visuals.update(poses);
    objects.slice(3).forEach((object, slot) => {
      const world = new THREE.Matrix4().multiplyMatrices(scan.matrixWorld, object.matrix);
      assert.ok(sourceCenter.clone().applyMatrix4(world).distanceTo(expected[slot]) < 1e-12);
    });
  }
  poses[0].fraction = 0; visuals.update(poses);
  const top = sourceCenter.clone().applyMatrix4(woodenBoxSourceRotation()); top.y = WOODEN_BOX.alignedMax[1];
  top.applyMatrix4(woodenBoxSourceRotation().invert());
  top.applyMatrix4(new THREE.Matrix4().multiplyMatrices(scan.matrixWorld, objects[3].matrix));
  assert.ok(top.y < poses[0].floorY, 'the complete box must start below its floor');
  poses.forEach(p => { p.visible = false; }); visuals.update(poses);
  assert.equal(objects[3].visible, false); assert.equal(objects[4].visible, false);
  assert.deepEqual(material.uniforms.uBoxFloors.value.toArray(), [.1, .1]);
});

test('hide suspends headset triggering and all disarm paths cancel floor animations', () => {
  const installation = createInstallation({ scene: new THREE.Scene(), scanRoot: new THREE.Group(), defaultPlyBase: [0, 0, 0] });
  installation.setCalibrated(); installation.showBox(); installation.update(1.5);
  assert.ok(installation.headsetInsideTrigger([0, 2, 0]));
  assert.ok(installation.hideBox()); assert.equal(installation.headsetInsideTrigger([0, 2, 0]), false);
  assert.equal(installation.rotateHallway(), false);
  installation.update(1.5); assert.equal(installation.snapshot().boxReveal.motion, 'hidden');
  for (const cancel of [() => installation.stop(), () => installation.invalidate('Tracking lost'),
    () => installation.reset(), () => installation.prepareForCalibration()]) {
    installation.reset(); installation.setCalibrated(); installation.showBox(); installation.update(.5);
    cancel(); installation.update(10);
    assert.equal(installation.snapshot().boxReveal.motion, 'hidden');
    assert.equal(installation.snapshot().secondBox.reveal.motion, 'hidden');
  }
  installation.dispose();
});

test('pivot box glitches in place one second after actual turn completion, then hides without descending', () => {
  for (const preview of [false, true]) {
    const scene = new THREE.Scene(), scanRoot = new THREE.Group(); scene.add(scanRoot);
    const installation = createInstallation({ scene, scanRoot, defaultPlyBase: [0, 0, 2] });
    installation.setCalibrated(); installation.showBox(preview); installation.update(1.5);
    installation.configure({ ...installation.snapshot().config, rotationSeconds: 8 });
    installation.showBox(preview); installation.update(1.5);
    const anchor = scene.getObjectByName('installation-box')!;
    scene.updateMatrixWorld(true); const anchorPose = anchor.matrixWorld.toArray();
    assert.ok(installation.rotateHallway()); installation.update(7.9);
    assert.equal(installation.snapshot().boxGlitch.phase, 'idle');
    installation.update(.1);
    assert.equal(installation.snapshot().phase, 'reversed');
    assert.equal(installation.snapshot().boxGlitch.phase, 'waiting');
    const rootPose = scanRoot.matrix.toArray();
    installation.update(.999);
    assert.equal(installation.snapshot().boxGlitch.progress, 0);
    installation.update(.276);
    assert.equal(installation.snapshot().boxGlitch.phase, 'glitching');
    assert.ok(Math.abs(installation.snapshot().boxGlitch.progress - .5) < 1e-10);
    assert.equal(installation.snapshot().boxReveal.motion, 'visible');
    assert.equal(installation.snapshot().boxReveal.fraction, 1, 'automatic exit must not lower the visual');
    scene.updateMatrixWorld(true); assert.deepEqual(anchor.matrixWorld.toArray(), anchorPose);
    assert.deepEqual(scanRoot.matrix.toArray(), rootPose);
    installation.update(.3);
    assert.equal(installation.snapshot().boxGlitch.phase, 'hidden');
    assert.equal(installation.snapshot().boxReveal.motion, 'hidden');
    assert.equal(scene.getObjectByName('installation-fixed-props')!.visible, false);
    assert.ok(installation.showBox(preview)); installation.update(1.5); installation.update(10);
    assert.equal(installation.snapshot().boxGlitch.phase, 'idle');
    assert.equal(installation.snapshot().boxReveal.motion, 'visible', 'manual re-show must clear the old automatic exit');
    installation.dispose();
  }
});

test('all disarm paths cancel waiting and active glitches without late-frame revival', () => {
  for (const elapsed of [.5, 1.2]) for (const action of ['stop', 'invalidate', 'reset', 'prepareForCalibration'] as const) {
    const installation = createInstallation({ scene: new THREE.Scene(), scanRoot: new THREE.Group(), defaultPlyBase: [0, 0, 0] });
    installation.setCalibrated(); installation.showBox(); installation.update(1.5);
    installation.rotateHallway(); installation.update(4); installation.update(elapsed);
    assert.equal(installation.snapshot().boxGlitch.phase, elapsed < 1 ? 'waiting' : 'glitching');
    if (action === 'invalidate') installation.invalidate('Tracking lost'); else installation[action]();
    installation.update(100); installation.update(NaN);
    assert.equal(installation.snapshot().boxGlitch.phase, 'idle');
    assert.equal(installation.snapshot().boxReveal.motion, 'hidden');
    installation.dispose();
  }
});
