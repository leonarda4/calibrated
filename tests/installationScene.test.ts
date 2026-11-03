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

function verifyActualBoxEdges(mesh: THREE.Mesh, base: Position3, direction: Position3, size = { width: 0.36, depth: 0.36, height: 0.43 }) {
  mesh.updateWorldMatrix(true, false);
  const geometry = new THREE.EdgesGeometry(mesh.geometry);
  try {
    const attribute = geometry.getAttribute('position');
    assert.equal(attribute.count, 24, 'a box must have twelve physical edges');
    const points = Array.from({ length: attribute.count }, (_, index) =>
      new THREE.Vector3().fromBufferAttribute(attribute, index).applyMatrix4(mesh.matrixWorld));
    const heading = new THREE.Vector3(direction[0], 0, direction[2]).normalize();
    const normal = new THREE.Vector3(heading.z, 0, -heading.x);
    const counts = { width: 0, depth: 0, height: 0 };
    for (let edge = 0; edge < points.length; edge += 2) {
      const vector = points[edge + 1].clone().sub(points[edge]);
      const length = vector.length();
      vector.divideScalar(length);
      const axis = Math.abs(vector.y) > 1 - 1e-9 ? 'height' :
        Math.abs(vector.dot(heading)) > 1 - 1e-9 ? 'depth' : 'width';
      if (axis === 'width') assert.ok(Math.abs(vector.dot(normal)) > 1 - 1e-9, 'horizontal box edge must follow a hallway axis');
      assert.ok(Math.abs(length - size[axis]) < 1e-9, 'actual geometry edge has the wrong metric length');
      counts[axis]++;
    }
    assert.deepEqual(counts, { width: 4, depth: 4, height: 4 });
    assert.ok(Math.abs(Math.min(...points.map(point => point.y)) - base[1]) < 1e-9, 'box bottom is not on its supplied floor');
    const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
    nearPoint(center.toArray(), [base[0], base[1] + size.height / 2, base[2]]);
  } finally { geometry.dispose(); }
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

test('box sides follow the hallway heading while its floor, metric size and turn pivot stay fixed', () => {
  const { scene, scanRoot, installation, baseline } = setup(null);
  try {
    const config = { ...installation.snapshot().config, centerX: 1.25, centerZ: -2.5, floorY: 0.2 };
    installation.applyScanPlacement(config, [3, 0, 4]);
    const box = scene.getObjectByName('installation-box')!;
    const heading = new THREE.Vector3(0.6, 0, 0.8);
    const wallNormal = new THREE.Vector3(0.8, 0, -0.6);
    nearPoint(box.position.toArray(), [1.25, 0.415, -2.5]);
    nearPoint(box.scale.toArray(), [0.36, 0.43, 0.36]);
    assert.ok(Math.abs(installation.snapshot().boxYaw - Math.atan2(3, 4)) < 1e-12);
    const parallel = (a: THREE.Vector3, b: THREE.Vector3, direction: THREE.Vector3, length: number) => {
      const edge = b.clone().sub(a);
      assert.ok(Math.abs(edge.length() - length) < 1e-10);
      assert.ok(Math.abs(edge.normalize().dot(direction) - 1) < 1e-10, 'box edge is not parallel to the fitted hallway axis');
    };
    const levels = [-0.5, 0.5].map(y => [
      new THREE.Vector3(-0.5, y, -0.5), new THREE.Vector3(0.5, y, -0.5),
      new THREE.Vector3(0.5, y, 0.5), new THREE.Vector3(-0.5, y, 0.5),
    ].map(point => box.localToWorld(point)));
    for (const [level, corners] of levels.entries()) {
      for (const point of corners) assert.ok(Math.abs(point.y - (config.floorY + level * config.boxHeight)) < 1e-10);
      parallel(corners[0], corners[1], wallNormal, config.boxWidth);
      parallel(corners[3], corners[2], wallNormal, config.boxWidth);
      parallel(corners[0], corners[3], heading, config.boxDepth);
      parallel(corners[1], corners[2], heading, config.boxDepth);
    }
    for (let corner = 0; corner < 4; corner++) parallel(levels[0][corner], levels[1][corner], new THREE.Vector3(0, 1, 0), config.boxHeight);

    installation.setCalibrated();
    assert.equal(installation.showBox(false), true);
    const fixedBox = box.getWorldPosition(new THREE.Vector3()).toArray();
    const fixedOrientation = box.getWorldQuaternion(new THREE.Quaternion()).toArray();
    const fixedYaw = installation.snapshot().boxYaw;
    assert.equal(installation.rotateHallway(), true);
    installation.update(2);
    assert.equal(installation.snapshot().yaw, Math.PI / 2);
    nearPoint(box.getWorldPosition(new THREE.Vector3()).toArray(), fixedBox);
    assert.deepEqual(box.getWorldQuaternion(new THREE.Quaternion()).toArray(), fixedOrientation);
    assert.equal(installation.snapshot().boxYaw, fixedYaw);
    const duringTurn = installation.snapshot();
    assert.throws(() => installation.applyScanPlacement({ ...config, centerX: 99 }, [-4, 0, 3]));
    assert.deepEqual(installation.snapshot().config, duringTurn.config);
    assert.equal(installation.snapshot().boxYaw, fixedYaw);
    assert.deepEqual(box.getWorldQuaternion(new THREE.Quaternion()).toArray(), fixedOrientation);
    installation.update(2);
    assert.equal(installation.snapshot().yaw, Math.PI);
    nearPoint(scanRoot.position.toArray(), [-0.5, 0.2, 0]);
    nearPoint(box.getWorldPosition(new THREE.Vector3()).toArray(), fixedBox);
    assert.deepEqual(box.getWorldQuaternion(new THREE.Quaternion()).toArray(), fixedOrientation);
    installation.reset();
    assert.deepEqual(scanRoot.matrix.toArray(), baseline.toArray());
    assert.equal(installation.snapshot().boxYaw, fixedYaw);

    installation.prepareForCalibration();
    scanRoot.position.set(5, 0.7, -2);
    scanRoot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    scanRoot.updateMatrixWorld(true);
    const fittedRoot = scanRoot.matrix.toArray();
    installation.setCalibrated();
    // A new fitted horizontal heading updates yaw without changing the floor.
    installation.applyScanPlacement(config, [-4, 0, 3]);
    assert.ok(Math.abs(installation.snapshot().boxYaw - Math.atan2(-4, 3)) < 1e-12);
    nearPoint(new THREE.Vector3(0, 0, 1).applyQuaternion(box.quaternion).toArray(), [-0.8, 0, 0.6]);
    nearPoint(new THREE.Vector3(0, 1, 0).applyQuaternion(box.quaternion).toArray(), [0, 1, 0]);
    nearPoint(box.position.toArray(), fixedBox);
    nearPoint(box.scale.toArray(), [0.36, 0.43, 0.36]);
    assert.deepEqual(installation.snapshot().config, config);
    assert.deepEqual(scanRoot.matrix.toArray(), fittedRoot, 'refreshing box heading must not move the fitted scan');
  } finally { installation.dispose(); }
});

test('invalid hallway headings cannot partially replace a valid placement or box orientation', () => {
  const { scene, installation } = setup(null);
  try {
    const config = { ...installation.snapshot().config, centerX: 1.25, centerZ: -2.5, floorY: 0.2 };
    installation.applyScanPlacement(config, [3, 0, 4]);
    const before = installation.snapshot();
    const box = scene.getObjectByName('installation-box')!;
    const position = box.position.toArray();
    const orientation = box.quaternion.toArray();
    const invalidDirections: Position3[] = [[0, 0, 0], [0, 1, 0], [1, 1, 0], [NaN, 0, 1], [1, Infinity, 0], [1, 0, -Infinity]];
    for (const direction of invalidDirections) {
      assert.throws(() => installation.applyScanPlacement({ ...config, centerX: 99, floorY: 3 }, direction));
      assert.deepEqual(installation.snapshot().config, before.config);
      assert.equal(installation.snapshot().placementSource, before.placementSource);
      assert.equal(installation.snapshot().boxYaw, before.boxYaw);
      assert.deepEqual(box.position.toArray(), position);
      assert.deepEqual(box.quaternion.toArray(), orientation);
    }
    installation.applyScanPlacement({ ...config, centerZ: -3 });
    assert.equal(installation.snapshot().boxYaw, before.boxYaw, 'omitting an optional heading must preserve the previous orientation');
  } finally { installation.dispose(); }
});

test('second metric box is prepared hidden, stays fixed through the turn and needs its own reveal afterward', () => {
  const { scene, scanRoot, installation, baseline } = setup(null);
  try {
    const direction: Position3 = [3, 0, 4];
    const firstBase: Position3 = [0, 0, -2.5];
    const secondBase: Position3 = [0.2, 0, -4.7];
    installation.applyScanPlacement({ ...installation.snapshot().config, centerX: firstBase[0], centerZ: firstBase[2], floorY: firstBase[1] }, direction);
    installation.setCalibrated();
    assert.equal(installation.showBox(false), true);
    assert.equal(installation.showSecondBox(), false);
    installation.setSecondBoxPlacement(secondBase, direction);
    const first = scene.getObjectByName('installation-box') as THREE.Mesh;
    const second = scene.getObjectByName('installation-second-box') as THREE.Mesh;
    assert.equal(second.parent, scene, 'secondary prop must not inherit the rotating scan or first-box scale');
    verifyActualBoxEdges(first, firstBase, direction);
    verifyActualBoxEdges(second, secondBase, direction);
    const prepared = installation.snapshot().secondBox;
    assert.equal(prepared.placed, true);
    assert.equal(prepared.visible, false);
    assert.deepEqual(prepared.base, secondBase);
    assert.deepEqual([prepared.width, prepared.depth, prepared.height], [0.36, 0.36, 0.43]);
    assert.equal(second.visible, false);
    const firstPose = { position: first.position.toArray(), quaternion: first.quaternion.toArray() };
    const secondPose = { position: second.position.toArray(), quaternion: second.quaternion.toArray() };
    const primaryConfig = installation.snapshot().config;
    assert.equal(installation.showSecondBox(), false);
    assert.equal(installation.rotateHallway(), true);
    installation.update(2);
    assert.equal(installation.showSecondBox(), false);
    assert.throws(() => installation.setSecondBoxPlacement([9, 0, 9], [1, 0, 0]));
    assert.deepEqual(installation.snapshot().secondBox, prepared);
    assert.deepEqual(second.position.toArray(), secondPose.position);
    assert.deepEqual(second.quaternion.toArray(), secondPose.quaternion);
    installation.update(2);
    assert.equal(installation.snapshot().phase, 'reversed');
    assert.equal(installation.snapshot().secondBox.visible, false, 'finishing the turn must never reveal the second box automatically');
    assert.equal(second.visible, false);
    nearPoint(scanRoot.position.toArray(), [-3, 0.2, 0]);
    const reversedRoot = scanRoot.matrix.toArray();
    assert.equal(installation.showSecondBox(), true);
    const revealed = installation.snapshot().secondBox;
    assert.equal(revealed.visible, true);
    assert.equal(second.visible, true);
    assert.equal(scene.getObjectByName('installation-fixed-props')!.visible, true);
    assert.equal(installation.showSecondBox(), true, 'repeated reveal must be idempotent');
    assert.deepEqual(installation.snapshot().secondBox, revealed);
    assert.deepEqual(first.position.toArray(), firstPose.position);
    assert.deepEqual(first.quaternion.toArray(), firstPose.quaternion);
    assert.deepEqual(second.position.toArray(), secondPose.position);
    assert.deepEqual(second.quaternion.toArray(), secondPose.quaternion);
    assert.deepEqual(installation.snapshot().config, primaryConfig);
    assert.deepEqual(scanRoot.matrix.toArray(), reversedRoot, 'revealing a prop must not change the hallway pivot or transform');
    verifyActualBoxEdges(first, firstBase, direction);
    verifyActualBoxEdges(second, secondBase, direction);
    installation.reset();
    assert.deepEqual(scanRoot.matrix.toArray(), baseline.toArray());
    assert.equal(installation.snapshot().secondBox.placed, false);
    assert.equal(installation.snapshot().secondBox.base, null);
    assert.equal(second.visible, false);
    installation.showBox(false); installation.rotateHallway(); installation.update(4);
    assert.equal(installation.showSecondBox(), false, 'a new turn cannot revive a previous hidden placement');
  } finally { installation.dispose(); }
});

test('secondary dimensions are independent of first-box edits and invalid input cannot replace a preparation', () => {
  const { scene, installation } = setup(null);
  try {
    const config = { ...installation.snapshot().config, centerX: 0, centerZ: -2.5, floorY: 0, boxWidth: 0.5, boxDepth: 0.6, boxHeight: 0.7 };
    const direction: Position3 = [0, 0, 1];
    const base: Position3 = [1, 0, -4];
    installation.applyScanPlacement(config, direction);
    installation.setSecondBoxPlacement(base, direction);
    const first = scene.getObjectByName('installation-box') as THREE.Mesh;
    const second = scene.getObjectByName('installation-second-box') as THREE.Mesh;
    verifyActualBoxEdges(first, [0, 0, -2.5], direction, { width: 0.5, depth: 0.6, height: 0.7 });
    verifyActualBoxEdges(second, base, direction);
    const original = installation.snapshot().secondBox;
    const originalPose = { position: second.position.toArray(), quaternion: second.quaternion.toArray() };
    const invalid: [Position3, Position3][] = [
      [[NaN, 0, 0], direction], [[0, Infinity, 0], direction],
      [base, [0, 0, 0]], [base, [0, 1, 0]], [base, [1, 1, 0]], [base, [Infinity, 0, 1]],
    ];
    for (const [invalidBase, invalidDirection] of invalid) {
      assert.throws(() => installation.setSecondBoxPlacement(invalidBase, invalidDirection));
      assert.deepEqual(installation.snapshot().secondBox, original);
      assert.deepEqual(second.position.toArray(), originalPose.position);
      assert.deepEqual(second.quaternion.toArray(), originalPose.quaternion);
    }
    installation.applyScanPlacement({ ...config }, direction);
    assert.deepEqual(installation.snapshot().secondBox, original, 'unchanged primary application must preserve hidden preparation');
    installation.configure({ ...config, rotationSeconds: 5 });
    assert.deepEqual(installation.snapshot().secondBox, original, 'timing edits do not move the prepared prop');
    installation.configure({ ...installation.snapshot().config, centerX: 0.1 });
    assert.equal(installation.snapshot().secondBox.placed, false, 'moving the primary pivot must revoke secondary preparation');
    installation.setSecondBoxPlacement(base, direction);
    installation.applyScanPlacement({ ...installation.snapshot().config }, [1, 0, 0]);
    assert.equal(installation.snapshot().secondBox.placed, false, 'changing primary source/heading must revoke secondary preparation');
  } finally { installation.dispose(); }
});

test('fit, preparation, reset, stop and invalidation revoke a prepared second box', () => {
  const actions: [string, (installation: ReturnType<typeof createInstallation>) => void][] = [
    ['new fit', installation => installation.setCalibrated()],
    ['calibration preparation', installation => installation.prepareForCalibration()],
    ['reset', installation => installation.reset()],
    ['stop', installation => installation.stop()],
    ['invalidation', installation => installation.invalidate('Synthetic session/reference change')],
  ];
  for (const [label, action] of actions) {
    const { scene, installation } = setup(null);
    try {
      installation.applyScanPlacement({ ...installation.snapshot().config, centerZ: -2.5 }, [0, 0, 1]);
      installation.setCalibrated(); installation.showBox(false);
      installation.setSecondBoxPlacement([0, 0, -4.7], [0, 0, 1]);
      action(installation);
      assert.equal(installation.snapshot().secondBox.placed, false, label);
      assert.equal(installation.snapshot().secondBox.visible, false, label);
      assert.equal(installation.snapshot().secondBox.base, null, label);
      assert.equal(scene.getObjectByName('installation-second-box')!.visible, false, label);
      assert.equal(installation.showSecondBox(), false, label);
    } finally { installation.dispose(); }
  }
});

test('actual first-box centre is the fixed yaw pivot and has independently equal distances to asymmetric world walls', () => {
  const { scene, scanRoot, installation, baseline } = setup(null);
  try {
    // Public analytic fixture: n·p=1.45 and n·p=3.55. The bisector is n·p=2.5,
    // which is deliberately different from the XR origin n·(0,0,0)=0.
    const normal = new THREE.Vector3(0.8, 0, -0.6);
    const leftOffset = 1.45, rightOffset = 3.55;
    const expectedBase: Position3 = [1.25, 0, -2.5];
    const heading: Position3 = [0.6, 0, 0.8];
    const distances = (point: THREE.Vector3) => [normal.dot(point) - leftOffset, rightOffset - normal.dot(point)];
    const equalDistances = (point: THREE.Vector3) => {
      const [left, right] = distances(point);
      assert.ok(Math.abs(left - 1.05) < 1e-9, 'actual left-wall distance is incorrect');
      assert.ok(Math.abs(right - 1.05) < 1e-9, 'actual right-wall distance is incorrect');
      assert.ok(Math.abs(left - right) < 1e-9, 'actual box centre is not the wall bisector');
    };
    const config = { ...installation.snapshot().config, centerX: expectedBase[0], centerZ: expectedBase[2], floorY: expectedBase[1], rotationSeconds: 4 };
    installation.applyScanPlacement(config, heading);
    installation.setCalibrated();
    assert.equal(installation.showBox(false), true);
    const box = scene.getObjectByName('installation-box') as THREE.Mesh;
    verifyActualBoxEdges(box, expectedBase, heading);
    const vertices = () => {
      box.updateWorldMatrix(true, false);
      const positions = box.geometry.getAttribute('position');
      return Array.from({ length: positions.count }, (_, index) =>
        new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(box.matrixWorld));
    };
    const actualCenter = box.getWorldPosition(new THREE.Vector3());
    const actualBase = new THREE.Vector3(actualCenter.x, Math.min(...vertices().map(point => point.y)), actualCenter.z);
    nearPoint(actualBase.toArray(), expectedBase);
    equalDistances(actualBase);
    equalDistances(actualCenter);
    const actualVertices = vertices();
    const leftEdgeClearance = Math.min(...actualVertices.map(point => distances(point)[0]));
    const rightEdgeClearance = Math.min(...actualVertices.map(point => distances(point)[1]));
    assert.ok(Math.abs(leftEdgeClearance - 0.87) < 1e-9);
    assert.ok(Math.abs(rightEdgeClearance - 0.87) < 1e-9);

    // Track the scan-local point that originally lies under the actual box.
    // Its rendered world position must stay fixed, independently of metadata.
    const rawUnderBox = scanRoot.worldToLocal(actualBase.clone());
    const rawFloorNeighbors = [rawUnderBox.clone().add(new THREE.Vector3(1, 0, 0)), rawUnderBox.clone().add(new THREE.Vector3(0, 1, 0))];
    const fixedOrientation = box.getWorldQuaternion(new THREE.Quaternion()).toArray();
    const verifyPivot = (angle: number) => {
      assert.ok(Math.abs(installation.snapshot().yaw - angle) < 1e-10);
      const actualScanPivot = scanRoot.localToWorld(rawUnderBox.clone());
      nearPoint(actualScanPivot.toArray(), expectedBase);
      equalDistances(actualScanPivot);
      const centre = box.getWorldPosition(new THREE.Vector3());
      nearPoint([centre.x, 0, centre.z], expectedBase);
      equalDistances(centre);
      const state = installation.snapshot().config;
      nearPoint([state.centerX, state.floorY, state.centerZ], actualScanPivot.toArray());
      assert.deepEqual(box.getWorldQuaternion(new THREE.Quaternion()).toArray(), fixedOrientation);
      for (const point of rawFloorNeighbors) assert.ok(Math.abs(scanRoot.localToWorld(point.clone()).y) < 1e-9, 'turn tilted the fitted floor');
    };
    verifyPivot(0);
    assert.equal(installation.rotateHallway(), true);
    // Inverse of the existing smoothstep, targeting a non-cardinal 30° sample.
    const timeAt30 = 4 * (0.5 - Math.sin(Math.asin(2 / 3) / 3));
    installation.update(timeAt30); verifyPivot(Math.PI / 6);
    installation.update(2 - timeAt30); verifyPivot(Math.PI / 2);
    installation.update(2); verifyPivot(Math.PI);
    installation.reset();
    assert.deepEqual(scanRoot.matrix.toArray(), baseline.toArray());

    // This independent check must detect an off-centre manual edit instead of
    // repeating width/2 twice and falsely claiming equal clearances.
    installation.configure({ ...config, centerX: config.centerX + normal.x * 0.1, centerZ: config.centerZ + normal.z * 0.1 });
    const [shiftedLeft, shiftedRight] = distances(box.getWorldPosition(new THREE.Vector3()));
    assert.ok(Math.abs(shiftedLeft - 1.15) < 1e-9);
    assert.ok(Math.abs(shiftedRight - 0.95) < 1e-9);
    assert.ok(Math.abs(shiftedLeft - shiftedRight) > 0.19, 'independent wall distances failed to detect the offset');
  } finally { installation.dispose(); }
});
