import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runRoomMistScenario} from './roomMistScenario.mjs';

/** Actual baked fog in the added hallway; no movement-area approximation. */
export async function runVolumeFogScenario(page, output, {privateAsset=false}={}) {
  const result=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/.vite/deps/three.js');
    const {FOG}=await import('/src/effects/volumeFogConfig.ts');
    const {BROOM_ENCOUNTER}=await import('/src/experience/broomEncounter.ts');
    const {HoleWorldRotation}=await import('/src/experience/holeWorldRotation.ts');
    const {scene,renderer,camera,controls,splats,hallwayFog:fog,experience,floorHole,hallwayCut,worldPresentation,desktopBoundary}=window.__debug;
    const ensure=(ok,message)=>{if(!ok)throw Error(message);};
    ensure(fog.snapshot().phase==='ready','Fog failed to initialize: '+fog.snapshot().error);
    const saved={camera:camera.position.clone(),up:camera.up.clone(),target:controls.target.clone(),damping:controls.enableDamping,
      experienceUpdate:experience.update,fogUpdate:fog.update,boundarySnapshot:desktopBoundary.snapshot,
      mist:window.__debug.hallwayMist.snapshot().visibleRequested};
    window.__debug.hallwayMist.setVisible(false);
    const resources=[splats.viewer.splatMesh.geometry,splats.viewer.splatMesh.material,splats.viewer.sortWorker];
    const target=new THREE.WebGLRenderTarget(512,384),previousTarget=renderer.getRenderTarget(),images={};
    let presentation=new THREE.Matrix4();
    const updateFog=delta=>{
      // Only the synchronous fog update is forbidden from reading bounds.
      // Other native-frame effects may legitimately read them while a sort yields.
      const previous=desktopBoundary.snapshot;
      desktopBoundary.snapshot=()=>{throw Error('Fog must not read movement bounds');};
      try{return saved.fogUpdate(delta);}finally{desktopBoundary.snapshot=previous;}
    };
    experience.update=()=>{};fog.update=()=>updateFog(0);controls.enableDamping=false;
    const move=(from,to,up=new THREE.Vector3(0,1,0))=>{
      camera.up.copy(up);camera.position.copy(from);controls.target.copy(to);controls.update();camera.updateMatrixWorld(true);
    };
    const settle=async()=>{
      scene.updateMatrixWorld(true);splats.viewer.update(renderer,camera);await splats.viewer.sortPromise;
      splats.viewer.splatMesh.updateTransforms();await splats.viewer.runSplatSort(true,true);
    };
    const render=(visible,name)=>{
      // Sorting yields to native frames, which restore canonical coordinates.
      // Reapply this captured pose synchronously before each paired render.
      worldPresentation.beginFrame();hallwayCut.update();fog.setVisible(visible);
      worldPresentation.apply(presentation);scene.updateMatrixWorld(true);
      splats.viewer.splatMesh.updateTransforms();
      renderer.setRenderTarget(target);renderer.render(scene,camera);
      const bytes=new Uint8Array(512*384*4);renderer.readRenderTargetPixels(target,0,0,512,384,bytes);renderer.setRenderTarget(previousTarget);
      if(name){
        const canvas=document.createElement('canvas');canvas.width=512;canvas.height=384;
        const ctx=canvas.getContext('2d'),picture=ctx.createImageData(512,384);
        for(let y=0;y<384;y++)picture.data.set(bytes.subarray(y*512*4,(y+1)*512*4),(383-y)*512*4);
        ctx.putImageData(picture,0,0);images[name]=canvas.toDataURL('image/png').split(',')[1];
      }
      return bytes;
    };
    const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>6)n++;return n;};
    const energy=(a,b)=>{let n=0;for(let i=0;i<a.length;i++)if(i%4!==3)n+=b[i]-a[i];return n;};
    const probe=(a,b,p)=>{
      const q=p.clone().project(camera),x=Math.round((q.x+1)*256),y=Math.round((q.y+1)*192);
      ensure(x>1&&x<510&&y>1&&y<382,'Fog probe outside the viewport');
      let change=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(let c=0;c<3;c++){
        const i=((y+dy)*512+x+dx)*4+c;change=Math.max(change,Math.abs(a[i]-b[i]));
      }return change;
    };
    try{
      floorHole.close();updateFog(0);
      ensure(fog.snapshot().volumes.length===1,'Fog must have exactly one volume');
      for(const sign of [-1,1]){
        move(new THREE.Vector3(0,1.55,0),new THREE.Vector3(0,.35,sign*10));await settle();
        ensure(diff(render(false),render(true,'fog-main-clear-'+sign))===0,'Fog remains in an original hallway end');
      }
      ensure(floorHole.show(),'Could not open the added hallway');
      hallwayCut.update();updateFog(0);
      const volume=fog.root.children[0],canonical=volume.matrix.clone(),initial=fog.snapshot().volumes[0];
      const hallwayHeight=(await import('/src/viewer/hallwayCutPlacement.ts')).HALLWAY_CUT.openingHeight;
      ensure(fog.snapshot().height===hallwayHeight/2 && Math.abs(initial.max[1]-hallwayHeight/2)<1e-6,'Fog does not reach half the hallway height');
      ensure(initial.visible,'Fog must be present as soon as the corridor opens');
      ensure(initial.min[2]===5 && initial.max[2]===33,'Wrong fixed interval');
      const local=(x,y,z,matrix=volume.matrixWorld)=>new THREE.Vector3(x,y,z).applyMatrix4(matrix);
      const setView=(depth=-1)=>{
        scene.updateMatrixWorld(true);
        const up=new THREE.Vector3(0,1,0).transformDirection(volume.matrixWorld);
        move(local(0,1.35,depth),local(0,.1,depth+11),up);
      };
      setView();await settle();
      const off=render(false,'fog-downward-off'),on=render(true,'fog-downward-before-turn');
      const beforePixels=diff(off,on);ensure(beforePixels>50,'No fog before turning');
      const gapProbe=probe(off,on,local(0,.12,4.3)),wallProbe=probe(off,on,local(1.02,1,7));
      ensure(gapProbe===0,'Fog intrudes into the fixed gap after the broom');
      ensure(wallProbe===0,'Fog bleeds onto the passage wall');
      const material=splats.viewer.splatMesh.material,b=material.uniforms.uHallwayBrightness,o=material.uniforms.uGlobalOpacity;
      const brightness=b.value,opacity=o.value,background=scene.background;let darkRatio;
      try{
        // Isolate emitted RGB for both measurements. White void contrast also
        // depends on fog opacity, and must not enter the lighting ratio.
        scene.background=new THREE.Color(0);
        const referenceEnergy=energy(render(false),render(true));
        ensure(Math.abs(referenceEnergy)>100,'Fog lighting control has no measurable RGB contribution');
        b.value=.3;darkRatio=energy(render(false),render(true))/referenceEnergy;
        ensure(darkRatio>.28&&darkRatio<.32,'Fog brightness does not match the scan: '+darkRatio);
        scene.background=background;b.value=brightness;o.value=0;
        ensure(diff(render(false),render(true))===0,'Calibration fade leaves fog visible');
      }finally{scene.background=background;b.value=brightness;o.value=opacity;}
      const hole={...floorHole.snapshot(),floorSide:hallwayCut.snapshot().floorSide};
      const turn=new HoleWorldRotation();ensure(turn.start(hole),'Invalid turn geometry');
      const phases=[{name:'before-turn',matrix:new THREE.Matrix4()}];
      for(let i=1;i<=8;i++){turn.update(.5,true);if(i===4||i===8)phases.push({name:i===4?'mid-turn':'after-turn',matrix:turn.matrix().clone()});}
      ensure(turn.returnToOriginal(),'Could not test return turn');
      for(let i=1;i<=8;i++){turn.update(.5,true);if(i===4||i===8)phases.push({name:i===4?'mid-return':'after-return',matrix:turn.matrix().clone()});}
      const renderedPhases=[];
      for(const phase of phases){
        presentation=phase.matrix;
        worldPresentation.beginFrame();hallwayCut.update();updateFog(0);
        const cameraBefore=camera.matrixWorld.toArray();
        worldPresentation.apply(phase.matrix);scene.updateMatrixWorld(true);
        ensure(camera.matrixWorld.toArray().every((v,i)=>v===cameraBefore[i]),'Presentation moved the camera');
        const expected=phase.matrix.clone().multiply(canonical);
        ensure(volume.matrixWorld.elements.every((v,i)=>Math.abs(v-expected.elements[i])<1e-7),'Fog detached during '+phase.name);
        ensure(fog.snapshot().volumes[0].min[2]===FOG.startDepth,'Turning changed the fixed start');
        setView();await settle();
        const count=diff(render(false),render(true,'fog-downward-'+phase.name));
        ensure(count>50,'Fog disappeared during '+phase.name);renderedPhases.push({phase:phase.name,changedPixels:count});
      }
      worldPresentation.beginFrame();hallwayCut.update();updateFog(0);setView(20);await settle();
      const farPixels=diff(render(false),render(true,'fog-downward-far-end'));
      ensure(farPixels>50,'Fog stopped at the former 18m endpoint');
      setView();await settle();const still=render(true);
      for(let i=0;i<60;i++)updateFog(.5);
      ensure(diff(still,render(true,'fog-downward-drift'))>50,'The density is not drifting');
      const gl=renderer.getContext();
      const timing=visible=>{
        render(visible);renderer.setRenderTarget(target);renderer.render(scene,camera);gl.finish();
        const samples=[];for(let batch=0;batch<3;batch++){
          const start=performance.now();for(let i=0;i<8;i++)renderer.render(scene,camera);gl.finish();samples.push((performance.now()-start)/8);
        }
        renderer.setRenderTarget(previousTarget);return samples.sort((a,b)=>a-b)[1];
      };
      const desktopMs={off:timing(false),on:timing(true),resolution:[512,384],method:'Median of3 warmed8-render batches with GPU finish; excludes sorting/XR/streaming'};
      floorHole.close();updateFog(0);
      ensure(!fog.snapshot().visible&&!fog.snapshot().volumes[0].visible,'Closed corridor retains fog');
      ensure(resources[0]===splats.viewer.splatMesh.geometry,'Fog rebuilt splat geometry');
      ensure(resources[1]===splats.viewer.splatMesh.material&&resources[2]===splats.viewer.sortWorker,'Fog rebuilt shared resources');
      return {height:fog.snapshot().height,hallwayHeight,fixedStart:FOG.startDepth,fixedEnd:FOG.endDepth,gapAfterBroom:FOG.startDepth-BROOM_ENCOUNTER.depth,
        beforePixels,gapProbe,wallProbe,farPixels,darkRatio,desktopMs,lightingRgbIsolated:true,renderedPhases,noMainHallFog:true,noBoundaryReads:true,animated30Seconds:true,images};
    }finally{
      worldPresentation.reset();floorHole.close();desktopBoundary.snapshot=saved.boundarySnapshot;
      fog.update=saved.fogUpdate;fog.setVisible(true);experience.update=saved.experienceUpdate;
      window.__debug.hallwayMist.setVisible(saved.mist);
      camera.up.copy(saved.up);camera.position.copy(saved.camera);controls.target.copy(saved.target);
      controls.enableDamping=saved.damping;controls.update();renderer.setRenderTarget(previousTarget);target.dispose();
    }
  });
  for(const [name,data] of Object.entries(result.images))await fs.writeFile(path.join(output,(privateAsset?'private-':'')+name+'.png'),Buffer.from(data,'base64'));
  delete result.images;assert.equal(result.fixedStart,5);assert.ok(result.gapAfterBroom>0);
  return {...result,asset:privateAsset?'original hallway and cutout':'synthetic hallway, actual baked fog'};
}

export async function runPrivateFogScenario(parentPage,output){
  const page=await parentPage.context().newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+m.location().url);});
  try{
    await page.route('**/favicon.ico',route=>route.fulfill({status:204,body:''}));
    await page.goto(new URL('/?quality=detail',parentPage.url()).href,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('status')?.textContent?.includes('loaded'),undefined,{timeout:180000});
    await page.evaluate(()=>window.__debug.renderer.setAnimationLoop(null));
    const result=await runVolumeFogScenario(page,output,{privateAsset:true});
    const mist=await runRoomMistScenario(page,output,{privateAsset:true});assert.deepEqual(errors,[]);return {...result,mist};
  }finally{await page.close();}
}
