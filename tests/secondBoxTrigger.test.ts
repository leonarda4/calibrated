import test from 'node:test';
import assert from 'node:assert/strict';
import { headsetInSecondBoxSection } from '../src/experience/secondBoxTrigger.ts';
import type { HallwayWallPlanes } from '../src/experience/hallwayCenter.ts';

const walls: HallwayWallPlanes = {
  left: { point: [-1, 0, 4], normal: [1, 0, 0], residual: 0 },
  right: { point: [1.2, 0, 4], normal: [-1, 0, 0], residual: 0 },
};
const section = { walls, stationZ: 4, floorY: 0 };

test('second-box section includes the whole hallway width/height and two metres of length', () => {
  for (const x of [-1, 0, 1.2]) for (const y of [0, 1.7, 2.6]) for (const z of [3, 4, 5]) {
    assert.ok(headsetInSecondBoxSection([x, y, z], section));
  }
  for (const p of [[-1.001, 1.7, 4], [1.201, 1.7, 4], [0, -.001, 4], [0, 2.601, 4],
    [0, 1.7, 2.999], [0, 1.7, 5.001], [NaN, 1.7, 4], [0, Infinity, 4]] as const) {
    assert.equal(headsetInSecondBoxSection(p, section), false);
  }
});

test('trigger follows tapered fitted walls and refuses missing/invalid geometry', () => {
  const normal = [-Math.cos(.1), 0, Math.sin(.1)] as const;
  const tapered = { ...section, walls: { ...walls, right: { ...walls.right, normal } } };
  assert.equal(headsetInSecondBoxSection([1.25, 1.7, 3], tapered), false);
  assert.equal(headsetInSecondBoxSection([1.25, 1.7, 5], tapered), true);
  assert.equal(headsetInSecondBoxSection([0, 1.7, 4], { ...section, floorY: NaN }), false);
  assert.equal(headsetInSecondBoxSection([0, 1.7, 4], { ...section,
    walls: { ...walls, right: { ...walls.right, normal: [0, 0, 0] } } }), false);
});
