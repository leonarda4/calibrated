import assert from 'node:assert/strict';
import path from 'node:path';

async function frame(page) {
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Collapse evidence missed its native frame.')),2000);
    requestAnimationFrame(()=>{clearTimeout(timer);resolve();});
  }));
}

async function moveHead(page,point,target) {
  await page.evaluate(async({point,target})=>{
    const {THREE}=window.__collapseCheck,{camera,controls}=window.__debug;
    const from=camera.position.clone(),to=new THREE.Vector3(...point),steps=Math.max(1,Math.ceil(from.distanceTo(to)/.06));
    if(steps>200)throw Error('Unbounded collapse test path.');
    for(let i=1;i<=steps;i++) {
      camera.position.copy(from).lerp(to,i/steps);controls.target.fromArray(target);controls.update();
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Collapse physical step stalled.')),2000);
        requestAnimationFrame(()=>{clearTimeout(timer);resolve();});});
    }
  },{point,target});
}

async function resume(page,stopAt) {
  await frame(page);
  await page.evaluate(stopAt=>{const s=window.__collapseCheck;s.stopAt=stopAt??null;s.paused=false;},stopAt);
}

async function capture(page,output,name) {
  await page.evaluate(async()=>{window.__collapseCheck.paused=true;await window.__collapseCheck.settleView();});
  await page.screenshot({path:path.join(output,name),fullPage:true,timeout:60000});
}

async function nativeBlastPixels(page,baseline) {
  return page.evaluate(async baseline=>{
    const s=window.__collapseCheck,{renderer,scene,camera}=window.__debug;
    await s.settleView();renderer.render(scene,camera);
    const gl=renderer.getContext(),bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
    gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    let changedPixels=0,maxDifference=0;
    if(baseline)s.nativeBlastPixels=bytes;
    else for(let i=0;i<bytes.length;i+=4){
      let difference=0;for(let c=0;c<3;c++){const d=Math.abs(bytes[i+c]-s.nativeBlastPixels[i+c]);difference+=d;maxDifference=Math.max(maxDifference,d);}
      if(difference>6)changedPixels++;
    }
    return {changedPixels,maxDifference,mask:window.__debug.hallwayCollapse.snapshot().mask};
  },baseline);
}

