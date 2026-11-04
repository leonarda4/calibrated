import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rotateContentAroundPivot, type ContentTransform } from '../src/experience/rotation.ts';
import { createInstallation } from '../src/experience/installation.ts';

function near(actual: readonly number[], expected: readonly number[], tolerance = 1e-11) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < tolerance,
    `axis ${axis}: ${value} versus ${expected[axis]}`));
}

const base: ContentTransform = { position: [7, .25, -3], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] };
const pivot = [2, 0, 4] as const;

test('turn offset leaves the original alignment intact and reaches exact half/full lateral displacement', () => {
  near(rotateContentAroundPivot(base, pivot, 0, .2, 0).position, base.position);
  for (const [yaw, amount] of [[Math.PI / 2, .1], [Math.PI, .2], [Math.PI * 1.5, .2], [-.1, 0]]) {
    const original = rotateContentAroundPivot(base, pivot, yaw);
    const corrected = rotateContentAroundPivot(base, pivot, yaw, .2, 0);
    near(corrected.position, [original.position[0] - amount, original.position[1], original.position[2]]);
    near(corrected.quaternion, original.quaternion);
  }
  assert.deepEqual(base, { position: [7, .25, -3], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] });
});

test('calibrated hallway heading controls the correction axis and negative offsets reverse it', () => {
  const heading = .63;
  const original = rotateContentAroundPivot(base, pivot, Math.PI);
  for (const offset of [-.2, .2]) {
    const corrected = rotateContentAroundPivot(base, pivot, Math.PI, offset, heading);
    const displacement = corrected.position.map((value, axis) => value - original.position[axis]);
    near(displacement, [-Math.cos(heading) * offset, 0, Math.sin(heading) * offset]);
    assert.ok(Math.abs(displacement[0] * Math.sin(heading) + displacement[2] * Math.cos(heading)) < 1e-12,
      'a lateral correction must not travel along the calibrated hallway');
  }
});

function fixture(live = false) {
  const scene = new THREE.Scene(), scanRoot = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  scene.add(scanRoot, camera);
  scanRoot.position.set(...base.position); scanRoot.quaternion.set(...base.quaternion);
  const installation = createInstallation({ scene, camera, scanRoot, defaultPlyBase: null });
  const heading = .63;
  const direction = [Math.sin(heading), 0, Math.cos(heading)] as const;
  installation.applyScanPlacement({ ...installation.snapshot().config, centerX: pivot[0], centerZ: pivot[2], floorY: 0 }, direction);
  if (live) installation.setCalibrated();
  assert.equal(installation.showBox(!live), true);
  installation.setSecondBoxPlacement([2.8, 0, 5], direction);
  installation.update(1.5);
  scene.updateMatrixWorld(true);
  return { installation, scene, scanRoot, camera, heading,
    baseline: scanRoot.matrix.toArray(),
    first: scene.getObjectByName('installation-box')!, second: scene.getObjectByName('installation-second-box')! };
}

test('offset turns and repeated reversed adjustments keep both box anchors and tracked camera fixed', () => {
  const f = fixture(true), { installation, scanRoot, camera, first, second, heading } = f;
  const firstPose = first.matrixWorld.toArray(), secondPose = second.matrixWorld.toArray(), cameraPose = camera.matrixWorld.toArray();
  try {
    assert.equal(installation.setRotationOffset(.2), true);
    assert.equal(installation.snapshot().rotationOffsetMetres, .2);
    scanRoot.updateMatrix(); assert.deepEqual(scanRoot.matrix.toArray(), f.baseline, 'pre-turn offset must not move the aligned scan');
    assert.equal(installation.rotateHallway(), true);
    installation.update(2);
    const half = rotateContentAroundPivot(base, pivot, Math.PI / 2, .2, heading);
    near(scanRoot.position.toArray(), half.position);
    assert.equal(installation.setRotationOffset(.3), false, 'do not jump the target during an active turn');
    installation.update(2);
    assert.equal(installation.snapshot().phase, 'reversed');
    near(installation.snapshot().rotationOffsetWorld, [-Math.cos(heading) * .2, 0, Math.sin(heading) * .2]);
    assert.equal(installation.showSecondBox(), true);
    installation.update(1.5);
    for (const offset of [.2, .2, -.08, -.08]) {
      assert.equal(installation.setRotationOffset(offset), true);
      const expected = rotateContentAroundPivot(base, pivot, Math.PI, offset, heading);
      near(scanRoot.position.toArray(), expected.position);
      near(scanRoot.quaternion.toArray(), expected.quaternion);
      f.scene.updateMatrixWorld(true);
      near(first.matrixWorld.toArray(), firstPose);
      near(second.matrixWorld.toArray(), secondPose);
      near(camera.matrixWorld.toArray(), cameraPose);
    }
    installation.reset(); scanRoot.updateMatrix();
    assert.deepEqual(scanRoot.matrix.toArray(), f.baseline);
    assert.equal(installation.snapshot().rotationOffsetMetres, -.08, 'reset retains only the authored offset preference');
    assert.equal(installation.snapshot().calibrated, true, 'a visual baseline reset preserves the still-current live fit');
    assert.equal(installation.snapshot().secondBox.visible, false);
  } finally { installation.dispose(); }
});

