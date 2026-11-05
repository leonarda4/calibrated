import test from 'node:test';
import assert from 'node:assert/strict';
import { WallGaze, lookingAtWall } from '../src/viewer/wallGaze.ts';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' != ' + expected);
const input = (looking: boolean | null, z = -8, arrived = false) => ({ looking, z, arrived });

test('the revealed wall immediately moves unseen without a watched introduction or distance cap', () => {
  const wall = new WallGaze(); wall.start(-8, 2.5);
  assert.equal(wall.snapshot().stage, 'stealth');
  assert.equal(wall.snapshot().allowedSeconds, 0);
  const gate = wall.update(.1, input(false));
  close(gate.allowedSeconds, .1);
  assert.equal(gate.maxTravel, Infinity);
  assert.equal(gate.movementSoundGain, 1);
  assert.equal(gate.stopInSeconds, null);
  wall.observePosition(-5); // Actual movement exceeding the former 2m intro changes no gate.
  assert.equal(wall.update(.1, input(false, -5)).stage, 'stealth');
  close(wall.snapshot().allowedSeconds, .1);
});

test('look-back movement and its sound envelope end precisely at 0.7 seconds', () => {
  const wall = new WallGaze(); wall.start(-8, 2.5);
  wall.update(.1, input(false));
  let gate = wall.update(.4, input(true, -7.9));
  close(gate.allowedSeconds, .4);
  close(gate.stopInSeconds!, .3);
  close(gate.movementSoundGain, 3 / 7);
  gate = wall.update(.4, input(true, -7.5));
  close(gate.allowedSeconds, .3); // Only the part of the frame before the deadline moves.
  close(gate.stopInSeconds!, 0);
  close(gate.movementSoundGain, 0);
  close(gate.lookSeconds, 0); // The five-second dwell starts only at actual arrival.
  assert.equal(wall.update(.5, input(true, -7.2)).allowedSeconds, 0);
  gate = wall.update(.1, input(false, -7.2));
  close(gate.allowedSeconds, .1);
  close(gate.movementSoundGain, 1);
  close(gate.lookSeconds, 0);
  close(wall.update(.1, input(true, -7.1)).stopInSeconds!, .6);
});

test('proximity waits and stationary observations cannot bank unseen catch-up motion', () => {
  const wall = new WallGaze(); wall.start(-8, 2.5);
  for (let i = 0; i < 50; i++) close(wall.update(.1, input(false)).allowedSeconds, .1);
  assert.equal(wall.snapshot().stage, 'stealth');
  assert.equal(wall.snapshot().maxTravel, Infinity);
  assert.equal(wall.update(30, input(false)).allowedSeconds, 0);
  close(wall.update(.1, input(false)).allowedSeconds, .1);
  wall.update(.5, input(true)); wall.update(.3, input(true));
  assert.equal(wall.update(.1, input(true)).allowedSeconds, 0);
});

test('unknown gaze and invalid or stalled frames block movement without refreshing stop grace', () => {
  const wall = new WallGaze(); wall.start(-8, 2.5);
  for (const dt of [0, -1, NaN, Infinity, .50001]) {
    assert.equal(wall.update(dt, input(false)).allowedSeconds, 0);
    assert.equal(wall.snapshot().movementSoundGain, 0);
    assert.equal(wall.snapshot().stage, 'stealth');
  }
  wall.update(.1, input(false)); wall.update(.4, input(true));
  assert.equal(wall.update(.1, input(null)).allowedSeconds, 0);
  close(wall.snapshot().lookSeconds, 0);
  assert.equal(wall.snapshot().stopInSeconds, null);
  assert.equal(wall.update(.1, input(true)).allowedSeconds, 0);
  close(wall.update(.1, input(false)).allowedSeconds, .1);
  assert.equal(wall.update(.1, input(false, NaN)).allowedSeconds, 0);
  assert.equal(wall.update(.1, input(true)).allowedSeconds, 0);
});

