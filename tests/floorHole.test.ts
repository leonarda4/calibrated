import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Matrix4, Quaternion, ShaderMaterial, Vector3 } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { createFloorHole, FLOOR_HOLE } from '../src/viewer/floorHole.ts';
import { WALL_SECTION } from '../src/viewer/wallSectionConfig.ts';
import { createHallwayPlacementFrame } from '../src/viewer/wallRouteFrame.ts';

const startZ = FLOOR_HOLE.startZ;
const endZ = startZ + FLOOR_HOLE.length;
const middleZ = (startZ + endZ) / 2;

type Arrival = { positionRoute: readonly [number, number, number]; halfDepth: number; direction: 1 | -1;
  crossing?: { playerRoute: readonly [number, number, number]; direction: 1 | -1 } };

function fixture(options: { calibration?: Matrix4; arrival?: () => Arrival } = {}) {
  const scan = new Group();
  // Raw +Y is longitudinal, matching the active export; keep the fixture public.
  scan.rotation.x = Math.PI / 2;
  scan.rotation.y = Math.PI;
  scan.updateMatrixWorld(true);
  const points: number[] = [];
  for (const x of [-.9, 1.2]) {
    for (let z = -9; z <= 8; z += .05) {
      for (let y = .45; y <= 1.8; y += .1) {
        points.push(...scan.worldToLocal(new Vector3(x, y, z)).toArray());
      }
    }
  }
  const centers = new Float32Array(points);
  const material = new ShaderMaterial({ vertexShader: 'void main () { gl_Position = quadPos; }',
    fragmentShader: 'void main () {}' });
  Object.assign(scan, { viewer: { splatMesh: { material } } });
  let blocked: string | null = null;
  let data: Float32Array | undefined = centers;
  let queries = 0;
  let rotation = { phase: 'box', offsetWorld: [0, 0, 0] as readonly [number, number, number] };
  if (options.calibration) scan.applyMatrix4(options.calibration);
  const frame = createHallwayPlacementFrame(scan);
  frame.set(options.calibration);
  const hole = createFloorHole({ scanRoot: scan as unknown as DropInViewer,
    getSourceCenters: () => { queries++; return data; }, blockReason: () => blocked, getRotationState: () => rotation,
    placementFrame: frame, getWallArrival: options.arrival });
  return { hole, scan, material, centers, block: (reason: string | null) => { blocked = reason; },
    queries: () => queries,
    removeData: () => { data = undefined; },
    rotate: (phase: string, offset: number, z = 0) => { rotation = { phase, offsetWorld: [offset, 0, z] }; } };
}

test('floor opening spans the current walls and follows offset/rotation at its fixed world-Z interval', () => {
  const { hole, material, scan, centers } = fixture();
  const source = centers.slice();
  assert.equal(hole.show(), false);
  hole.initialize(); assert.equal(hole.snapshot().open, false);
  assert.equal(hole.show(), true, hole.snapshot().status);
  assert.ok(Math.abs(hole.snapshot().width - WALL_SECTION.width) < 1e-6);
  assert.equal(hole.snapshot().length, WALL_SECTION.height);
  assert.ok(Math.abs(hole.snapshot().centerX! - .15) < 1e-6);
  const bounds = material.uniforms.uFloorHoleBounds.value.toArray();
  assert.ok(Math.abs(bounds[0] + .9) < 1e-6);
  assert.ok(Math.abs(bounds[1] - 1.2) < 1e-6);
  assert.deepEqual(bounds.slice(2), [startZ, endZ]);
  scan.position.x += .3; hole.update();
  const translated = material.uniforms.uFloorHoleBounds.value.toArray();
  assert.ok(Math.abs(translated[0] - bounds[0] - .3) < 1e-6);
  assert.ok(Math.abs(translated[1] - bounds[1] - .3) < 1e-6);
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  const pivot = new Vector3(0, 0, middleZ);
  scan.position.sub(pivot).applyQuaternion(turn).add(pivot); scan.position.x += .1;
  scan.quaternion.premultiply(turn); scan.updateMatrixWorld(true); hole.update();
  assert.equal(hole.snapshot().open, true, hole.snapshot().status);
  const rotated = material.uniforms.uFloorHoleBounds.value.toArray();
  assert.ok(Math.abs(rotated[0] + 1.4) < 1e-6);
  assert.ok(Math.abs(rotated[1] - .7) < 1e-6);
  assert.deepEqual(rotated.slice(2), [startZ, endZ]);
  assert.ok(Math.abs(hole.snapshot().centerX! + .35) < 1e-6);
  assert.deepEqual(centers, source, 'A visual cutout must preserve the original calibration data.');
  hole.close();
  assert.equal(material.uniforms.uFloorHoleOpen.value, 0);
  assert.equal(hole.snapshot().centerX, null);
});