/** Actual scene5 pixels, with fog and fragments separately controlled for attribution. */
async function pixels(page,{baseline=false,blast=false}={}) {
  return page.evaluate(async({baseline,blast})=>{
    const s=window.__collapseCheck,{THREE}=s;
    const {renderer,scene,camera,controls,splats,hallwayCollapse,hallwayCollapseEffects,hallwayFog}=window.__debug;
    s.paused=true;
    const objects=Array.from({length:6},(_,i)=>splats.getSplatScene(i));
    const visible=objects.map(o=>o.visible),fog=hallwayFog.snapshot().visible,fx=hallwayCollapseEffects.root.visible,fxState=hallwayCollapseEffects.snapshot();
    const oldTarget=controls.target.clone(),gl=renderer.getContext(),width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
    const read=()=>{splats.viewer.update(renderer,camera);renderer.render(scene,camera);const data=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;};
    const changed=(a,b,threshold=12)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>threshold)n++;return n;};
    const sort=()=>s.settleView();
    const sample=(data,point)=>{
      const p=new THREE.Vector3(...point).project(camera),x=Math.round((p.x+1)*width/2),y=Math.round((p.y+1)*height/2);
      if(p.z< -1||p.z>1||x<2||x>=width-2||y<2||y>=height-2)return null;
      let best=null;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const at=((y+dy)*width+x+dx)*4,rgb=[...data.slice(at,at+4)];
        // Keep visible scan detail when an edge shares this small probe with
        // the white void; a gap must be white throughout the neighbourhood.
        if(!best||rgb[0]+rgb[1]+rgb[2]<best[0]+best[1]+best[2])best=rgb;
      }
      return best;
    };
    try {
      controls.target.fromArray(s.positions.forwardTarget);controls.update();await sort();
      let fracturePixels=0;
      if(blast){hallwayFog.setVisible(true);hallwayCollapseEffects.root.visible=true;const on=read();hallwayCollapseEffects.root.visible=false;fracturePixels=changed(on,read(),6);}
      hallwayFog.setVisible(false);hallwayCollapseEffects.root.visible=false;
      objects.forEach((o,i)=>{o.visible=i===5;});
      const crop=read(),near=s.probes.near.map(p=>sample(crop,p)),far=s.probes.far.map(p=>sample(crop,p));
      const damageControl=splats.viewer.splatMesh.material.uniforms.uCutoutDestruction.value,damageEnabled=damageControl.x;
      damageControl.x=0;const intact=read();damageControl.x=damageEnabled;
      const state=hallwayCollapse.snapshot();
      const grid=s.probes.grid.map(probe=>{
        const before=sample(intact,probe.world),after=sample(crop,probe.world);
        const delta=before&&after?before.slice(0,3).reduce((sum,v,c)=>sum+Math.abs(v-after[c]),0):null;
        return {opening:probe.opening,before,after,delta};
      });
      const damagePixels=changed(crop,intact,20);
      let damagePixelsLow=0,maxDamageDifference=0;
      const patchBounds=(state.patches??[]).filter(p=>p.active&&p.fadeProgress>0).map(patch=>{
        const projected=[];
        for(const x of [-2,2])for(const y of [-2,2])for(const z of [-2,2])projected.push(new THREE.Vector3(...s.mapOpeningPoint(
          patch.centerOpening[0]+x*patch.radiusAcross,patch.centerOpening[1]+y*patch.radiusUp,patch.centerOpening[2]+z*patch.radiusDepth)).project(camera));
        return [Math.min(...projected.map(p=>(p.x+1)*width/2)),Math.min(...projected.map(p=>(p.y+1)*height/2)),
          Math.max(...projected.map(p=>(p.x+1)*width/2)),Math.max(...projected.map(p=>(p.y+1)*height/2))];
      });
      const localPixelControl={inside:0,outside:0,outsideStrong:0,outsidePeak:0,bounds:patchBounds};
      for(let i=0;i<crop.length;i+=4){let delta=0,peak=0;for(let c=0;c<3;c++){
        const difference=Math.abs(crop[i+c]-intact[i+c]);delta+=difference;maxDamageDifference=Math.max(maxDamageDifference,difference);
        peak=Math.max(peak,difference);
      }if(delta>1){damagePixelsLow++;const x=(i/4)%width,y=Math.floor(i/4/width);
        if(patchBounds.some(b=>x>=b[0]-5&&x<=b[2]+5&&y>=b[1]-5&&y<=b[3]+5))localPixelControl.inside++;
        else {localPixelControl.outside++;localPixelControl.outsidePeak=Math.max(localPixelControl.outsidePeak,peak);if(delta>6)localPixelControl.outsideStrong++;}
      }}
      let matureControl=null;
      if(state.patches?.filter(p=>p.fadeProgress>0).length===1){
        const shapes=splats.viewer.splatMesh.material.uniforms.uCollapsePatchShapes.value,count=splats.viewer.splatMesh.material.uniforms.uCollapsePatchCount.value;
        const progress=shapes.map(v=>v.z);
        try {
          for(let i=0;i<count;i++)shapes[i].z=1;
          const mature=read();let peak=0;
          for(let i=0;i<mature.length;i+=4)for(let c=0;c<3;c++)peak=Math.max(peak,Math.abs(mature[i+c]-intact[i+c]));
          let inside=0,outsideStrong=0;
          for(let i=0;i<mature.length;i+=4){
            const delta=Math.abs(mature[i]-intact[i])+Math.abs(mature[i+1]-intact[i+1])+Math.abs(mature[i+2]-intact[i+2]);
            if(delta<=20)continue;
            const x=(i/4)%width,y=Math.floor(i/4/width);
            if(patchBounds.some(b=>x>=b[0]-5&&x<=b[2]+5&&y>=b[1]-5&&y<=b[3]+5))inside++;else outsideStrong++;
          }
          matureControl={changed:changed(mature,intact,20),peak,inside,outsideStrong};
        } finally {shapes.forEach((v,i)=>{v.z=progress[i];});}
      }
      const scanPixel=rgb=>rgb&&rgb[3]===255&&rgb[0]+rgb[1]+rgb[2]>35&&765-rgb[0]-rgb[1]-rgb[2]>20;
      const whiteGap=rgb=>rgb&&rgb[3]===255&&765-rgb[0]-rgb[1]-rgb[2]<=6;
      const usable=grid.filter(p=>scanPixel(p.before)&&p.after);
      const rows=[...new Set(grid.map(p=>p.opening[2]))].map(depth=>{
        const points=usable.filter(p=>p.opening[2]===depth);
        return {depth,lit:points.length,changed:points.filter(p=>p.delta>20).length,
          missing:points.filter(p=>whiteGap(p.after)).length,surviving:points.filter(p=>p.delta<=6).length};
      });
      const activePatches=(state.patches??[]).filter(p=>p.fadeProgress>0);
      const local=(p)=>activePatches.some(patch=>{
        const d=p.opening.map((v,i)=>(v-patch.centerOpening[i])/[patch.radiusAcross,patch.radiusUp,patch.radiusDepth][i]);
        return d.reduce((sum,v)=>sum+v*v,0)<=4;
      });
      const gridSummary={lit:usable.length,changed:usable.filter(p=>p.delta>20).length,
        missing:usable.filter(p=>whiteGap(p.after)).length,surviving:usable.filter(p=>p.delta<=6).length,
        localChanges:usable.filter(p=>p.delta>20&&local(p)).length,distantChanges:usable.filter(p=>p.delta>20&&!local(p)).length,rows,
        changedExamples:usable.filter(p=>p.delta>20).slice(0,10),survivingExamples:usable.filter(p=>p.delta<=6).slice(0,10)};
      const patchProbes=(state.patches??[]).map(patch=>{
        const surface=[Math.sign(patch.centerOpening[0])*s.source.width/2,patch.centerOpening[1],patch.centerOpening[2]];
        const world=s.mapOpeningPoint(...surface),before=sample(intact,world),after=sample(crop,world);
        return {id:patch.id,opening:surface,age:patch.age,progress:patch.fadeProgress,before,after};
      });
      hallwayFog.setVisible(true);const foggy=read(),farWithFog=s.probes.far.map(p=>sample(foggy,p));hallwayFog.setVisible(false);
      const visibleWhiteGaps=s.probes.grid.filter(probe=>{
        const before=sample(intact,probe.world),after=sample(foggy,probe.world);
        return scanPixel(before)&&whiteGap(after);
      }).length;
      objects.forEach((o,i)=>{o.visible=i===0;});
      controls.target.fromArray(s.positions.outwardTarget);controls.update();await sort();
      // Native presentation continues while awaiting the sorter; restore the
      // evidence-only visibility immediately before this synchronous readback.
      objects.forEach((o,i)=>{o.visible=i===0;});hallwayFog.setVisible(false);hallwayCollapseEffects.root.visible=false;
      const original=read();
      let originalLit=0;for(let i=0;i<original.length;i+=4){const sum=original[i]+original[i+1]+original[i+2];if(sum>30&&765-sum>20)originalLit++;}
      const originalChanged=baseline?0:changed(original,s.originalPixels,0);
      let originalMaxDifference=0;
      if(!baseline)for(let i=0;i<original.length;i+=4)for(let c=0;c<3;c++)originalMaxDifference=Math.max(originalMaxDifference,Math.abs(original[i+c]-s.originalPixels[i+c]));
      const mask=splats.viewer.splatMesh.material.uniforms.uCutoutDestruction.value,active=mask.x;mask.x=0;
      const originalMaskChanged=changed(original,read(),0);mask.x=active;
      const originalVisibility=splats.viewer.splatMesh.material.uniforms.sceneVisibility.value.slice(0,6);
      const originalCamera=camera.matrixWorld.toArray();
      if(baseline){s.originalPixels=original;s.baseline={near,far};}
      const uniform=splats.viewer.splatMesh.material.uniforms.uCutoutDestruction.value.toArray();
      const fogUniforms=hallwayFog.root.children.find(o=>o.material?.uniforms?.uCutoutDestruction)?.material.uniforms;
      const fogUniform=fogUniforms?.uCutoutDestruction.value.toArray();
      const patchUniforms=uniforms=>({count:uniforms?.uCollapsePatchCount?.value??0,residual:uniforms?.uCollapseResidual?.value??0,
        centers:uniforms?.uCollapsePatchCenters?.value.map(v=>v.toArray())??[],shapes:uniforms?.uCollapsePatchShapes?.value.map(v=>v.toArray())??[]});
      const packedPatches=patchUniforms(splats.viewer.splatMesh.material.uniforms),fogPatches=patchUniforms(fogUniforms);
      return {near,far,farWithFog,grid:gridSummary,visibleWhiteGaps,damagePixels,damagePixelsLow,maxDamageDifference,localPixelControl,matureControl,patchProbes,fracturePixels,originalLit,originalChanged,originalMaxDifference,originalMaskChanged,originalVisibility,originalCamera,uniform,fogUniform,
        packedPatches,fogPatches,collapse:hallwayCollapse.snapshot(),fx:fxState};
    } finally {
      objects.forEach((o,i)=>{o.visible=visible[i];});hallwayFog.setVisible(fog);hallwayCollapseEffects.root.visible=fx;
      controls.target.copy(oldTarget);controls.update();await sort();renderer.render(scene,camera);
    }
  },{baseline,blast});
}

