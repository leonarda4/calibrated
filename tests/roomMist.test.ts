import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Group,Matrix4,Scene,ShaderMaterial,Vector3} from 'three';
import type {DropInViewer} from '@mkkellogg/gaussian-splats-3d';
import {volumeMetadata} from '../src/effects/volumeTexture.ts';
import {MIST} from '../src/effects/roomMistConfig.ts';
import {FOG} from '../src/effects/volumeFogConfig.ts';
import {createRoomMist} from '../src/effects/roomMist.ts';
import {checkVolumeAssets} from '../scripts/check-volume-assets.mts';
import {cutOpeningFromMetadata,cutoutPlacement,type HoleMouth} from '../src/viewer/hallwayCutPlacement.ts';
import {corridorAtmosphereMatrix,stretchVolumeHeight} from '../src/effects/corridorAtmosphere.ts';

const metadata={cutPlane:{pointRaw:[0,0,0],normalRaw:[0,1,0]},floorFit:{normalRaw:[0,0,1]},walls:{width:2.1}};
const source=cutOpeningFromMetadata(metadata);
const hole=(open=true,yaw=0):HoleMouth=>({open,floorY:0,startZ:-1.1,endZ:1.5,nearBounds:[-.95,1.15],farBounds:[-1.1,1.25],
  routeToWorld:new Matrix4().makeRotationY(yaw).setPosition(3,0,-4).toArray()});

test('both unchanged supplied packages pass byte, layer and tiling checks',async()=>{
  for(const [url,base] of [[FOG.densityUrl,'floor_fog_v3_density'],[MIST.densityUrl,'room_mist_v1_density']]){
    const folder=new URL('../public'+url.slice(0,url.lastIndexOf('/')),import.meta.url);
    const result=await checkVolumeAssets(folder,base);assert.ok(result.filled>.05);
    assert.ok(result.seams.x.seam<=3*result.seams.x.step+.01);
  }
  const data=JSON.parse(await readFile(new URL('../public'+MIST.metadataUrl,import.meta.url),'utf8'));
  const spec=volumeMetadata(data,416000);assert.equal(spec.height,2.6);assert.equal(spec.groundBoost,1.6);
  assert.deepEqual(spec.resolution,[50,52,160]);
  assert.equal(volumeMetadata({...data,fogHeight:3,boundsMax:[1.25,3,4],resolution:[20,30,40]},24000).height,3);
  for(const bad of [{...data,resolution:[5000,2,2]},{...data,fogHeight:0},{...data,boundsMin:[-1.25,-.1,-4]},{...data,groundBoost:NaN}])assert.throws(()=>volumeMetadata(bad));
  assert.throws(()=>volumeMetadata(data,1),/size/);
});

test('half-height fog stretches only the vertical sampling and shares the captured corridor with mist',()=>{
  const spec={resolution:[160,53,400] as [number,number,number],min:[-1.2,.0025,-3] as const,size:[2.4,.795,6] as const,height:.8,groundBoost:1};
  const original=JSON.stringify(spec),height=source.height*FOG.heightFraction,sampling=stretchVolumeHeight(spec,height);
  assert.equal(height,1.3);assert.equal(sampling.min[1],.0025*1.625);assert.equal(sampling.size[1],.795*1.625);
  assert.equal(sampling.size[0],2.4);assert.equal(sampling.size[2],6);assert.equal(JSON.stringify(spec),original);
  assert.throws(()=>stretchVolumeHeight(spec,NaN));assert.throws(()=>stretchVolumeHeight(spec,0));
  assert.equal(MIST.startDepth,FOG.startDepth);assert.equal(MIST.endDepth,FOG.endDepth);
  for(const yaw of [0,.73,Math.PI/2])for(const end of [-1.1,1.5]){
    const h=hole(true,yaw),box:[number,number,number]=[0,0,end],p=cutoutPlacement(source,h,box);
    const displayHeights: number[]=[height,source.height];
    for(const displayHeight of displayHeights){
      const actual: Matrix4=corridorAtmosphereMatrix(source,h,box,displayHeight);
      const point: Vector3=new Vector3(0,displayHeight/2,12);
      const expected=p.map(point).applyMatrix4(p.routeToWorld);
      assert.ok(point.clone().applyMatrix4(actual).distanceTo(expected)<1e-9);
      assert.ok(new Vector3(0,0,0).applyMatrix4(actual).distanceTo(p.map(new Vector3()).applyMatrix4(p.routeToWorld))<1e-9);
    }
  }
});

