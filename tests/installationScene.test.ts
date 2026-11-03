import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInstallation } from '../src/experience/installation.ts';
import { DEFAULT_INSTALLATION_CONFIG, type Position3 } from '../src/experience/flow.ts';

// Explicit authored fixture anchor, unrelated to the new production scan.
const FIXTURE_PLY_CENTER: Position3 = [-6.5, -1.6, 0];

function nearPoint(actual: readonly number[], expected: readonly number[]) {
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-9,
    `axis ${axis}: ${actual[axis]} versus ${expected[axis]}`);
}

function setup(defaultPlyCenter: Position3 | null = FIXTURE_PLY_CENTER) {
  const scene = new THREE.Scene();
  const scanRoot = new THREE.Group();
  scanRoot.position.set(3, 0.2, -5);
  scanRoot.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  scene.add(scanRoot);
  const installation = createInstallation({ scene, scanRoot, defaultPlyCenter });
  const baseline = scanRoot.matrix.clone();
  // Force a current local matrix; creating a Group does not eagerly update it.
  scanRoot.updateMatrix();
  baseline.copy(scanRoot.matrix);
  return { scene, scanRoot, installation, baseline };
}

function previewTurn(installation: ReturnType<typeof createInstallation>) {
  assert.equal(installation.showBox(true), true);
  assert.equal(installation.rotateHallway(), true);
}

test('manual scene shows only the box and changes heading only after an explicit Rotate click', () => {
  const scene = new THREE.Scene();
  const scanRoot = new THREE.Group();
  scanRoot.position.set(3, 0.2, -5);
  scene.add(scanRoot);
  scanRoot.updateMatrixWorld(true);
  const baseline = scanRoot.matrix.toArray();
  const cues: string[] = [];
  const installation = createInstallation({ scene, scanRoot, defaultPlyCenter: null, onCue: cue => cues.push(cue) });
  try {
    assert.equal(installation.showBox(true), false, 'stale profile anchors must not supply an unchosen manual placement');
    installation.applyScanPlacement({ ...installation.snapshot().config, centerX: 0, centerZ: -2.5, floorY: 0 });
    assert.equal(installation.showBox(false), false, 'a live box still requires the current fit');
    assert.equal(installation.showBox(true), true);
    const props = scene.getObjectByName('installation-fixed-props')!;
    const box = scene.getObjectByName('installation-box')!;
    assert.equal(props.visible, true);
    assert.equal(scene.getObjectByName('installation-badge'), undefined);
    nearPoint(box.position.toArray(), [0, 0.215, -2.5]);
    nearPoint(box.scale.toArray(), [0.36, 0.43, 0.36]);
    installation.update(1000, [{ position: [0, 2.1, -2.5], tracked: true, timestampMs: 1000 }], 1000);
    installation.previewAdvance();
    assert.equal(installation.simulateCollection(), false);
    assert.equal(installation.snapshot().phase, 'box');
    assert.deepEqual(scanRoot.matrix.toArray(), baseline);
    installation.configure({ ...installation.snapshot().config, centerX: 1, centerZ: -2 });
    assert.equal(installation.snapshot().phase, 'box');
    assert.equal(props.visible, true);
    const fixedBox = box.getWorldPosition(new THREE.Vector3()).toArray();
    assert.equal(installation.showBox(true), true, 'repeated Show should be idempotent');
    assert.equal(installation.rotateHallway(), true);
    assert.equal(installation.rotateHallway(), false);
    installation.update(2);
    assert.equal(installation.snapshot().yaw, Math.PI / 2);
    installation.update(2);
    nearPoint(scanRoot.position.toArray(), [-1, 0.2, 1]);
    nearPoint(box.getWorldPosition(new THREE.Vector3()).toArray(), fixedBox);
    assert.equal(props.visible, true);
    assert.equal(installation.snapshot().phase, 'reversed');
    assert.equal(installation.rotateHallway(), false);
    assert.deepEqual(cues, []);
    installation.reset();
    assert.deepEqual(scanRoot.matrix.toArray(), baseline);
    assert.equal(props.visible, false);
    assert.equal(installation.showBox(true), true);
    assert.equal(installation.rotateHallway(), true);
    installation.update(4);
    nearPoint(scanRoot.position.toArray(), [-1, 0.2, 1]);
  } finally { installation.dispose(); }
});

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
    // Even an unexpected external root edit during the turn cannot make an
    // explicit placement refresh drag the physical box along with the scan.
    scanRoot.position.x += 2;
    installation.syncPlacementFromScan();
    assert.deepEqual(box.getWorldPosition(new THREE.Vector3()).toArray(), originalBox);
    installation.update(0.1);
    assert.equal(scene.getObjectByName('installation-badge'), undefined);
    const stoppedAt = scanRoot.matrix.toArray();
    installation.invalidate('Tracking interrupted');
    installation.update(10);
    assert.deepEqual(scanRoot.matrix.toArray(), stoppedAt);
    installation.reset();
    assert.deepEqual(scanRoot.matrix.toArray(), baseline.toArray());
    assert.equal(installation.snapshot().calibrated, false);
  } finally { installation.dispose(); }
});