test('prearrival gaze never counts toward the final five-second disappearance dwell', () => {
  const wall = new WallGaze(); wall.start(-8, 2.5);
  wall.update(.1, input(false));
  for (let i = 0; i < 12; i++) wall.update(.5, input(true, -6));
  assert.equal(wall.snapshot().stage, 'stealth');
  assert.equal(wall.snapshot().vanishReady, false);
  assert.equal(wall.snapshot().arrivalReady, false);
  close(wall.snapshot().lookSeconds, 0);
  wall.observePosition(2.5, true);
  close(wall.snapshot().lookSeconds, 0);
  for (let i = 0; i < 9; i++) wall.update(.5, input(true, 2.5, true));
  assert.equal(wall.snapshot().vanishReady, false);
  assert.equal(wall.update(.5, input(true, 2.5, true)).vanishReady, true);
  assert.equal(wall.snapshot().arrivalReady, true);
  assert.equal(wall.snapshot().allowedSeconds, 0);
  assert.equal(wall.update(.1, input(false, 2.5, true)).vanishReady, false);
  close(wall.snapshot().lookSeconds, 0);
});

test('endpoint arrival holds motion and requires a fresh complete five-second look', () => {
  const wall = new WallGaze(); wall.start(-8, 2.5);
  wall.update(.5, input(true, 2.4));
  wall.observePosition(2.5, true);
  assert.equal(wall.snapshot().stage, 'arrival');
  close(wall.snapshot().lookSeconds, 0);
  assert.equal(wall.snapshot().stopInSeconds, null);
  assert.equal(wall.snapshot().allowedSeconds, 0);
  for (let i = 0; i < 9; i++) wall.update(.5, input(true, 2.5, true));
  assert.equal(wall.snapshot().vanishReady, false);
  assert.equal(wall.update(.5, input(true, 2.5, true)).vanishReady, true);
  assert.equal(wall.snapshot().movementSoundGain, 0);
});

test('lost gaze, look-away and stalled frames reset the complete five-second dwell', () => {
  const wall = new WallGaze(); wall.start(-8, 2.5); wall.observePosition(2.5, true);
  for (const interruption of [input(false), input(null), input(true, NaN)]) {
    for (let i = 0; i < 8; i++) wall.update(.5, input(true));
    wall.update(.1, interruption);
    close(wall.snapshot().lookSeconds, 0);
    assert.equal(wall.snapshot().vanishReady, false);
  }
  for (let i = 0; i < 8; i++) wall.update(.5, input(true));
  assert.equal(wall.update(1, input(true)).lookSeconds, 0);
  for (let i = 0; i < 9; i++) wall.update(.5, input(true));
  assert.equal(wall.snapshot().vanishReady, false);
});

test('ordinary decimal frame steps finish the dwell exactly at five seconds', () => {
  const wall = new WallGaze(); wall.start(-8, 2.5); wall.observePosition(2.5, true);
  for (let i = 0; i < 49; i++) wall.update(.1, input(true));
  assert.equal(wall.snapshot().vanishReady, false);
  assert.equal(wall.update(.1, input(true)).vanishReady, true);
  close(wall.snapshot().lookSeconds, 5);
});

test('both route directions and short or zero-length paths keep the same unseen gate', () => {
  for (const [start, end] of [[-8, 2.5], [8, -2.5], [-3, -2], [-2, -2]]) {
    const wall = new WallGaze(); wall.start(start, end);
    assert.equal(wall.snapshot().stage, 'stealth');
    close(wall.update(.1, input(false, start)).allowedSeconds, .1);
    assert.equal(wall.snapshot().maxTravel, Infinity);
    wall.observePosition(end, true);
    assert.equal(wall.snapshot().stage, 'arrival');
    assert.equal(wall.update(.1, input(false, end, true)).allowedSeconds, 0);
  }
});

