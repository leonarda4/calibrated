import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Matrix4, PerspectiveCamera, Scene, ShaderMaterial, Vector3 } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { HoleWorldRotation, easeHoleTurn, type HoleTurnGeometry } from '../src/experience/holeWorldRotation.ts';
import { createWorldPresentation } from '../src/viewer/worldPresentation.ts';

function hole(floorSide: 'start' | 'end', route = new Matrix4()): HoleTurnGeometry {
  return {open:true,floorY:0,startZ:-2.9,endZ:-.3,nearBounds:[-1.1,1.2],farBounds:[-.9,1.3],routeToWorld:route.toArray(),floorSide};
}
const near = (a:number,b:number,tolerance=1e-9) => assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const matrixNear = (a:Matrix4,b:Matrix4) => a.elements.forEach((value,i)=>near(value,b.elements[i]));

test('either source floor hinges onto the physical floor, ceiling stays above it and corridor depth becomes horizontal', () => {
  for(const side of ['start','end'] as const)for(const yaw of [0,.7,Math.PI,-1.4]) {
    const frame=new Matrix4().makeRotationY(yaw).setPosition(3,0,-2), geometry=hole(side,frame), turn=new HoleWorldRotation();
    assert.equal(turn.start(geometry),true);
    for(let i=0;i<16;i++)turn.update(.25,true);
    assert.equal(turn.snapshot().phase,'complete');near(turn.snapshot().angleDegrees,90);
    const floorZ=side==='end'?geometry.endZ:geometry.startZ, ceilingZ=side==='end'?geometry.startZ:geometry.endZ;
    const transform=turn.matrix();
    for(const depth of [0,1.7,9])for(const x of [-.75,.2,.7]) {
      const floor=new Vector3(x,-depth,floorZ).applyMatrix4(frame).applyMatrix4(transform);
      const ceiling=new Vector3(x,-depth,ceilingZ).applyMatrix4(frame).applyMatrix4(transform);
      near(floor.y,0);near(ceiling.y,2.6);
    }
    const direction=new Vector3(0,-1,0).transformDirection(transform);
    near(direction.y,0);near(direction.length(),1);near(transform.determinant(),1);
    // Every point of the floor edge is stationary, rather than orbiting the viewer.
    for(const x of [-1,0,1]) {
      const edge=new Vector3(x,0,floorZ).applyMatrix4(frame);
      near(edge.distanceTo(edge.clone().applyMatrix4(transform)),0);
    }
  }
});

test('quarter-turn easing is slow at both ends, exact at midpoint and endpoint, frozen and never compounded', () => {
  const geometry=hole('end'), turn=new HoleWorldRotation();assert.equal(turn.start(geometry),true);
  const hinge=turn.snapshot().hingeWorld;
  geometry.endZ=8;(geometry.routeToWorld as number[])[12]=100;
  turn.update(.5,true);const early=turn.snapshot().angleDegrees;assert.ok(early>0&&early<11.25);
  for(let i=0;i<3;i++)turn.update(.5,true);near(turn.snapshot().angleDegrees,45);
  for(let i=0;i<3;i++)turn.update(.5,true);near(turn.snapshot().angleDegrees,90-early);
  turn.update(.5,true);near(turn.snapshot().angleDegrees,90);assert.deepEqual(turn.snapshot().hingeWorld,hinge);
  const final=turn.matrix();for(let i=0;i<20;i++)turn.update(.1,true);matrixNear(turn.matrix(),final);
  assert.equal(turn.start(hole('start')),false);
  near(easeHoleTurn(0),0);near(easeHoleTurn(1),1);near(easeHoleTurn(.25)+easeHoleTurn(.75),1);
});

