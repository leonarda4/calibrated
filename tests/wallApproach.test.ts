import test from 'node:test';
import assert from 'node:assert/strict';
import { WallApproach, wallEntryBlocked, type WallClearance } from '../src/viewer/wallApproach.ts';

const space = (z: number, x = 0): WallClearance => ({ player: [x, 1.7, z], centerX: 0,
  halfWidth: 1.05, halfDepth: .25, clearance: .75, resumeExtra: .15 });
const clear = space(-2);

test('the automatic wall stays within 8..2, approaches from the other side and holds its endpoint', () => {
  const wall = new WallApproach();
  wall.start(8, 2, .3);
  assert.equal(wall.snapshot().z, 8);
  wall.update(10, clear);
  assert.equal(wall.snapshot().z, 5);
  wall.update(100, clear);
  assert.equal(wall.snapshot().z, 2);
  assert.equal(wall.snapshot().active, false);
  wall.update(100, space(2));
  assert.equal(wall.snapshot().z, 2);
});

test('a swept step stops before the player, waits with hysteresis and resumes without catching up', () => {
  const wall = new WallApproach(); wall.start(8, 2, .3);
  wall.update(100, space(5));
  assert.equal(wall.snapshot().z, 6);
  assert.equal(wall.snapshot().waitingFor, 'player');
  wall.update(1000, space(5));
  assert.equal(wall.snapshot().z, 6);
  wall.update(1, space(4.9)); // ten cm is short of the 15 cm release margin
  assert.equal(wall.snapshot().z, 6);
  wall.update(1, space(4.8));
  assert.ok(Math.abs(wall.snapshot().z - 5.8) < 1e-8);
  assert.equal(wall.snapshot().speed, .3);
  wall.update(1, clear);
  assert.ok(Math.abs(wall.snapshot().z - 5.5) < 1e-8);
});

test('a close player behind the wall pauses it without retreat; moving aside clears the path', () => {
  const wall = new WallApproach(); wall.start(8, 2, .3);
  wall.update(1, space(8.4));
  assert.equal(wall.snapshot().z, 8);
  wall.update(100, space(7.7));
  assert.equal(wall.snapshot().z, 8);
  wall.update(1, space(7.7, 2.1));
  assert.equal(wall.snapshot().z, 7.7);
  wall.update(1, space(10));
  assert.equal(wall.snapshot().z, 7.4);
});

test('missing or invalid player poses block motion and cancellation prevents late-frame revival', () => {
  const wall = new WallApproach(); wall.start(8, 2, .3);
  wall.update(100, { ...clear, player: null });
  assert.equal(wall.snapshot().z, 8);
  assert.equal(wall.snapshot().waitingFor, 'tracking');
  wall.update(100, space(NaN));
  assert.equal(wall.snapshot().z, 8);
  wall.update(1, clear); wall.cancel();
  const stopped = wall.snapshot().z;
  wall.update(100, clear);
  assert.equal(wall.snapshot().z, stopped);
  assert.equal(wall.snapshot().state, 'idle');
  wall.start(8, 2, .3);
  assert.equal(wall.snapshot().z, 8);
});

test('invalid frames or route parameters cannot move the wall or replace its active route', () => {
  const wall = new WallApproach();
  wall.start(8, 2, .3);
  const before = wall.snapshot();
  for (const dt of [0, -1, NaN, Infinity]) { wall.update(dt, clear); assert.deepEqual(wall.snapshot(), before); }
  assert.throws(() => wall.start(8, 2, 0));
  assert.throws(() => wall.start(8, NaN, .3));
  assert.deepEqual(wall.snapshot(), before);
});

test('either route direction sweeps the player and never retreats or overshoots', () => {
  for (const sign of [-1, 1]) {
    const wall = new WallApproach(); wall.start(sign * 8, sign * 2, .3);
    wall.update(100, space(sign * 5));
    assert.equal(wall.snapshot().z, sign * 6);
    wall.update(100, space(sign * 5));
    assert.equal(wall.snapshot().z, sign * 6);
    wall.update(100, space(-sign * 2));
    assert.equal(wall.snapshot().z, sign * 2);
    assert.equal(wall.snapshot().state, 'complete');
  }
});

test('entry uses the entire swept full-thickness footprint and requires current player tracking', () => {
  const bounds = { minX: -3.3, maxX: 1.05, minZ: -8.25, maxZ: -7.75 };
  assert.equal(wallEntryBlocked([0, 4, -8], bounds, .75), true);
  assert.equal(wallEntryBlocked([-3, 1.6, -8.5], bounds, .75), true);
  assert.equal(wallEntryBlocked(null, bounds, .75), true);
  assert.equal(wallEntryBlocked([0, 1.6, -6.9], bounds, .75), false);
  assert.equal(wallEntryBlocked([2, 1.6, -8], bounds, .75), false);
});
