import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryClearance, createBoundaryApproachWarning } from '../src/boundary/approachWarning.ts';
import type { Point3 } from '../src/boundary/geometry.ts';

const p = (x: number, z = 0, y = 1.6): Point3 => [x, y, z];
const square: Point3[] = [[-2,0,-2],[2,0,-2],[2,0,2],[-2,0,2]];
const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function fixture(hallwayForward: Point3 | null = [1,0,0]) {
  let time = 0, accepted = true, cancellations = 0;
  const calls: number[] = [];
  const warning = createBoundaryApproachWarning({ onWarning() { if (!accepted) return false; calls.push(time); return true; },
    onCancel() { cancellations++; } });
  const step = (head: Point3 | null, dt = .1, live = true, points = square, enabled = true, forward = hallwayForward) => {
    time += dt; warning.update(time, { head, live, points, hallwayForward: forward }, enabled);
  };
  return { warning, calls, step, accepted(value: boolean) { accepted = value; },
    cancellations: () => cancellations, time: () => time };
}

test('clearance follows true polygon segments, concavities and either winding', () => {
  near(boundaryClearance(p(0), square), 2);
  near(boundaryClearance(p(1.5), square), .5);
  near(boundaryClearance(p(2), square), 0);
  near(boundaryClearance(p(2.3, 2.4), square), -.5);
  near(boundaryClearance(p(1.5), [...square].reverse()), .5);
  const concave: Point3[] = [[0,0,0],[4,0,0],[4,0,1],[1,0,1],[1,0,4],[0,0,4]];
  near(boundaryClearance(p(.75,.75), concave), Math.hypot(.25,.25));
  near(boundaryClearance(p(2,2), concave), -1);
  assert.equal(boundaryClearance(p(0), []), null);
  assert.equal(boundaryClearance(p(0), [p(0),p(1),p(2)]), null);
  assert.equal(boundaryClearance(p(NaN), square), null);
});

test('rotated/translated physical bounds preserve clearance independently of head height', () => {
  const yaw = .63, transform = ([x,y,z]: Point3): Point3 => [3+Math.cos(yaw)*x+Math.sin(yaw)*z,y,-4-Math.sin(yaw)*x+Math.cos(yaw)*z];
  near(boundaryClearance(transform(p(1.5)), square.map(transform)), .5);
  near(boundaryClearance(p(1.5,0,-8), square), .5);
});

test('outward travel triggers exactly at half a metre once, even after a long stationary hold', () => {
  const f = fixture();
  f.step(p(1.4)); f.step(p(1.45)); assert.equal(f.calls.length, 0);
  f.step(p(1.5)); assert.equal(f.calls.length, 1);
  near(f.warning.snapshot().distanceMetres, .5);
  for (let i = 0; i < 120; i++) f.step(p(1.5));
  f.step(p(1.6)); f.step(p(1.8)); assert.equal(f.calls.length, 1);
});

test('a stationary start near an edge, gaze-only changes, tangential travel and head bob do not warn', () => {
  const f = fixture();
  f.step(p(1.6));
  for (let i = 0; i < 30; i++) f.step(p(1.6 + (i % 2 ? .004 : -.004), 0, 1+i/10));
  f.step(p(1.6,.1)); f.step(p(1.6,.2));
  f.step(p(1.5,.2)); f.step(p(1.4,.2));
  assert.equal(f.calls.length, 0);
});

test('retreat hysteresis and eight-second cooldown require a fresh outward approach', () => {
  const f = fixture();
  f.step(p(1.4)); f.step(p(1.5));
  f.step(p(1.3)); f.step(p(1.5)); assert.equal(f.calls.length, 1, 'small retreat cannot rearm');
  f.step(p(1.25)); assert.equal(f.warning.snapshot().latched, false);
  f.step(p(1.4)); f.step(p(1.5)); assert.equal(f.calls.length, 1, 'cooldown blocks a quick re-entry');
  while (f.time() < 9) f.step(p(1.5));
  assert.equal(f.calls.length, 1, 'cooldown expiry cannot play a delayed stationary warning');
  f.step(p(1.55)); assert.equal(f.calls.length, 2);
  assert.ok(f.calls[1] - f.calls[0] >= 8);
});