test('return and repeat reuse one captured hinge with symmetric easing and exact identity', () => {
  for (const side of ['start','end'] as const) for (const yaw of [0,.7,Math.PI]) for (const floorY of [0,.17]) {
    const route=new Matrix4().makeRotationY(yaw).setPosition(3,0,-2), geometry=hole(side,route), turn=new HoleWorldRotation();
    geometry.floorY=floorY;
    assert.equal(turn.start(geometry),true);
    const frozen=turn.geometry()!, hinge=turn.snapshot().hingeWorld, axis=turn.snapshot().axisWorld;
    (geometry.nearBounds as number[])[0]=-100;
    (frozen.farBounds as number[])[1]=100;
    assert.notDeepEqual(turn.geometry()!.nearBounds,geometry.nearBounds);
    assert.notDeepEqual(turn.geometry()!.farBounds,frozen.farBounds);
    for(let i=0;i<8;i++)turn.update(.5,true);
    const final=turn.matrix();
    for(let cycle=0;cycle<4;cycle++) {
      assert.equal(turn.returnToOriginal(),true);
      assert.equal(turn.snapshot().phase,'returning');near(turn.snapshot().angleDegrees,90);matrixNear(turn.matrix(),final);
      assert.equal(turn.returnToOriginal(),false);assert.equal(turn.rotateIntoCutout(),false);
      turn.update(.5,true);const early=90-turn.snapshot().angleDegrees;assert.ok(early>0&&early<11.25);
      for(let i=0;i<3;i++)turn.update(.5,true);near(turn.snapshot().angleDegrees,45);
      for(let i=0;i<3;i++)turn.update(.5,true);near(turn.snapshot().angleDegrees,early);
      turn.update(.5,true);assert.equal(turn.snapshot().phase,'original');near(turn.snapshot().angleDegrees,0);
      assert.deepEqual(turn.matrix().toArray(),new Matrix4().toArray());
      assert.deepEqual(turn.snapshot().hingeWorld,hinge);assert.deepEqual(turn.snapshot().axisWorld,axis);
      assert.equal(turn.returnToOriginal(),false);assert.equal(turn.start(hole(side)),false);
      for(let i=0;i<5;i++)turn.update(.1,true);assert.deepEqual(turn.matrix().toArray(),new Matrix4().toArray());
      assert.equal(turn.rotateIntoCutout(),true);
      for(let i=0;i<8;i++)turn.update(.5,true);
      assert.equal(turn.snapshot().phase,'complete');matrixNear(turn.matrix(),final);
    }
  }
});

test('return cancellation and lost tracking in either settled world cannot revive a prior visit', () => {
  for(const phase of ['returning','original'] as const) for(const invalid of [NaN,Infinity,-.1,.501]) {
    const turn=new HoleWorldRotation();turn.start(hole('end'));
    for(let i=0;i<8;i++)turn.update(.5,true);
    turn.returnToOriginal();
    for(let i=0;i<(phase==='original'?8:2);i++)turn.update(.5,true);
    assert.equal(turn.snapshot().phase,phase);
    turn.update(invalid,true);assert.equal(turn.snapshot().phase,'cancelled');matrixNear(turn.matrix(),new Matrix4());
    assert.equal(turn.returnToOriginal(),false);assert.equal(turn.rotateIntoCutout(),false);
    for(let i=0;i<10;i++)turn.update(.5,true);matrixNear(turn.matrix(),new Matrix4());
    turn.reset();assert.equal(turn.geometry(),null);assert.equal(turn.start(hole('start')),true);
  }
  for(const complete of [false,true]) {
    const turn=new HoleWorldRotation();turn.start(hole('end'));for(let i=0;i<8;i++)turn.update(.5,true);
    turn.returnToOriginal();if(complete)for(let i=0;i<8;i++)turn.update(.5,true);
    turn.update(.1,false);assert.equal(turn.snapshot().phase,'cancelled');matrixNear(turn.matrix(),new Matrix4());
  }
});

