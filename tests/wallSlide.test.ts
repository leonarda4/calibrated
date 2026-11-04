import test from 'node:test';
import assert from 'node:assert/strict';
import { WallSlide } from '../src/viewer/wallSlide.ts';

test('every reveal enters from the left and every hide continues to the right', () => {
  const slide = new WallSlide(1.25);
  for (let cycle = 0; cycle < 3; cycle++) {
    assert.equal(slide.show(2.3), true);
    assert.equal(slide.snapshot().offset, -2.3);
    let last = -2.3;
    for (let frame = 0; frame < 125; frame++) {
      slide.update(.01);
      const { offset } = slide.snapshot();
      assert.ok(offset >= last && offset <= 0, 'Entry reversed or overshot the centre.');
      last = offset;
    }
    assert.equal(slide.snapshot().motion, 'visible');
    assert.equal(slide.snapshot().offset, 0);
    assert.equal(slide.hide(), true);
    last = 0;
    for (let frame = 0; frame < 125; frame++) {
      slide.update(.01);
      const { offset } = slide.snapshot();
      assert.ok(offset >= last && offset <= 2.3, 'Exit reversed or overshot the parking position.');
      last = offset;
    }
    assert.equal(slide.snapshot().motion, 'hidden');
    assert.equal(slide.snapshot().offset, 2.3);
  }
});

test('button repeats cannot reverse or restart an active slide', () => {
  const slide = new WallSlide(1);
  assert.equal(slide.hide(), false);
  slide.show(2);
  slide.update(.4);
  const entering = slide.snapshot();
  assert.equal(slide.show(9), false);
  assert.equal(slide.hide(), false);
  assert.deepEqual(slide.snapshot(), entering);
  slide.update(.6);
  assert.equal(slide.show(9), false);
  slide.hide(); slide.update(.4);
  const exiting = slide.snapshot();
  assert.equal(slide.show(9), false);
  assert.equal(slide.hide(), false);
  assert.deepEqual(slide.snapshot(), exiting);
});

test('recovery cancels either leg and stale elapsed time cannot reveal the wall again', () => {
  const slide = new WallSlide(1);
  for (const leg of ['entering', 'exiting']) {
    slide.show(2);
    if (leg === 'exiting') { slide.update(1); slide.hide(); }
    slide.update(.4);
    slide.reset();
    slide.update(10);
    assert.deepEqual(slide.snapshot(), { motion: 'hidden', offset: 0, progress: 0, animating: false });
  }
  slide.show(2);
  assert.equal(slide.snapshot().offset, -2);
});

test('invalid frames cannot move the wall and a late frame clamps at the endpoint', () => {
  const slide = new WallSlide(1);
  slide.show(2);
  const start = slide.snapshot();
  for (const delta of [0, -.1, NaN, Infinity, -Infinity]) {
    slide.update(delta);
    assert.deepEqual(slide.snapshot(), start);
  }
  slide.update(100);
  assert.equal(slide.snapshot().motion, 'visible');
  assert.equal(slide.snapshot().offset, 0);
  slide.hide(); slide.update(100);
  assert.equal(slide.snapshot().motion, 'hidden');
  assert.equal(slide.snapshot().offset, 2);
});

test('invalid metric distances or durations are rejected without changing state', () => {
  for (const invalid of [0, -1, NaN, Infinity]) {
    assert.throws(() => new WallSlide(invalid), /duration/);
    const slide = new WallSlide(1);
    assert.throws(() => slide.show(invalid), /distance/);
    assert.equal(slide.snapshot().motion, 'hidden');
  }
});