test('floor opening follows the eased sideways correction without fitting a transverse mid-turn scan', () => {
  const { hole, material, scan, rotate } = fixture();
  hole.initialize(); assert.equal(hole.show(), true);
  const original = material.uniforms.uFloorHoleBounds.value.toArray();
  rotate('rotating', .05); scan.rotation.y += Math.PI / 2; hole.update();
  const during = material.uniforms.uFloorHoleBounds.value.toArray();
  assert.equal(hole.snapshot().open, true);
  assert.ok(Math.abs(during[0] - original[0] - .05) < 1e-8);
  assert.deepEqual(during.slice(2), original.slice(2));
  rotate('stopped', .05); hole.update();
  assert.equal(hole.snapshot().open, false);
  hole.update(); assert.equal(hole.snapshot().open, false, 'an old correction cannot reopen recovery');
});

test('floor opening rejects disarmed, nonmetric and missing-source requests and resets closed', () => {
  const { hole, material, scan, block, removeData } = fixture();
  hole.reset(); hole.initialize();
  block('Tracking interrupted.'); assert.equal(hole.show(), false);
  block(null); scan.scale.setScalar(2); assert.equal(hole.show(), false);
  scan.scale.setScalar(1); assert.equal(hole.show(), true);
  block('Tracking interrupted.'); assert.equal(hole.toggle(), true, 'Closing remains available.');
  assert.equal(hole.snapshot().open, false);
  assert.equal(hole.show(), false);
  block(null); assert.equal(hole.show(), true);
  hole.reset();
  assert.equal(material.uniforms.uFloorHoleOpen.value, 0);
  assert.equal(hole.snapshot().open, false);
  removeData(); assert.equal(hole.show(), false);
  hole.loadingFailed(new Error('Load failed.'));
  assert.equal(hole.snapshot().phase, 'error'); assert.equal(hole.show(), false);
  assert.equal(FLOOR_HOLE.floorY, 0);
});

test('hole follows both calibrated offset components without changing its world-Z endpoints', () => {
  const { hole, scan, material, rotate } = fixture();
  const heading = .2;
  scan.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading));
  hole.initialize(); assert.equal(hole.show(), true, hole.snapshot().status);
  const near = material.uniforms.uFloorHoleBounds.value.toArray();
  const far = material.uniforms.uFloorHoleFarBounds.value.toArray();
  const dx = -.05 * Math.cos(heading), dz = .05 * Math.sin(heading);
  rotate('rotating', dx, dz); scan.rotation.y += .8; hole.update();
  const during = material.uniforms.uFloorHoleBounds.value.toArray();
  for (const side of [0, 1]) {
    const expected = dx - (far[side] - near[side]) / FLOOR_HOLE.length * dz;
    assert.ok(Math.abs(during[side] - near[side] - expected) < 1e-8);
  }
  assert.deepEqual(during.slice(2), [startZ, endZ]);
});

