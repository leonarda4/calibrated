import test from 'node:test';
import assert from 'node:assert/strict';
import { wallConcealsHole, WALL_CONCEALMENT_MARGIN, type WallConcealmentGeometry } from '../src/viewer/wallConcealment.ts';

type Point3 = readonly [number, number, number];
const wall: WallConcealmentGeometry = { position: [0, 0, 2.5], normal: [0, 0, 1], right: [1, 0, 0],
  width: 2.3, height: 2.6, halfDepth: .25 };
const eye: Point3 = [0, 1.7, 4.5];
const hole: Point3[] = [[-1.1, 0, -1.1], [1.1, 0, -1.1], [-1.05, 0, 1.5], [1.05, 0, 1.5]];

test('all fitted aperture corners are concealed before passage, including the full slab face', () => {
  assert.equal(wallConcealsHole(eye, wall, hole), true);
  const before = structuredClone({ wall, eye, hole });
  assert.equal(wallConcealsHole(eye, wall, hole), true);
  assert.deepEqual({ wall, eye, hole }, before, 'Occlusion queries may not mutate the frozen aperture or wall.');
  assert.equal(wallConcealsHole([.9, 1.7, 3], wall, hole), true, 'A close eye still views the aperture through the wall.');
});

test('approach reveals only once the actual moving wall lies in front of the complete aperture', () => {
  assert.equal(wallConcealsHole(eye, { ...wall, position: [0, 0, -8] }, hole), false);
  assert.equal(wallConcealsHole(eye, { ...wall, position: [0, 0, 1] }, hole), false);
  assert.equal(wallConcealsHole(eye, { ...wall, position: [0, 0, 1.6] }, hole), true);
  assert.equal(wallConcealsHole(eye, { ...wall, position: [0, 0, 5] }, hole), false, 'A wall behind the viewer conceals nothing.');
});

test('full depth and the eye-facing face matter for oblique viewing', () => {
  const slant = Math.PI / 5;
  const angled = { ...wall, normal: [Math.sin(slant), 0, Math.cos(slant)] as Point3,
    right: [Math.cos(slant), 0, -Math.sin(slant)] as Point3 };
  assert.equal(wallConcealsHole(eye, angled, hole), true);
  assert.equal(wallConcealsHole([3, 1.7, 3.5], angled, hole), false);
  const otherSide = hole.map(p => [-p[0], p[1], 5 - p[2]] as Point3);
  assert.equal(wallConcealsHole([0, 1.7, .5], wall, otherSide), true, 'Either eye-facing good side can conceal an aperture.');
});

test('every corner must fit the wall rectangle and the conservative edge overlap', () => {
  for (let corner = 0; corner < hole.length; corner++) {
    const changed = hole.map(p => [...p] as [number, number, number]);
    changed[corner][0] = corner % 2 ? 20 : -20;
    assert.equal(wallConcealsHole(eye, wall, changed), false, `Corner ${corner} can expose the opening.`);
  }
  assert.equal(wallConcealsHole([4, 1.7, 4.5], wall, hole), false);
  assert.equal(wallConcealsHole([0, 8, 4.5], wall, hole), false);
  assert.equal(wallConcealsHole([0, 0, 4.5], wall, hole), false, 'A floor-level ray cannot use a zero-overlap bottom edge.');
  const tiny = { ...wall, width: WALL_CONCEALMENT_MARGIN * 2 };
  assert.equal(wallConcealsHole(eye, tiny, hole), false);
});

test('eyes in or on the wall and rays failing to cross it cannot authorize reveal', () => {
  for (const z of [2.25, 2.5, 2.75]) assert.equal(wallConcealsHole([0, 1.7, z], wall, hole), false);
  assert.equal(wallConcealsHole([0, 1.7, .5], wall, hole), false, 'The viewer has already passed to the hole side.');
  const touching = hole.map(p => [p[0], p[1], 2.75] as Point3);
  assert.equal(wallConcealsHole(eye, wall, touching), false);
  const parallel = hole.map((p, i) => [p[0], 0, i < 2 ? 4.5 : 5] as Point3);
  assert.equal(wallConcealsHole(eye, wall, parallel), false);
});

test('concealment is invariant under calibrated horizontal yaw and origin changes', () => {
  const transform = (p: Point3, yaw: number, vector = false): Point3 => [
    Math.cos(yaw) * p[0] + Math.sin(yaw) * p[2] + (vector ? 0 : 3.1),
    p[1] + (vector ? 0 : .6),
    -Math.sin(yaw) * p[0] + Math.cos(yaw) * p[2] + (vector ? 0 : -4.7)];
  for (const yaw of [Math.PI, Math.PI / 2, -.63]) {
    const mapped = { ...wall, position: transform(wall.position, yaw),
      normal: transform(wall.normal, yaw, true), right: transform(wall.right, yaw, true) };
    for (const viewer of [eye, [4, 1.7, 4.5] as const, [0, 1.7, .5] as const]) {
      assert.equal(wallConcealsHole(transform(viewer, yaw), mapped, hole.map(p => transform(p, yaw))),
        wallConcealsHole(viewer, wall, hole));
    }
  }
});

test('missing, nonfinite and degenerate inputs cannot reveal the floor', () => {
  assert.equal(wallConcealsHole(null, wall, hole), false);
  assert.equal(wallConcealsHole([NaN, 1, 4], wall, hole), false);
  assert.equal(wallConcealsHole(eye, wall, null), false);
  assert.equal(wallConcealsHole(eye, wall, hole.slice(0, 3)), false);
  assert.equal(wallConcealsHole(eye, wall, hole.map(() => hole[0])), false);
  const nonfloor = hole.map((p, i) => [p[0], i ? 0 : .2, p[2]] as Point3);
  assert.equal(wallConcealsHole(eye, wall, nonfloor), false);
  for (const dimensions of [{ width: NaN }, { height: 0 }, { halfDepth: -1 }]) {
    assert.equal(wallConcealsHole(eye, { ...wall, ...dimensions }, hole), false);
  }
  assert.equal(wallConcealsHole(eye, { ...wall, normal: [0, 0, 0] }, hole), false);
  assert.equal(wallConcealsHole(eye, { ...wall, normal: [0, 0, 2] }, hole), false);
  assert.equal(wallConcealsHole(eye, { ...wall, right: [0, 0, 1] }, hole), false);
  assert.equal(wallConcealsHole(eye, { ...wall, normal: [0, .1, Math.sqrt(.99)] }, hole), false);
});
