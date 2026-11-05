import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Group, Matrix4, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { createInstallation } from '../src/experience/installation.ts';
import { createHallwaySections } from '../src/experience/hallwaySection.ts';
import { measureWallDistances, type HallwayCenterResult } from '../src/experience/hallwayCenter.ts';
import { createHallwayPlacementFrame } from '../src/viewer/wallRouteFrame.ts';

const near = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} expected ${expected}`);
const nearVector = (actual: Vector3, expected: Vector3, tolerance = 1e-9) =>
  assert.ok(actual.distanceTo(expected) < tolerance, `${actual.toArray()} expected ${expected.toArray()}`);
const successful = (fit: HallwayCenterResult) => {
  if (!fit.ok) assert.fail(fit.reason);
  return fit;
};
const station = 4.57;

function fixture(yaw: number) {
  const source: number[] = [];
  for (let along = -12; along <= 12.001; along += .05) {
    for (let height = .45; height <= 1.751; height += .1) {
      source.push(-.9 - .02 * along, along, height, 1.2 + .05 * along, along, height);
    }
  }
  const centers = new Float32Array(source);
  const scene = new Scene(), scan = new Group(), rig = new Group(), camera = new PerspectiveCamera();
  rig.add(camera); scene.add(scan, rig);
  const authored = new Quaternion().setFromEuler(new Euler(Math.PI / 2, Math.PI, 0));
  const transform = new Matrix4().makeRotationY(yaw).setPosition(3.2, 0, -4.7);
  scan.position.setFromMatrixPosition(transform);
  scan.quaternion.setFromRotationMatrix(transform).multiply(authored);
  scan.updateMatrixWorld(true);
  const placementFrame = createHallwayPlacementFrame(scan); placementFrame.set(transform);
  const sections = createHallwaySections({ scanRoot: placementFrame.root, getCenters: () => centers });
  const queries: number[] = [];
  let supported = true;
  const installation = createInstallation({ scene, scanRoot: scan, camera, defaultPlyBase: null, placementFrame,
    getHallwaySection(z) {
      queries.push(z);
      return supported ? sections.at(z) : { ok: false, reason: 'Missing current opposite wall.',
        evidence: { scannedPoints: centers.length / 3, eligiblePoints: 0, occupiedCells: 0 } };
    },
  });
  const direction = new Vector3(0, 0, 1).transformDirection(transform);
  const prepare = () => {
    installation.setCalibrated();
    const primary = new Vector3(0, 0, 2.5).applyMatrix4(transform);
    installation.applyScanPlacement({ ...installation.snapshot().config,
      centerX: primary.x, centerZ: primary.z, floorY: 0 }, direction.toArray());
    assert.ok(installation.setSecondBoxPlacement(new Vector3(.9, 0, station).applyMatrix4(transform).toArray(), direction.toArray()));
    assert.ok(installation.showBox()); installation.update(1.5);
  };
  prepare();
  const seat = scene.getObjectByName('installation-second-box')!;
  const primary = scene.getObjectByName('installation-box')!;
  primary.updateWorldMatrix(true, false);
  const fixedPrimary = primary.matrixWorld.clone();
  return { scene, scan, rig, camera, transform, placementFrame, sections, queries, installation, seat, primary,
    fixedPrimary, prepare, unsupported() { supported = false; } };
}

function verifySeat(f: ReturnType<typeof fixture>) {
  const fit = successful(f.sections.at(station));
  const state = f.installation.snapshot().secondBox;
  assert.equal(state.alignmentError, null); assert.ok(state.placed);
  assert.deepEqual([state.width, state.depth, state.height], [.36, .36, .43]);
  // Select the same physical +X side independently of estimator left/right labels.
  const side = fit.wallPlanes.left.normal[0] < 0 ? 'left' : 'right';
  const wall = fit.wallPlanes[side], n = wall.normal, p = wall.point;
  const expectedX = (.18 + n[0] * p[0] + n[2] * (p[2] - station)) / n[0];
  const expectedBase = new Vector3(expectedX, 0, station).applyMatrix4(f.transform);
  nearVector(new Vector3(...state.base!), expectedBase);
  near(state.base![1], 0);
  const tangent = new Vector3(n[2], 0, -n[0]).transformDirection(f.transform);
  near(Math.sin(state.yaw), tangent.x); near(Math.cos(state.yaw), tangent.z);
  f.seat.updateWorldMatrix(true, false);
  nearVector(f.seat.getWorldPosition(new Vector3()), expectedBase.clone().add(new Vector3(0, .215, 0)));
  const footprint = [-.5, .5].flatMap(x => [-.5, .5].map(z =>
    f.placementFrame.routePoint(new Vector3(x, -.5, z).applyMatrix4(f.seat.matrixWorld))));
  const distances = footprint.map(point => measureWallDistances(fit.wallPlanes, point.toArray())[side]);
  assert.equal(distances.filter(distance => Math.abs(distance) < 1e-9).length, 2, 'the full wall-side edge contacts the fitted plane');
  near(Math.max(...distances), .36);
  for (const point of footprint) near(point.y, 0);
  near(footprint[0].distanceTo(footprint[1]), .36);
  near(footprint[0].distanceTo(footprint[2]), .36);
  const routeBase = f.placementFrame.routePoint(new Vector3(...state.base!));
  near(routeBase.z, station);
  f.primary.updateWorldMatrix(true, false);
  f.primary.matrixWorld.elements.forEach((value, axis) => near(value, f.fixedPrimary.elements[axis]));
  assert.deepEqual(f.rig.matrix.toArray(), new Matrix4().toArray());
  assert.deepEqual(f.rig.position.toArray(), [0, 0, 0]);
  assert.deepEqual(f.camera.position.toArray(), [0, 0, 0]);
  for (const query of f.queries) near(query, station);
  return routeBase;
}

for (const yaw of [Math.PI / 2, Math.PI, -.63]) {
  test(`second seat fits route station and wall edge through a translated calibration yaw ${yaw}`, () => {
    const f = fixture(yaw);
    try {
      verifySeat(f);
      assert.equal(f.installation.snapshot().secondBox.visible, false);
      assert.ok(f.installation.rotateHallway()); f.installation.update(4);
      assert.equal(f.installation.snapshot().secondBox.visible, false, 'seat stays hidden during the turn');
      const hiddenBase = f.installation.snapshot().secondBox.base!;
      assert.equal(f.installation.headsetAboveSecondBox([hiddenBase[0], 1.7, hiddenBase[2]]), false);
      assert.ok(f.installation.showSecondBox()); f.installation.update(1.5);
      const before = verifySeat(f);
      assert.ok(f.installation.snapshot().secondBox.visible); assert.ok(f.seat.visible);
      const revealedBase = f.installation.snapshot().secondBox.base!;
      assert.ok(f.installation.headsetAboveSecondBox([revealedBase[0], 1.7, revealedBase[2]]));
      const outside = new Vector3(.19, 1.7, 0).applyAxisAngle(new Vector3(0, 1, 0), f.installation.snapshot().secondBox.yaw);
      outside.x += revealedBase[0]; outside.z += revealedBase[2];
      assert.equal(f.installation.headsetAboveSecondBox(outside.toArray()), false);
      assert.ok(f.installation.setRotationOffset(.1));
      const shifted = verifySeat(f);
      near(shifted.x - before.x, -.1, 2e-6);
      assert.ok(f.installation.setRotationOffset(0));
      nearVector(verifySeat(f), before, 2e-6);
    } finally { f.installation.dispose(); }
  });
}

test('unsupported route refit immediately hides a previously revealed seat, including repeated Show', () => {
  const f = fixture(Math.PI / 2);
  try {
    assert.ok(f.installation.rotateHallway()); f.installation.update(4);
    assert.ok(f.installation.showSecondBox()); f.installation.update(1.5);
    assert.ok(f.seat.visible);
    f.unsupported();
    assert.equal(f.installation.showSecondBox(), false);
    assert.equal(f.installation.snapshot().secondBox.visible, false);
    assert.equal(f.installation.snapshot().secondBox.reveal.motion, 'hidden');
    assert.equal(f.seat.visible, false);
    assert.match(f.installation.snapshot().secondBox.alignmentError!, /opposite wall/);
    f.installation.update(10); assert.equal(f.seat.visible, false);
  } finally { f.installation.dispose(); }
});

test('fresh calibration clears the old seat and allows the same whole sequence again', () => {
  const f = fixture(-.63);
  try {
    assert.ok(f.installation.rotateHallway()); f.installation.update(4);
    assert.ok(f.installation.showSecondBox()); f.installation.update(1.5);
    f.installation.prepareForCalibration();
    assert.equal(f.installation.snapshot().secondBox.placed, false);
    assert.equal(f.installation.snapshot().secondBox.visible, false);
    assert.equal(f.installation.snapshot().secondBox.base, null);
    assert.equal(f.seat.visible, false);
    f.prepare(); verifySeat(f);
    assert.ok(f.installation.rotateHallway()); f.installation.update(4);
    assert.ok(f.installation.showSecondBox()); f.installation.update(1.5);
    verifySeat(f); assert.ok(f.seat.visible);
  } finally { f.installation.dispose(); }
});