const lit=rgb=>rgb&&rgb[3]===255&&rgb[0]+rgb[1]+rgb[2]>35&&765-rgb[0]-rgb[1]-rgb[2]>20;
const nearEqual=(a,b,label)=>assert.deepEqual(a,b,label);

/** Native broom completion, supplied overlapping fractures, shader erosion and a usable return portal. */
export async function runHallwayCollapseScenario(page,output,{privateAsset=false,beforeReturn,onReturning,onReturned}={}) {
  const prefix=privateAsset?'private-':'';
  await page.waitForFunction(()=>window.__debug.hallwayCollapseEffects&&window.__debug.hallwayCollapseEffects.snapshot().phase!=='loading',undefined,{timeout:45000});
  const saved=await page.evaluate(async()=>{
    const d=window.__debug,{camera,controls,splats,broomEncounter,holeWorldRotation,hallwayCollapse,hallwayCollapseEffects,hallwayFog,renderer,scene,realityEnding}=d;
    const mesh=splats.viewer.splatMesh;
    const s={THREE:await import('/node_modules/.vite/deps/three.js'),camera:camera.position.toArray(),target:controls.target.toArray(),
      damping:controls.enableDamping,fog:hallwayFog.snapshot().visible,paused:false,stopAt:.6,arms:0,armStates:[],events:[],
      broomUpdate:broomEncounter.update,turnUpdate:holeWorldRotation.update,fogUpdate:hallwayFog.update,
      endingUpdate:realityEnding?.update,endingEvents:[],holdFallback:true,collapseSpeed:8,
      collapseUpdate:hallwayCollapse.update,collapseArm:hallwayCollapse.arm,
      lifecycle:{sessionEnds:0,contextLosses:0},
      resources:{geometry:mesh.geometry,material:mesh.material,textures:mesh.splatDataTextures,worker:splats.viewer.sortWorker},
      fxResources:[],tracked:['getController','getControllerGrip','getHand'].flatMap(method=>[0,1].map(i=>{
        const object=renderer.xr[method](i);object.updateWorldMatrix(true,false);return {object,parent:object.parent,matrix:object.matrixWorld.clone()};
      }))};
    hallwayCollapseEffects.root.traverse(o=>{if(o.geometry)s.fxResources.push({object:o,geometry:o.geometry,material:o.material});});
    s.onSessionEnd=()=>s.lifecycle.sessionEnds++;s.onContextLost=()=>s.lifecycle.contextLosses++;
    renderer.xr.addEventListener('sessionend',s.onSessionEnd);renderer.domElement.addEventListener('webglcontextlost',s.onContextLost);
    window.__collapseCheck=s;controls.enableDamping=false;hallwayFog.setVisible(true);
    s.settleView=async()=>{
      const viewer=splats.viewer,originalSort=viewer.runSplatSort;
      const nativeFrame=()=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Collapse evidence sort missed its native frame.')),2000);
        requestAnimationFrame(()=>{clearTimeout(timer);resolve();});
      });
      for(let i=0;i<3;i++)await nativeFrame();
      // The pinned sorter returns early while busy, including before its GPU
      // pass replaces sortPromise. Drain that work with automatic requests gated.
      const gatedSort=()=>Promise.resolve(false);viewer.runSplatSort=gatedSort;
      try {
        const deadline=performance.now()+45000;
        while(viewer.sortRunning){if(performance.now()>deadline)throw Error('Collapse evidence sort did not drain.');await nativeFrame();}
        camera.updateMatrixWorld(true);scene.updateMatrixWorld(true);viewer.update(renderer,camera);viewer.splatMesh.updateTransforms();
        await originalSort.call(viewer,true,true);await viewer.sortPromise;
        while(viewer.sortRunning){if(performance.now()>deadline)throw Error('Collapse evidence current-view sort did not finish.');await nativeFrame();}
        viewer.update(renderer,camera);renderer.render(scene,camera);
      } finally {if(viewer.runSplatSort===gatedSort)viewer.runSplatSort=originalSort;}
    };
    broomEncounter.update=function(dt,...args){const before=this.snapshot().phase;s.broomUpdate.call(this,s.paused?0:dt,...args);
      const after=this.snapshot().phase;if(after!==before)s.events.push({before,after});};
    holeWorldRotation.update=function(dt,...args){return s.turnUpdate.call(this,s.paused?0:dt,...args);};
    hallwayFog.update=function(dt,...args){return s.fogUpdate.call(this,s.paused?0:dt,...args);};
    if(realityEnding)realityEnding.update=function(sample){
      const before=this.snapshot();let dt=s.paused?0:sample.dt;
      // Geometry probes accelerate collapse and hold story time independently.
      // Dedicated fallback branches below release this hold at normal frame speed.
      if(s.holdFallback&&!before.returnedCount&&before.trigger===null)dt=0;
      const endingClock=state=>s.fallbackClock
        ? state.trigger==='timeout'?5+state.dimensionSeconds:state.trigger==='boundary'?state.dimensionSeconds:state.afterExplosionsSeconds??0
        : state.dimensionSeconds;
      if((before.returnedCount>0||s.fallbackClock)&&s.endingStopAt!==undefined&&dt>0&&dt<=.5)dt=Math.max(0,Math.min(dt,s.endingStopAt-endingClock(before)));
      s.endingUpdate.call(this,{...sample,dt});
      const after=this.snapshot();
      if(before.phase!==after.phase)s.endingEvents.push({phase:after.phase,seconds:after.dimensionSeconds});
      if(before.returnedCount===0&&after.returnedCount===1)s.endingEndpoint={state:after,camera:camera.matrixWorld.toArray()};
      if((after.returnedCount>0||s.fallbackClock)&&s.endingStopAt!==undefined&&endingClock(after)>=s.endingStopAt-1e-8)s.paused=true;
    };
    hallwayCollapse.arm=function(...args){args[5]={...args[5],seed:1407};const phase=broomEncounter.snapshot().phase,ok=s.collapseArm.apply(this,args);
      if(ok){s.arms++;s.armStates.push({broom:phase,lastEvent:s.events.at(-1)});}return ok;};
    hallwayCollapse.update=function(sample){
      let dt=s.paused?0:sample.dt;
      if(!s.paused&&dt>0&&dt<=.5&&sample.eligible&&sample.upright&&this.snapshot().active){
        dt=Math.min(.25,dt*s.collapseSpeed);
        if(s.stopAt!==null)dt=Math.max(0,Math.min(dt,s.stopAt-this.snapshot().elapsedSeconds));
      }
      s.collapseUpdate.call(this,{...sample,dt});
      if(s.stopAt!==null&&this.snapshot().active&&this.snapshot().elapsedSeconds>=s.stopAt-1e-8)s.paused=true;
    };
    return {camera:s.camera,target:s.target,damping:s.damping,fog:s.fog,fx:hallwayCollapseEffects.snapshot()};
  });
  try {
    assert.equal(saved.fx.phase,'ready',saved.fx.error??'Local fracture assets must preload.');
    assert.ok(saved.fx.pieces>0&&saved.fx.poolSize===5&&saved.fx.geometryCount>0);
    assert.match(saved.fx.sourceSha256,/^[a-f\d]{64}$/i,'Fragments retain the supplied animation provenance.');
    await page.locator('#experience-reset').click();
    await page.locator('#experience-show-broom').click();
    await page.locator('#experience-show-broom').click();
    assert.equal(await page.evaluate(()=>window.__collapseCheck.arms),0,'Manual broom visibility cannot start destruction.');
    await page.locator('#experience-reset').click();
    await page.locator('#experience-floor-hole').click();
    await page.evaluate(()=>{
      const {THREE}=window.__collapseCheck,{floorHole,hallwayCut,camera,controls}=window.__debug,hole=floorHole.snapshot();
      const route=new THREE.Matrix4().fromArray(hole.routeToWorld),x=(hole.nearBounds[0]+hole.nearBounds[1]+hole.farBounds[0]+hole.farBounds[1])/4;
      const p=new THREE.Vector3(x,hole.floorY+1.65,(hole.startZ+hole.endZ)/2).applyMatrix4(route);
      const forward=new THREE.Vector3(0,0,hallwayCut.snapshot().floorSide==='end'?-1:1).transformDirection(route);
      camera.position.copy(p);controls.target.copy(p).add(forward);controls.update();
    });
    await page.waitForFunction(()=>window.__debug.broomEncounter.snapshot().phase==='waitingReveal',undefined,{timeout:14000});
    const positions=await page.evaluate(async()=>{
      const s=window.__collapseCheck,{THREE}=s,{broomEncounter,floorHole,hallwayCut,holeWorldRotation,splats,hallwayCollapseEffects}=window.__debug;
      const broom=broomEncounter.snapshot(),pose=new THREE.Matrix4().fromArray(broom.uprightMatrix);
      const base=new THREE.Vector3().setFromMatrixPosition(pose),forward=new THREE.Vector3(0,0,1).transformDirection(pose);
      const entrance=new THREE.Vector3(...broom.entranceWorld),up=new THREE.Vector3(0,1,0);
      const {cutOpeningFromMetadata,cutoutPlacement}=await import('/src/viewer/hallwayCutPlacement.ts');
      const hole={...floorHole.snapshot(),floorSide:hallwayCut.snapshot().floorSide},source=cutOpeningFromMetadata(splats.userData.hallwayCutMetadata);
      s.geometry=hole;s.source=source;
      const middle=(bounds)=> (bounds[0]+bounds[1])/2;
      const guide=[middle(hole.floorSide==='end'?hole.farBounds:hole.nearBounds),hole.floorY,hole.floorSide==='end'?hole.endZ:hole.startZ];
      const placement=cutoutPlacement(source,hole,guide),world=holeWorldRotation.matrix();
      const point=(x,y,z)=>placement.map(new THREE.Vector3(x,y,z)).applyMatrix4(placement.routeToWorld).applyMatrix4(world).toArray();
      s.mapOpeningPoint=point;
      const far=hallwayCollapseEffects.snapshot().farDepth;
      s.probes={near:[2.7,4,5].flatMap(z=>[-.2,.2].map(x=>point(x*source.width,0,z))),
        far:[7.5,far*.75,far-1].filter(z=>z>6.9&&z<far-.25).flatMap(z=>[-.2,.2].map(x=>point(x*source.width,0,z))),grid:[]};
      for(let index=0;index<22;index++){
        const z=6.7+(far-.4-6.7)*index/21;
        for(const side of [-1,1])for(const height of [.25,.55,.9,1.2,1.6,2,2.35]){
          const opening=[side*source.width/2,height,z];s.probes.grid.push({opening,world:point(...opening)});
        }
        for(const height of [0,source.height])for(const across of [-.3,0,.3]){
          const opening=[across*source.width,height,z];s.probes.grid.push({opening,world:point(...opening)});
        }
      }
      s.positions={near:base.clone().addScaledVector(up,1.65).toArray(),view:base.clone().addScaledVector(forward,-1.4).addScaledVector(up,1.65).toArray(),
        target:base.clone().addScaledVector(up,.73).toArray(),outside:entrance.clone().addScaledVector(forward,-.25).addScaledVector(up,1.65).toArray(),
        forwardTarget:entrance.clone().addScaledVector(forward,6.5).addScaledVector(up,.4).toArray(),
        outwardTarget:entrance.clone().addScaledVector(forward,-3).addScaledVector(up,1.65).toArray()};
      return s.positions;
    });
    await moveHead(page,positions.view,positions.forwardTarget);
    await page.waitForFunction(()=>window.__debug.broomEncounter.snapshot().phase==='visible',undefined,{timeout:6000});
    await capture(page,output,`${prefix}hallway-collapse-before.png`);
    const before=await pixels(page,{baseline:true});
    assert.equal(before.collapse.phase,'idle');assert.equal(before.uniform[0],0);
    assert.ok(before.originalLit>25,'The original corridor comparison must contain visible scan pixels.');
    assert.ok(before.near.filter(lit).length>=3,`Protected floor needs rendered baseline pixels: ${JSON.stringify(before.near)}`);
    assert.ok(before.far.filter(lit).length>=2,`Distant crop needs rendered baseline pixels: ${JSON.stringify(before.far)}`);
    await resume(page,.6);
    await moveHead(page,positions.near,positions.target);
    await page.waitForFunction(()=>window.__debug.broomEncounter.snapshot().phase==='waitingExit',undefined,{timeout:3000});
    await moveHead(page,positions.view,positions.forwardTarget);
    await page.waitForFunction(()=>window.__debug.hallwayCollapse.snapshot().elapsedSeconds>=.6-1e-8,undefined,{timeout:7000});
    await capture(page,output,`${prefix}hallway-collapse-first-patch.png`);
    const first=await pixels(page);
    assert.equal(first.collapse.blasts.length,10);assert.equal(new Set(first.collapse.blasts.map(b=>b.id)).size,10);
    assert.equal(first.collapse.blasts.filter(b=>b.side===-1).length,5);assert.equal(first.collapse.blasts.filter(b=>b.side===1).length,5);
    first.collapse.blasts.slice(1).forEach((blast,index)=>{
      assert.ok(blast.depth<first.collapse.blasts[index].depth,'Each successive blast advances toward the protected approach.');
      assert.ok(blast.start>first.collapse.blasts[index].start);
    });
    const gaps=first.collapse.blasts.slice(1).map((b,i)=>b.start-first.collapse.blasts[i].start);
    assert.ok(Math.max(...gaps)-Math.min(...gaps)>.05,'Blast timing varies.');
    assert.ok(Math.max(...first.collapse.blasts.map(b=>b.height))-Math.min(...first.collapse.blasts.map(b=>b.height))>.3,'Blast heights vary.');
    assert.equal(first.collapse.patches.filter(p=>p.fadeProgress>0).length,1,'The first local patch starts with its own blast.');
    // A far, densely overlapping patch can initially be subpixel. Its matured
    // single-site control must still remove real pixels only around that site.
    assert.ok(first.matureControl?.changed>0&&first.matureControl.inside>0,'The first local patch removes actual pixels as it matures.');
    assert.equal(first.matureControl.outsideStrong,0,'The matured single-site control cannot affect an unfired region.');
    assert.equal(first.localPixelControl.outsideStrong,0,`First-blast fading stays inside its local projected region, allowing two-level rounding: ${JSON.stringify(first.localPixelControl)}`);
    assert.equal(first.grid.distantChanges,0,`Unfired, distant regions remain intact after the first blast: ${JSON.stringify(first.grid)}`);
    nearEqual(first.near,before.near,'The first local fracture preserves the nearby crop.');
    assert.equal(first.originalMaskChanged,0);
    const overlapAt=first.collapse.blasts[1].start+.25,midpointAt=first.collapse.blasts[5].start+.5;
    const duration=first.collapse.durationSeconds;
    assert.ok(Number.isFinite(duration)&&duration>midpointAt);
    await resume(page,overlapAt);
    await page.waitForFunction(t=>window.__debug.hallwayCollapse.snapshot().elapsedSeconds>=t-1e-8,overlapAt,{timeout:7000});
    // Capture the native view before any probe changes visibility or looks back.
    await capture(page,output,`${prefix}hallway-collapse-blasts.png`);
    const nativeBlasts=await nativeBlastPixels(page,true);
    const blasts=await pixels(page,{blast:true});
    const restoredBlasts=await nativeBlastPixels(page,false);
    assert.equal(restoredBlasts.changedPixels,0,`Probe collection must restore the native forward frame: ${JSON.stringify(restoredBlasts)}`);
    await capture(page,output,`${prefix}hallway-collapse-blasts-restored.png`);
    assert.equal(blasts.collapse.mask.active,true,'Each active blast develops its own persistent damage.');
    assert.ok(blasts.collapse.blasts.filter(b=>b.active).length>=2,'Supplied fracture instances overlap.');
    assert.ok(blasts.fx.activeActors>=2&&blasts.fracturePixels>0,`Active fragments must change real pixels: ${JSON.stringify({fx:blasts.fx,pixels:blasts.fracturePixels})}`);
    assert.ok(blasts.collapse.blasts.filter(b=>b.active).every(b=>b.depth-b.radius>blasts.collapse.protectedDepth));
    nearEqual(blasts.near,before.near,'The first explosions preserve the nearby crop.');
    assert.equal(blasts.originalMaskChanged,0);
    await resume(page,midpointAt);
    await page.waitForFunction(t=>window.__debug.hallwayCollapse.snapshot().elapsedSeconds>=t-1e-8,midpointAt,{timeout:7000});
    await capture(page,output,`${prefix}hallway-collapse-mid.png`);
    const middle=await pixels(page);
    assert.ok(middle.collapse.progress>0&&middle.collapse.progress<1);assert.equal(middle.uniform[0],1);
    assert.deepEqual(middle.fogUniform,middle.uniform,'Fog and splats share the local damage controls.');
    assert.deepEqual(middle.fogPatches,middle.packedPatches,'Fog and splats share every local patch.');
    nearEqual(middle.near,before.near,'The protected approach remains unchanged during erosion.');
    assert.ok(middle.grid.changed>0&&middle.grid.surviving>0,`Intermediate damage removes local regions while leaving other regions intact: ${JSON.stringify(middle.grid)}`);
    assert.ok(middle.grid.rows.some(row=>row.changed>0&&row.surviving>0),'At an equal depth, some surfaces change and others survive.');
    assert.equal(middle.originalMaskChanged,0,'Enabling erosion cannot change any original-corridor pixel in the same frame.');
    const patchMatureAt=first.collapse.patchMatureSeconds;
    await resume(page,patchMatureAt);
    await page.waitForFunction(t=>window.__debug.hallwayCollapse.snapshot().elapsedSeconds>=t-1e-8,patchMatureAt,{timeout:9000});
    await capture(page,output,`${prefix}hallway-collapse-islands.png`);
    const islands=await pixels(page);
    assert.ok(islands.collapse.residualProgress<1e-8);
    assert.ok(islands.grid.rows.filter(row=>row.missing>0&&row.surviving>0).length>=3,'Initial organic cavities retain irregular islands.');
    await resume(page,patchMatureAt+4);
    await page.waitForFunction(t=>window.__debug.hallwayCollapse.snapshot().elapsedSeconds>=t-1e-8,patchMatureAt+4,{timeout:9000});
    await capture(page,output,`${prefix}hallway-collapse-islands-fading.png`);
    const fading=await pixels(page);
    assert.ok(Math.abs(fading.collapse.residualProgress-.5)<1e-7);
    nearEqual(fading.near,before.near,'Slow clearing retains the complete nearby return route.');
    assert.equal(fading.originalMaskChanged,0);
    await resume(page,duration);
    await page.waitForFunction(()=>window.__debug.hallwayCollapse.snapshot().phase==='complete',undefined,{timeout:7000});
    await capture(page,output,`${prefix}hallway-collapse-black.png`);
    const final=await pixels(page);
    nearEqual(final.near,before.near,'The full near return corridor survives.');assert.equal(final.originalMaskChanged,0);
    assert.equal(final.collapse.patches.length,10);assert.ok(final.collapse.patches.every(p=>p.fadeProgress===1));
    assert.equal(final.packedPatches.count,10);assert.deepEqual(final.fogPatches,final.packedPatches);
    assert.ok(final.grid.missing>0,'Mature local damage leaves actual white gaps.');
    assert.ok(final.visibleWhiteGaps>0,'Organic gaps remain opaque white with actual fog enabled.');
    assert.ok(Math.abs(final.collapse.residualProgress-1)<1e-9,'Residual clearing reaches completion within floating-point precision.');
    assert.ok(final.grid.missing>islands.grid.missing,'The initial islands keep dissolving after the explosions.');
    assert.ok(final.grid.surviving<islands.grid.surviving,'Far fewer residual surfaces survive the slow clearing.');
    assert.ok(fading.grid.missing>=islands.grid.missing&&fading.grid.missing<=final.grid.missing,'Missing regions grow gradually through the residual stage.');
    const farRows=final.grid.rows.filter(row=>row.depth>final.collapse.protectedDepth+4.5);
    assert.ok(farRows.some(row=>row.missing>0&&row.surviving===0),'A distant row fully clears rather than freezing its splat islands.');
    assert.equal(final.fx.activeActors,0);assert.equal(final.collapse.protectedDepth,6);
    const result=await page.evaluate(()=>{
      const s=window.__collapseCheck,{splats,hallwayCollapseEffects,broom,broomEncounter,holeWorldRotation}=window.__debug,mesh=splats.viewer.splatMesh;
      return {arms:s.arms,armStates:s.armStates,broom:broom.snapshot(),encounter:broomEncounter.snapshot(),turn:holeWorldRotation.snapshot(),rumble:window.__debug.fractureRumble.snapshot(),
        resourcesStable:mesh.geometry===s.resources.geometry&&mesh.material===s.resources.material&&mesh.splatDataTextures===s.resources.textures&&splats.viewer.sortWorker===s.resources.worker,
        fragmentResourcesStable:s.fxResources.every(r=>r.object.geometry===r.geometry&&r.object.material===r.material),
        world:holeWorldRotation.snapshot(),endingState:window.__debug.realityEnding.snapshot(),lifecycle:{...s.lifecycle},
        sceneCount:mesh.scenes.length,fx:hallwayCollapseEffects.snapshot(),trackedStable:s.tracked.every(t=>{
          t.object.updateWorldMatrix(true,false);return t.object.parent===t.parent&&t.object.matrixWorld.elements.every((v,j)=>Math.abs(v-t.matrix.elements[j])<1e-7);
        })};
    });
    assert.equal(result.arms,1);assert.equal(result.armStates[0].broom,'complete');
    assert.deepEqual(result.armStates[0].lastEvent,{before:'glitchingOut',after:'complete'});
    assert.equal(result.broom.visible,false);assert.equal(result.encounter.phase,'complete');
    assert.equal(result.resourcesStable,true);assert.equal(result.fragmentResourcesStable,true);assert.equal(result.trackedStable,true);assert.equal(result.sceneCount,6);
    assert.equal(result.rumble.requestedCount,10,'Each actual blast requests its rumble exactly once.');
    assert.equal(result.world.phase,'complete','Finishing explosions and island clearing cannot reset the rotated world.');
    assert.equal(result.endingState.phase,'armed','The visual fixture holds ending time while inspecting every collapse stage.');
    assert.deepEqual(result.lifecycle,{sessionEnds:0,contextLosses:0},'Collapse completion cannot emit a session end or lose the graphics context.');
    assert.equal(new Set(result.rumble.consumedIds).size,10);
    if(beforeReturn)await beforeReturn(page,{output,prefix,positions});
    await resume(page,null);
    await moveHead(page,positions.outside,positions.outwardTarget);
    const returnEye=await page.evaluate(()=>window.__debug.camera.matrixWorld.toArray());
    if(onReturning)await onReturning(page,{output,prefix,positions});
    await page.waitForFunction(()=>window.__debug.holeWorldRotation.snapshot().phase==='original',undefined,{timeout:10000});
    const returned=await page.evaluate(()=>({turn:window.__debug.holeWorldRotation.snapshot(),collapse:window.__debug.hallwayCollapse.snapshot(),
      camera:window.__debug.camera.matrixWorld.toArray(),arms:window.__collapseCheck.arms,fx:window.__debug.hallwayCollapseEffects.snapshot(),rumble:window.__debug.fractureRumble.snapshot()}));
    assert.deepEqual(returned.camera,returnEye,'The physical tracked viewpoint stays fixed during the return.');
    returned.turn.matrix.forEach((v,i)=>assert.ok(Math.abs(v-(i%5===0?1:0))<1e-7));
    assert.equal(returned.collapse.phase,'complete');assert.equal(returned.arms,1);assert.equal(returned.fx.activeActors,0);
    assert.equal(returned.rumble.requestedCount,10);assert.equal(returned.rumble.playing,false);
    await capture(page,output,`${prefix}hallway-collapse-return.png`);
    const ending=onReturned?await onReturned(page,{output,prefix,positions,returned}):undefined;
    await page.locator('#experience-floor-hole').click();
    await frame(page);
    const closed=await page.evaluate(()=>({collapse:window.__debug.hallwayCollapse.snapshot(),fx:window.__debug.hallwayCollapseEffects.snapshot(),
      mask:window.__debug.splats.viewer.splatMesh.material.uniforms.uCutoutDestruction.value.toArray(),
      patches:window.__debug.splats.viewer.splatMesh.material.uniforms.uCollapsePatchCount.value,
      endingActive:window.__debug.realityEnding?.snapshot().active??false,endingOpacity:window.__debug.realityEndingEffects?.snapshot().opacity??1}));
    assert.equal(closed.collapse.active,false);assert.equal(closed.fx.activeActors,0);assert.equal(closed.mask[0],0);
    assert.equal(closed.patches,0);
    assert.equal(closed.endingActive,false);assert.equal(closed.endingOpacity,1);
    const noRevival=await page.evaluate(()=>{
      const {hallwayCollapse,hallwayCollapseEffects,holeWorldRotation,camera}=window.__debug,s=window.__collapseCheck;
      for(let i=0;i<8;i++)s.collapseUpdate.call(hallwayCollapse,{dt:.25,eligible:true,upright:true,
        positionWorld:camera.position.toArray(),presentation:holeWorldRotation.matrix()});
      hallwayCollapseEffects.update(hallwayCollapse,true);return !hallwayCollapse.snapshot().active&&hallwayCollapseEffects.snapshot().activeActors===0;
    });
    assert.equal(noRevival,true,'Old bounded updates cannot revive a closed sequence.');
    const recovery=[];
    for(const action of ['STOP','reset','calibration']) {
      await page.evaluate(()=>{
        const s=window.__collapseCheck,{floorHole,holeWorldRotation,hallwayCollapse,camera}=window.__debug;
        document.getElementById('experience-reset').click();
        if(!floorHole.show()||!holeWorldRotation.start(s.geometry))throw Error('Collapse recovery setup needs an actual opening.');
        for(let i=0;i<8;i++)s.turnUpdate.call(holeWorldRotation,.5,true);
        camera.position.fromArray(s.positions.view);
        const before=hallwayCollapse.snapshot();
        if(!s.collapseArm.call(hallwayCollapse,s.geometry,holeWorldRotation.matrix(),s.source,savedFarDepth(),camera.position.toArray()))
          throw Error(`Fresh game did not rearm collapse: ${JSON.stringify({before,turn:holeWorldRotation.snapshot(),after:hallwayCollapse.snapshot()})}`);
        function savedFarDepth(){return window.__debug.hallwayCollapseEffects.snapshot().farDepth;}
        for(let i=0;i<10;i++)s.collapseUpdate.call(hallwayCollapse,{dt:.25,eligible:true,upright:true,
          positionWorld:camera.position.toArray(),presentation:holeWorldRotation.matrix()});
      });
      await frame(page);
      const active=await page.evaluate(()=>window.__debug.splats.viewer.splatMesh.material.uniforms.uCutoutDestruction.value.x);
      assert.equal(active,1,`${action} recovery must first have an active rendered erosion mask.`);
      await page.evaluate(action=>{
        if(action==='calibration'){window.__debug.experience.prepareForCalibration();window.__debug.experience.setCalibrationActive(false);}
        else document.getElementById(action==='STOP'?'experience-stop':'experience-reset').click();
      },action);
      await frame(page);
      const cleared=await page.evaluate(()=>({active:window.__debug.hallwayCollapse.snapshot().active,
        fx:window.__debug.hallwayCollapseEffects.snapshot().activeActors,mask:window.__debug.splats.viewer.splatMesh.material.uniforms.uCutoutDestruction.value.x,
        playing:window.__debug.fractureRumble.snapshot().playing,endingActive:window.__debug.realityEnding?.snapshot().active??false,
        endingOpacity:window.__debug.realityEndingEffects?.snapshot().opacity??1}));
      assert.deepEqual(cleared,{active:false,fx:0,mask:0,playing:false,endingActive:false,endingOpacity:1},`${action} cancels destruction, fragments, rumble and the ending.`);recovery.push(action);
    }
    return {nativeCompletion:true,before,first,blasts,nativeBlasts,restoredBlasts,middle,islands,fading,final,returned,closed,recovery,ending,...result,
      screenshots:['before','first-patch','blasts','blasts-restored','mid','islands','islands-fading','black','return'].map(stage=>`${prefix}hallway-collapse-${stage}.png`)};
  } finally {
    await page.evaluate(saved=>{
      const s=window.__collapseCheck,d=window.__debug;if(!s)return;
      d.renderer.xr.removeEventListener('sessionend',s.onSessionEnd);d.renderer.domElement.removeEventListener('webglcontextlost',s.onContextLost);
      d.broomEncounter.update=s.broomUpdate;d.holeWorldRotation.update=s.turnUpdate;d.hallwayFog.update=s.fogUpdate;
      if(s.endingUpdate)d.realityEnding.update=s.endingUpdate;
      d.hallwayCollapse.update=s.collapseUpdate;d.hallwayCollapse.arm=s.collapseArm;
      document.getElementById('experience-reset').click();d.hallwayFog.setVisible(saved.fog);
      d.camera.position.fromArray(saved.camera);d.controls.target.fromArray(saved.target);d.controls.enableDamping=saved.damping;d.controls.update();
      delete window.__collapseCheck;
    },saved);
  }
}
