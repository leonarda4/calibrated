import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from 'three';
import { HoleWorldRotation, type HoleTurnGeometry } from '../src/experience/holeWorldRotation.ts';
import { HolePortalCrossing } from '../src/experience/holePortalCrossing.ts';

function fixture(side:'start'|'end'='end',yaw=.7,floorY=0) {
  const route=new Matrix4().makeRotationY(yaw).setPosition(3,0,-2);
  const geometry:HoleTurnGeometry={open:true,floorY,startZ:-2.9,endZ:-.3,
    nearBounds:[-1.1,1.2],farBounds:[-.9,1.3],routeToWorld:route.toArray(),floorSide:side};
  const turn=new HoleWorldRotation();assert.equal(turn.start(geometry),true);
  for(let i=0;i<16;i++)turn.update(.25,true);
  const final=turn.matrix(), combined=final.clone().multiply(route), portal=new HolePortalCrossing();
  assert.equal(portal.capture(geometry,final),true);
  const world=(distance:number,x=0,z=-1.6) => new Vector3(x,floorY+distance,z).applyMatrix4(combined).toArray() as [number,number,number];
  const feed=(distance:number,x=0,z=-1.6,deltaSeconds=.1,eligible=true) => portal.update({position:world(distance,x,z),deltaSeconds,eligible});
  return {geometry,route,final,combined,portal,world,feed};
}

test('the frozen vertical tapered doorway detects physical interior-to-original crossings in either calibrated orientation', () => {
  for(const side of ['start','end'] as const)for(const yaw of [0,.7,Math.PI,-1.4])for(const floor of [-.05,0,.17]) {
    const {portal,feed}=fixture(side,yaw,floor);
    assert.equal(portal.snapshot().captured,true);assert.ok(Math.abs(portal.snapshot().normalWorld![1])<1e-9);
    assert.equal(feed(-.2),false);assert.equal(portal.snapshot().armed,true);
    assert.equal(feed(-.03),false);assert.equal(feed(.02),false);assert.equal(portal.snapshot().pendingHit,true);
    assert.equal(feed(.079),false);assert.equal(feed(.081),true);
    assert.equal(portal.snapshot().crossings,1);
    for(let i=0;i<5;i++)assert.equal(feed(.12),false);
    assert.equal(feed(-.12),false);assert.equal(feed(.12),true);
    assert.equal(portal.snapshot().crossings,2);
  }
});

test('starting outside must first occupy the stable interior; deadband jitter cannot fabricate repeated passes', () => {
  const {portal,feed}=fixture();
  assert.equal(feed(.2),false);assert.equal(feed(.02),false);assert.equal(feed(-.03),false);assert.equal(feed(.12),false);
  assert.equal(portal.snapshot().armed,false);
  assert.equal(feed(-.12),false);assert.equal(feed(.01),false);assert.equal(feed(-.01),false);
  assert.equal(portal.snapshot().pendingHit,false);
  assert.equal(feed(.02),false);assert.equal(feed(.1),true);
  assert.equal(feed(.02),false);assert.equal(feed(.1),false);assert.equal(portal.snapshot().crossings,1);
});

test('crossings use the strict interpolated trapezoid, not its world or route bounding rectangle', () => {
  for(const [x,z] of [[-1,-1.6],[1.25,-1.6],[1.28,-1.6],[0,-2.9],[0,-.3],[0,-3],[0,0]]) {
    const {portal,feed}=fixture();
    assert.equal(feed(-.12,x,z),false);assert.equal(feed(.12,x,z),false,`Accepted outside/boundary [${x},${z}]`);
    assert.equal(portal.snapshot().crossings,0);
  }
  for(const x of [-.9998,1.2498]) {
    const {feed}=fixture();assert.equal(feed(-.12,x),false);assert.equal(feed(.12,x),true);
  }
});

test('an outside miss or leaving the aperture in the deadband cannot turn into a later crossing', () => {
  const {portal,feed}=fixture();
  feed(-.12,1.28);assert.equal(feed(.02,1.28),false);assert.equal(feed(.1,1.22),false);
  assert.equal(portal.snapshot().crossings,0);
  feed(-.12,1.2);feed(.01,1.2);assert.equal(portal.snapshot().pendingHit,true);
  assert.equal(feed(.04,1.3),false);assert.equal(portal.snapshot().pendingHit,false);
  assert.equal(feed(.1,1.2),false);assert.equal(portal.snapshot().crossings,0);
});