test('raw PLY centre passes through scan translation and axis rotation while the metric box stays upright', () => {
  const { scene, installation } = setup();
  try {
    assert.deepEqual(installation.snapshot().defaultPlyCenter, FIXTURE_PLY_CENTER);
    // -90° X maps raw (x,y,z) -> (x,z,-y), then adds (3,.2,-5).
    const expected = [-3.5, 0.2, -3.4];
    const box = scene.getObjectByName('installation-box')!;
    nearPoint(box.getWorldPosition(new THREE.Vector3()).toArray(), expected);
    nearPoint(box.scale.toArray(), [0.36, 0.43, 0.36]);
    assert.deepEqual(box.getWorldQuaternion(new THREE.Quaternion()).toArray(), [0, 0, 0, 1]);
    assert.equal(box.parent?.parent, scene);
    const state = installation.snapshot();
    assert.equal(state.placementSource, 'default-ply');
    assert.ok(Math.abs(state.config.floorY - (expected[1] - 0.43 / 2)) < 1e-9);
    assert.equal(scene.getObjectByName('installation-badge'), undefined);
  } finally { installation.dispose(); }
});

test('real scan-transform refresh and new fit reproject the default anchor without moving the scan', () => {
  const { scene, scanRoot, installation } = setup();
  try {
    installation.setCalibrated();
    installation.prepareForCalibration();
    scanRoot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    scanRoot.position.set(4, 1.2, -8);
    scanRoot.updateMatrixWorld(true);
    const newRoot = scanRoot.matrix.toArray();
    installation.syncPlacementFromScan();
    // Normalized raw centre (-6.5,0,1.6), then +90° Y -> (1.6,0,6.5).
    nearPoint(scene.getObjectByName('installation-box')!.position.toArray(), [5.6, 1.2, -1.5]);
    assert.deepEqual(scanRoot.matrix.toArray(), newRoot);
    scanRoot.position.y += 0.1;
    installation.setCalibrated(); // fit path must sync before saving its baseline
    nearPoint(scene.getObjectByName('installation-box')!.position.toArray(), [5.6, 1.3, -1.5]);
    assert.equal(installation.snapshot().calibrated, true);
    assert.equal(installation.snapshot().placementConfirmed, false);
    installation.confirmPlacement(true);
    assert.equal(installation.start(false), true, 'unchanged anchor refresh must preserve the operator confirmation');
  } finally { installation.dispose(); }
});

test('default anchor survives timing/dimension edits but an explicit world position remains an override after reset and fit', () => {
  const { scene, scanRoot, installation } = setup();
  try {
    installation.configure({ ...installation.snapshot().config, explorationSeconds: 3, boxHeight: 0.6, boxWidth: 0.4, boxDepth: 0.5 });
    assert.equal(installation.snapshot().placementSource, 'default-ply');
    nearPoint(scene.getObjectByName('installation-box')!.position.toArray(), [-3.5, 0.2, -3.4]);
    assert.ok(Math.abs(installation.snapshot().config.floorY + 0.1) < 1e-9);
    scanRoot.position.x += 2;
    installation.syncPlacementFromScan();
    nearPoint(scene.getObjectByName('installation-box')!.position.toArray(), [-1.5, 0.2, -3.4]);
    installation.configure({ ...installation.snapshot().config, centerX: 8, centerZ: 3, floorY: 0.15 });
    assert.equal(installation.snapshot().placementSource, 'manual-world');
    scanRoot.position.set(-4, 1, 5);
    installation.syncPlacementFromScan();
    installation.setCalibrated();
    installation.reset();
    assert.equal(installation.snapshot().placementSource, 'manual-world');
    nearPoint(scene.getObjectByName('installation-box')!.position.toArray(), [8, 0.45, 3]);
    assert.throws(() => installation.configure({ ...installation.snapshot().config, floorY: NaN }));
    assert.equal(installation.snapshot().placementSource, 'manual-world');
  } finally { installation.dispose(); }
});

