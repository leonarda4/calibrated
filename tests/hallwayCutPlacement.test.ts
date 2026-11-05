import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Matrix3, Matrix4, Object3D, ShaderMaterial, Vector3 } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { cutOpeningFromMetadata, cutoutPlacement, rawToCutOpening, type HoleMouth } from '../src/viewer/hallwayCutPlacement.ts';
import { createHallwayCut } from '../src/viewer/hallwayCut.ts';

const metadata = { cutPlane: { pointRaw: [2,20,-1.4], normalRaw: [0,1,0] }, floorFit: { normalRaw: [0,0,1] }, walls: { width: 2.2 } };
const source = cutOpeningFromMetadata(metadata);
const hole = (): HoleMouth => ({open:true,floorY:0,startZ:-2.9,endZ:-.3,nearBounds:[-1.1,1.2],farBounds:[-.9,1.3],routeToWorld:new Matrix4().toArray()});
const close = (a: number[], b: number[], tolerance=1e-10) => a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<tolerance,`${a} != ${b}`));

test('downward cutout meets every tapered mouth corner with floor toward the actual second box in either direction', () => {
  const transform = new Matrix4().makeRotationY(.73).setPosition(-3,0,2);
  for(const boxZ of [-5,4.57]) {
    const opening=hole();opening.routeToWorld=transform.toArray();
    const result=cutoutPlacement(source,opening,[.2,0,boxZ]);
    const floorAtEnd=boxZ>0;
    assert.equal(result.floorAtEnd,floorAtEnd);
    const rawFromOpening=rawToCutOpening(source).invert();
    for(const y of [0,source.height])for(const x of [-source.width/2,source.width/2]) {
      const far=(y===0)===floorAtEnd, sides=far?opening.farBounds!:opening.nearBounds!;
      const right=(x>0)===floorAtEnd;
      const expected=new Vector3(sides[right?1:0],0,far?opening.endZ:opening.startZ).applyMatrix4(transform);
      const raw=new Vector3(x,y,0).applyMatrix4(rawFromOpening);
      close(result.mapRaw(raw).toArray(),expected.toArray());
      const below=raw.clone().addScaledVector(new Vector3(...source.along),3.25);
      close(result.mapRaw(below).toArray(),expected.clone().add(new Vector3(0,-3.25,0)).toArray());
    }
    assert.ok(result.derivative(new Vector3(0,1,1)).determinant()<0,
      'Opening coordinates use across/up/along with negative handedness; raw-to-world remains a proper orientation.');
    assert.ok(result.sourceToWorld.determinant()>0);
  }
});

test('tapered covariance Jacobian agrees with independent displacement differences, including sheared walls', () => {
  const result=cutoutPlacement(source,hole(),[0,0,5]), point=new Vector3(.53,1.8,4);
  const derivative=new Matrix3().setFromMatrix4(result.derivative(point)), delta=1e-5;
  for(const axis of [new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)]) {
    const numeric=result.map(point.clone().addScaledVector(axis,delta)).sub(result.map(point)).divideScalar(delta);
    close(numeric.toArray(),axis.clone().applyMatrix3(derivative).toArray(),1e-8);
  }
  const middle=new Vector3(0,source.height/2,0), raw=middle.clone().applyMatrix4(rawToCutOpening(source).invert());
  close(raw.applyMatrix4(result.sourceToWorld).toArray(),result.map(middle).toArray());
});

test('the cutout follows the captured hole, cancels scan motion, hides on close and reuses shared resources', () => {
  const scan=new Group(), object=new Object3D();scan.add(object);
  const material=new ShaderMaterial({vertexShader:'void main () { vec4 viewCenter = transformModelViewMatrix * vec4(splatCenter, 1.0); gl_Position = quadPos; }',fragmentShader:'void main () {}'});
  scan.userData.hallwayCutMetadata=metadata;
  Object.assign(object,{updateTransform:()=>object.updateWorldMatrix(true,false)});
  Object.assign(scan,{viewer:{splatMesh:{material}},getSceneCount:()=>6,getSplatScene:()=>object});
  let state=hole();let boxZ=5;
  const cut=createHallwayCut({scanRoot:scan as unknown as DropInViewer,getHole:()=>state,getSecondBoxRoute:()=>[0,0,boxZ]});
  cut.initialize();assert.equal(object.visible,false);cut.update();assert.equal(object.visible,true);
  const first=cut.snapshot(), pose=object.matrixWorld.toArray();
  scan.position.set(4,0,-2);scan.rotation.y=1.2;cut.update();
  close(object.matrixWorld.toArray(),pose);assert.deepEqual(cut.snapshot().mouthWorld,first.mouthWorld);
  state={...state,nearBounds:[-1.4,.9],farBounds:[-1,1.4],routeToWorld:new Matrix4().makeRotationY(-.6).setPosition(2,0,3).toArray()};
  cut.update();assert.notDeepEqual(cut.snapshot().mouthWorld,first.mouthWorld);
  boxZ=-6;cut.update();assert.equal(cut.snapshot().floorSide,'start');
  state={...state,open:false};cut.update();assert.equal(object.visible,false);assert.equal(material.uniforms.uHallwayCutOpen.value,0);
  cut.update();assert.equal(object.visible,false);assert.equal(cut.snapshot().mouthWorld,null);
  assert.equal((scan as unknown as DropInViewer).viewer.splatMesh.material,material);
  assert.ok(material.vertexShader.includes('derivative * mat3(uHallwayCutRawToOpening)'));
  assert.ok(material.fragmentShader.includes('mouth.x < sides.x'));
});

test('invalid crop metadata and unsupported hole geometry fail without a fabricated placement', () => {
  assert.throws(()=>cutOpeningFromMetadata({}),/metadata/);
  assert.throws(()=>cutOpeningFromMetadata({...metadata,cutPlane:{...metadata.cutPlane,normalRaw:[0,0,1]}}),/orthogonal/);
  assert.throws(()=>cutoutPlacement(source,{...hole(),nearBounds:null}),/corners/);
  assert.throws(()=>cutoutPlacement(source,{...hole(),endZ:-4}),/corners/);
  assert.throws(()=>cutoutPlacement(source,hole(),[0,0,NaN]),/finite/);
});
