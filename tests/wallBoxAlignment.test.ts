import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { alignBoxToWall } from '../src/experience/wallBoxAlignment.ts';
import { measureWallDistances, type HallwayWallPlanes } from '../src/experience/hallwayCenter.ts';
import { createInstallation } from '../src/experience/installation.ts';

const walls: HallwayWallPlanes = {
  left: { point: [-1.1, 0, 0], normal: [1, 0, 0], residual: .02 },
  right: { point: [1.1, 0, 0], normal: [-Math.cos(.03), 0, Math.sin(.03)], residual: .02 },
};

test('seat edge follows the actual selected nonparallel plane at an unchanged world-Z station', () => {
  const aligned = alignBoxToWall({ walls, reference: [1, 0, 4], direction: [0, 0, 1] });
  assert.equal(aligned.base[1], 0); assert.equal(aligned.base[2], 4);
  const distances = aligned.corners.map(p => measureWallDistances(walls, p).right);
  assert.equal(distances.filter(d => Math.abs(d) < 1e-10).length, 2);
  assert.ok(Math.abs(Math.max(...distances) - .36) < 1e-10);
  assert.ok(Math.abs(aligned.direction[0] * walls.right.normal[0] + aligned.direction[2] * walls.right.normal[2]) < 1e-12);
});

test('ten-centimetre seat clearance follows the selected plane without changing its station or walls', () => {
  const original = structuredClone(walls);
  for (const x of [-1, 1]) {
    const aligned = alignBoxToWall({ walls, reference: [x, 0, 4], direction: [0, 0, 1], wallClearance: .1 });
    const distances = aligned.corners.map(p => measureWallDistances(walls, p)[aligned.wallSide]);
    assert.equal(distances.filter(d => Math.abs(d - .1) < 1e-10).length, 2);
    assert.ok(Math.abs(Math.max(...distances) - .46) < 1e-10);
    assert.equal(aligned.base[1], 0); assert.equal(aligned.base[2], 4);
  }
  assert.deepEqual(walls, original);
  assert.throws(() => alignBoxToWall({ walls, reference: [1, 0, 4], direction: [0, 0, 1], wallClearance: -.1 }));
});

test('seat keeps the same physical wall side when rotation swaps estimator wall labels', () => {
  const first = alignBoxToWall({ walls, reference: [-.9, 0, 4], direction: [0, 0, 1] });
  const shifted: HallwayWallPlanes = {
    left: { ...walls.right, point: [1.3, 0, 0] },
    right: { ...walls.left, point: [-.9, 0, 0] },
  };
  const second = alignBoxToWall({ walls: shifted, reference: first.base, direction: first.direction, preferredNormal: first.inwardNormal });
  assert.ok(Math.abs(second.base[0] - first.base[0] - .2) < 1e-12);
  assert.equal(second.base[2], first.base[2]); assert.equal(second.wallSide, 'right');
});

test('visible second seat follows corrected current walls while the first pivot remains fixed', () => {
  const scene = new THREE.Scene(), scanRoot = new THREE.Group(); scene.add(scanRoot);
  const installation = createInstallation({ scene, scanRoot, defaultPlyBase: [0, 0, 0],
    getHallwaySection(z) {
      const shift = scanRoot.position.x;
      const planes: HallwayWallPlanes = {
        left: { point: [-1.1 + shift, 0, z], normal: [1, 0, 0], residual: 0 },
        right: { point: [1.1 + shift, 0, z], normal: [-1, 0, 0], residual: 0 },
      };
      return { ok: true, centerWorld: [shift, 0, z], centerRaw: [0, 0, z], directionWorld: [0, 0, 1],
        wallPlanes: planes, width: 2.2, clearanceLeft: 1.1, clearanceRight: 1.1, residual: 0,
        evidence: { scannedPoints: 100, eligiblePoints: 100, occupiedCells: 100 } };
    },
  });
  installation.setCalibrated(); installation.showBox(); installation.update(1.5);
  installation.setSecondBoxPlacement([-.92, 0, 4], [0, 0, 1]);
  const first = scene.getObjectByName('installation-box')!.position.clone();
  installation.rotateHallway(); installation.update(4); assert.ok(installation.showSecondBox());
  installation.update(1.5);
  const before = installation.snapshot().secondBox.base!;
  assert.ok(installation.setRotationOffset(.1));
  const after = installation.snapshot().secondBox.base!;
  assert.ok(Math.abs(after[0] - before[0] + .1) < 1e-12);
  assert.equal(after[1], 0); assert.equal(after[2], before[2]);
  assert.ok(scene.getObjectByName('installation-box')!.position.equals(first));
  installation.dispose();
});

test('unsupported current walls block preparation instead of advertising an aligned seat', () => {
  const installation = createInstallation({ scene: new THREE.Scene(), scanRoot: new THREE.Group(), defaultPlyBase: [0, 0, 0],
    getHallwaySection() { return { ok: false, reason: 'Missing opposite wall.',
      evidence: { scannedPoints: 20, eligiblePoints: 20, occupiedCells: 20 } }; },
  });
  assert.equal(installation.setSecondBoxPlacement([-.9, 0, 4], [0, 0, 1]), false);
  assert.equal(installation.snapshot().secondBox.placed, false);
  assert.equal(installation.snapshot().secondBox.base, null);
  assert.match(installation.snapshot().secondBox.alignmentError!, /opposite wall/);
  installation.showBox(true); installation.update(1.5); installation.rotateHallway(); installation.update(4);
  assert.equal(installation.showSecondBox(), false);
  installation.dispose();
});