test('invalid offsets leave state intact and interruption freezes correction until explicit reset', () => {
  const f = fixture(), { installation, scanRoot } = f;
  try {
    assert.equal(installation.setRotationOffset(.1), true);
    for (const offset of [NaN, Infinity, -Infinity, -1.0001, 1.0001]) {
      assert.throws(() => installation.setRotationOffset(offset));
      assert.equal(installation.snapshot().rotationOffsetMetres, .1);
    }
    assert.equal(installation.rotateHallway(), true);
    installation.update(1);
    scanRoot.updateMatrix(); const frozen = scanRoot.matrix.toArray();
    installation.stop(); installation.update(20);
    assert.equal(installation.setRotationOffset(.2), false);
    scanRoot.updateMatrix(); assert.deepEqual(scanRoot.matrix.toArray(), frozen);
    installation.reset(); scanRoot.updateMatrix();
    assert.deepEqual(scanRoot.matrix.toArray(), f.baseline);
    assert.equal(installation.snapshot().rotationOffsetMetres, .1);
    assert.equal(installation.snapshot().calibrated, false);
  } finally { installation.dispose(); }
});

test('raw start edits preserve original and reversed headings, fixed pivot and subsequent frames', () => {
  for (const turned of [false, true]) {
    const f = fixture(), { installation, scanRoot, scene, camera, first } = f;
    try {
      installation.setRotationOffset(.2);
      if (turned) { installation.rotateHallway(); installation.update(4); }
      scene.updateMatrixWorld(true);
      const phase = installation.snapshot().phase;
      const quaternion = scanRoot.quaternion.toArray();
      const firstPose = first.matrixWorld.toArray(), cameraPose = camera.matrixWorld.toArray();
      for (let edit = 0; edit < 3; edit++) {
        const raw = scanRoot.worldToLocal(new THREE.Vector3()).add(new THREE.Vector3(.12, -.23, .04));
        installation.setInspectionStartPoint(raw.toArray());
        const position = scanRoot.position.toArray();
        near(scanRoot.localToWorld(raw.clone()).toArray(), [0, 0, 0]);
        // Both continuous rendering and the input/change pair must retain the edit.
        for (let frame = 0; frame < 5; frame++) installation.update(.02);
        installation.setInspectionStartPoint(raw.toArray());
        near(scanRoot.position.toArray(), position);
        near(scanRoot.quaternion.toArray(), quaternion);
        assert.equal(installation.snapshot().phase, phase);
        assert.equal(installation.snapshot().rotationOffsetMetres, .2);
        scene.updateMatrixWorld(true);
        near(first.matrixWorld.toArray(), firstPose);
        near(camera.matrixWorld.toArray(), cameraPose);
      }
      const translated = scanRoot.position.toArray();
      installation.setRotationOffset(.3);
      installation.setRotationOffset(.2);
      near(scanRoot.position.toArray(), translated, 1e-10);
      near(scanRoot.quaternion.toArray(), quaternion);
      const matrix = scanRoot.matrix.toArray();
      assert.throws(() => installation.setInspectionStartPoint([NaN, 0, 0]), /finite/i);
      scanRoot.updateMatrix(); near(scanRoot.matrix.toArray(), matrix);
    } finally { installation.dispose(); }
  }
});