test('picker can own a scan placement and later manual edits revoke that source', () => {
  const { scene, scanRoot, installation } = setup();
  try {
    installation.applyScanPlacement({ ...installation.snapshot().config, centerX: 2, centerZ: -1, floorY: 0.1 });
    assert.equal(installation.snapshot().placementSource, 'picked-scan');
    scanRoot.position.x += 4;
    installation.syncPlacementFromScan();
    nearPoint(scene.getObjectByName('installation-box')!.position.toArray(), [2, 0.315, -1]);
    installation.configure({ ...installation.snapshot().config, rotationSeconds: 5 });
    assert.equal(installation.snapshot().placementSource, 'picked-scan');
    installation.configure({ ...installation.snapshot().config, floorY: 0.2 });
    assert.equal(installation.snapshot().placementSource, 'manual-world');
  } finally { installation.dispose(); }
});

test('explicit null anchor stays unplaced even when the active scan defines a box base', () => {
  const scene = new THREE.Scene();
  const scanRoot = new THREE.Group();
  scanRoot.position.set(25, 8, -40);
  scene.add(scanRoot);
  const installation = createInstallation({ scene, scanRoot, defaultPlyCenter: null });
  try {
    assert.equal(installation.snapshot().placementSource, 'unplaced');
    assert.equal(installation.snapshot().defaultPlyCenter, null);
    assert.equal(installation.snapshot().defaultPlyBase, null);
    assert.deepEqual(installation.snapshot().config, DEFAULT_INSTALLATION_CONFIG);
    assert.match(installation.snapshot().status, /placement unset/i);
    nearPoint(scene.getObjectByName('installation-box')!.position.toArray(), [0, 0.215, 0]);
    nearPoint(scene.getObjectByName('installation-box')!.scale.toArray(), [0.36, 0.43, 0.36]);
    installation.syncPlacementFromScan();
    installation.setCalibrated();
    installation.confirmPlacement(true);
    assert.equal(installation.snapshot().placementConfirmed, false);
    assert.equal(installation.start(false), false);
    assert.equal(installation.snapshot().placementSource, 'unplaced');
    scanRoot.position.set(-7, 0.4, 2);
    installation.syncPlacementFromScan();
    assert.deepEqual(installation.snapshot().config, DEFAULT_INSTALLATION_CONFIG);
    installation.reset();
    assert.equal(installation.snapshot().placementSource, 'unplaced');
  } finally { installation.dispose(); }
});

test('applying draft fields explicitly places the manual box and a current fit permits live Show', () => {
  const { installation } = setup(null);
  try {
    installation.setCalibrated();
    installation.configure({ ...installation.snapshot().config });
    assert.equal(installation.snapshot().placementSource, 'manual-world');
    assert.equal(installation.snapshot().placementConfirmed, false);
    assert.equal(installation.showBox(false), true);
    assert.equal(installation.snapshot().phase, 'box');
  } finally { installation.dispose(); }
});

test('unplaced desktop and live controls wait for an explicit placement', () => {
  const { installation } = setup(null);
  try {
    assert.equal(installation.showBox(true), false);
    assert.equal(installation.snapshot().placementSource, 'unplaced');
    assert.equal(installation.snapshot().placementConfirmed, false);
    assert.equal(installation.snapshot().calibrated, false);
    assert.equal(installation.rotateHallway(), false);
    assert.match(installation.snapshot().status, /unset/i);
    installation.stop('STOP: remain still.');
    assert.match(installation.snapshot().status, /STOP: remain still/);
    installation.reset();
    assert.equal(installation.snapshot().placementSource, 'unplaced');
    installation.confirmPlacement(true);
    assert.equal(installation.start(false), false);
  } finally { installation.dispose(); }
});

test('a new floor-edge pick explicitly places an unplaced scan without retaining a default anchor', () => {
  const { installation } = setup(null);
  try {
    installation.applyScanPlacement({ ...installation.snapshot().config, centerX: 1, floorY: 0.1, centerZ: -2 });
    assert.equal(installation.snapshot().placementSource, 'picked-scan');
    assert.equal(installation.snapshot().defaultPlyCenter, null);
    assert.equal(installation.snapshot().placementConfirmed, false);
    installation.setCalibrated();
    installation.confirmPlacement(true);
    assert.equal(installation.start(false), true);
  } finally { installation.dispose(); }
});