test('a declined audio request does not consume the zone and retry still requires movement', () => {
  const f = fixture(); f.accepted(false);
  f.step(p(1.4)); f.step(p(1.5)); assert.equal(f.warning.snapshot().latched, false);
  f.accepted(true); f.step(p(1.5)); assert.equal(f.calls.length, 0);
  f.step(p(1.55)); assert.equal(f.calls.length, 1);
});

test('shallow diagonal approaches accumulate their outward component without warning on tangent travel', () => {
  const f = fixture(); f.step(p(1.48));
  for (let i = 1; i <= 12; i++) f.step(p(1.48+i*.004,i*.03));
  assert.equal(f.calls.length, 1, 'a small but real outward component must not be discarded on every step');
});

test('stale/missing tracking, unavailable bounds and disabled/desktop observations cannot speak', () => {
  for (const condition of ['stale','missing','disabled','empty'] as const) {
    const f = fixture(); f.step(p(1.4));
    f.step(condition === 'missing' ? null : p(1.5), .1, condition !== 'stale', condition === 'empty' ? [] : square, condition !== 'disabled');
    assert.equal(f.calls.length, 0, condition);
    f.step(p(1.5)); assert.equal(f.calls.length, 0, 'first recovered pose must seed motion');
    f.step(p(1.55)); assert.equal(f.calls.length, 1);
  }
});

test('reference/polygon changes, paused frames and impossible jumps discard old movement', () => {
  const changed = square.map(([x,y,z]): Point3 => [x-.2,y,z]);
  const f = fixture(); f.step(p(1.4)); f.step(p(1.5), .1, true, changed);
  assert.equal(f.calls.length, 0);
  f.step(p(1.6), .6, true, changed); assert.equal(f.calls.length, 0);
  f.step(p(1.7), .001, true, changed); assert.equal(f.calls.length, 0);
  f.step(p(1.75), .1, true, changed); assert.equal(f.calls.length, 1);
});

test('outside travel never warns, including the former unbounded negative-distance case', () => {
  const f = fixture(); f.step(p(2.1)); f.step(p(2.05)); assert.equal(f.calls.length, 0);
  f.step(p(2.15)); f.step(p(2.4)); assert.equal(f.calls.length, 0);
  assert.equal(f.warning.snapshot().inWarningStrip, false);
  f.step(p(8)); f.step(p(8.1)); assert.equal(f.calls.length, 0);
});

test('reset cancels warning/history and duplicate or backwards timestamps cannot invent motion', () => {
  const f = fixture(); f.step(p(1.4)); f.step(p(1.5));
  const cancellations = f.cancellations(); f.warning.reset();
  assert.ok(f.cancellations() > cancellations); assert.equal(f.warning.snapshot().warnings, 0);
  f.step(p(1.4)); f.step(p(1.5), 0); f.step(p(1.5)); assert.equal(f.calls.length, 1);
  f.warning.update(0, { live: true, points: square, head: p(1.6), hallwayForward: [1,0,0] }, true);
  assert.equal(f.warning.snapshot().status, 'paused');
  assert.equal(f.calls.length, 1);
});

test('end-facing finite segments ignore nearby lateral edges and retain full-polygon inside/outside', () => {
  const axis: Point3 = [0,0,1];
  near(boundaryClearance(p(1.9), square, axis), 2);
  near(boundaryClearance(p(1.9,1.5), square, axis), .5);
  near(boundaryClearance(p(1.9,-1.5), [...square].reverse(), axis), .5);
  near(boundaryClearance(p(2.3,2.4), square, axis), -.5);
  assert.ok(boundaryClearance(p(2.1,1.7), square, axis)! < 0, 'outside a side edge must not qualify near an end');
  assert.equal(boundaryClearance(p(0), square, [0,1,0]), null);
  assert.equal(boundaryClearance(p(0), square, [NaN,0,1]), null);
});

