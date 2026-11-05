import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { BroomEncounter, BROOM_ENCOUNTER, broomCutoutPlacement } from '../src/experience/broomEncounter.ts';
import { HoleWorldRotation, type HoleTurnGeometry } from '../src/experience/holeWorldRotation.ts';
import { BROOM } from '../src/viewer/broomConfig.ts';

function fixture(side: 'start' | 'end' = 'end', yaw = .7, floorY = 0) {
  const route = new Matrix4().makeRotationY(yaw).setPosition(3, 0, -2);
  const hole: HoleTurnGeometry = { open: true, floorY, startZ: -2.9, endZ: -.3,
    nearBounds: [-1.1, 1.2], farBounds: [-.9, 1.3], routeToWorld: route.toArray(), floorSide: side };
  const turn = new HoleWorldRotation(); assert.equal(turn.start(hole), true);
  for (let i = 0; i < 8; i++) turn.update(.5, true);
  const final = turn.matrix(), encounter = new BroomEncounter();
  assert.equal(encounter.arm(hole, final), true);
  const head = (x = 0, z = 0, y = 1.65) => new Vector3(x, y, z)
    .applyMatrix4(new Matrix4().fromArray(encounter.snapshot().uprightMatrix!)).toArray();
  return { hole, final, turn, encounter, head };
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function step(encounter: BroomEncounter, seconds: number, position: [number, number, number], upright = true) {
  while (seconds > 1e-10) { const dt = Math.min(.1, seconds); encounter.update(dt, true, position, upright); seconds -= dt; }
}
function reveal(f: ReturnType<typeof fixture>) {
  step(f.encounter, 2, f.head(1));
  assert.equal(f.encounter.snapshot().phase, 'glitchingIn');
  step(f.encounter, .55, f.head(1));
  assert.equal(f.encounter.snapshot().phase, 'visible');
}

test('broom is centred four metric metres inside either upright cutout, bristles on the floor at calibrated yaw/origin', () => {
  for (const side of ['start', 'end'] as const) for (const yaw of [0, .7, Math.PI, -1.4]) for (const floor of [0, .04]) {
    const { hole, final, encounter } = fixture(side, yaw, floor), state = encounter.snapshot();
    const canonical = new Matrix4().fromArray(state.canonicalMatrix!), upright = final.clone().multiply(canonical);
    const base = new Vector3().setFromMatrixPosition(upright), mouth = new Vector3(...state.entranceWorld!);
    near(base.y, floor); near(base.distanceTo(mouth), 4); near(upright.determinant(), 1);
    const routePoint = new Vector3().setFromMatrixPosition(canonical).applyMatrix4(new Matrix4().fromArray(hole.routeToWorld).invert());
    near(routePoint.y, floor - 4); near(routePoint.z, side === 'end' ? hole.endZ : hole.startZ);
    const bounds = side === 'end' ? hole.farBounds! : hole.nearBounds!;
    near(routePoint.x, (bounds[0] + bounds[1]) / 2);
    const source = canonical.clone().multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion(...BROOM.sourceRotation)))
      .multiply(new Matrix4().makeTranslation(-BROOM.sourceBase[0], -BROOM.sourceBase[1], -BROOM.sourceBase[2]));
    const displayed = final.clone().multiply(source);
    near(new Vector3(...BROOM.sourceBase).applyMatrix4(displayed).distanceTo(base), 0);
    near(new Vector3(0, 0, -1).transformDirection(displayed).distanceTo(new Vector3(0, 1, 0)), 0);
    assert.deepEqual(new Vector3().setFromMatrixScale(displayed).toArray().map(x => Math.round(x * 1e8) / 1e8), [1, 1, 1]);
  }
});

test('first completion waits two full seconds before a bounded glitch-in; duplicate/repeated turns cannot restart it', () => {
  const f = fixture(), { encounter, head } = f;
  assert.equal(encounter.arm(f.hole, f.final), false);
  step(encounter, 1.999, head()); assert.equal(encounter.snapshot().visible, false);
  encounter.update(.001, true, head(), true);
  assert.equal(encounter.snapshot().phase, 'glitchingIn'); near(encounter.snapshot().glitch, 1);
  encounter.update(.275, true, head(), true); near(encounter.snapshot().glitch, .5);
  assert.equal(encounter.snapshot().phase, 'glitchingIn', 'proximity during reveal must not consume its exit timer');
  encounter.update(.275, true, head(), true);
  assert.equal(encounter.snapshot().phase, 'visible'); near(encounter.snapshot().glitch, 0);
  assert.equal(encounter.arm(f.hole, f.final), false);
});

