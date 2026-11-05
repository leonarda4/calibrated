import test from 'node:test';
import assert from 'node:assert/strict';
import { isHeadsetInBox } from '../src/experience/boxTrigger.ts';
import { DEFAULT_INSTALLATION_CONFIG, rotationYaw } from '../src/experience/flow.ts';
import { createInstallation } from '../src/experience/installation.ts';
import * as THREE from 'three';

test('trigger includes box volume and space above it, excludes sides and below its base', () => {
  const c = { ...DEFAULT_INSTALLATION_CONFIG, centerX: 3, centerZ: -2, floorY: .4, boxWidth: .4, boxDepth: .8 };
  for (const y of [.4, .6, .83, 2.4, 10]) assert.ok(isHeadsetInBox([3, y, -2], c, 0));
  assert.ok(isHeadsetInBox([3.2, 2, -1.6], c, 0));
  for (const p of [[3.201, 2, -2], [3, 2, -1.599], [3, .399, -2], [NaN, 2, -2], [3, Infinity, -2]] as const) {
    assert.equal(isHeadsetInBox(p, c, 0), false);
  }
  // A non-square footprint catches swapped axes and incorrect yaw sign.
  const yaw = Math.PI / 3;
  const world = (x: number, z: number): readonly [number, number, number] =>
    [3 + Math.cos(yaw) * x + Math.sin(yaw) * z, 2, -2 - Math.sin(yaw) * x + Math.cos(yaw) * z];
  assert.ok(isHeadsetInBox(world(.19, .39), c, yaw));
  assert.equal(isHeadsetInBox(world(.21, 0), c, yaw), false);
  assert.equal(isHeadsetInBox(world(0, .41), c, yaw), false);
});

test('only a shown calibrated live box accepts headset triggering, once per turn', () => {
  const installation = createInstallation({ scene: new THREE.Scene(), scanRoot: new THREE.Group(), defaultPlyCenter: null });
  installation.configure({ ...DEFAULT_INSTALLATION_CONFIG });
  assert.equal(installation.headsetInsideTrigger([0, 2, 0]), false);
  installation.showBox(true);
  assert.equal(installation.headsetInsideTrigger([0, 2, 0]), false);
  installation.reset(); installation.setCalibrated(); installation.showBox();
  assert.equal(installation.headsetInsideTrigger([0, 2, 0]), false, 'wait for the floor entrance before enabling the trigger');
  installation.update(1.5);
  assert.ok(installation.headsetInsideTrigger([0, 2, 0]));
  installation.rotateHallway();
  assert.equal(installation.headsetInsideTrigger([0, 2, 0]), false);
  installation.update(4);
  assert.equal(installation.headsetInsideTrigger([0, 2, 0]), false);
  installation.reset(); installation.showBox(); installation.invalidate('Tracking lost');
  assert.equal(installation.headsetInsideTrigger([0, 2, 0]), false);
  installation.dispose();
});

test('second-box hallway trigger accepts desktop preview only after its rise and revokes on hide/reset', () => {
  const installation = createInstallation({ scene: new THREE.Scene(), scanRoot: new THREE.Group(), defaultPlyCenter: null,
    getHallwaySection(z) {
      return { ok: true, centerWorld: [3, .4, z], centerRaw: [3, .4, z], directionWorld: [0, 0, 1],
        width: 2, clearanceLeft: 1, clearanceRight: 1, residual: 0,
        wallPlanes: { left: { point: [2, .4, z], normal: [1, 0, 0], residual: 0 },
          right: { point: [4, .4, z], normal: [-1, 0, 0], residual: 0 } },
        evidence: { scannedPoints: 100, eligiblePoints: 100, occupiedCells: 100 } };
    } });
  const base = [3.72, .4, -2] as const;
  const point = (x = 0, z = 0, y = 1.7): readonly [number, number, number] =>
    [3 + x, y, base[2] + z];
  try {
    installation.configure({ ...DEFAULT_INSTALLATION_CONFIG });
    assert.ok(installation.setSecondBoxPlacement(base, [0, 0, 1]));
    assert.equal(installation.headsetInSecondBoxHallway(point()), false);
    assert.ok(installation.showBox(true)); installation.update(1.5);
    assert.ok(installation.rotateHallway()); installation.update(4);
    assert.equal(installation.headsetInSecondBoxHallway(point()), false, 'a prepared hidden box cannot arm the wall');
    assert.ok(installation.showSecondBox()); installation.update(.75);
    assert.equal(installation.headsetInSecondBoxHallway(point()), false, 'rising box cannot arm the wall');
    installation.update(.75);
    assert.equal(installation.snapshot().calibrated, false);
    assert.equal(installation.snapshot().preview, true);
    assert.ok(installation.headsetInSecondBoxHallway(point(-.9, .9)), 'entry across the hallway, away from the box, must arm');
    assert.ok(installation.headsetInSecondBoxHallway(point(0, 0, 3)), 'full hallway height is included');
    for (const p of [point(1.001, 0), point(0, -1.001), point(0, 0, .399), point(0, 0, 3.001), [NaN, 2, 0], [3, Infinity, -2]] as const) {
      assert.equal(installation.headsetInSecondBoxHallway(p), false);
    }
    assert.ok(installation.hideSecondBox());
    assert.equal(installation.headsetInSecondBoxHallway(point()), false, 'descending box immediately revokes overlap');
    installation.update(1.5); assert.ok(installation.showSecondBox()); installation.update(1.5);
    assert.ok(installation.headsetInSecondBoxHallway(point()));
    installation.reset();
    assert.equal(installation.headsetInSecondBoxHallway(point()), false);
    installation.invalidate('Tracking lost');
    assert.equal(installation.headsetInSecondBoxHallway(point()), false);
  } finally { installation.dispose(); }
});

test('turn eases in and out symmetrically and ends at exactly 180 degrees', () => {
  const angle = (t: number) => rotationYaw(t, 4);
  assert.equal(angle(0), 0); assert.equal(angle(4), Math.PI);
  assert.equal(angle(5), Math.PI);
  const start = angle(.01), middle = angle(2.01) - angle(2), end = angle(4) - angle(3.99);
  assert.ok(start < middle / 100);
  assert.ok(Math.abs(start - end) < 1e-12);
  for (let i = 1; i <= 40; i++) assert.ok(angle(i / 10) > angle((i - 1) / 10));
});