test('reset prevents late-frame revival and invalid starts preserve the current gate', () => {
  const wall = new WallGaze(); wall.start(-8, 2.5); wall.update(.1, input(true));
  const before = wall.snapshot();
  assert.throws(() => wall.start(NaN, 2.5)); assert.deepEqual(wall.snapshot(), before);
  wall.reset(); wall.observePosition(2.5, true);
  assert.equal(wall.update(.5, input(true, 2.5, true)).stage, 'idle');
  assert.equal(wall.snapshot().allowedSeconds, 0);
  assert.equal(wall.snapshot().vanishReady, false);
  wall.start(-8, 2.5);
  assert.equal(wall.snapshot().stage, 'stealth');
  close(wall.update(.1, input(false)).allowedSeconds, .1);
});

test('wall gaze uses a normalized 3D cone, including pitch and its inclusive boundary', () => {
  assert.equal(lookingAtWall([0, 1.6, 0], [0, 0, -10], [0, 1.6, -8]), true);
  assert.equal(lookingAtWall([0, 1.6, 0], [0, 0, 1], [0, 1.6, -8]), false);
  assert.equal(lookingAtWall([0, 1.6, 0], [1, 0, -1], [0, 1.6, -8]), true);
  assert.equal(lookingAtWall([0, 1.6, 0], [1.1, 0, -1], [0, 1.6, -8]), false);
  assert.equal(lookingAtWall([0, 1.6, 0], [0, 2, 0], [0, 1.3, -8]), false);
  assert.equal(lookingAtWall([0, 1.6, 0], [0, 1, -1], [0, 1.6, -8]), true);
  assert.equal(lookingAtWall([0, 1.6, 0], [0, 1.1, -1], [0, 1.6, -8]), false);
  const edge = [Math.sin(47 * Math.PI / 180), 0, -Math.cos(47 * Math.PI / 180)] as const;
  assert.equal(lookingAtWall([0, 1.6, 0], edge, [0, 1.6, -8], 45), false);
  assert.equal(lookingAtWall([0, 1.6, 0], edge, [0, 1.6, -8], 50), true);
});

test('wall gaze is invariant under shared translated and yawed calibration frames', () => {
  const point = (p: readonly [number, number, number], yaw: number, translate = true): readonly [number, number, number] => [
    Math.cos(yaw) * p[0] + Math.sin(yaw) * p[2] + (translate ? 3 : 0),
    p[1] + (translate ? .7 : 0),
    -Math.sin(yaw) * p[0] + Math.cos(yaw) * p[2] + (translate ? -4 : 0)];
  for (const yaw of [Math.PI, Math.PI / 2, -.63]) {
    for (const forward of [[0, 0, -1], [0, 0, 1], [.8, 0, -1]] as const) {
      assert.equal(lookingAtWall(point([0, 1.6, 0], yaw), point(forward, yaw, false), point([0, 1.3, -8], yaw)),
        lookingAtWall([0, 1.6, 0], forward, [0, 1.3, -8]));
    }
  }
});

test('missing, nonfinite and degenerate gaze inputs return unknown rather than looking away', () => {
  const p = [0, 1.6, 0] as const, f = [0, 0, -1] as const, t = [0, 1.3, -8] as const;
  assert.equal(lookingAtWall(null, f, t), null);
  assert.equal(lookingAtWall(p, null, t), null);
  assert.equal(lookingAtWall(p, [0, 0, 0], t), null);
  assert.equal(lookingAtWall(p, f, p), null);
  assert.equal(lookingAtWall(p, f, [1e-12, 1.6, 0]), null, 'Transform roundoff at the wall centre cannot define a viewing ray.');
  assert.equal(lookingAtWall(p, [0, 0, -1e-12], t), null);
  assert.equal(lookingAtWall([NaN, 1.6, 0], f, t), null);
  assert.equal(lookingAtWall(p, [Infinity, 0, -1], t), null);
  assert.equal(lookingAtWall(p, f, [0, NaN, -8]), null);
  for (const degrees of [-1, NaN, Infinity, 180]) assert.equal(lookingAtWall(p, f, t, degrees), null);
});