test('the invisible two-metre square accepts a distant approach, then latches a two-second exit even after leaving', () => {
  const f = fixture('start', -1.4), { encounter, head } = f; reveal(f);
  for (const p of [head(1.001), head(-1.001), head(0, -1.001), head(0, 1.001), head(0, 0, -.001)]) {
    encounter.update(.1, true, p, true); assert.equal(encounter.snapshot().phase, 'visible');
  }
  encounter.update(.1, true, head(), false); assert.equal(encounter.snapshot().phase, 'visible');
  encounter.update(.1, true, head(1, -1, 100), true);
  assert.equal(encounter.snapshot().phase, 'waitingExit'); near(encounter.snapshot().elapsedSeconds, 0);
  step(encounter, 1.999, head(3)); assert.equal(encounter.snapshot().phase, 'waitingExit');
  encounter.update(.001, true, head(3), true); assert.equal(encounter.snapshot().phase, 'glitchingOut');
  encounter.update(.275, true, head(3), true); near(encounter.snapshot().glitch, .5);
  encounter.update(.275, true, head(3), true); assert.equal(encounter.snapshot().visible, false);
  assert.equal(encounter.snapshot().phase, 'complete');
  assert.equal(encounter.arm(f.hole, f.final), false);
  step(encounter, 5, head()); assert.equal(encounter.snapshot().phase, 'complete');
});

test('return/re-entry preserves a waiting or present encounter without accepting a tilted proximity pose', () => {
  const f = fixture(); step(f.encounter, 1, f.head());
  step(f.encounter, 1, f.head(), false); assert.equal(f.encounter.snapshot().phase, 'glitchingIn');
  step(f.encounter, .55, f.head(), false); assert.equal(f.encounter.snapshot().phase, 'visible');
  step(f.encounter, 4, f.head(), false); assert.equal(f.encounter.snapshot().phase, 'visible');
  f.encounter.update(.1, true, f.head(), true); assert.equal(f.encounter.snapshot().phase, 'waitingExit');
  step(f.encounter, 2, f.head(), false); assert.equal(f.encounter.snapshot().phase, 'glitchingOut');
});

test('loss of current poses, eligibility or a bounded clock cancels all live stages without revival; reset rearms a fresh game', () => {
  for (const stage of ['waitingReveal', 'glitchingIn', 'visible', 'waitingExit', 'glitchingOut']) for (const invalid of [NaN, -.01, .501]) {
    const f = fixture();
    if (stage !== 'waitingReveal') step(f.encounter, 2, f.head(1));
    if (['visible', 'waitingExit', 'glitchingOut'].includes(stage)) step(f.encounter, .55, f.head(1));
    if (['waitingExit', 'glitchingOut'].includes(stage)) f.encounter.update(.1, true, f.head(), true);
    if (stage === 'glitchingOut') step(f.encounter, 2, f.head());
    assert.equal(f.encounter.snapshot().phase, stage);
    f.encounter.update(invalid, true, f.head(), true);
    assert.equal(f.encounter.snapshot().phase, 'cancelled'); assert.equal(f.encounter.snapshot().visible, false);
    step(f.encounter, 4, f.head()); assert.equal(f.encounter.arm(f.hole, f.final), false);
    f.encounter.reset(); assert.equal(f.encounter.arm(f.hole, f.final), true);
  }
  for (const [eligible, position] of [[false, [0, 1, 0]], [true, null], [true, [NaN, 1, 0]]] as const) {
    const f = fixture(); f.encounter.update(.1, eligible, position, true);
    assert.equal(f.encounter.snapshot().phase, 'cancelled');
  }
});

test('captured poses are immutable and invalid or incomplete rotations fail hidden', () => {
  const f = fixture(), before = f.encounter.snapshot();
  (f.hole.routeToWorld as number[])[12] = 100; (f.hole.farBounds as number[])[0] = -100; f.final.identity();
  const publicPose = f.encounter.snapshot(); publicPose.canonicalMatrix![12] = 200; publicPose.entranceWorld![0] = 300;
  assert.deepEqual(f.encounter.snapshot(), before);
  const valid = fixture();
  assert.throws(() => broomCutoutPlacement(valid.hole, new Matrix4()), /completed upright/);
  const failed = new BroomEncounter(); assert.equal(failed.arm({ ...valid.hole, open: false }, valid.final), false);
  assert.equal(failed.snapshot().visible, false); assert.equal(failed.snapshot().phase, 'cancelled');
  assert.deepEqual(before.triggerSize, [2, .43, 2]); assert.equal(BROOM_ENCOUNTER.depth, 4);
});
