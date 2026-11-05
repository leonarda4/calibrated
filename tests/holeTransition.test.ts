import test from 'node:test';
import assert from 'node:assert/strict';
import { createHoleTransition, headsetAboveHole, headsetClearOfHole, type HoleFootprint } from '../src/experience/holeTransition.ts';

const hole: HoleFootprint = Object.freeze({
  open: true, floorY: .3, startZ: -3, endZ: -1,
  nearBounds: Object.freeze([-1, 1]), farBounds: Object.freeze([0, 2]),
});

test('headset hole test interpolates both fitted edges rather than accepting their bounding rectangle', () => {
  assert.equal(headsetAboveHole([-.75, 1.7, -2], hole), false);
  assert.equal(headsetAboveHole([1.75, 1.7, -2], hole), false);
  assert.equal(headsetAboveHole([-.5, 1.7, -2], hole), true);
  assert.equal(headsetAboveHole([1.5, 1.7, -2], hole), true);
  assert.equal(headsetAboveHole([-1, 1.7, -3], hole), true);
  assert.equal(headsetAboveHole([2, 1.7, -1], hole), true);
  assert.equal(headsetAboveHole([1, 1.7, -1], hole), true);
  assert.equal(headsetAboveHole([1, 1.7, -3.00001], hole), false);
  assert.equal(headsetAboveHole([1, 1.7, -.99999], hole), false);
});

test('an open hole requires the headset at or above its actual floor without a height ceiling', () => {
  assert.equal(headsetAboveHole([0, .29999, -2], hole), false);
  assert.equal(headsetAboveHole([0, .3, -2], hole), true);
  assert.equal(headsetAboveHole([0, 100, -2], hole), true);
  assert.equal(headsetAboveHole([0, 1.7, -2], { ...hole, open: false }), false);
});

test('repeat entry requires a horizontal exit beyond the fitted edges and clearance margin', () => {
  assert.equal(headsetClearOfHole([-.55, 1.7, -2], hole), false);
  assert.equal(headsetClearOfHole([-.61, 1.7, -2], hole), true);
  assert.equal(headsetClearOfHole([1.55, 1.7, -2], hole), false);
  assert.equal(headsetClearOfHole([1.61, 1.7, -2], hole), true);
  assert.equal(headsetClearOfHole([0, 1.7, -3.05], hole), false);
  assert.equal(headsetClearOfHole([0, 1.7, -3.11], hole), true);
  assert.equal(headsetClearOfHole([1, 1.7, -.95], hole), false);
  assert.equal(headsetClearOfHole([1, 1.7, -.89], hole), true);
  assert.equal(headsetClearOfHole([0, -.5, -2], hole), false, 'Lowering the head is not a fresh horizontal exit.');
  for (const position of [null, [], [NaN, 1, -2], [0, Infinity, -2]]) assert.equal(headsetClearOfHole(position, hole), false);
  assert.equal(headsetClearOfHole([8, 1.7, -2], { ...hole, open: false }), false);
  assert.equal(headsetClearOfHole([8, 1.7, -2], { ...hole, nearBounds: null }), false);
  assert.equal(headsetClearOfHole([8, 1.7, -2], hole, NaN), false);
});

test('missing/nonfinite poses and malformed or missing fitted geometry cannot trigger', () => {
  for (const position of [null, [], [0, 1], [0, 1, -2, 4], [NaN, 1, -2], [0, Infinity, -2], [0, 1, NaN]]) {
    assert.equal(headsetAboveHole(position, hole), false);
  }
  for (const invalid of [
    { floorY: NaN }, { startZ: NaN }, { endZ: Infinity }, { endZ: -3 }, { startZ: -1 },
    { nearBounds: null }, { farBounds: null }, { nearBounds: [0] }, { farBounds: [0, 1, 2] },
    { nearBounds: [NaN, 1] }, { farBounds: [0, Infinity] },
    { nearBounds: [1, 0] }, { farBounds: [1, 1] },
    // Its middle would have positive width if only the interpolated edges were checked.
    { nearBounds: [1, 0], farBounds: [-4, 4] },
  ]) assert.equal(headsetAboveHole([0, 1.7, -2], { ...hole, ...invalid }), false);
});

