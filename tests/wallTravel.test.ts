import test from 'node:test';
import assert from 'node:assert/strict';
import { WallTravel } from '../src/viewer/wallTravel.ts';

test('forward and backward travel use metres per second and stop exactly at their targets', () => {
  const travel = new WallTravel();
  for (const [mode, sign] of [['forward', 1], ['backward', -1]] as const) {
    travel.start(mode, 2, .25);
    travel.update(2);
    assert.equal(travel.snapshot().offset, sign * .5);
    travel.update(20);
    assert.equal(travel.snapshot().offset, sign * 2);
    assert.equal(travel.snapshot().moving, false);
    travel.update(20);
    assert.equal(travel.snapshot().offset, sign * 2);
    travel.reset();
  }
});

test('back-and-forth motion passes both sides of its anchor and turns smoothly within its speed limit', () => {
  const travel = new WallTravel();
  const distance = 1.5, speed = .2, quarter = Math.PI * distance / (2 * speed);
  travel.start('loop', distance, speed);
  for (const expected of [distance, 0, -distance, 0, distance]) {
    travel.update(quarter);
    assert.ok(Math.abs(travel.snapshot().offset - expected) < 1e-10);
    assert.equal(travel.snapshot().moving, true);
  }
  let previous = travel.snapshot().offset;
  for (let frame = 0; frame < 1000; frame++) {
    travel.update(.02);
    const current = travel.snapshot().offset;
    assert.ok(Math.abs(current) <= distance);
    assert.ok(Math.abs(current - previous) <= speed * .02 + 1e-10);
    previous = current;
  }
});

test('recovery clears movement and late updates cannot revive it while retaining test preferences', () => {
  const travel = new WallTravel();
  travel.start('loop', 2, .1); travel.update(3); travel.reset(); travel.update(100);
  assert.deepEqual(travel.snapshot(), { mode: 'stopped', offset: 0, distance: 2, speed: .1, moving: false });
});

test('invalid frames and invalid new commands leave active movement unchanged', () => {
  const travel = new WallTravel();
  travel.start('forward', 1, .15); travel.update(1);
  const before = travel.snapshot();
  for (const dt of [0, -1, NaN, Infinity]) { travel.update(dt); assert.deepEqual(travel.snapshot(), before); }
  for (const distance of [0, -1, 11, NaN, Infinity]) {
    assert.throws(() => travel.start('forward', distance, .2));
    assert.deepEqual(travel.snapshot(), before);
  }
  for (const speed of [0, -1, 2, NaN, Infinity]) {
    assert.throws(() => travel.start('backward', 1, speed));
    assert.deepEqual(travel.snapshot(), before);
  }
});
