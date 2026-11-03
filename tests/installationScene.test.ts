import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInstallation } from '../src/experience/installation.ts';

function setup() {
  const scene = new THREE.Scene();
  const scanRoot = new THREE.Group();
  scanRoot.position.set(3, 0.2, -5);
  scanRoot.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  scene.add(scanRoot);
  const installation = createInstallation({ scene, scanRoot });
  const baseline = scanRoot.matrix.clone();
  // Force a current local matrix; creating a Group does not eagerly update it.
  scanRoot.updateMatrix();
  baseline.copy(scanRoot.matrix);
  return { scene, scanRoot, installation, baseline };
}

function previewTurn(installation: ReturnType<typeof createInstallation>) {
  assert.equal(installation.start(true), true);
  installation.previewAdvance();
  installation.confirmStationary(true);
  assert.equal(installation.simulateCollection(), true);
}

test('scene turn keeps the physical box fixed; stop freezes, reset restores exact baseline', () => {
  const { scene, scanRoot, installation, baseline } = setup();
  try {
    installation.setCalibrated();
    const box = scene.getObjectByName('installation-box')!;
    const originalBox = box.getWorldPosition(new THREE.Vector3()).toArray();
    previewTurn(installation);
    installation.update(1);
    assert.notDeepEqual(scanRoot.matrix.toArray(), baseline.toArray());
    assert.deepEqual(box.getWorldPosition(new THREE.Vector3()).toArray(), originalBox);
    assert.equal(scene.getObjectByName('installation-badge')!.visible, false);
    const stoppedAt = scanRoot.matrix.toArray();
    installation.invalidate('Tracking interrupted');
    installation.update(10);
    assert.deepEqual(scanRoot.matrix.toArray(), stoppedAt);
    installation.reset();
    assert.deepEqual(scanRoot.matrix.toArray(), baseline.toArray());
    assert.equal(installation.snapshot().calibrated, false);
  } finally { installation.dispose(); }
});

test('new calibration cannot compound an artistic yaw; NaN delta cannot poison future scene updates', () => {
  const { scanRoot, installation, baseline } = setup();
  try {
    installation.setCalibrated();
    previewTurn(installation);
    installation.update(NaN);
    installation.update(Infinity);
    assert.deepEqual(scanRoot.matrix.toArray(), baseline.toArray());
    installation.update(4);
    assert.equal(installation.snapshot().yaw, Math.PI);
    assert.throws(() => installation.setCalibrated());
    installation.prepareForCalibration();
    assert.deepEqual(scanRoot.matrix.toArray(), baseline.toArray());
    scanRoot.position.set(2, 0.3, -4);
    installation.setCalibrated();
    previewTurn(installation);
    installation.update(4);
    // Default pivot is (0,-2): (2,-4) -> (-2,0), with unchanged floor height.
    assert.ok(Math.abs(scanRoot.position.x + 2) < 1e-12);
    assert.ok(Math.abs(scanRoot.position.z) < 1e-12);
    assert.equal(scanRoot.position.y, 0.3);
    installation.reset();
    assert.deepEqual(scanRoot.position.toArray(), [2, 0.3, -4]);
  } finally { installation.dispose(); }
});