test('mist exists only with the added hallway and follows its captured yaw/pitch without rebuilding',async()=>{
  const scan=new Group() as unknown as DropInViewer;
  const material=new ShaderMaterial({uniforms:{uGlobalOpacity:{value:1},uHallwayBrightness:{value:.3},uRealityOpacity:{value:1}}});
  const cut=new Group();Object.assign(scan,{viewer:{splatMesh:{material}},getSplatScene:()=>cut});scan.userData.hallwayCutMetadata=metadata;
  const scene=new Scene(),presentation=new Group();scene.add(presentation);presentation.add(scan);
  const h=hole(false),mask={active:false,frontDepth:6,protectedDepth:6,feather:.75};let allowed=true;
  const json=await readFile(new URL('../public'+MIST.metadataUrl,import.meta.url),'utf8');
  const bytes=await readFile(new URL('../public'+MIST.densityUrl,import.meta.url));
  const originalFetch=globalThis.fetch;let signal:AbortSignal|undefined;
  globalThis.fetch=(async(url,init)=>{signal=init?.signal as AbortSignal;return new Response(url===MIST.metadataUrl?json:bytes);}) as typeof fetch;
  const mist=createRoomMist({scene,scanRoot:scan,getHole:()=>h,getSecondBoxRoute:()=>[0,0,h.endZ],getDestruction:()=>mask,canRender:()=>allowed});
  presentation.add(mist.root);
  try{
    await mist.initialize();assert.equal(mist.snapshot().phase,'ready',mist.snapshot().error??'');assert.equal(mist.root.children.length,1);
    assert.equal(mist.snapshot().visible,false,'No mist in the original hallway with the hole closed.');
    const mesh=mist.root.children[0] as import('three').Mesh<import('three').BoxGeometry,ShaderMaterial>,geometry=mesh.geometry;
    assert.deepEqual(mesh.material.uniforms.uMin.value.toArray(),[-source.width/2,0,5]);
    assert.deepEqual(mesh.material.uniforms.uMax.value.toArray(),[source.width/2,2.6,33]);
    h.open=true;mist.update(.5);assert.equal(mist.root.visible,true);assert.equal(mist.snapshot().height,2.6);
    for(const yaw of [0,.73,Math.PI/2]){
      h.routeToWorld=hole(true,yaw).routeToWorld;
      presentation.matrixAutoUpdate=false;presentation.matrix.makeRotationX(Math.PI/2);
      mist.update();scene.updateMatrixWorld(true);
      const expected=presentation.matrix.clone().multiply(corridorAtmosphereMatrix(source,h,[0,0,h.endZ],source.height));
      mesh.matrixWorld.elements.forEach((n,i)=>assert.ok(Math.abs(n-expected.elements[i])<1e-9));
    }
    (mesh.onBeforeRender as ()=>void)();assert.equal(mesh.material.uniforms.uBrightness.value,.3);assert.equal(mesh.material.uniforms.uOpacity.value,1);
    mask.active=true;(mesh.onBeforeRender as ()=>void)();assert.equal(mesh.material.uniforms.uCutoutDestruction.value.x,1);
    material.uniforms.uRealityOpacity.value=0;(mesh.onBeforeRender as ()=>void)();assert.equal(mesh.material.uniforms.uOpacity.value,0);material.uniforms.uRealityOpacity.value=1;
    material.uniforms.uGlobalOpacity.value=0;(mesh.onBeforeRender as ()=>void)();assert.equal(mesh.material.uniforms.uOpacity.value,0);material.uniforms.uGlobalOpacity.value=1;
    cut.visible=false;(mesh.onBeforeRender as ()=>void)();assert.equal(mesh.material.uniforms.uOpacity.value,0);cut.visible=true;
    h.open=false;mist.update();assert.equal(mist.root.visible,false);h.open=true;
    allowed=false;mist.update();assert.equal(mist.root.visible,false);allowed=true;
    mist.setVisible(false);assert.equal(mist.root.visible,false);mist.setVisible(true);assert.equal(mist.root.visible,true);
    assert.equal(mist.setDensity(.35),true);assert.equal(mist.setDensity(NaN),false);assert.equal(mist.setDensity(1),false);
    assert.equal(mesh.geometry,geometry);assert.equal(mist.snapshot().volumes.length,1);
    let disposed=0;geometry.addEventListener('dispose',()=>disposed++);mist.dispose();mist.dispose();assert.equal(disposed,1);
    assert.equal(signal?.aborted,true);assert.equal(mist.root.parent,null);mist.update();assert.equal(mist.snapshot().visible,false);
  }finally{mist.dispose();globalThis.fetch=originalFetch;material.dispose();}
});

test('disabled or corrupt mist does not render or block the source scene',async()=>{
  const scan=new Group() as unknown as DropInViewer,scene=new Scene();
  const options={scene,scanRoot:scan,getHole:()=>hole(false),getSecondBoxRoute:()=>null,canRender:()=>true};
  const disabled=createRoomMist({...options,enabled:false});await disabled.initialize();assert.equal(disabled.snapshot().phase,'off');disabled.dispose();
  const old=globalThis.fetch;globalThis.fetch=(async()=>new Response('missing',{status:404})) as typeof fetch;
  const failed=createRoomMist(options);
  try{await failed.initialize();assert.equal(failed.snapshot().phase,'error');assert.equal(failed.snapshot().visible,false);assert.equal(scan.visible,true);}
  finally{failed.dispose();globalThis.fetch=old;}
});
