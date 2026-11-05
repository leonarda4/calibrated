import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorationFootsteps, type FootstepPass } from '../src/audio/explorationFootsteps.ts';
import { GAMEPLAY_AUDIO } from '../src/audio/gameplayAudioConfig.ts';

test('irregular walkers continue through long live exploration with bounded gaps, gains and passing directions', () => {
  let seed = 473;
  const footsteps = createExplorationFootsteps(() => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; });
  const passes: (FootstepPass & { at: number })[] = [];
  footsteps.start(0);
  for (let now = .05; now <= 120; now += .05) {
    const pass = footsteps.update(now); if (pass) passes.push({ ...pass, at: now });
  }
  assert.ok(passes.length > 10 && passes.at(-1)!.at > 100, 'live exploration must not end at the autoplay deadline');
  assert.ok(passes[0].at >= 3 && passes[0].at <= 6.05);
  const intervals: string[] = [];
  passes.forEach((pass, index) => {
    assert.ok(GAMEPLAY_AUDIO.explorationFootsteps.clips.includes(pass.clip));
    assert.ok(pass.gainScale >= .85 && pass.gainScale <= 1.15);
    assert.ok(Math.abs(pass.panFrom) >= .35 && Math.abs(pass.panFrom) <= .75);
    assert.equal(pass.panFrom, -pass.panTo);
    if (index) {
      const interval = pass.at - passes[index-1].at; intervals.push(interval.toFixed(1));
      assert.ok(interval >= 5 - 1e-8 && interval <= 8.05 + 1e-8, 'pass length plus a real quiet gap prevents overlap');
      assert.notEqual(pass.clip, passes[index-1].clip, 'both recordings take turns instead of repeating one sample');
    }
  });
  assert.ok(new Set(intervals).size > 3);
  assert.ok(passes.some(pass => pass.panFrom < 0) && passes.some(pass => pass.panFrom > 0));
});

test('missed footstep passes are skipped without bursts, and Stop/restart clears the old deadline', () => {
  const footsteps = createExplorationFootsteps(() => .5);
  footsteps.start(0); assert.equal(footsteps.snapshot().nextAtSeconds, 4.5);
  assert.equal(footsteps.update(100), null);
  assert.equal(footsteps.snapshot().nextAtSeconds, 106.5);
  assert.equal(footsteps.update(100), null);
  assert.equal(footsteps.update(Number.NaN), null); assert.equal(footsteps.update(99), null);
  assert.ok(footsteps.update(106.5)); assert.equal(footsteps.update(106.5), null);
  footsteps.stop(); assert.equal(footsteps.update(500), null);
  footsteps.start(500); assert.equal(footsteps.snapshot().nextAtSeconds, 504.5);
  assert.ok(footsteps.update(504.5));
});

test('injected random endpoints remain bounded and invalid start clocks do not create passes', () => {
  for (const value of [0, 1, -10, 10, Number.NaN]) {
    const footsteps = createExplorationFootsteps(() => value);
    footsteps.start(-1); assert.equal(footsteps.snapshot().active, false);
    footsteps.start(0);
    const pass = footsteps.update(footsteps.snapshot().nextAtSeconds!);
    assert.ok(pass && pass.clip && Math.abs(pass.panFrom) <= 1 && pass.gainScale > 0);
  }
});
