import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from 'three';
import { HallwayCollapse, HALLWAY_COLLAPSE, type HallwayCollapseSample } from '../src/experience/hallwayCollapse.ts';
import { HoleWorldRotation, type HoleTurnGeometry } from '../src/experience/holeWorldRotation.ts';
import type { CutOpening } from '../src/viewer/hallwayCutPlacement.ts';
import type { Point3 } from '../src/boundary/geometry.ts';

const near = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const vectorNear = (a: Point3, b: Point3) => a.forEach((value, index) => near(value, b[index]));
const matrixNear = (a: readonly number[], b: readonly number[]) => a.forEach((value, index) => near(value, b[index]));

function fixture(side: 'start' | 'end' = 'end', yaw = .7, floorY = 0, farDepth = 12, blastSeconds?: number, seed = 0x12345678) {
  const route = new Matrix4().makeRotationY(yaw).setPosition(3, 0, -2);
  const hole: HoleTurnGeometry = { open: true, floorY, startZ: -2.9, endZ: -.3,
    nearBounds: [-1.1, 1.2], farBounds: [-.9, 1.3], routeToWorld: route.toArray(), floorSide: side };
  const source: CutOpening = { origin: [1, 2, 3], across: [1, 0, 0], up: [0, 0, 1], along: [0, 1, 0], width: 2.2, height: 2.6 };
  const turn = new HoleWorldRotation(); assert.ok(turn.start(hole));
  for (let index = 0; index < 8; index++) turn.update(.5, true);
  const final = turn.matrix();
  // Independent bilinear geometry, rather than the implementation's matrices.
  const point = (x = 0, height = 1.65, depth = 2, presentation = final): Point3 => {
    const s = side === 'end' ? 1 - height / source.height : height / source.height;
    const sign = side === 'end' ? 1 : -1, t = .5 + sign * x / source.width;
    const left = hole.nearBounds![0] + s * (hole.farBounds![0] - hole.nearBounds![0]);
    const right = hole.nearBounds![1] + s * (hole.farBounds![1] - hole.nearBounds![1]);
    return new Vector3(left + (right - left) * t, floorY - depth, hole.startZ + s * (hole.endZ - hole.startZ))
      .applyMatrix4(route).applyMatrix4(presentation).toArray();
  };
  const collapse = new HallwayCollapse();
  assert.ok(collapse.arm(hole, final, source, farDepth, point(), { blastSeconds, seed }));
  const sample = (overrides: Partial<HallwayCollapseSample> = {}): HallwayCollapseSample => ({
    dt: .1, eligible: true, upright: true, positionWorld: point(), presentation: final, ...overrides,
  });
  const step = (seconds: number, overrides: Partial<HallwayCollapseSample> = {}) => {
    while (seconds > 1e-9) { const dt = Math.min(.1, seconds); collapse.update(sample({ ...overrides, dt })); seconds -= dt; }
  };
  return { collapse, hole, source, route, final, point, sample, step };
}

test('ten seeded spots give five on each side, irregular timing and strictly far-to-near depths', () => {
  const f = fixture(), state = f.collapse.snapshot();
  assert.equal(state.phase, 'fracturing'); assert.equal(state.protectedDepth, 6);
  assert.equal(state.seed, 0x12345678); assert.equal(state.blasts.length, 10);
  assert.equal(state.blasts.filter(blast => blast.side === -1).length, 5);
  assert.equal(state.blasts.filter(blast => blast.side === 1).length, 5);
  near(state.blasts[0].depth, 11); near(state.blasts.at(-1)!.depth, 8);
  const gaps: number[] = [];
  state.blasts.forEach((blast, index) => {
    near(blast.duration, 1.8);
    assert.ok(Math.abs(blast.across) < f.source.width / 2 && Math.abs(blast.across) > f.source.width / 2 - .13);
    assert.ok(blast.height >= .25 && blast.height <= f.source.height - .25);
    assert.ok(blast.radiusAcross >= 1.1 && blast.radiusAcross <= 1.6);
    assert.ok(blast.radiusUp >= .8 && blast.radiusUp <= 1.4); assert.ok(blast.radiusDepth > 0);
    if (!index) return;
    assert.equal(blast.side, -state.blasts[index - 1].side);
    assert.ok(blast.depth < state.blasts[index - 1].depth);
    const gap = blast.start - state.blasts[index - 1].start;
    assert.ok(gap >= .6 && gap <= 1.1); gaps.push(gap);
  });
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > .1);
  assert.equal(new Set(state.blasts.map(blast => blast.height)).size, 10);
  assert.equal(f.collapse.arm(f.hole, f.final, f.source, 12, f.point()), false);
});