test('endpoint opening begins one metre beyond the centre or clears a deeper slab in either calibrated direction', () => {
  const calibration = new Matrix4().makeRotationY(.7).setPosition(2.2, 0, -1.1);
  for (const direction of [1, -1] as const) for (const halfDepth of [WALL_SECTION.depth / 2, 1.2]) {
    const { hole, material } = fixture({ calibration });
    hole.initialize();
    const placement = { positionRoute: [.15, 0, 2.5] as const, halfDepth, direction };
    assert.equal(hole.showBehindWall(placement), true, hole.snapshot().status);
    const state = hole.snapshot();
    assert.equal(state.locked, true); assert.equal(state.open, true);
    const edgeDistance = Math.max(1, halfDepth + .05);
    const edge = placement.positionRoute[2] - direction * edgeDistance;
    const other = edge - direction * FLOOR_HOLE.length;
    assert.ok(Math.abs(state.startZ - Math.min(edge, other)) < 1e-12);
    assert.ok(Math.abs(state.endZ - Math.max(edge, other)) < 1e-12);
    assert.ok(Math.abs(state.endZ - state.startZ - FLOOR_HOLE.length) < 1e-12);
    const nearestHoleEdge = direction === 1 ? state.endZ : state.startZ;
    const rearFace = placement.positionRoute[2] - direction * placement.halfDepth;
    assert.ok(Math.abs(direction * (rearFace - nearestHoleEdge) - (edgeDistance - halfDepth)) < 1e-12,
      'The opening is one metre beyond the centre, with at least five centimetres clear of either slab face.');
    const slabStart = placement.positionRoute[2] - placement.halfDepth;
    const slabEnd = placement.positionRoute[2] + placement.halfDepth;
    assert.ok(state.endZ < slabStart || state.startZ > slabEnd, 'Neither wall face may stop over the hole.');
    for (const corner of state.worldCorners!) {
      const route = new Vector3(...corner).applyMatrix4(calibration.clone().invert());
      assert.ok(route.z >= state.startZ - 1e-10 && route.z <= state.endZ + 1e-10);
      assert.ok(Math.min(Math.abs(route.x + .9), Math.abs(route.x - 1.2)) < 1e-6);
      assert.ok(Math.abs(route.y) < 1e-12);
    }
    assert.deepEqual(state.routeToWorld, calibration.toArray());
    const expectedInverse = calibration.clone().invert().toArray();
    material.uniforms.uFloorHoleWorldToRoute.value.toArray().forEach((v: number, i: number) =>
      assert.ok(Math.abs(v - expectedInverse[i]) < 1e-12));
  }
});

test('the first-box endpoint fallback brings the hole closer with its near edge one metre beyond the wall', () => {
  const { hole } = fixture();
  hole.initialize();
  assert.equal(WALL_SECTION.startWorldZ, -8);
  assert.equal(WALL_SECTION.targetWorldZ, 2.5);
  const halfDepth = WALL_SECTION.depth / 2;
  assert.equal(hole.showBehindWall({ positionRoute: [0, 0, WALL_SECTION.targetWorldZ], halfDepth, direction: 1 }), true);
  const state = hole.snapshot();
  assert.equal(FLOOR_HOLE.aheadMetres, 1);
  assert.ok(Math.abs(state.startZ + 1.1) < 1e-12);
  assert.ok(Math.abs(state.endZ - 1.5) < 1e-12);
  assert.ok(Math.abs(WALL_SECTION.targetWorldZ - state.endZ - 1) < 1e-12);
  assert.equal(state.startZ, FLOOR_HOLE.startZ);
  hole.close(); assert.equal(hole.show(), true);
  assert.ok(Math.abs(hole.snapshot().startZ - state.startZ) < 1e-12,
    'Manual floor reveal and wall arrival must use the same authored interval.');
});

