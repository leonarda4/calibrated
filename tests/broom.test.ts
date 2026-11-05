import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Matrix4, MeshBasicMaterial, Quaternion, Scene, ShaderMaterial, Vector3 } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { createBroom } from '../src/viewer/broom.ts';
import { BROOM } from '../src/viewer/broomConfig.ts';

function fixture() {
  const scene = new Scene(), scan = new Group(), rawObject = new Group();
  Object.assign(rawObject, { updateTransform() { rawObject.updateMatrix(); } });
  // Transform-only double; browser checks compile/render the full pinned shader.
  const material = new ShaderMaterial({ vertexShader: 'void main () { gl_Position = quadPos; }', fragmentShader: 'void main () {}' });
  Object.assign(scan, { getSceneCount: () => 3, getSplatScene: () => rawObject, viewer: { splatMesh: { material } } });
  scene.add(scan);
  scan.rotation.x = Math.PI / 2; scan.updateMatrixWorld(true);
  const points: number[] = [];
  for (const x of [-.8, 1.4]) for (let z = -30; z <= 30; z += .1) {
    for (let y = .5; y <= 1.8; y += .1) points.push(...scan.worldToLocal(new Vector3(x, y, z)).toArray());
  }
  const centers = new Float32Array(points);
  let rotation = { phase: 'box', offsetWorld: [0, 0, 0] as readonly [number, number, number] };
  let blocked: string | null = null;
  const broom = createBroom({ scene, scanRoot: scan as unknown as DropInViewer,
    getPivot: () => ({ centerX: .3, floorY: .1 }), blockReason: () => blocked,
    getSourceCenters: () => centers, getRotationState: () => rotation });
  return { scene, scan, rawObject, broom, block: (reason: string | null) => { blocked = reason; },
    rotate: (phase: string, offset: number, z = 0) => { rotation = { phase, offsetWorld: [offset, 0, z] }; } };
}

test('original broom stays centred/upright at world Z6 in the current metric hallway', () => {
  const { scan, rawObject, broom, rotate } = fixture();
  assert.equal(broom.show(), false);
  broom.initialize(); assert.equal(broom.show(), true);
  for (const angle of [0, .63, Math.PI]) {
    scan.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), angle)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
    scan.position.set(2.1, .2, -3.8);
    broom.update();
    const matrix = new Matrix4().multiplyMatrices(scan.matrixWorld, rawObject.matrix);
    const base = new Vector3(...BROOM.sourceBase).applyMatrix4(matrix);
    const handle = new Vector3(...BROOM.sourceBase).add(new Vector3(0, 0, -1)).applyMatrix4(matrix);
    const expectedX = 2.1 + (.3 + Math.sin(angle) * (6 + 3.8)) / Math.cos(angle);
    assert.ok(base.distanceTo(new Vector3(expectedX, .1, 6)) < 1e-5, 'base must follow the current fitted section centre');
    assert.ok(handle.sub(base).distanceTo(new Vector3(0, 1, 0)) < 1e-12);
    assert.ok(Math.abs(matrix.determinant() - 1) < 1e-12, 'Gaussian scale/covariance must use a proper rigid transform.');
  }
  const originalX = broom.snapshot().baseWorld![0];
  rotate('rotating', .05); scan.rotation.y = Math.PI / 2; broom.update();
  assert.ok(Math.abs(broom.snapshot().baseWorld![0] - originalX - .05) < 1e-8);
  assert.equal(broom.snapshot().baseWorld![2], 6, 'authored world station stays fixed through the artistic turn');
  broom.reset(); broom.update();
  assert.equal(rawObject.visible, false);
});

test('broom respects calibration gates, rejects changed scale, and fails hidden', () => {
  const { scan, rawObject, broom, block } = fixture();
  broom.initialize(); block('Tracking lost.');
  assert.equal(broom.show(), false); assert.equal(rawObject.visible, false);
  block(null); scan.scale.setScalar(2);
  assert.equal(broom.show(), false);
  scan.scale.setScalar(1); assert.equal(broom.show(), true);
  broom.loadingFailed(new Error('Asset unavailable.'));
  assert.equal(broom.snapshot().phase, 'error'); assert.equal(rawObject.visible, false);
  assert.equal(broom.show(), false);
});

test('Reset during loading tolerates the renderer placeholder material before glitch uniforms exist', () => {
  const { scan, broom, rawObject } = fixture();
  const placeholder = new MeshBasicMaterial();
  Object.assign(scan, { viewer: { splatMesh: { material: placeholder } } });
  assert.doesNotThrow(() => broom.reset());
  assert.equal(rawObject.visible, false);
  assert.equal(broom.snapshot().phase, 'loading');
  assert.doesNotThrow(() => broom.loadingFailed(new Error('Interrupted load.')));
  assert.equal(broom.snapshot().visible, false);
  placeholder.dispose();
});

test('broom projects a calibrated sideways correction onto its unchanged world-Z station', () => {
  const { scan, broom, rotate } = fixture();
  const heading = .3;
  scan.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), heading)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
  broom.initialize(); assert.equal(broom.show(), true, broom.snapshot().status);
  const before = broom.snapshot().baseWorld!;
  const dx = -.05 * Math.cos(heading), dz = .05 * Math.sin(heading);
  rotate('rotating', dx, dz); scan.rotation.y += .8; broom.update();
  const during = broom.snapshot().baseWorld!;
  assert.ok(Math.abs(during[0] - before[0] - dx + Math.tan(heading) * dz) < 1e-6);
  assert.equal(during[2], 6);
});
