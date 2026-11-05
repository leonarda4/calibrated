import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { WallPassage, type WallPassageGeometry } from '../src/viewer/wallPassage.ts';

type Point3 = readonly [number, number, number];

function fixture(yaw = 0) {
  const normal = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const base = new Vector3(3, .2, -5);
  const wall: WallPassageGeometry = { position: base.toArray(), normal: normal.toArray(), right: right.toArray(),
    width: 2.2, height: 2.6, halfDepth: .25 };
  const passage = new WallPassage();
  const point = (distance: number, x = 0, height = 1.6): Point3 => base.clone()
    .addScaledVector(normal, distance).addScaledVector(right, x).add(new Vector3(0, height, 0)).toArray();
  const feed = (distance: number, x = 0, height = 1.6, dt = .1) => passage.update(point(distance, x, height), dt, wall);
  return { passage, wall, normal, right, base, point, feed };
}

test('physical passage crosses the complete slab before emitting once, in either oblique direction', () => {
  for (const yaw of [0, .47, Math.PI, -.82]) for (const travel of [-1, 1] as const) {
    const { feed, point, normal } = fixture(yaw);
    for (const distance of [-.4, -.2, -.01, .04, .249, .299]) {
      assert.equal(feed(travel * distance), null, `premature pass at signed distance ${distance}`);
    }
    const result = feed(travel * .31);
    assert.deepEqual(result, { playerRoute: point(travel * .31), direction: Math.sign(travel * normal.z) });
    assert.equal(feed(travel * .4), null, 'remaining on the far side must not emit again');
    assert.equal(feed(travel * .45), null);
  }
});

test('strict width and height reject slab-edge misses and below-floor or over-wall travel', () => {
  for (const yaw of [0, .61]) for (const [x, y] of [[1.101, 1.6], [-1.101, 1.6], [0, -.001], [0, 2.601]]) {
    const { feed } = fixture(yaw);
    for (const distance of [-.4, -.2, .05, .31]) assert.equal(feed(distance, x, y), null);
  }
  for (const [x, y] of [[1.1, 1.6], [-1.1, 1.6], [0, 0], [0, 2.6]]) {
    const { feed } = fixture();
    for (const distance of [-.4, -.2, .05, .31]) assert.equal(feed(distance, x, y), null, 'exact aperture edge is excluded');
  }
  const inside = fixture(.61);
  inside.feed(-.4, 1.09, 2.59); inside.feed(-.2, 1.09, 2.59); inside.feed(.05, 1.09, 2.59);
  assert.ok(inside.feed(.31, 1.09, 2.59));
});

test('the swept plane intersection and continued occupancy must both remain inside the wall face', () => {
  const miss = fixture();
  miss.feed(-.4, 1.6); assert.equal(miss.feed(.1, 1), null, 'plane hit is outside despite the endpoint being inside');
  assert.equal(miss.feed(.31, 1), null, 'entering laterally after a miss cannot complete that pass');
  const leave = fixture();
  leave.feed(-.4); leave.feed(-.1); leave.feed(.03);
  assert.equal(leave.feed(.1, 1.2), null, 'leaving the slab bounds cancels the pending pass');
  assert.equal(leave.feed(.31, 1), null);
});

test('starting within the slab and centre-plane jitter cannot arm a passage', () => {
  const { feed } = fixture(.47);
  for (const distance of [0, -.03, .02, -.1, .1, -.04, .04, .28, -.02]) assert.equal(feed(distance), null);
  assert.equal(feed(.31), null, 'there was no previously observed complete entry side');
  assert.equal(feed(.08), null); assert.equal(feed(-.03), null);
  assert.equal(feed(.06), null, 'backing out after a partial crossing cancels it');
  assert.equal(feed(.31), null);
});

test('wall motion cannot fabricate passage through a stationary player', () => {
  const { passage, wall, point } = fixture(.47), player = point(0);
  for (const offset of [-.5, -.3, -.1, 0, .1, .3, .5]) {
    const translated = { ...wall, position: new Vector3(...wall.position)
      .addScaledVector(new Vector3(...wall.normal), offset).toArray() };
    assert.equal(passage.update(player, .1, translated), null);
  }
});

test('large tracking jumps and implausibly quick samples discard passage history', () => {
  for (const [to, dt] of [[.4, .25], [-.2, .01]]) {
    const { passage, wall, point, feed } = fixture();
    feed(-.4);
    assert.equal(passage.update(point(to), dt, wall), null);
    assert.equal(feed(.2), null); assert.equal(feed(.31), null, 'a rejected sample cannot retain the entry side');
    feed(.4); feed(.15); feed(-.05);
    assert.ok(feed(-.31), 'a later genuine crossing can be freshly armed');
  }
  const valid = fixture();
  valid.feed(-.31);
  assert.ok(valid.feed(.31, 0, 1.6, .2), 'a plausible bounded single-frame sweep may cross both faces');
});

test('missing/invalid poses and stalled clocks clear a partly completed passage', () => {
  for (const bad of [null, [NaN, 1, 0], [0, Infinity, 0]] as const) {
    const { passage, wall, feed } = fixture();
    feed(-.4); feed(-.1); feed(.03);
    assert.equal(passage.update(bad, .1, wall), null);
    assert.equal(feed(.31), null);
  }
  for (const dt of [0, -.1, NaN, Infinity, .501]) {
    const { passage, wall, point, feed } = fixture();
    feed(-.4); feed(-.1); feed(.03);
    assert.equal(passage.update(point(.08), dt, wall), null);
    assert.equal(feed(.31), null);
  }
});

test('changed or invalid geometry and explicit reset cannot retain a pending pass', () => {
  for (const changed of ['position', 'normal', 'right', 'width', 'height', 'halfDepth'] as const) {
    const { passage, wall, point, feed } = fixture();
    feed(-.4); feed(-.1); feed(.03);
    const revised = { ...wall };
    if (changed === 'position') revised.position = [3.01, .2, -5];
    else if (changed === 'normal') revised.normal = [.01, 0, Math.sqrt(1 - .0001)];
    else if (changed === 'right') revised.right = [Math.sqrt(1 - .0001), 0, -.01];
    else revised[changed] += .01;
    assert.equal(passage.update(point(.08), .1, revised), null);
    assert.equal(passage.update(point(.31), .1, revised), null, `changed ${changed} retained a stale crossing`);
  }
  for (const bad of [{ width: 0 }, { height: -1 }, { halfDepth: -.1 }, { width: NaN }, { position: [NaN, 0, 0] as Point3 }]) {
    const { passage, wall, point, feed } = fixture();
    feed(-.4); feed(-.1); feed(.03);
    assert.equal(passage.update(point(.08), .1, { ...wall, ...bad }), null);
    assert.equal(feed(.31), null);
  }
  const reset = fixture();
  reset.feed(-.4); reset.feed(-.1); reset.feed(.03); reset.passage.reset();
  assert.equal(reset.feed(.31), null);
  reset.feed(.4); reset.feed(.1); reset.feed(-.04); assert.ok(reset.feed(-.31));
});