test('hidden preparation anchors one metre beyond the wall and reveal never refits or follows a passing player', () => {
  const calibration = new Matrix4().makeRotationY(-.63).setPosition(3, 0, -4);
  for (const direction of [1, -1] as const) {
    const { hole, material, scan, centers, queries, rotate, removeData } = fixture({ calibration });
    const source = centers.slice();
    const player: [number, number, number] = [.15, 1.7, 1.5 + direction * .4];
    const placement: Arrival = { positionRoute: [.15, 0, 1.5], halfDepth: .25, direction,
      crossing: { playerRoute: player, direction: direction === 1 ? -1 : 1 } };
    hole.initialize(); assert.equal(hole.prepareBehindWall(placement), true, hole.snapshot().status);
    const state = hole.snapshot();
    const nearEdge = direction === 1 ? state.endZ : state.startZ;
    assert.ok(Math.abs(direction * (placement.positionRoute[2] - nearEdge) - 1) < 1e-12,
      'Use the fixed wall and approach direction, independent of any old player-passage payload.');
    assert.ok(Math.abs(state.endZ - state.startZ - 2.6) < 1e-12);
    assert.equal(state.open, false); assert.equal(state.locked, true); assert.equal(state.prepared, true);
    assert.equal(material.uniforms.uFloorHoleOpen.value, 0, 'Preparing geometry cannot open the visible floor cut.');
    for (const corner of state.worldCorners!) {
      const route = new Vector3(...corner).applyMatrix4(calibration.clone().invert());
      assert.ok(Math.min(Math.abs(route.x + .9), Math.abs(route.x - 1.2)) < 1e-6);
      assert.ok(Math.min(Math.abs(route.z - state.startZ), Math.abs(route.z - state.endZ)) < 1e-10);
      assert.ok(Math.abs(route.y) < 1e-12);
    }
    const queryCount = queries(), bounds = material.uniforms.uFloorHoleBounds.value.toArray();
    player[0] += 1; player[2] += direction * 2;
    scan.position.x += .3; rotate('rotating', .2, -.1); hole.update();
    assert.equal(hole.prepareBehindWall({ ...placement, positionRoute: [.15, 0, 6] }), true,
      'duplicate preparation must reuse the original fixed wall station');
    removeData();
    assert.equal(hole.revealPrepared(), true, 'revealing the prepared opening does not require live scan data');
    assert.equal(hole.snapshot().open, true); assert.equal(material.uniforms.uFloorHoleOpen.value, 1);
    assert.equal(hole.showBehindWall(placement), true, 'passage must reuse the prepared opening');
    assert.deepEqual(hole.snapshot().worldCorners, state.worldCorners);
    assert.deepEqual(material.uniforms.uFloorHoleBounds.value.toArray(), bounds);
    assert.equal(queries(), queryCount, 'moving the player or scan cannot trigger another fit');
    assert.deepEqual(centers, source);
    hole.reset(); hole.update();
    assert.equal(hole.snapshot().open, false); assert.equal(hole.snapshot().locked, false);
    assert.equal(hole.snapshot().prepared, false); assert.equal(hole.revealPrepared(), false);
    assert.equal(material.uniforms.uFloorHoleOpen.value, 0);
  }
});

test('concealed reveal glitches the already prepared cut without refitting and recovery cancels its progress', () => {
  const { hole, material, queries, block } = fixture();
  const placement: Arrival = { positionRoute: [0, 0, 2.5], halfDepth: .25, direction: 1 };
  hole.initialize(); assert.equal(hole.prepareBehindWall(placement), true);
  const prepared = hole.snapshot(), queryCount = queries();
  block('Tracking interrupted.'); assert.equal(hole.revealPrepared(true), false);
  assert.equal(hole.snapshot().open, false); assert.equal(hole.snapshot().prepared, true);
  block(null); assert.equal(hole.revealPrepared(true), true);
  assert.equal(hole.snapshot().open, true); assert.equal(hole.snapshot().revealProgress, 0);
  assert.equal(material.uniforms.uFloorHoleReveal.value, 0);
  hole.update(FLOOR_HOLE.revealSeconds / 2);
  assert.ok(Math.abs(hole.snapshot().revealProgress - .5) < 1e-12);
  assert.equal(hole.revealPrepared(true), true, 'Repeated concealment notifications cannot restart the effect');
  assert.ok(Math.abs(hole.snapshot().revealProgress - .5) < 1e-12);
  for (const dt of [NaN, -1, .51]) hole.update(dt);
  assert.ok(Math.abs(hole.snapshot().revealProgress - .5) < 1e-12, 'Invalid or stalled clocks cannot advance the reveal');
  hole.update(FLOOR_HOLE.revealSeconds / 2);
  assert.equal(hole.snapshot().revealProgress, 1); assert.equal(material.uniforms.uFloorHoleReveal.value, 1);
  assert.equal(queries(), queryCount); assert.deepEqual(hole.snapshot().worldCorners, prepared.worldCorners);
  hole.reset(); hole.update(.1);
  assert.equal(hole.snapshot().open, false); assert.equal(hole.snapshot().prepared, false);
  assert.equal(hole.snapshot().revealProgress, 0); assert.equal(material.uniforms.uFloorHoleReveal.value, 0);
});