test('only the inside half-metre strips at either hallway end can warn', () => {
  for (const sign of [-1,1]) {
    const f = fixture([0,0,1]);
    f.step(p(1.4)); f.step(p(1.5)); f.step(p(1.7)); f.step(p(1.9));
    assert.equal(f.calls.length, 0, 'approaching a side boundary must stay silent');
    f.step(p(0,sign*1.3), .5); f.step(p(0,sign*1.48));
    assert.equal(f.calls.length, 0, '0.52m from the end is outside the strip');
    f.step(p(0,sign*1.5)); assert.equal(f.calls.length, 1);
    near(f.warning.snapshot().distanceMetres,.5);
  }
  const narrow: Point3[] = [[-.55,0,-8],[.55,0,-8],[.55,0,8],[-.55,0,8]];
  const f = fixture([0,0,1]);
  for (const x of [0,.1,.2,.3,.4,.5]) f.step(p(x), .1, true, narrow);
  assert.equal(f.calls.length, 0, 'a narrow headset area must not make the whole hallway a warning zone');
});

test('calibrated hallway direction selects the same ends across yaw, origin and polygon winding', () => {
  for (const yaw of [0,.63,Math.PI/2,Math.PI,-1.1]) for (const reverse of [false,true]) {
    const transform = ([x,y,z]: Point3): Point3 => [3+Math.cos(yaw)*x+Math.sin(yaw)*z,y,-4-Math.sin(yaw)*x+Math.cos(yaw)*z];
    const points = square.map(transform); if (reverse) points.reverse();
    const axis: Point3 = [Math.sin(yaw),0,Math.cos(yaw)], f = fixture(axis);
    f.step(transform(p(1.4)), .1,true,points); f.step(transform(p(1.5)), .1,true,points);
    assert.equal(f.calls.length, 0);
    f.step(transform(p(0,1.4)), .5,true,points); f.step(transform(p(0,1.5)), .1,true,points);
    assert.equal(f.calls.length, 1);
  }
});

test('leaving the half-metre strip cancels playback immediately while preserving retreat hysteresis', () => {
  const f = fixture(); f.step(p(1.4)); f.step(p(1.5));
  const cancellations = f.cancellations(); f.step(p(1.49));
  assert.ok(f.cancellations() > cancellations, 'even a tiny retreat out of the strip cancels speech');
  assert.equal(f.warning.snapshot().latched, true, 'leaving the audio strip must not bypass the 0.75m rearm margin');
  assert.equal(f.warning.snapshot().inWarningStrip, false);
  f.step(p(1.5)); assert.equal(f.calls.length, 1);
  f.step(p(1.7)); f.step(p(1.9)); f.step(p(2));
  assert.equal(f.warning.snapshot().inWarningStrip, true);
  const atEdge = f.cancellations(); f.step(p(2.05));
  assert.ok(f.cancellations() > atEdge); assert.equal(f.warning.snapshot().status, 'outside');
  assert.equal(f.calls.length, 1);
});

test('missing or changed hallway direction discards motion instead of guessing physical tracking axes', () => {
  const f = fixture(null); f.step(p(1.4)); f.step(p(1.5));
  assert.equal(f.calls.length, 0); assert.equal(f.warning.snapshot().status, 'unoriented');
  f.step(p(1.6), .1,true,square,true,[1,0,0]); assert.equal(f.calls.length, 0);
  f.step(p(1.65), .1,true,square,true,[1,0,0]); assert.equal(f.calls.length, 1);
  const cancellations=f.cancellations(); f.step(p(1.7), .1,true,square,true,null);
  assert.ok(f.cancellations()>cancellations);
  const changed=fixture([1,0,0]); changed.step(p(1.4,1.4));
  changed.step(p(1.5,1.5), .1,true,square,true,[0,0,1]); assert.equal(changed.calls.length, 0);
  changed.step(p(1.5,1.55), .1,true,square,true,[0,0,1]); assert.equal(changed.calls.length, 1);
});