test('same seed reproduces the entire captured plan; a new game seed varies positions, timing and patch noise', () => {
  const a = fixture(), b = fixture(), different = fixture('end', .7, 0, 12, undefined, 41);
  assert.deepEqual(a.collapse.snapshot(), b.collapse.snapshot());
  assert.notDeepEqual(a.collapse.snapshot().blasts, different.collapse.snapshot().blasts);
  assert.notDeepEqual(a.collapse.snapshot().patches.map(patch => patch.seed), different.collapse.snapshot().patches.map(patch => patch.seed));
  a.step(2.3); b.step(2.3); assert.deepEqual(a.collapse.snapshot(), b.collapse.snapshot());
});

test('each blast starts only its own zero-strength local cavity, then matures over three seconds', () => {
  const f = fixture(), initial = f.collapse.snapshot();
  assert.equal(initial.maskActive, false); assert.equal(initial.patches[0].active, true);
  near(initial.patches[0].fadeProgress, 0);
  assert.ok(initial.patches.slice(1).every(patch => !patch.active && patch.age < 0 && patch.fadeProgress === 0));
  assert.equal(f.collapse.removalAtOpening(initial.patches[0].centerOpening), 0);
  f.step(.4); const first = f.collapse.snapshot().patches[0];
  assert.ok(first.fadeProgress > 0 && first.fadeProgress < 1);
  assert.ok(f.collapse.removalAtOpening(first.centerOpening) > 0);
  const opposite: Point3 = [-first.centerOpening[0], first.centerOpening[1], first.centerOpening[2]];
  assert.equal(f.collapse.removalAtOpening(opposite), 0, 'equal depth on the opposite wall survives the first local cavity');
  assert.equal(f.collapse.removalAtOpening([first.centerOpening[0], first.centerOpening[1] + 2, first.centerOpening[2]]), 0);
  const secondStart = f.collapse.snapshot().blasts[1].start;
  f.step(secondStart - .4); const second = f.collapse.snapshot().patches[1];
  near(second.age, 0); near(second.fadeProgress, 0); assert.equal(second.active, true);
  f.step(3); near(f.collapse.snapshot().patches[1].fadeProgress, 1);
  assert.deepEqual(f.collapse.snapshot().mask.patches, f.collapse.snapshot().patches);
});

test('damage is a growing three-dimensional patch union, never an entire clipping-depth plane', () => {
  const f = fixture(); let previous = f.collapse.snapshot();
  const points: Point3[] = previous.patches.flatMap(patch => [patch.centerOpening,
    [0, 0, patch.centerOpening[2]] as Point3, [0, 2.6, patch.centerOpening[2]] as Point3]);
  let weights = points.map(point => f.collapse.removalAtOpening(point));
  while (f.collapse.snapshot().phase !== 'complete') {
    f.collapse.update(f.sample()); const state = f.collapse.snapshot();
    assert.ok(state.progress + 1e-10 >= previous.progress);
    state.patches.forEach((patch, index) => assert.ok(patch.fadeProgress + 1e-10 >= previous.patches[index].fadeProgress));
    const next = points.map(point => f.collapse.removalAtOpening(point));
    next.forEach((weight, index) => assert.ok(weight + 1e-10 >= weights[index]));
    for (const patch of state.patches) assert.equal(f.collapse.removalAtOpening([patch.centerOpening[0], patch.centerOpening[1], 6]), 0);
    previous = state; weights = next;
  }
  near(previous.elapsedSeconds, previous.durationSeconds); near(previous.progress, 1);
  assert.ok(previous.patchMatureSeconds >= 8.4 && previous.patchMatureSeconds <= 12.9);
  near(previous.durationSeconds,previous.patchMatureSeconds+HALLWAY_COLLAPSE.residualSeconds);
  assert.ok(previous.patches.every(patch => patch.fadeProgress === 1 && patch.active));
  const middleDepth = previous.patches[0].centerOpening[2];
  assert.ok(f.collapse.removalAtOpening(previous.patches[0].centerOpening) > .9);
  assert.equal(f.collapse.removalAtOpening([4, 1.3, middleDepth]), 0);
  assert.equal(previous.residualProgress,1);
  assert.equal(f.collapse.removalAtOpening([0,1.3,11.5]),1,'distant residual islands eventually disappear');
  const ended = f.collapse.snapshot(); f.step(10);
  near(f.collapse.snapshot().elapsedSeconds, ended.elapsedSeconds);
  assert.deepEqual(f.collapse.snapshot().patches, ended.patches);
});