test('a new turn requires the entire finite captured trapezoid', () => {
  for (const invalid of [
    {...hole('end'),nearBounds:null}, {...hole('start'),farBounds:null},
    {...hole('end'),nearBounds:[-1,NaN]}, {...hole('start'),farBounds:[1,0]},
    {...hole('end'),nearBounds:[-1,0,1]}, {...hole('start'),farBounds:[-Infinity,1]},
  ]) assert.equal(new HoleWorldRotation().start(invalid),false);
});

test('invalid frames, loss of tracking eligibility and recovery cancel without stale-angle revival', () => {
  for(const bad of [NaN,Infinity,-.01,.501])for(const completed of [false,true]) {
    const turn=new HoleWorldRotation();turn.start(hole('end'));
    for(let i=0;i<(completed?16:4);i++)turn.update(.25,true);
    turn.update(bad,true);assert.equal(turn.snapshot().phase,'cancelled');matrixNear(turn.matrix(),new Matrix4());
    for(let i=0;i<20;i++)turn.update(.25,true);matrixNear(turn.matrix(),new Matrix4());assert.equal(turn.start(hole('end')),false);
    turn.reset();assert.equal(turn.start(hole('end')),true);turn.update(.25,false);matrixNear(turn.matrix(),new Matrix4());
  }
  const turn=new HoleWorldRotation();assert.equal(turn.start({...hole('end'),open:false}),false);
  assert.equal(turn.start(hole('end',new Matrix4().makeScale(2,2,2))),false);
  assert.equal(turn.start(hole('end',new Matrix4().makeRotationX(.2))),false);
});

test('presentation rotates all authored content and clipping planes, preserving tracked objects, source coordinates and resources', () => {
  const scene=new Scene(), scan=new Group(), box=new Group(), camera=new PerspectiveCamera(), grip=new Group();
  scan.position.set(2,0,3);box.position.set(.1,.2,4);camera.position.set(.1,1.7,-1.6);grip.position.set(.2,1,-1);
  scene.add(scan,box,camera,grip);scene.updateMatrixWorld(true);
  const route=new Matrix4().makeRotationY(.6).setPosition(2,0,-3);
  const material=new ShaderMaterial({uniforms:{uFloorHoleWorldToRoute:{value:route.clone().invert()},
    uHallwayCutRouteToWorld:{value:route.clone()},uHallwayCutWorldToRoute:{value:route.clone().invert()},uBoxWorldToContent:{value:new Matrix4()}}});
  Object.assign(scan,{viewer:{splatMesh:{material}}});
  const display=createWorldPresentation(scene,scan as unknown as DropInViewer);display.attach(scan);display.attach(box);
  const canonicalScan=scan.matrixWorld.clone(),canonicalBox=box.matrixWorld.clone(),eye=camera.matrixWorld.clone(),hand=grip.matrixWorld.clone();
  const turn=new HoleWorldRotation();turn.start(hole('end',route));for(let i=0;i<8;i++)turn.update(.25,true);
  for(let i=0;i<30;i++) {
    display.beginFrame();matrixNear(scan.matrixWorld,canonicalScan);matrixNear(material.uniforms.uHallwayCutRouteToWorld.value,route);
    display.apply(turn.matrix());matrixNear(scan.matrixWorld,turn.matrix().multiply(canonicalScan));
    matrixNear(box.matrixWorld,turn.matrix().multiply(canonicalBox));matrixNear(camera.matrixWorld,eye);matrixNear(grip.matrixWorld,hand);
    matrixNear(material.uniforms.uHallwayCutRouteToWorld.value,turn.matrix().multiply(route));
    matrixNear(material.uniforms.uFloorHoleWorldToRoute.value,route.clone().invert().multiply(turn.matrix().invert()));
    assert.deepEqual(scan.position.toArray(),[2,0,3]);assert.equal((scan as unknown as DropInViewer).viewer.splatMesh.material,material);
  }
  display.reset();matrixNear(scan.matrixWorld,canonicalScan);matrixNear(material.uniforms.uBoxWorldToContent.value,new Matrix4());
  assert.throws(()=>display.attach(camera),/authored environment/);
});
