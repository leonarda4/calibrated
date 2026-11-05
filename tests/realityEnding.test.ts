import test from 'node:test';
import assert from 'node:assert/strict';
import { RealityEnding, REALITY_ENDING, type RealityEndingSample, type RealityWorldPhase } from '../src/experience/realityEnding.ts';

const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function fixture(seed = 72) {
  const ending = new RealityEnding({ seed });
  const sample = (overrides: Partial<RealityEndingSample> = {}): RealityEndingSample => ({
    dt: .1, eligible: true, worldPhase: 'original', collapseStarted: false, brightness: .3, ...overrides,
  });
  const arm = () => ending.update(sample({ worldPhase: 'complete', collapseStarted: true }));
  const returning = () => ending.update(sample({ worldPhase: 'returning' }));
  const arrive = (brightness = .3, dt = .4) => ending.update(sample({ brightness, dt }));
  const ready = (brightness = .3) => { arm(); returning(); arrive(brightness); };
  const step = (seconds: number, overrides: Partial<RealityEndingSample> = {}) => {
    while (seconds > 1e-10) { const dt = Math.min(.1, seconds); ending.update(sample({ ...overrides, dt })); seconds -= dt; }
  };
  return { ending, sample, arm, returning, arrive, ready, step };
}

test('idle ignores absent collapse, ineligible/invalid samples and unchanged original-world poses', () => {
  const f = fixture();
  for (const worldPhase of ['idle', 'complete', 'returning', 'original', 'cancelled'] as const) {
    f.ending.update(f.sample({ worldPhase })); assert.equal(f.ending.snapshot().phase, 'idle');
  }
  for (const invalid of [{ eligible: false }, { dt: NaN }, { dt: .501 }, { brightness: NaN }, { brightness: 2 }, { worldPhase: 'cancelled' as const }]) {
    f.ending.update(f.sample({ ...invalid, collapseStarted: true })); assert.equal(f.ending.snapshot().phase, 'idle');
  }
  assert.equal(f.ending.snapshot().brightness, null); assert.equal(f.ending.snapshot().originalDamage, false);
  f.arm(); assert.equal(f.ending.snapshot().phase, 'armed');
  f.step(10); assert.equal(f.ending.snapshot().phase, 'armed');
  assert.equal(f.ending.snapshot().returnedCount, 0); assert.equal(f.ending.snapshot().narrationCount, 0);
});

test('only an armed observed return applies original damage and its actual endpoint starts time at zero', () => {
  const f = fixture();
  f.ending.update(f.sample({ worldPhase: 'returning' }));
  f.ending.update(f.sample({ collapseStarted: true }));
  assert.equal(f.ending.snapshot().phase, 'armed', 'pre-arm return history cannot create a late endpoint');
  assert.equal(f.ending.snapshot().returnedCount, 0);
  f.returning(); assert.equal(f.ending.snapshot().phase, 'returning'); assert.ok(f.ending.snapshot().originalDamage);
  assert.equal(f.ending.snapshot().brightness, null);
  f.step(3, { worldPhase: 'returning' }); assert.equal(f.ending.snapshot().dimensionSeconds, 0);
  f.arrive(.45, .5);
  const arrived = f.ending.snapshot();
  assert.equal(arrived.phase, 'relighting'); assert.equal(arrived.dimensionSeconds, 0);
  near(arrived.brightness!, .45); assert.equal(arrived.returnedCount, 1); assert.equal(arrived.narrationCount, 0);
  assert.ok(arrived.originalDamage); assert.equal(arrived.environmentOpacity, 1);
});

test('collapse onset during return applies damage immediately without spending arrival time', () => {
  const f = fixture(); f.ending.update(f.sample({ worldPhase: 'returning', collapseStarted: true }));
  assert.equal(f.ending.snapshot().phase, 'returning'); assert.ok(f.ending.snapshot().originalDamage);
  f.arrive(.3, 0); assert.equal(f.ending.snapshot().phase, 'relighting');
  assert.equal(f.ending.snapshot().dimensionSeconds, 0);
});