test('approaching local damage restores and permanently protects the surroundings and entire route back', () => {
  const f = fixture(); f.step(20);
  const first = f.collapse.snapshot().patches[0]; assert.ok(f.collapse.removalAtOpening(first.centerOpening) > .9);
  f.collapse.update(f.sample({ positionWorld: f.point(.3, 1.7, 8) }));
  near(f.collapse.snapshot().protectedDepth, 10);
  for (const patch of f.collapse.snapshot().patches) for (const depth of [0, 2, 6, 8, 9.9, 10])
    assert.equal(f.collapse.removalAtOpening([patch.centerOpening[0], patch.centerOpening[1], depth]), 0);
  f.step(2); near(f.collapse.snapshot().protectedDepth, 10);
  f.collapse.update(f.sample({ positionWorld: f.point(0, 1.7, 11) }));
  near(f.collapse.snapshot().protectedDepth, 13); assert.equal(f.collapse.snapshot().maskActive, false);
  assert.ok(f.collapse.snapshot().patches.every(patch => !patch.active));
});

test('optional physical bounds only enlarge protection; unavailable or invalid bounds never gate organic damage', () => {
  const f = fixture('start', -.63);
  const boundary: Point3[] = [f.point(-.7, 0, 0), f.point(.7, 0, 0), f.point(.7, 0, 7), f.point(-.7, 0, 7)];
  f.collapse.update(f.sample({ boundaryPoints: boundary })); near(f.collapse.snapshot().protectedDepth, 8);
  for (const boundaryPoints of [null, undefined, [], [[NaN, 0, 0]] as Point3[], [[0, 0, 0], [1, 0, 1]] as Point3[]]) {
    f.collapse.update(f.sample({ boundaryPoints })); assert.equal(f.collapse.snapshot().phase, 'disintegrating');
    near(f.collapse.snapshot().protectedDepth, 8);
  }
});

test('calibrated yaw, either floor-side hinge and taper preserve source depth and exact FX spot positions', () => {
  for (const side of ['start', 'end'] as const) for (const yaw of [0, Math.PI / 2, Math.PI, -.63]) for (const floor of [0, .04]) {
    const f = fixture(side, yaw, floor, 33), state = f.collapse.snapshot();
    matrixNear(new Matrix4().fromArray(state.openingToCanonical!).multiply(new Matrix4().fromArray(state.canonicalToOpening!)).toArray(), new Matrix4().toArray());
    for (const depth of [0, 2, 6, 17, 32.6]) for (const height of [0, 1.3, 2.6]) for (const x of [-1.1, .2, 1.1]) {
      const world = f.point(x, height, depth);
      vectorNear(f.collapse.worldPoint([x, height, depth], f.final)!, world);
      vectorNear(f.collapse.canonicalPoint(x, height, depth)!, f.point(x, height, depth, new Matrix4()));
      near(new Vector3(...world).applyMatrix4(new Matrix4().fromArray(state.worldToOpening!)).z, depth);
      near(world[1], floor + height);
    }
    for (const blast of state.blasts) {
      vectorNear(f.collapse.worldPoint(blast.openingPosition, f.final)!, f.point(blast.across, blast.height, blast.depth));
      assert.ok(blast.depth - blast.radius > state.protectedDepth);
      assert.ok(blast.depth < state.farDepth);
    }
    f.collapse.update(f.sample({ positionWorld: f.point(0, 1.65, 7) })); near(f.collapse.snapshot().protectedDepth, 9);
  }
});

