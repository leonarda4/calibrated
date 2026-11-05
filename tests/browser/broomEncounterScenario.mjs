import assert from 'node:assert/strict';
import path from 'node:path';

async function moveHead(page, point, target) {
  await page.evaluate(async ({point,target}) => {
    const {camera,controls}=window.__debug, {THREE}=window.__broomEncounterCheck;
    const from=camera.position.clone(), to=new THREE.Vector3(...point), steps=Math.max(1,Math.ceil(from.distanceTo(to)/.06));
    if(steps>200)throw Error('Unbounded broom test path.');
    for(let i=1;i<=steps;i++) {
      camera.position.copy(from).lerp(to,i/steps);controls.target.fromArray(target);controls.update();
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
  },{point,target});
}

async function resume(page) {
  await page.evaluate(async()=>{
    await new Promise(resolve=>requestAnimationFrame(resolve));window.__broomEncounterCheck.paused=false;
  });
}

async function screenshot(page, file) {
  await page.evaluate(()=>{window.__broomEncounterCheck.paused=true;});
  try { await page.screenshot({path:file,fullPage:true,timeout:60000}); }
  finally { await resume(page); }
}

async function captureGlitch(page, output, name) {
  await page.evaluate(()=>{window.__broomEncounterCheck.paused=true;});
  try {
    const evidence=await page.evaluate(async()=>{
      const {THREE}=window.__broomEncounterCheck,{renderer,scene,camera,splats,broom,broomEncounter}=window.__debug;
      scene.updateMatrixWorld(true);splats.viewer.update(renderer,camera);await splats.viewer.sortPromise;
      splats.viewer.splatMesh.updateTransforms();await splats.viewer.runSplatSort(true,true);await splats.viewer.sortPromise;
      const state=broomEncounter.snapshot(), object=splats.getSplatScene(2), material=splats.viewer.splatMesh.material;
      const pose=new THREE.Matrix4().fromArray(state.uprightMatrix), base=new THREE.Vector3().setFromMatrixPosition(pose);
      const corners=[[-.35,-.12],[.35,-.12],[-.35,1.7],[.35,1.7]].map(([x,y])=>new THREE.Vector3(x,y,0).applyMatrix4(pose).project(camera));
      const gl=renderer.getContext(), width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
      const x=Math.max(0,Math.floor((Math.min(...corners.map(p=>p.x))+1)*width/2));
      const y=Math.max(0,Math.floor((Math.min(...corners.map(p=>p.y))+1)*height/2));
      const w=Math.min(width-x,Math.ceil((Math.max(...corners.map(p=>p.x))+1)*width/2)-x);
      const h=Math.min(height-y,Math.ceil((Math.max(...corners.map(p=>p.y))+1)*height/2)-y);
      if(w<=0||h<=0)throw Error('Broom evidence is outside the viewport.');
      const read=()=>{renderer.render(scene,camera);const bytes=new Uint8Array(w*h*4);gl.readPixels(x,y,w,h,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;};
      const changed=(a,b)=>{let count=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>15)count++;return count;};
      object.visible=false;const empty=read();object.visible=true;material.uniforms.uBroomGlitch.value=0;const solid=read();
      material.uniforms.uBroomGlitch.value=state.glitch;const glitch=read();
      const raw=splats.getSplatScene(2);raw.updateMatrix();const source=splats.matrixWorld.clone().multiply(raw.matrix);
      const {BROOM}=await import('/src/viewer/broomConfig.ts');
      const actualBase=new THREE.Vector3(...BROOM.sourceBase).applyMatrix4(source), up=new THREE.Vector3(0,0,-1).transformDirection(source);
      return {state,visible:broom.snapshot().visible,fullPixels:changed(solid,empty),glitchPixels:changed(glitch,solid),
        actualBase:actualBase.toArray(),expectedBase:base.toArray(),up:up.toArray(),determinant:source.determinant(),
        distanceFromEntrance:base.distanceTo(new THREE.Vector3(...state.entranceWorld)),roi:[x,y,w,h]};
    });
    assert.ok(evidence.fullPixels>12,`Broom must render: ${JSON.stringify(evidence)}`);
    assert.ok(evidence.glitchPixels>4,'The sliced glitch must change actual broom pixels.');
    evidence.actualBase.forEach((v,i)=>assert.ok(Math.abs(v-evidence.expectedBase[i])<1e-7));
    evidence.up.forEach((v,i)=>assert.ok(Math.abs(v-[0,1,0][i])<1e-7));
    assert.ok(Math.abs(evidence.distanceFromEntrance-4)<1e-7);assert.ok(Math.abs(evidence.determinant-1)<1e-7);
    await page.screenshot({path:path.join(output,name),fullPage:true,timeout:60000});
    return evidence;
  } finally { await resume(page); }
}

/** Native main-loop cue, actual rendered glitch, physical proximity and one-shot recovery. */
export async function runBroomEncounterScenario(page, output) {
  const saved=await page.evaluate(async()=>{
    document.getElementById('experience-reset').click();
    const {camera,controls,splats,broomEncounter,holeWorldRotation,experience}=window.__debug;
    const mesh=splats.viewer.splatMesh;
    const s={THREE:await import('/node_modules/.vite/deps/three.js'),camera:camera.position.toArray(),target:controls.target.toArray(),
      damping:controls.enableDamping,arm:broomEncounter.arm,update:broomEncounter.update,turnUpdate:holeWorldRotation.update,
      speech:experience.gameplayAudio.speech,speechCalls:[],
      paused:false,clock:0,arms:0,events:[],resources:{geometry:mesh.geometry,material:mesh.material,textures:mesh.splatDataTextures,worker:splats.viewer.sortWorker}};
    window.__broomEncounterCheck=s;controls.enableDamping=false;
    experience.gameplayAudio.speech=function(id){
      if(id==='cleanRoom')s.speechCalls.push({id,phase:broomEncounter.snapshot().phase,at:s.clock,
        visible:window.__debug.broom.snapshot().visible});
      return s.speech.call(this,id);
    };
    broomEncounter.arm=function(...args){const ok=s.arm.apply(this,args);if(ok){s.arms++;s.clock=0;s.events.push({phase:'waitingReveal',at:0});}return ok;};
    broomEncounter.update=function(seconds,...args){
      const dt=s.paused?0:seconds,before=this.snapshot().phase;
      if(dt>0&&dt<=.5&&args[0])s.clock+=dt;
      s.update.call(this,dt,...args);const after=this.snapshot().phase;
      if(after!==before)s.events.push({phase:after,at:s.clock});
    };
    holeWorldRotation.update=function(seconds,...args){return s.turnUpdate.call(this,s.paused?0:seconds,...args);};
    return {camera:s.camera,target:s.target,damping:s.damping};
  });
  try {
    await page.locator('#experience-floor-hole').click();
    await page.evaluate(()=>{
      const {camera,controls,floorHole,hallwayCut}=window.__debug,{THREE}=window.__broomEncounterCheck,hole=floorHole.snapshot();
      const route=new THREE.Matrix4().fromArray(hole.routeToWorld), x=(hole.nearBounds[0]+hole.nearBounds[1]+hole.farBounds[0]+hole.farBounds[1])/4;
      const p=new THREE.Vector3(x,hole.floorY+1.65,(hole.startZ+hole.endZ)/2).applyMatrix4(route);
      const forward=new THREE.Vector3(0,0,hallwayCut.snapshot().floorSide==='end'?-1:1).transformDirection(route);
      camera.position.copy(p);controls.target.copy(p).add(forward);controls.update();window.__broomEncounterCheck.entry=p.toArray();
    });
    await page.waitForFunction(()=>window.__debug.broomEncounter.snapshot().phase==='waitingReveal',undefined,{timeout:12000});
    const waiting=await page.evaluate(()=>({state:window.__debug.broomEncounter.snapshot(),broom:window.__debug.broom.snapshot(),
      speechCalls:window.__broomEncounterCheck.speechCalls}));
    assert.equal(waiting.broom.visible,false);assert.ok(waiting.state.elapsedSeconds<1);
    assert.deepEqual(waiting.speechCalls,[],'The cleaning instruction must wait for actual broom appearance');
    const positions=await page.evaluate(()=>{
      const {THREE}=window.__broomEncounterCheck,s=window.__debug.broomEncounter.snapshot(),pose=new THREE.Matrix4().fromArray(s.uprightMatrix);
      const base=new THREE.Vector3().setFromMatrixPosition(pose),forward=new THREE.Vector3(0,0,1).transformDirection(pose);
      return {near:base.clone().add(new THREE.Vector3(0,1.65,0)).toArray(),
        view:base.clone().addScaledVector(forward,-1.4).add(new THREE.Vector3(0,1.65,0)).toArray(),
        target:base.clone().add(new THREE.Vector3(0,.73,0)).toArray(),
        outside:new THREE.Vector3(...s.entranceWorld).addScaledVector(forward,-.25).add(new THREE.Vector3(0,1.65,0)).toArray()};
    });
    await moveHead(page,positions.view,positions.target);
    await page.waitForFunction(()=>{const s=window.__debug.broomEncounter.snapshot();return s.phase==='glitchingIn'&&s.glitch>.25&&s.glitch<.85;},undefined,{timeout:6000});
    const appearance=await captureGlitch(page,output,'broom-cutout-glitch-in.png');
    await page.waitForFunction(()=>window.__debug.broomEncounter.snapshot().phase==='visible',undefined,{timeout:4000});
    await screenshot(page,path.join(output,'broom-cutout-visible.png'));
    await moveHead(page,positions.near,positions.target);
    await page.waitForFunction(()=>window.__debug.broomEncounter.snapshot().phase==='waitingExit',undefined,{timeout:3000});
    await moveHead(page,positions.view,positions.target);
    await page.waitForFunction(()=>{const s=window.__debug.broomEncounter.snapshot();return s.phase==='glitchingOut'&&s.glitch>.2&&s.glitch<.85;},undefined,{timeout:6000});
    const disappearance=await captureGlitch(page,output,'broom-cutout-glitch-out.png');
    await page.waitForFunction(()=>window.__debug.broomEncounter.snapshot().phase==='complete',undefined,{timeout:4000});
    assert.equal(await page.evaluate(()=>window.__debug.broom.snapshot().visible),false);
    await screenshot(page,path.join(output,'broom-cutout-gone.png'));
    await moveHead(page,positions.outside,positions.target);
    await page.waitForFunction(()=>window.__debug.holeWorldRotation.snapshot().phase==='original',undefined,{timeout:10000});
    const entry=await page.evaluate(()=>window.__broomEncounterCheck.entry);
    await moveHead(page,entry,positions.target);
    // The completed broom now arms the return ending, which owns this return
    // and blocks another entry. Earlier non-ending reentry is covered separately.
    const returned=await page.evaluate(async()=>{
      for(let i=0;i<15;i++)await new Promise(resolve=>requestAnimationFrame(resolve));
      return {worldPhase:window.__debug.holeWorldRotation.snapshot().phase,
        endingOwnsReturn:window.__debug.realityEnding.snapshot().originalDamage};
    });
    assert.equal(returned.worldPhase,'original');assert.equal(returned.endingOwnsReturn,true);
    const result=await page.evaluate(()=>{
      const {splats,broom,broomEncounter}=window.__debug,s=window.__broomEncounterCheck,mesh=splats.viewer.splatMesh;
      return {state:broomEncounter.snapshot(),broom:broom.snapshot(),arms:s.arms,events:s.events,speechCalls:s.speechCalls.map(call=>({...call})),
        resourcesStable:mesh.geometry===s.resources.geometry&&mesh.material===s.resources.material&&
          mesh.splatDataTextures===s.resources.textures&&splats.viewer.sortWorker===s.resources.worker};
    });
    assert.equal(result.arms,1);assert.equal(result.state.phase,'complete');assert.equal(result.broom.visible,false);assert.equal(result.resourcesStable,true);
    assert.equal(result.speechCalls.length,1,'Standing visible frames or repeated hole crossings replayed the cleaning instruction');
    assert.equal(result.speechCalls[0].id,'cleanRoom');assert.equal(result.speechCalls[0].phase,'glitchingIn');
    assert.equal(result.speechCalls[0].visible,true,'Cleaning instruction preceded a successful visible presentation');
    const at=phase=>result.events.find(e=>e.phase===phase).at;
    assert.ok(at('glitchingIn')>=2-1e-8&&at('glitchingIn')<2.5);
    assert.ok(Math.abs(result.speechCalls[0].at-at('glitchingIn'))<1e-8,'Cleaning instruction did not accompany actual first glitch-in');
    assert.ok(at('glitchingOut')-at('waitingExit')>=2-1e-8&&at('glitchingOut')-at('waitingExit')<2.5);
    const recovery=await page.evaluate(()=>{
      const {broomEncounter,broom,floorHole,hallwayCut,holeWorldRotation,experience}=window.__debug,done=[];
      for(const action of ['close','hide','STOP','reset','calibration']) {
        document.getElementById('experience-reset').click();
        if(!floorHole.show())throw Error('Broom recovery opening failed.');
        const hole={...floorHole.snapshot(),floorSide:hallwayCut.snapshot().floorSide};
        if(!holeWorldRotation.start(hole))throw Error('Broom recovery turn failed.');
        for(let i=0;i<8;i++)holeWorldRotation.update(.5,true);
        if(!broomEncounter.arm(hole,holeWorldRotation.matrix()))throw Error('Fresh game did not rearm broom.');
        const p=[100,1,100];for(let i=0;i<20;i++)broomEncounter.update(.1,true,p,true);
        for(let i=0;i<6;i++)broomEncounter.update(.1,true,p,true);
        broom.presentEncounter(broomEncounter.snapshot());
        if(action==='close')floorHole.close();
        else if(action==='hide')document.getElementById('experience-show-broom').dispatchEvent(new MouseEvent('click',{bubbles:true}));
        else if(action==='STOP')document.getElementById('experience-stop').click();
        else if(action==='reset')document.getElementById('experience-reset').click();
        else {experience.prepareForCalibration();experience.setCalibrationActive(false);}
        if(broom.snapshot().visible||!['idle','cancelled'].includes(broomEncounter.snapshot().phase)||
          window.__debug.splats.viewer.splatMesh.material.uniforms.uBroomGlitch.value!==0)throw Error(`${action} retained the broom.`);
        done.push(action);
      }
      return done;
    });
    const manualAudio=await page.evaluate(()=>{
      const {broom}=window.__debug,s=window.__broomEncounterCheck;
      document.getElementById('experience-reset').click();
      const before=s.speechCalls.length;
      if(!broom.show())throw Error('Manual broom audio fixture failed to show.');
      broom.update();broom.update();broom.show();
      if(s.speechCalls.length!==before+1)throw Error('An already visible manual broom replayed its reveal instruction.');
      broom.reset();
      if(!broom.show()||s.speechCalls.length!==before+2)throw Error('A new actual manual reveal did not replay the supplied instruction.');
      broom.reset();
      return {sameCentralRevealCallback:true,repeatedVisibleUpdatesSilent:true,newRevealReplaysOnce:true};
    });
    return {appearance,disappearance,...result,returned,recovery,manualAudio,cleanRoomAtActualGlitchIn:true,
      actualMainFirstRotation:true,boxFootprintMetres:[.36,.36],desktopOnly:true};
  } finally {
    await page.evaluate(saved=>{
      const {broomEncounter,holeWorldRotation,camera,controls,experience}=window.__debug,s=window.__broomEncounterCheck;
      if(s){broomEncounter.arm=s.arm;broomEncounter.update=s.update;holeWorldRotation.update=s.turnUpdate;experience.gameplayAudio.speech=s.speech;}
      document.getElementById('experience-reset').click();
      camera.position.fromArray(saved.camera);controls.target.fromArray(saved.target);controls.enableDamping=saved.damping;controls.update();
      delete window.__broomEncounterCheck;
    },saved).catch(()=>{});
  }
}
