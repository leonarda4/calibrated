import test from 'node:test';
import assert from 'node:assert/strict';
import { WallRevealGate } from '../src/viewer/wallReveal.ts';

test('hidden wall reveals immediately on look-away or after exactly five continuous watched seconds', () => {
  const gate = new WallRevealGate();
  assert.equal(gate.update(0, false), true);
  for (let i = 0; i < 49; i++) assert.equal(gate.update(.1, true), false);
  assert.equal(gate.update(.099, true), false);
  assert.equal(gate.update(.001, true), true);
  assert.equal(gate.remainingSeconds(), 0);
});

test('unknown gaze, stalled/invalid clocks and cancellation cannot accumulate a stale timeout', () => {
  const gate = new WallRevealGate();
  for (const invalid of [NaN, Infinity, -.1, .501]) {
    for (let i = 0; i < 9; i++) gate.update(.5, true);
    assert.equal(gate.update(invalid, false), false);
    assert.equal(gate.remainingSeconds(), 5);
  }
  gate.update(.5, true); assert.equal(gate.update(.1, null), false); assert.equal(gate.remainingSeconds(), 5);
  gate.update(.5, true); gate.update(0, true); assert.equal(gate.remainingSeconds(), 4.5);
  gate.update(.1, false); assert.equal(gate.remainingSeconds(), 5);
  gate.update(.5, true); gate.reset(); assert.equal(gate.remainingSeconds(), 5);
});