test('return/reentry pauses patch and blast clocks but retains loss and current-presentation protection', () => {
  const f = fixture(); f.step(2);
  const before = f.collapse.snapshot(); assert.ok(before.maskActive);
  const original = new Matrix4();
  f.step(4, { upright: false, presentation: original, positionWorld: f.point(0, 1.65, 2, original) });
  const paused = f.collapse.snapshot(); assert.equal(paused.paused, true);
  near(paused.elapsedSeconds, before.elapsedSeconds); near(paused.progress, before.progress); assert.ok(paused.maskActive);
  assert.deepEqual(paused.patches, before.patches);
  matrixNear(paused.worldToOpening!, new Matrix4().fromArray(before.canonicalToOpening!).toArray());
  f.collapse.update(f.sample({ dt: 0, upright: false, presentation: original, positionWorld: f.point(0, 1.65, 9, original) }));
  near(f.collapse.snapshot().protectedDepth, 11);
  f.collapse.update(f.sample()); assert.equal(f.collapse.snapshot().paused, false);
  near(f.collapse.snapshot().elapsedSeconds, before.elapsedSeconds + .1);
  assert.equal(f.collapse.arm(f.hole, f.final, f.source, 12, f.point()), false);
});

test('spots and depth radii adapt to crop length; insufficient distant space suppresses the entire cue', () => {
  const short = fixture(), long = fixture('end', .7, 0, 32.6);
  assert.ok(long.collapse.snapshot().patches[0].radiusDepth > short.collapse.snapshot().patches[0].radiusDepth * 4);
  for (const far of [10, 12, 32.6]) {
    const state = fixture('end', .7, 0, far).collapse.snapshot();
    assert.equal(state.phase, 'fracturing'); assert.equal(state.blasts.length, 10);
    for (const blast of state.blasts) assert.ok(blast.depth >= 8 && blast.depth <= far - 1 + 1e-9);
  }
  for (const far of [6.5, 8, 9]) {
    const f = fixture('end', 0, 0, far); f.step(10);
    assert.equal(f.collapse.snapshot().phase, 'suppressed'); assert.equal(f.collapse.snapshot().active, false);
    assert.equal(f.collapse.snapshot().explosionsFinished, true, 'A fully protected crop cannot leave the finale waiting for nonexistent blasts.');
    assert.deepEqual(f.collapse.snapshot().patches, []);
  }
});

test('long source clips retain their full durations while damage remains local and independently timed', () => {
  const f = fixture('end', .7, 0, 12, 5); f.step(3.2);
  assert.ok(f.collapse.snapshot().maskActive); assert.ok(f.collapse.snapshot().blasts[0].active);
  near(f.collapse.snapshot().patches[0].fadeProgress, 1);
  near(f.collapse.snapshot().durationSeconds, f.collapse.snapshot().blasts.at(-1)!.start + 5 + HALLWAY_COLLAPSE.residualSeconds);
});

test('blast completion preserves the world and organic islands fade gradually afterward, pausing for return',()=>{
  const f=fixture(),plan=f.collapse.snapshot(),pose=f.final.toArray();
  const lastBlast=plan.blasts.at(-1)!;
  f.step(lastBlast.start+lastBlast.duration);
  assert.equal(f.collapse.snapshot().blasts.some(b=>b.active),false);
  assert.equal(f.collapse.snapshot().explosionsFinished,true);
  near(f.collapse.snapshot().blastEndSeconds,lastBlast.start+lastBlast.duration);
  assert.equal(f.collapse.snapshot().active,true);assert.equal(f.collapse.snapshot().phase,'disintegrating');
  matrixNear(f.collapse.snapshot().worldToOpening!,new Matrix4().fromArray(plan.canonicalToOpening!).multiply(f.final.clone().invert()).toArray());
  matrixNear(f.final.toArray(),pose);
  f.step(plan.patchMatureSeconds-f.collapse.snapshot().elapsedSeconds);
  assert.equal(f.collapse.snapshot().residualProgress,0);
  const point:Point3=[0,2.6,11.5],initial=f.collapse.removalAtOpening(point);
  f.step(4);near(f.collapse.snapshot().residualProgress,.5);
  assert.ok(f.collapse.removalAtOpening(point)>initial);
  const paused=f.collapse.snapshot();f.step(2,{upright:false});
  near(f.collapse.snapshot().elapsedSeconds,paused.elapsedSeconds);
  near(f.collapse.snapshot().residualProgress,.5);
  f.step(4);assert.equal(f.collapse.snapshot().phase,'complete');
  assert.equal(f.collapse.removalAtOpening(point),1);
  for(const depth of [0,2,4,6])assert.equal(f.collapse.removalAtOpening([0,1.3,depth]),0);
});