test('exact one/five/six-second boundaries give relight, holding, one glitch and one final narration edge', () => {
  const f = fixture(); f.ready();
  f.step(.999); assert.equal(f.ending.snapshot().phase, 'relighting');
  f.ending.update(f.sample({ dt: .001 })); assert.equal(f.ending.snapshot().phase, 'holding'); near(f.ending.snapshot().brightness!, 1);
  f.step(3.999); assert.equal(f.ending.snapshot().phase, 'holding'); near(f.ending.snapshot().dimensionSeconds, 4.999);
  f.ending.update(f.sample({ dt: .001 }));
  assert.equal(f.ending.snapshot().phase, 'glitching'); near(f.ending.snapshot().dimensionSeconds, 5);
  near(f.ending.snapshot().glitchProgress, 0); near(f.ending.snapshot().environmentOpacity, 1);
  f.step(.999); assert.equal(f.ending.snapshot().phase, 'glitching'); assert.equal(f.ending.snapshot().narrationCount, 0);
  f.ending.update(f.sample({ dt: .001 }));
  const white = f.ending.snapshot(); assert.equal(white.phase, 'white'); assert.equal(white.dimensionSeconds, 6);
  assert.equal(white.glitchProgress, 1); assert.equal(white.environmentOpacity, 0); assert.equal(white.narrationCount, 1);
  f.step(20, { collapseStarted: true });
  assert.equal(f.ending.snapshot().phase, 'white'); assert.equal(f.ending.snapshot().narrationCount, 1);
  assert.equal(f.ending.snapshot().returnedCount, 1); assert.equal(f.ending.snapshot().dimensionSeconds, 6);
});

test('relight mirrors the earlier irregular flicker and respects captured brightness from dark to fully lit', () => {
  for (const captured of [0, .15, .3, .65, 1]) {
    const f = fixture(); f.ready(captured);
    const levels = [f.ending.snapshot().brightness!];
    for (let i = 0; i < 100; i++) { f.ending.update(f.sample({ dt: .01, brightness: 0 })); levels.push(f.ending.snapshot().brightness!); }
    near(levels[0], captured); near(levels.at(-1)!, 1);
    assert.ok(levels.every(level => level >= captured - 1e-10 && level <= 1));
    if (captured < 1) {
      assert.ok(levels.some((level, index) => index && level < levels[index - 1] - .01));
      assert.ok(levels.some((level, index) => index && level > levels[index - 1] + .01));
    }
    f.step(3); near(f.ending.snapshot().brightness!, 1);
  }
});

test('glitch flickers irregularly with bounded opacity, then hides only at the final white endpoint', () => {
  const f = fixture(); f.ready(); f.step(5);
  const levels = [f.ending.snapshot().environmentOpacity];
  for (let i = 0; i < 99; i++) { f.ending.update(f.sample({ dt: .01 })); levels.push(f.ending.snapshot().environmentOpacity); }
  assert.equal(f.ending.snapshot().phase, 'glitching'); assert.equal(f.ending.snapshot().narrationCount, 0);
  assert.ok(levels.every(level => level >= 0 && level <= 1));
  assert.ok(levels.filter((level, index) => index && level > levels[index - 1] + .01).length > 10);
  assert.ok(levels.filter((level, index) => index && level < levels[index - 1] - .01).length > 10);
  f.ending.update(f.sample({ dt: .01 })); assert.equal(f.ending.snapshot().phase, 'white');
  assert.equal(f.ending.snapshot().environmentOpacity, 0);
});

test('same seed and clock give frame-rate-independent profiles, while a changed seed varies intermediate levels', () => {
  const a = fixture(9), b = fixture(9), other = fixture(10); a.ready(); b.ready(); other.ready();
  let changed = false;
  for (let i = 0; i < 60; i++) {
    a.ending.update(a.sample({ dt: .1 })); other.ending.update(other.sample({ dt: .1 }));
    for (let n = 0; n < 10; n++) b.ending.update(b.sample({ dt: .01 }));
    near(a.ending.snapshot().brightness!, b.ending.snapshot().brightness!);
    near(a.ending.snapshot().environmentOpacity, b.ending.snapshot().environmentOpacity);
    if (Math.abs(a.ending.snapshot().environmentOpacity - other.ending.snapshot().environmentOpacity) > .001 ||
        Math.abs(a.ending.snapshot().brightness! - other.ending.snapshot().brightness!) > .001) changed = true;
  }
  assert.ok(changed); assert.equal(a.ending.snapshot().narrationCount, 1); assert.equal(b.ending.snapshot().narrationCount, 1);
});

