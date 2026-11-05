import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Matrix4, Vector3 } from 'three';
import { FOG, fogMetadata, inFogPassage } from '../src/effects/volumeFogConfig.ts';
import { BROOM_ENCOUNTER, broomCutoutPlacement } from '../src/experience/broomEncounter.ts';
import { HoleWorldRotation } from '../src/experience/holeWorldRotation.ts';
import { cutOpeningFromMetadata, cutoutPlacement, type Point3 } from '../src/viewer/hallwayCutPlacement.ts';

test('supplied 3D density validates its byte count, layout and floor height', async () => {
  const [metadata, binary] = await Promise.all([readFile(new URL('../public'+FOG.metadataUrl, import.meta.url),'utf8'),
    readFile(new URL('../public'+FOG.densityUrl, import.meta.url))]);
  const value = JSON.parse(metadata), spec = fogMetadata(value, binary.byteLength);
  assert.deepEqual(spec.resolution, [160,53,400]); assert.ok(spec.min[1]>0 && spec.min[1]<.003);
  assert.equal(spec.height,.8);assert.ok(Math.abs(spec.size[1] - .795) < 1e-6);
  assert.throws(() => fogMetadata(value, binary.byteLength - 1), /size/);
  for (const invalid of [{...value,order:'z fastest'}, {...value,resolution:[160,0,400]},
    {...value,boundsMin:[-1.2,-.15,-3]}, {...value,encoding:'float32'}]) assert.throws(() => fogMetadata(invalid));
});

test('the fixed fog interval stays at five metres with the broom moved to four and covers the far export', () => {
  const passage = {start:FOG.startDepth,end:FOG.endDepth,sides:[-1.05,1.05,-1.05,1.05] as const};
  assert.equal(FOG.startDepth, 5); assert.equal(FOG.endDepth, 33);
  assert.equal(FOG.startDepth - BROOM_ENCOUNTER.depth, 1);
  assert.equal(inFogPassage([0,.1,BROOM_ENCOUNTER.depth],passage,1.3),false);
  assert.equal(inFogPassage([0,.1,FOG.startDepth-.01],passage,1.3),false);
  assert.ok(inFogPassage([0,.1,FOG.startDepth+.2],passage,1.3));
  assert.ok(inFogPassage([0,1.1,30],passage,1.3), 'The stretched volume includes the upper half-height layer.');
  assert.equal(inFogPassage([0,.1,FOG.endDepth+.01],passage,1.3),false);
  for (const point of [[-2,.1,8],[2,.1,8],[0,1.4,8]] as Point3[]) assert.equal(inFogPassage(point,passage,1.3),false);
});

test('fixed fog remains one metre beyond the relocated broom through calibrated turns and either floor-side hinge', () => {
  const source = cutOpeningFromMetadata({cutPlane:{pointRaw:[0,0,0],normalRaw:[0,1,0]},
    floorFit:{normalRaw:[0,0,1]},walls:{width:2.1}});
  for (const yaw of [0,Math.PI,.73]) for (const floorSide of ['start','end'] as const) {
    const hole = {open:true,floorY:0,startZ:-3,endZ:-.4,nearBounds:[-.95,1.15],farBounds:[-.85,1.25],
      routeToWorld:new Matrix4().makeRotationY(yaw).setPosition(3,0,-4).toArray(),floorSide};
    const box: Point3 = [0,0,floorSide==='end'?hole.endZ:hole.startZ];
    const placement = cutoutPlacement(source,hole,box);
    const fogStart = placement.map(new Vector3(0,0,FOG.startDepth)).applyMatrix4(placement.routeToWorld);
    const broomStart = placement.map(new Vector3(0,0,BROOM_ENCOUNTER.depth)).applyMatrix4(placement.routeToWorld);
    const turn = new HoleWorldRotation(); assert.ok(turn.start(hole));
    for (let step=0;step<8;step++) {
      turn.update(.5,true);
      assert.ok(Math.abs(fogStart.clone().applyMatrix4(turn.matrix()).distanceTo(broomStart.clone().applyMatrix4(turn.matrix()))-1)<1e-10);
    }
    const broom = broomCutoutPlacement(hole,turn.matrix());
    assert.ok(new Vector3().setFromMatrixPosition(broom.upright).distanceTo(broomStart.clone().applyMatrix4(turn.matrix()))<1e-10);
    assert.ok(turn.returnToOriginal());
    for(let step=0;step<8;step++) {
      turn.update(.5,true);
      assert.ok(Math.abs(fogStart.clone().applyMatrix4(turn.matrix()).distanceTo(broomStart.clone().applyMatrix4(turn.matrix()))-1)<1e-10);
    }
  }
});
