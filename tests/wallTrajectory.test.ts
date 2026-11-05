import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Group } from 'three';
import { createHallwaySections } from '../src/experience/hallwaySection.ts';
import { measureWallDistances } from '../src/experience/hallwayCenter.ts';
import { lockWallTrajectory } from '../src/viewer/wallTrajectory.ts';

function sections(curve = 0) {
  const points: number[] = [];
  for (let z = -10; z <= 2.01; z += .05) for (let y = .45; y <= 1.751; y += .1) {
    points.push(-1.05 + .035 * z + curve * z * z, z, y, 1.05 + .015 * z + curve * z * z, z, y);
  }
  const root = new Group(); root.quaternion.setFromEuler(new Euler(Math.PI / 2, Math.PI, 0)); root.updateMatrixWorld(true);
  const source = new Float32Array(points), helper = createHallwaySections({ scanRoot: root, getCenters: () => source });
  return [-8, -6, -4, -2, 0].map(z => {
    const fit = helper.at(z); if (!fit.ok) assert.fail(fit.reason); return fit;
  });
}

test('one fixed straight trajectory and constant full-depth width cover the sampled angled/tapered hallway', () => {
  const fits = sections(), route = lockWallTrajectory(fits, .5);
  assert.ok(Object.isFrozen(route) && Object.isFrozen(route.normal));
  assert.ok(Math.abs(route.slope) > .015, 'Fixture must exercise lateral trajectory movement.');
  const endpoint = fits[fits.length - 1];
  assert.equal(route.xAt(0), endpoint.centerWorld[0]);
  const distances = measureWallDistances(endpoint.wallPlanes, [route.xAt(0), 0, 0]);
  assert.ok(distances.imbalance < 1e-12, 'Final wall must be centred between independently fitted planes.');
  for (const fit of fits) {
    const z = fit.centerWorld[2], x = route.xAt(z);
    for (const wall of Object.values(fit.wallPlanes)) {
      for (const depth of [-.25, .25]) {
        const distances = [-1, 1].map(side => {
          const px = x + side * route.width / 2 * route.across[0] + depth * route.normal[0];
          const pz = z + side * route.width / 2 * route.across[2] + depth * route.normal[2];
          return wall.normal[0] * (px - wall.point[0]) + wall.normal[2] * (pz - wall.point[2]);
        });
        assert.ok(Math.min(...distances) <= 0, 'A frozen face leaves a gap before a sampled wall.');
      }
    }
  }
  for (const z of [-7.876, -6.501, -6.499, -5.001, -4.999, -2.001]) {
    assert.ok(Math.abs((route.xAt(z + .001) - route.xAt(z)) / .001 - route.slope) < 1e-10,
      'Trajectory jumps at a section boundary.');
  }
  const before = [route.xAt(-8), route.xAt(-2), route.width, ...route.normal];
  (fits[0].centerWorld as unknown as number[])[0] += 10;
  (fits[0].wallPlanes.left.point as unknown as number[])[0] += 10;
  assert.deepEqual([route.xAt(-8), route.xAt(-2), route.width, ...route.normal], before,
    'A later source/fit change altered the locked trajectory.');
});

test('a frozen trajectory rejects missing or degenerate support', () => {
  const fits = sections();
  assert.throws(() => lockWallTrajectory([], .5));
  assert.throws(() => lockWallTrajectory([fits[0], fits[0]], .5));
  assert.throws(() => lockWallTrajectory(fits, 0));
});

test('nonlinear hallway samples keep the new final station exactly centred without realignment', () => {
  const fits = sections(.004), route = lockWallTrajectory(fits, .5), end = fits[fits.length - 1];
  const meanX = fits.reduce((sum, fit) => sum + fit.centerWorld[0], 0) / fits.length;
  const meanZ = fits.reduce((sum, fit) => sum + fit.centerWorld[2], 0) / fits.length;
  const slope = fits.reduce((sum, fit) => sum + (fit.centerWorld[0] - meanX) * (fit.centerWorld[2] - meanZ), 0) /
    fits.reduce((sum, fit) => sum + (fit.centerWorld[2] - meanZ) ** 2, 0);
  assert.ok(Math.abs(meanX + slope * (end.centerWorld[2] - meanZ) - end.centerWorld[0]) > .005,
    'Fixture must expose the old unconstrained endpoint offset.');
  assert.equal(route.xAt(end.centerWorld[2]), end.centerWorld[0]);
  assert.ok(measureWallDistances(end.wallPlanes, [route.xAt(0), 0, 0]).imbalance < 1e-12);
  const before = route.xAt(0);
  (end.centerWorld as unknown as number[])[0] += 1;
  assert.equal(route.xAt(0), before, 'A later fit mutation changed the frozen endpoint.');
});
