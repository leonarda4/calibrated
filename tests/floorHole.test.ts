import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Quaternion, ShaderMaterial, Vector3 } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { createFloorHole, FLOOR_HOLE } from '../src/viewer/floorHole.ts';
import { WALL_SECTION } from '../src/viewer/wallSectionConfig.ts';

function fixture() {
  const scan = new Group();
  // Raw +Y is longitudinal, matching the active export; keep the fixture public.
  scan.rotation.x = Math.PI / 2;
  scan.rotation.y = Math.PI;
  scan.updateMatrixWorld(true);
  const points: number[] = [];
  for (const x of [-.9, 1.2]) {
    for (let z = 2; z <= 6.5; z += .05) {
      for (let y = .45; y <= 1.8; y += .1) {
        points.push(...scan.worldToLocal(new Vector3(x, y, z)).toArray());
      }
    }
  }
  const centers = new Float32Array(points);
  const material = new ShaderMaterial({ vertexShader: 'void main () { gl_Position = quadPos; }',
    fragmentShader: 'void main () {}' });
  Object.assign(scan, { viewer: { splatMesh: { material } } });
  let blocked: string | null = null;
  let data: Float32Array | undefined = centers;
  let rotation = { phase: 'box', offsetWorld: [0, 0, 0] as readonly [number, number, number] };
  const hole = createFloorHole({ scanRoot: scan as unknown as DropInViewer,
    getSourceCenters: () => data, blockReason: () => blocked, getRotationState: () => rotation });
  return { hole, scan, material, centers, block: (reason: string | null) => { blocked = reason; },
    removeData: () => { data = undefined; },
    rotate: (phase: string, offset: number, z = 0) => { rotation = { phase, offsetWorld: [offset, 0, z] }; } };
}

test('floor opening spans the current walls and follows offset/rotation at its fixed world-Z interval', () => {
  const { hole, material, scan, centers } = fixture();
  const source = centers.slice();
  assert.equal(hole.show(), false);
  hole.initialize(); assert.equal(hole.snapshot().open, false);
  assert.equal(hole.show(), true, hole.snapshot().status);
  assert.ok(Math.abs(hole.snapshot().width - WALL_SECTION.width) < 1e-6);
  assert.equal(hole.snapshot().length, WALL_SECTION.height);
  assert.ok(Math.abs(hole.snapshot().centerX! - .15) < 1e-6);
  const bounds = material.uniforms.uFloorHoleBounds.value.toArray();
  assert.ok(Math.abs(bounds[0] + .9) < 1e-6);
  assert.ok(Math.abs(bounds[1] - 1.2) < 1e-6);
  assert.deepEqual(bounds.slice(2), [3, 5.6]);
  scan.position.x += .3; hole.update();
  const translated = material.uniforms.uFloorHoleBounds.value.toArray();
  assert.ok(Math.abs(translated[0] - bounds[0] - .3) < 1e-6);
  assert.ok(Math.abs(translated[1] - bounds[1] - .3) < 1e-6);
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  const pivot = new Vector3(0, 0, 4.3);
  scan.position.sub(pivot).applyQuaternion(turn).add(pivot); scan.position.x += .1;
  scan.quaternion.premultiply(turn); scan.updateMatrixWorld(true); hole.update();
  assert.equal(hole.snapshot().open, true, hole.snapshot().status);
  const rotated = material.uniforms.uFloorHoleBounds.value.toArray();
  assert.ok(Math.abs(rotated[0] + 1.4) < 1e-6);
  assert.ok(Math.abs(rotated[1] - .7) < 1e-6);
  assert.deepEqual(rotated.slice(2), [3, 5.6]);
  assert.ok(Math.abs(hole.snapshot().centerX! + .35) < 1e-6);
  assert.deepEqual(centers, source, 'A visual cutout must preserve the original calibration data.');
  hole.close();
  assert.equal(material.uniforms.uFloorHoleOpen.value, 0);
  assert.equal(hole.snapshot().centerX, null);
});

test('floor opening follows the eased sideways correction without fitting a transverse mid-turn scan', () => {
  const { hole, material, scan, rotate } = fixture();
  hole.initialize(); assert.equal(hole.show(), true);
  const original = material.uniforms.uFloorHoleBounds.value.toArray();
  rotate('rotating', .05); scan.rotation.y += Math.PI / 2; hole.update();
  const during = material.uniforms.uFloorHoleBounds.value.toArray();
  assert.equal(hole.snapshot().open, true);
  assert.ok(Math.abs(during[0] - original[0] - .05) < 1e-8);
  assert.deepEqual(during.slice(2), original.slice(2));
  rotate('stopped', .05); hole.update();
  assert.equal(hole.snapshot().open, false);
  hole.update(); assert.equal(hole.snapshot().open, false, 'an old correction cannot reopen recovery');
});

test('floor opening rejects disarmed, nonmetric and missing-source requests and resets closed', () => {
  const { hole, material, scan, block, removeData } = fixture();
  hole.reset(); hole.initialize();
  block('Tracking interrupted.'); assert.equal(hole.show(), false);
  block(null); scan.scale.setScalar(2); assert.equal(hole.show(), false);
  scan.scale.setScalar(1); assert.equal(hole.show(), true);
  block('Tracking interrupted.'); assert.equal(hole.toggle(), true, 'Closing remains available.');
  assert.equal(hole.snapshot().open, false);
  assert.equal(hole.show(), false);
  block(null); assert.equal(hole.show(), true);
  hole.reset();
  assert.equal(material.uniforms.uFloorHoleOpen.value, 0);
  assert.equal(hole.snapshot().open, false);
  removeData(); assert.equal(hole.show(), false);
  hole.loadingFailed(new Error('Load failed.'));
  assert.equal(hole.snapshot().phase, 'error'); assert.equal(hole.show(), false);
  assert.equal(FLOOR_HOLE.floorY, 0);
});

test('hole follows both calibrated offset components without changing its world-Z endpoints', () => {
  const { hole, scan, material, rotate } = fixture();
  const heading = .2;
  scan.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading));
  hole.initialize(); assert.equal(hole.show(), true, hole.snapshot().status);
  const near = material.uniforms.uFloorHoleBounds.value.toArray();
  const far = material.uniforms.uFloorHoleFarBounds.value.toArray();
  const dx = -.05 * Math.cos(heading), dz = .05 * Math.sin(heading);
  rotate('rotating', dx, dz); scan.rotation.y += .8; hole.update();
  const during = material.uniforms.uFloorHoleBounds.value.toArray();
  for (const side of [0, 1]) {
    const expected = dx - (far[side] - near[side]) / FLOOR_HOLE.length * dz;
    assert.ok(Math.abs(during[side] - near[side] - expected) < 1e-8);
  }
  assert.deepEqual(during.slice(2), [3, 5.6]);
});