test('arrival freezes floor geometry and source queries until an explicit reset, without stale-frame revival', () => {
  const { hole, scan, material, centers, queries, rotate, removeData } = fixture();
  const source = centers.slice();
  hole.initialize();
  const placement = { positionRoute: [0, 0, WALL_SECTION.targetWorldZ] as const,
    halfDepth: WALL_SECTION.depth / 2, direction: 1 as const };
  assert.equal(hole.showBehindWall(placement), true);
  const initial = hole.snapshot(), bounds = material.uniforms.uFloorHoleBounds.value.toArray();
  const readCount = queries();
  scan.position.x += 3;
  scan.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .6));
  rotate('rotating', .25, -.1); hole.update(); rotate('reversed', .25, -.1); hole.update();
  assert.equal(hole.show(), true, 'repeated reveal must retain the captured opening');
  assert.equal(hole.showBehindWall({ ...placement, positionRoute: [0, 0, -1] }), true,
    'a duplicate arrival callback must not reauthor an already captured opening');
  assert.deepEqual(hole.snapshot().worldCorners, initial.worldCorners);
  assert.deepEqual(material.uniforms.uFloorHoleBounds.value.toArray(), bounds);
  assert.equal(queries(), readCount, 'a frozen arrival must not refit moved scan data');
  assert.deepEqual(centers, source);
  removeData(); assert.equal(hole.show(), true);
  hole.reset(); hole.update();
  assert.equal(hole.snapshot().open, false); assert.equal(hole.snapshot().locked, false);
  assert.equal(material.uniforms.uFloorHoleOpen.value, 0);
  assert.equal(hole.showBehindWall(placement), false);
});

test('manual button API uses the current wall arrival once per closed-to-open cycle', () => {
  let endpoint = -2, arrivalCalls = 0;
  const { hole } = fixture({ arrival: () => {
    arrivalCalls++;
    return { positionRoute: [0, 0, endpoint], halfDepth: WALL_SECTION.depth / 2, direction: 1 };
  } });
  hole.initialize(); assert.equal(hole.show(), true);
  const first = hole.snapshot();
  endpoint = -1;
  assert.equal(hole.show(), true);
  assert.equal(arrivalCalls, 1); assert.equal(hole.snapshot().endZ, first.endZ);
  hole.close(); assert.equal(hole.show(), true);
  assert.equal(arrivalCalls, 2);
  assert.ok(Math.abs(hole.snapshot().endZ - first.endZ - 1) < 1e-12);
});

test('wall-arrival opening rejects blocked, nonmetric, missing-source and malformed commands closed', () => {
  const { hole, block, scan, removeData, material } = fixture();
  const valid: Arrival = { positionRoute: [0, 0, -2], halfDepth: .25, direction: 1 };
  assert.equal(hole.showBehindWall(valid), false);
  hole.initialize(); block('Tracking interrupted.'); assert.equal(hole.showBehindWall(valid), false);
  block(null);
  for (const bad of [
    { ...valid, positionRoute: [0, 0, NaN] as const },
    { ...valid, positionRoute: [0, 0, Infinity] as const },
    { ...valid, halfDepth: -.1 }, { ...valid, halfDepth: NaN },
    { ...valid, direction: 0 as 1 },
  ]) {
    assert.equal(hole.showBehindWall(bad), false);
    assert.equal(hole.snapshot().open, false); assert.equal(material.uniforms.uFloorHoleOpen.value, 0);
  }
  scan.scale.setScalar(2); assert.equal(hole.showBehindWall(valid), false);
  scan.scale.setScalar(1); removeData(); assert.equal(hole.showBehindWall(valid), false);
});
