import test from 'node:test';
import assert from 'node:assert/strict';
import { SecondBoxLights } from '../src/experience/secondBoxLights.ts';

test('settled second-box appearance waits two seconds, flickers once for one second and holds dark', () => {
  const cue = new SecondBoxLights();
  cue.observe(false); cue.update(.5); assert.equal(cue.snapshot().phase, 'idle');
  cue.observe(true); cue.update(.1); // first observed frame starts the delay
  for (let i = 0; i < 19; i++) cue.update(.1);
  assert.equal(cue.snapshot().phase, 'waiting');
  cue.update(.1); assert.equal(cue.snapshot().phase, 'flickering');
  assert.equal(cue.snapshot().relight, 1);
  const levels = [cue.snapshot().relight];
  for (let i = 0; i < 99; i++) { cue.update(.01); levels.push(cue.snapshot().relight); }
  assert.equal(cue.snapshot().phase, 'flickering');
  assert.ok(levels.every(value => value >= 0 && value <= 1));
  assert.ok(levels.filter((value, index) => index && value > levels[index - 1] + .01).length > 10);
  cue.update(.01); assert.equal(cue.snapshot().phase, 'dark');
  for (let i = 0; i < 20; i++) { cue.observe(true); cue.update(.1); }
  assert.equal(cue.snapshot().phase, 'dark', 'one appearance must not repeat the cue');
});

test('hide, manual cancellation and a paused frame cannot revive an old cue', () => {
  for (const interrupt of ['hide', 'cancel', 'pause']) {
    const cue = new SecondBoxLights(); cue.observe(true); cue.update(.01); cue.update(.5);
    if (interrupt === 'hide') cue.observe(false);
    else if (interrupt === 'cancel') cue.cancel();
    else cue.update(.501);
    for (let i = 0; i < 30; i++) cue.update(.1);
    assert.equal(cue.snapshot().phase, 'cancelled');
    if (interrupt !== 'hide') { cue.observe(true); cue.update(.1); assert.equal(cue.snapshot().phase, 'cancelled'); }
    cue.observe(false); cue.observe(true); cue.update(.01);
    assert.equal(cue.snapshot().phase, 'waiting', 'a genuinely new reveal can arm a fresh cue');
  }
});
