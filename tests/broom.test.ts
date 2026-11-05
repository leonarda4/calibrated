import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Matrix4, MeshBasicMaterial, Quaternion, Scene, ShaderMaterial, Vector3, Mesh, InstancedBufferGeometry, InstancedBufferAttribute, Float32BufferAttribute } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { createBroom } from '../src/viewer/broom.ts';
import { BROOM } from '../src/viewer/broomConfig.ts';
import { createBroomAtmosphere } from '../src/viewer/broomAtmosphere.ts';

test('foreground broom reuses only sorted broom indices, preserves shared state and rearms without rebuilding',()=>{
  const scene=new Scene(),scan=new Group(),object=new Group();Object.assign(object,{splatBuffer:{getSplatCount:()=>3}});scene.add(scan);
  const geometry=new InstancedBufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([0,0,0],3));
  const sorted=new InstancedBufferAttribute(new Uint32Array([4,1,5,0,3,2]),1);geometry.setAttribute('splatIndex',sorted);geometry.instanceCount=6;
  const material=new ShaderMaterial({vertexShader:'float splatOpacityFromScene = sceneOpacity[sceneIndex];',uniforms:{uGlobalOpacity:{value:.4}}});
  const mesh=new Mesh(geometry,material);Object.assign(mesh,{getSceneIndexForSplat:(index:number)=>index>=3?BROOM.sceneIndex:0});scan.add(mesh);
  Object.assign(scan,{viewer:{splatMesh:mesh},getSplatScene:()=>object});
  let atmosphere=true;const previousScene=scene.onBeforeRender,previousMesh=mesh.onBeforeRender;
  const effect=createBroomAtmosphere(scene,scan as unknown as DropInViewer,()=>atmosphere);
  const prepare=()=>{(scene.onBeforeRender as ()=>void)();(mesh.onBeforeRender as ()=>void)();};
  try{
    prepare();const layer=effect.layer,indices=layer.geometry.getAttribute('splatIndex');
    assert.deepEqual(Array.from(indices.array),[4,5,3]);assert.equal(layer.geometry.instanceCount,3);
    assert.equal(layer.material.uniforms.uGlobalOpacity,material.uniforms.uGlobalOpacity);
    assert.equal(material.uniforms.uBroomForeground.value,1);assert.equal(layer.material.uniforms.uBroomForeground.value,0);
    assert.notEqual(layer.geometry.getAttribute('position'),geometry.getAttribute('position'));
    atmosphere=false;prepare();assert.equal(layer.geometry.instanceCount,0);assert.equal(material.uniforms.uBroomForeground.value,0);
    atmosphere=true;prepare();assert.equal(layer.geometry.instanceCount,3);assert.equal(layer.geometry.getAttribute('splatIndex'),indices);
    sorted.set([5,2,4,1,3,0]);sorted.needsUpdate=true;prepare();assert.deepEqual(Array.from(indices.array),[5,4,3]);
    object.visible=false;prepare();assert.equal(layer.geometry.instanceCount,0);
    assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);
  }finally{effect.dispose();effect.dispose();geometry.dispose();material.dispose();}
  assert.equal(scene.onBeforeRender,previousScene);assert.equal(mesh.onBeforeRender,previousMesh);assert.equal(material.uniforms.uBroomForeground.value,0);
});

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