test('one entry starts exactly one two-second anticipation and one visual turn', () => {
  const events: string[] = [];
  const trigger = createHoleTransition({ leadSeconds: 2,
    onAnticipate() { events.push('music'); }, onTransition() { events.push('visual turn'); } });
  trigger.update(.25, true, false);
  assert.deepEqual(events, []);
  trigger.update(.25, true, true);
  assert.deepEqual(events, ['music']);
  assert.deepEqual(trigger.snapshot(), { phase: 'anticipating', remainingSeconds: 2, visualImplemented: true });
  for (let i = 0; i < 7; i++) trigger.update(.25, true, true);
  trigger.update(.249, true, false);
  assert.deepEqual(events, ['music']);
  trigger.update(.001, true, false);
  assert.deepEqual(events, ['music', 'visual turn']);
  assert.deepEqual(trigger.snapshot(), { phase: 'triggered', remainingSeconds: null, visualImplemented: true });
  for (let i = 0; i < 20; i++) trigger.update(.25, true, i % 2 === 0);
  assert.deepEqual(events, ['music', 'visual turn']);
});

test('pause, invalid clock or lost eligibility cancels an armed anticipation without revival', () => {
  for (const [deltaSeconds, eligible] of [[.501, true], [NaN, true], [Infinity, true], [-.1, true], [.1, false], [0, false]] as const) {
    const events: string[] = [];
    const trigger = createHoleTransition({ leadSeconds: 2,
      onAnticipate() { events.push('music'); }, onTransition() { events.push('visual turn'); } });
    trigger.update(.25, true, true);
    trigger.update(deltaSeconds, eligible, true);
    assert.equal(trigger.snapshot().phase, 'cancelled');
    for (let i = 0; i < 12; i++) trigger.update(.25, true, true);
    assert.deepEqual(events, ['music']);
    trigger.reset();
    trigger.update(.25, true, false);
    assert.equal(trigger.snapshot().phase, 'idle');
    trigger.update(.25, true, true);
    for (let i = 0; i < 8; i++) trigger.update(.25, true, true);
    assert.deepEqual(events, ['music', 'music', 'visual turn']);
  }
});

test('idle eligibility and zero-duration frames neither trigger nor spend anticipation time', () => {
  let starts = 0, visualStarts = 0;
  const trigger = createHoleTransition({ leadSeconds: 2, onAnticipate() { starts++; }, onTransition() { visualStarts++; } });
  trigger.update(.1, false, true);
  trigger.update(0, true, true);
  assert.equal(trigger.snapshot().phase, 'idle');
  trigger.update(.1, true, true);
  trigger.update(0, true, true);
  assert.equal(trigger.snapshot().remainingSeconds, 2);
  for (let i = 0; i < 20; i++) trigger.update(.1, true, false);
  assert.equal(starts, 1); assert.equal(visualStarts, 1);
});

test('headset checks and the visual turn leave the supplied geometry/pose untouched', () => {
  const position = Object.freeze([.5, 1.65, -2]);
  const before = JSON.stringify({ hole, position });
  let visualStarts = 0;
  const trigger = createHoleTransition({ leadSeconds: 2, onAnticipate() {}, onTransition() { visualStarts++; } });
  trigger.update(.1, true, headsetAboveHole(position, hole));
  for (let i = 0; i < 8; i++) trigger.update(.25, true, headsetAboveHole(position, hole));
  assert.equal(visualStarts, 1);
  assert.equal(trigger.snapshot().visualImplemented, true);
  assert.equal(JSON.stringify({ hole, position }), before);
});