test('invalid/stale frames and eligibility loss cancel every live stage without burst or damage replay', () => {
  for (const elapsed of [0, 3, 20]) for (const invalid of [
    { dt: NaN }, { dt: Infinity }, { dt: -.01 }, { dt: .501 }, { eligible: false },
    { positionWorld: null }, { positionWorld: [0, NaN, 0] as Point3 }, { presentation: new Matrix4().makeScale(2, 2, 2) },
  ]) {
    const f = fixture(); f.step(elapsed);
    const before = f.collapse.snapshot(); f.collapse.update(f.sample({ dt: 0 })); near(f.collapse.snapshot().elapsedSeconds, before.elapsedSeconds);
    f.collapse.update(f.sample(invalid));
    assert.equal(f.collapse.snapshot().phase, 'cancelled'); assert.equal(f.collapse.snapshot().maskActive, false);
    assert.ok(f.collapse.snapshot().blasts.every(blast => !blast.active));
    assert.ok(f.collapse.snapshot().patches.every(patch => !patch.active));
    f.step(3); assert.equal(f.collapse.snapshot().phase, 'cancelled');
    assert.equal(f.collapse.arm(f.hole, f.final, f.source, 12, f.point()), false);
    f.collapse.reset(); assert.equal(f.collapse.snapshot().openingToCanonical, null);
    assert.ok(f.collapse.arm(f.hole, f.final, f.source, 12, f.point(), { seed: 9 }));
  }
});

test('captured geometry/plans and snapshots are detached; malformed initial seeds/poses fail hidden', () => {
  const f = fixture(), before = f.collapse.snapshot(), pointBefore = f.collapse.worldPoint([.4, 1.2, 8], f.final);
  (f.source.origin as [number, number, number])[0] = 100; (f.hole.nearBounds as number[])[0] = -100;
  (f.hole.routeToWorld as number[])[12] = 100;
  const publicState = f.collapse.snapshot(); publicState.patches[0].centerOpening = [100, 100, 100];
  publicState.blasts[0].depth = 100; publicState.rawToOpening![0] = 200;
  assert.deepEqual(f.collapse.snapshot(), before); assert.deepEqual(f.collapse.worldPoint([.4, 1.2, 8], f.final), pointBefore);
  const valid = fixture();
  for (const seed of [NaN, Infinity, -1, .5, 0x100000000]) {
    const collapse = new HallwayCollapse(); assert.equal(collapse.arm(valid.hole, valid.final, valid.source, 12, valid.point(), { seed }), false);
    assert.equal(collapse.snapshot().active, false);
  }
  for (const invalid of [new Matrix4(), new Matrix4().makeScale(-1, 1, 1), new Matrix4().makeRotationX(.2)]) {
    const collapse = new HallwayCollapse(); assert.equal(collapse.arm(valid.hole, invalid, valid.source, 12, valid.point()), false);
    assert.equal(collapse.snapshot().phase, 'cancelled');
  }
  const malformed = new HallwayCollapse();
  assert.equal(malformed.arm(valid.hole, valid.final, { ...valid.source, across: [2, 0, 0] }, 12, valid.point()), false);
  assert.equal(malformed.worldPoint([0, 1, 8], valid.final), null);
  near(HALLWAY_COLLAPSE.patchSeconds, 3);
});