test('invalid positions, eligibility and stalled clocks discard history while retaining captured geometry', () => {
  for(const bad of [null,[NaN,0,0],[0,Infinity,0]] as const) {
    const {portal,feed}=fixture();feed(-.2);
    assert.equal(portal.update({position:bad,deltaSeconds:.1,eligible:true}),false);
    assert.equal(portal.snapshot().captured,true);assert.equal(portal.snapshot().armed,false);
    assert.equal(feed(.2),false);
  }
  for(const deltaSeconds of [NaN,Infinity,0,-.1,.501]) {
    const {portal,feed,world}=fixture();feed(-.2);
    assert.equal(portal.update({position:world(.2),deltaSeconds,eligible:true}),false);assert.equal(feed(.2),false);
  }
  const {portal,feed,world}=fixture();feed(-.2);
  assert.equal(portal.update({position:world(.2),deltaSeconds:.1,eligible:false}),false);assert.equal(feed(.2),false);
});

test('large tracking snaps and implausible speeds cannot pass through the doorway', () => {
  for(const [distance,dt] of [[1,.5],[.12,.01]]) {
    const {portal,feed}=fixture();feed(-.12);
    assert.equal(feed(distance,0,-1.6,dt),false);assert.equal(portal.snapshot().armed,false);
    assert.equal(feed(.12),false);assert.equal(portal.snapshot().crossings,0);
    assert.equal(feed(-.12),false);assert.equal(feed(.12),true);
  }
});

test('captured matrices and tapered edges cannot follow later edits, and history can reset independently', () => {
  const {portal,feed,geometry,final}=fixture(), corners=portal.snapshot().worldCorners;
  (geometry.nearBounds as number[])[0]=-100;(geometry.farBounds as number[])[1]=100;
  (geometry.routeToWorld as number[])[12]=100;final.makeTranslation(100,100,100);
  const publicCorners=portal.snapshot().worldCorners!;publicCorners[0][0]=999;
  assert.deepEqual(portal.snapshot().worldCorners,corners);
  feed(-.12,2);assert.equal(feed(.12,2),false);
  portal.clearSamples();
  feed(-.12);feed(.01);assert.equal(portal.snapshot().pendingHit,true);
  portal.clearSamples();assert.equal(portal.snapshot().captured,true);assert.equal(portal.snapshot().armed,false);
  assert.equal(portal.snapshot().signedDistance,null);assert.equal(feed(.12),false);
  feed(-.12);assert.equal(feed(.12),true);
  portal.reset();assert.equal(portal.snapshot().captured,false);assert.equal(portal.snapshot().worldCorners,null);
  assert.equal(portal.snapshot().crossings,0);assert.equal(feed(-.12),false);assert.equal(feed(.12),false);
});

test('capture rejects incomplete, nonmetric or nonvertical geometry and clears an old doorway on failure', () => {
  const {geometry,final,portal}=fixture();
  for(const bad of [
    {...geometry,open:false}, {...geometry,nearBounds:null}, {...geometry,farBounds:[1,0]},
    {...geometry,nearBounds:[-1,NaN]}, {...geometry,startZ:geometry.endZ}, {...geometry,floorY:Infinity},
    {...geometry,routeToWorld:new Matrix4().makeScale(2,2,2).toArray()},
    {...geometry,routeToWorld:new Matrix4().makeRotationX(.2).toArray()},
    {...geometry,routeToWorld:new Matrix4().makeScale(-1,1,1).toArray()},
  ]) {
    assert.equal(portal.capture(bad,final),false);assert.equal(portal.snapshot().captured,false);
  }
  assert.equal(portal.capture(geometry,new Matrix4()),false);
  assert.equal(portal.capture(geometry,new Matrix4().makeScale(2,2,2)),false);
  assert.equal(portal.capture(geometry,[1,2]),false);
  const corrupt=final.toArray();corrupt[0]=NaN;assert.equal(portal.capture(geometry,corrupt),false);
  assert.equal(portal.capture(geometry,final.toArray()),true);
});