test('user PLY bottom centre preserves the floor and extends the metric box upward through edits, fit and turn', () => {
  const scene = new THREE.Scene();
  const scanRoot = new THREE.Group();
  // Y-up raw start (3,-2.1,4.5) lands at the XR floor origin.
  scanRoot.position.set(-3, 2.1, -4.5);
  scene.add(scanRoot);
  const installation = createInstallation({ scene, scanRoot });
  try {
    const box = scene.getObjectByName('installation-box')!;
    assert.equal(scene.getObjectByName('installation-badge'), undefined);
    assert.deepEqual(installation.snapshot().defaultPlyBase, [3, -2.1, 2]);
    assert.equal(installation.snapshot().defaultPlyCenter, null);
    assert.equal(installation.snapshot().placementSource, 'default-ply');
    assert.equal(installation.snapshot().config.floorY, 0);
    nearPoint(box.position.toArray(), [0, 0.215, -2.5]);
    nearPoint(box.scale.toArray(), [0.36, 0.43, 0.36]);
    assert.equal(installation.snapshot().placementConfirmed, false);
    assert.equal(installation.start(false), false, 'authored placement alone is not a checked physical fit');

    installation.configure({ ...installation.snapshot().config, boxHeight: 0.6, explorationSeconds: 1 });
    assert.equal(installation.snapshot().placementSource, 'default-ply');
    assert.equal(installation.snapshot().config.floorY, 0);
    nearPoint(box.position.toArray(), [0, 0.3, -2.5]);

    installation.setCalibrated();
    installation.prepareForCalibration();
    scanRoot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    scanRoot.position.set(1, 2.6, -5);
    scanRoot.updateMatrixWorld(true);
    const fittedRoot = scanRoot.matrix.toArray();
    installation.setCalibrated();
    assert.deepEqual(scanRoot.matrix.toArray(), fittedRoot, 'projecting the base cannot move the scan');
    assert.ok(Math.abs(installation.snapshot().config.floorY - 0.5) < 1e-9);
    nearPoint(box.position.toArray(), [3, 0.8, -8]);
    assert.equal(installation.snapshot().placementConfirmed, false);

    const fixedBox = box.getWorldPosition(new THREE.Vector3()).toArray();
    previewTurn(installation);
    installation.update(2);
    installation.syncPlacementFromScan();
    installation.update(2);
    assert.equal(installation.snapshot().yaw, Math.PI);
    assert.equal(scanRoot.position.y, 2.6);
    nearPoint(box.getWorldPosition(new THREE.Vector3()).toArray(), fixedBox);
    installation.reset();
    assert.deepEqual(scanRoot.matrix.toArray(), fittedRoot);
  } finally { installation.dispose(); }
});

test('base override is explicit, null suppresses profile anchors, and ambiguous or invalid anchors are rejected', () => {
  const scene = new THREE.Scene();
  const scanRoot = new THREE.Group();
  const installation = createInstallation({ scene, scanRoot, defaultPlyBase: [1, 0.2, -4] });
  const unplaced = createInstallation({ scene, scanRoot, defaultPlyBase: null });
  try {
    assert.deepEqual(installation.snapshot().defaultPlyBase, [1, 0.2, -4]);
    assert.equal(installation.snapshot().config.floorY, 0.2);
    assert.equal(unplaced.snapshot().placementSource, 'unplaced');
    assert.equal(unplaced.snapshot().defaultPlyBase, null);
    assert.throws(() => createInstallation({ scene, scanRoot, defaultPlyBase: [NaN, 0, 0] }));
    assert.throws(() => createInstallation({ scene, scanRoot, defaultPlyCenter: [1, 2, 3], defaultPlyBase: [1, 2, 3] }));
  } finally { installation.dispose(); unplaced.dispose(); }
});

test('new calibration cannot compound an artistic yaw; NaN delta cannot poison future scene updates', () => {
  const { scanRoot, installation, baseline } = setup();
  try {
    installation.configure({ ...installation.snapshot().config, centerX: 0, centerZ: -2 });
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
    // Configured pivot is (0,-2): (2,-4) -> (-2,0), with unchanged floor height.
    assert.ok(Math.abs(scanRoot.position.x + 2) < 1e-12);
    assert.ok(Math.abs(scanRoot.position.z) < 1e-12);
    assert.equal(scanRoot.position.y, 0.3);
    installation.reset();
    assert.deepEqual(scanRoot.position.toArray(), [2, 0.3, -4]);
  } finally { installation.dispose(); }
});