test('post-arrival non-original poses pause the same dimension clock and never recapture another endpoint', () => {
  for (const elapsed of [.4, 2, 5.4]) for (const worldPhase of ['turning', 'complete', 'returning'] as const) {
    const f = fixture(); f.ready(); f.step(elapsed); const before = f.ending.snapshot();
    f.step(4, { worldPhase, collapseStarted: true, brightness: .8 });
    const paused = f.ending.snapshot(); assert.equal(paused.paused, true); near(paused.dimensionSeconds, before.dimensionSeconds);
    near(paused.brightness!, before.brightness!); near(paused.environmentOpacity, before.environmentOpacity);
    assert.equal(paused.returnedCount, 1); assert.equal(paused.narrationCount, 0);
    f.ending.update(f.sample()); near(f.ending.snapshot().dimensionSeconds, before.dimensionSeconds + .1);
    near(f.ending.snapshot().capturedBrightness!, .3); assert.equal(f.ending.snapshot().returnedCount, 1);
  }
});

test('valid frames crossing phase boundaries carry elapsed time without skipping or duplicating the final event', () => {
  const f = fixture(); f.ready(); f.step(.8);
  f.ending.update(f.sample({ dt: .5 })); near(f.ending.snapshot().dimensionSeconds, 1.3); assert.equal(f.ending.snapshot().phase, 'holding');
  f.step(3.5); f.ending.update(f.sample({ dt: .4 }));
  near(f.ending.snapshot().dimensionSeconds, 5.2); assert.equal(f.ending.snapshot().phase, 'glitching');
  near(f.ending.snapshot().glitchProgress, .2); assert.equal(f.ending.snapshot().narrationCount, 0);
  f.step(.8); assert.equal(f.ending.snapshot().phase, 'white'); assert.equal(f.ending.snapshot().narrationCount, 1);
});

test('eligibility loss, invalid clocks/brightness and world cancellation consume every active stage until reset', () => {
  for (const stage of ['armed', 'returning', 'relighting', 'holding', 'glitching', 'white']) for (const invalid of [
    { eligible: false }, { dt: NaN }, { dt: Infinity }, { dt: -.01 }, { dt: .501 },
    { brightness: NaN }, { brightness: -1 }, { brightness: 1.01 },
    { worldPhase: 'idle' as const }, { worldPhase: 'cancelled' as const }, { worldPhase: 'invalid' as RealityWorldPhase },
  ]) {
    const f = fixture(); f.arm();
    if (stage !== 'armed') f.returning();
    if (!['armed', 'returning'].includes(stage)) f.arrive();
    if (stage === 'holding') f.step(2);
    else if (stage === 'glitching') f.step(5.4);
    else if (stage === 'white') f.step(6);
    assert.equal(f.ending.snapshot().phase, stage);
    const previousNarration = f.ending.snapshot().narrationCount;
    f.ending.update(f.sample(invalid));
    const stopped = f.ending.snapshot(); assert.equal(stopped.phase, 'cancelled'); assert.equal(stopped.originalDamage, false);
    assert.equal(stopped.brightness, null); assert.equal(stopped.environmentOpacity, 1); assert.equal(stopped.narrationCount, previousNarration);
    f.step(10, { collapseStarted: true }); assert.equal(f.ending.snapshot().phase, 'cancelled');
    f.ending.reset(); assert.equal(f.ending.snapshot().returnedCount, 0); assert.equal(f.ending.snapshot().narrationCount, 0);
    f.ready(); assert.equal(f.ending.snapshot().phase, 'relighting');
  }
});

test('zero-duration observations do not consume clock time or trigger narration and manual cancellation is terminal', () => {
  const f = fixture(); f.ready();
  for (let i = 0; i < 20; i++) f.ending.update(f.sample({ dt: 0, collapseStarted: true }));
  assert.equal(f.ending.snapshot().dimensionSeconds, 0); assert.equal(f.ending.snapshot().narrationCount, 0);
  f.ending.cancel(); f.ready(); assert.equal(f.ending.snapshot().phase, 'cancelled');
  f.ending.reset({ seed: 77 }); assert.equal(f.ending.snapshot().seed, 77); assert.equal(f.ending.snapshot().brightness, null);
});

test('seed validation preserves state on invalid reset and no public snapshot can mutate the cue', () => {
  for (const seed of [NaN, Infinity, -1, .5, 0x100000000]) assert.throws(() => new RealityEnding({ seed }), /uint32/);
  const f = fixture(); f.ready(); const before = f.ending.snapshot();
  assert.throws(() => f.ending.reset({ seed: -1 }), /uint32/); assert.deepEqual(f.ending.snapshot(), before);
  const publicState = f.ending.snapshot(); publicState.originalDamage = false; publicState.dimensionSeconds = 100;
  assert.deepEqual(f.ending.snapshot(), before);
  assert.equal(new RealityEnding().snapshot().seed, REALITY_ENDING.defaultSeed);
});
