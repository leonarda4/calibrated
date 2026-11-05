import assert from 'node:assert/strict';
import path from 'node:path';

const nearArray = (actual, expected, label, tolerance=1e-7) => {
  assert.equal(actual.length,expected.length,label);
  actual.forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<tolerance,`${label}[${index}]: ${value} vs ${expected[index]}`));
};
const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

async function nativeFrames(page,count=3) {
  await page.evaluate(async count=>{
    for(let index=0;index<count;index++)await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Hole portal native frame stalled.')),2000);
      requestAnimationFrame(()=>{clearTimeout(timer);resolve();});
    });
  },count);
}

async function movePhysicalCamera(page,point,direction) {
  return page.evaluate(async ({point,direction})=>{
    const {THREE}=window.__holeTurnEvidence,{camera,controls}=window.__debug;
    const start=camera.position.clone(),target=new THREE.Vector3(...point);
    const steps=Math.max(1,Math.ceil(start.distanceTo(target)/.075));
    if(steps>200)throw Error('Hole portal test requested an unbounded camera path.');
    for(let step=1;step<=steps;step++) {
      const next=start.clone().lerp(target,step/steps),delta=next.clone().sub(camera.position);
      camera.position.copy(next);controls.target.add(delta);
      if(direction)controls.target.copy(camera.position).add(new THREE.Vector3(...direction));
      controls.update();camera.updateMatrixWorld(true);
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Hole portal physical step missed its native frame.')),2000);
        requestAnimationFrame(()=>{clearTimeout(timer);resolve();});
      });
    }
    return camera.matrixWorld.toArray();
  },{point,direction});
}

async function pauseEvidenceClock(page,name) {
  return page.evaluate(name=>{
    const e=window.__holeTurnEvidence,clock=window.__debug[name];
    if(e.pausedClock)throw Error('Nested hole evidence clock pause.');
    e.pausedClock={clock,update:clock.update};
    clock.update=function(_seconds,...args){return e.pausedClock.update.call(clock,0,...args);};
    return clock.snapshot();
  },name);
}

async function resumeEvidenceClock(page) {
  await nativeFrames(page,1);
  await page.evaluate(()=>{
    const e=window.__holeTurnEvidence;if(!e?.pausedClock)return;
    e.pausedClock.clock.update=e.pausedClock.update;delete e.pausedClock;
  });
}

async function capturePaused(page,name,file) {
  const state=await pauseEvidenceClock(page,name);
  try{await page.screenshot({path:file,fullPage:true,timeout:60000});return state;}
  finally{await resumeEvidenceClock(page);}
}

async function turnEvidence(page) {
  return page.evaluate(()=>{
    const e=window.__holeTurnEvidence,{camera,splats,scene,holeWorldRotation,worldPresentation}=window.__debug;
    scene.updateMatrixWorld(true);
    const mesh=splats.viewer.splatMesh;
    return {turn:holeWorldRotation.snapshot(),presentation:worldPresentation.snapshot().matrix,
      camera:camera.matrixWorld.toArray(),source:splats.matrix.toArray(),
      resourcesStable:mesh.material===e.resources.material&&mesh.geometry===e.resources.geometry&&
        mesh.splatDataTextures===e.resources.textures&&splats.viewer.sortWorker===e.resources.worker,
      trackedStable:e.tracked.every(t=>t.object.parent===t.parent&&t.object.matrixWorld.elements.every((v,i)=>Math.abs(v-t.matrix.elements[i])<1e-7)),
      box:scene.getObjectByName('installation-second-box').matrixWorld.toArray(),
      transition3Requests:e.transition3Requests,
      roomTiltingPlaying:window.__debug.experience.gameplayAudio.snapshot().roomTiltingPlaying,
      nativeTiltStarts:e.tiltSources.length};
  });
}

/** Actual entry trigger and rendered passage, including walking beyond the old aperture. */
export async function runHoleWorldTurnScenario(page, output, {privateAsset=false}={}) {
  const saved=await page.evaluate(()=>{
    const {camera,controls,experience}=window.__debug;
    return {camera:camera.position.toArray(),target:controls.target.toArray(),damping:controls.enableDamping,
      muted:experience.gameplayAudio.snapshot().muted};
  });
  const prefix=privateAsset?'private-':'';
  try {
    await page.locator('#experience-reset').click();
    await page.evaluate(async()=>{
      const {experience}=window.__debug;
      // Only the check-owned Chrome produces these sources; its process output is muted.
      experience.voices.setMuted(false);
      await experience.gameplayAudio.unlock();await experience.gameplayAudio.preload();
      if(!experience.gameplayAudio.snapshot().roomTiltingReady)throw Error('Room-tilting WAV was not ready for native movement evidence.');
    });
    await page.locator('#experience-floor-hole').click();
    const initial=await page.evaluate(async()=>{
      const THREE=await import('/node_modules/.vite/deps/three.js');
      const {floorHole,hallwayCut,camera,controls,splats,scene,renderer,experience}=window.__debug;
      const hole=floorHole.snapshot(),cut=hallwayCut.snapshot();
      if(!hole.open||!cut.visible)throw Error('The entry transition requires an open attached cutout.');
      const center=hole.worldCorners.reduce((sum,p)=>sum.add(new THREE.Vector3(...p).multiplyScalar(.25)),new THREE.Vector3());
      const frame=new THREE.Matrix4().fromArray(hole.routeToWorld);
      const forward=new THREE.Vector3(0,0,cut.floorSide==='end'?-1:1).transformDirection(frame);
      controls.enableDamping=false;camera.position.copy(center).add(new THREE.Vector3(0,1.65,0));
      controls.target.copy(camera.position).addScaledVector(forward,2).add(new THREE.Vector3(0,-.15,0));controls.update();
      scene.updateMatrixWorld(true);
      const tracked=['getController','getControllerGrip','getHand'].flatMap(method=>[0,1].map(index=>{
        const object=renderer.xr[method](index);object.updateWorldMatrix(true,false);
        return {object,parent:object.parent,matrix:object.matrixWorld.clone()};
      }));
      const originalTransition=experience.gameplayAudio.transition,originalSetTilting=experience.gameplayAudio.setRoomTilting;
      const sourcePrototype=BaseAudioContext.prototype,originalCreateSource=sourcePrototype.createBufferSource;
      window.__holeTurnEvidence={THREE,forward:forward.clone(),eye:camera.matrixWorld.clone(),scan:splats.matrix.clone(),tracked,
        box:scene.getObjectByName('installation-second-box').matrixWorld.clone(),hole,
        originalTransition,transition3Requests:0,originalSetTilting,sourcePrototype,originalCreateSource,
        tiltSources:[],tiltEdges:[],lastTiltActive:false,lastTiltAngle:window.__debug.holeWorldRotation.snapshot().angleDegrees,
        resources:{material:splats.viewer.splatMesh.material,geometry:splats.viewer.splatMesh.geometry,
          textures:splats.viewer.splatMesh.splatDataTextures,worker:splats.viewer.sortWorker}};
      experience.gameplayAudio.setRoomTilting=function(active){
        const e=window.__holeTurnEvidence,state=window.__debug.holeWorldRotation.snapshot();
        e.tiltObservation={active,phase:state.phase,angleDelta:Math.abs(state.angleDegrees-e.lastTiltAngle)};
        if(active!==e.lastTiltActive)e.tiltEdges.push({...e.tiltObservation});
        e.lastTiltActive=active;e.lastTiltAngle=state.angleDegrees;
        return originalSetTilting.call(this,active);
      };
      sourcePrototype.createBufferSource=function(...args){
        const source=originalCreateSource.apply(this,args),start=source.start.bind(source),stop=source.stop.bind(source);
        let record=null;
        source.start=function(...startArgs){
          if(source.loop){
            const e=window.__holeTurnEvidence;
            record={buffer:source.buffer,...e.tiltObservation,loopStart:source.loopStart,loopEnd:source.loopEnd,stopped:false,ended:false};
            e.tiltSources.push(record);source.addEventListener('ended',()=>{record.ended=true;});
          }
          return start(...startArgs);
        };
        source.stop=function(...stopArgs){if(record)record.stopped=true;return stop(...stopArgs);};
        return source;
      };
      experience.gameplayAudio.transition=function(stage){
        if(stage===3)window.__holeTurnEvidence.transition3Requests++;
        return originalTransition.call(this,stage);
      };
      return {hole,cut,camera:camera.position.toArray(),source:splats.matrix.toArray()};
    });
    await page.waitForFunction(()=>window.__debug.holeTransition.snapshot().phase==='anticipating',undefined,{timeout:6000});
    const countdown=await capturePaused(page,'holeTransition',path.join(output,`${prefix}hole-turn-entry.png`));
    assert.equal(countdown.phase,'anticipating');
    assert.equal(await page.evaluate(()=>window.__holeTurnEvidence.tiltSources.length),0,'Anticipation must not start the movement-only room sound');
    await page.waitForFunction(()=>window.__debug.holeWorldRotation.snapshot().angleDegrees>=30,undefined,{timeout:8000});
    const middle=await capturePaused(page,'holeWorldRotation',path.join(output,`${prefix}hole-turn-easing.png`));
    assert.equal(middle.phase,'turning');assert.ok(middle.angleDegrees<90);
    await page.waitForFunction(()=>window.__debug.holeWorldRotation.snapshot().phase==='complete',undefined,{timeout:8000});
    await pauseEvidenceClock(page,'holeWorldRotation');
    // The exact finishing frame still translates the rendered world. Observe
    // stable native frames before requiring the movement-only sound to stop.
    await nativeFrames(page,2);
    let final;
    try{final=await page.evaluate(async()=>{
      const {THREE,eye,scan,box,hole,resources}=window.__holeTurnEvidence;
      const {camera,controls,splats,scene,renderer,holeWorldRotation,hallwayCut}=window.__debug;
      scene.updateMatrixWorld(true);
      const compare=(a,b)=>a.elements.every((v,i)=>Math.abs(v-b.elements[i])<1e-7);
      const world=holeWorldRotation.matrix();
      if(!compare(camera.matrixWorld,eye)||!compare(splats.matrix,scan))throw Error('Quarter-turn changed the viewpoint or source placement.');
      if(!compare(scene.getObjectByName('installation-second-box').matrixWorld,box.clone().premultiply(world)))throw Error('Second box did not join the world turn.');
      const cut=hallwayCut.snapshot(),floorCorners=hole.worldCorners.slice(cut.floorSide==='end'?2:0,cut.floorSide==='end'?4:2);
      if(!floorCorners.every(p=>Math.abs(new THREE.Vector3(...p).add(new THREE.Vector3(0,-3,0))
        .applyMatrix4(world).y-hole.floorY)<1e-7))throw Error('New floor is not level with the physical floor.');
      const viewer=splats.viewer;
      const settle=async promise=>{let timer;try{await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Horizontal hallway sort timeout')),45000);})]);}finally{clearTimeout(timer);}};
      viewer.update(renderer,camera);await settle(viewer.sortPromise);viewer.splatMesh.updateTransforms();
      await settle(viewer.runSplatSort(true,true));await settle(viewer.sortPromise);
      const object=splats.getSplatScene(cut.sceneIndex),gl=renderer.getContext();
      const points=[2.5,3.5,5].map(distance=>camera.position.clone().addScaledVector(window.__holeTurnEvidence.forward,distance).setY(hole.floorY));
      const read=()=>points.map(point=>{const p=point.clone().project(camera),bytes=new Uint8Array(4);
        gl.readPixels(Math.floor((p.x+1)*gl.drawingBufferWidth/2),Math.floor((p.y+1)*gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return [...bytes.slice(0,3)];});
      object.visible=false;renderer.render(scene,camera);const empty=read();
      object.visible=true;renderer.render(scene,camera);const inside=read();
      if(inside.filter((rgb,i)=>rgb.some((v,c)=>Math.abs(v-empty[i][c])>10)).length<2)throw Error(`Hallway is clipped away from inside: ${JSON.stringify({empty,inside})}`);
      const current=viewer.splatMesh;
      return {state:holeWorldRotation.snapshot(),cameraUnchanged:true,sourceUnchanged:true,floorLevel:true,
        empty,inside,nativeTiltStarts:window.__holeTurnEvidence.tiltSources.length,
        resourcesStable:current.material===resources.material&&current.geometry===resources.geometry&&viewer.sortWorker===resources.worker};
    });
    assert.equal(final.resourcesStable,true);
    await page.evaluate(()=>{
      const e=window.__holeTurnEvidence,audio=window.__debug.experience.gameplayAudio.snapshot();
      if(audio.roomTiltingPlaying||!e.tiltSources.some(source=>source.phase==='turning'))throw Error(`First outward motion lacked native tilt audio or retained it at the standing endpoint: ${JSON.stringify({
        audio,turn:window.__debug.holeWorldRotation.snapshot().phase,
        sources:e.tiltSources.map(({phase,active,angleDelta,stopped,ended})=>({phase,active,angleDelta,stopped,ended})),edges:e.tiltEdges})}`);
    });
    await page.screenshot({path:path.join(output,`${prefix}hole-turn-horizontal.png`),fullPage:true,timeout:60000});
    }finally{await resumeEvidenceClock(page);}
    const walking=await page.evaluate(()=>{
      const {camera,controls,holeWorldRotation}=window.__debug,e=window.__holeTurnEvidence;
      const before=camera.position.clone(),matrix=holeWorldRotation.snapshot().matrix;
      camera.position.add(e.forward);controls.target.add(e.forward);controls.update();
      return {distance:camera.position.distanceTo(before),matrix};
    });
    await page.waitForTimeout(100);
    const held=await page.evaluate(()=>window.__debug.holeWorldRotation.snapshot());
    assert.equal(held.phase,'complete');assert.deepEqual(held.matrix,walking.matrix);assert.ok(Math.abs(walking.distance-1)<1e-7);
    await nativeFrames(page,4);
    assert.equal((await turnEvidence(page)).turn.phase,'complete','standing/walking inside cannot instantly reverse the world');
    const portal=await page.evaluate(()=>{
      const e=window.__holeTurnEvidence,{holeWorldRotation}=window.__debug,{THREE,hole}=e;
      const side=holeWorldRotation.snapshot().floorSide;
      const z=side==='end'?hole.endZ-1.65:hole.startZ+1.65,t=(z-hole.startZ)/(hole.endZ-hole.startZ);
      const left=hole.nearBounds[0]+t*(hole.farBounds[0]-hole.nearBounds[0]);
      const right=hole.nearBounds[1]+t*(hole.farBounds[1]-hole.nearBounds[1]),x=(left+right)/2;
      const frame=holeWorldRotation.matrix().multiply(new THREE.Matrix4().fromArray(hole.routeToWorld));
      const point=(x,y)=>new THREE.Vector3(x,hole.floorY+y,z).applyMatrix4(frame).toArray();
      const outward=new THREE.Vector3(0,1,0).transformDirection(frame).toArray();
      const entryZ=side==='end'?hole.endZ-.2:hole.startZ+.2,entryT=(entryZ-hole.startZ)/(hole.endZ-hole.startZ);
      const entryX=(hole.nearBounds[0]+entryT*(hole.farBounds[0]-hole.nearBounds[0])+
        hole.nearBounds[1]+entryT*(hole.farBounds[1]-hole.nearBounds[1]))/2;
      const originalFrame=new THREE.Matrix4().fromArray(hole.routeToWorld);
      return {inside:point(x,-.25),outside:point(x,.25),missInside:point(right+.35,-.25),missOutside:point(right+.35,.25),outward,
        repeatEntry:new THREE.Vector3(entryX,hole.floorY+1.65,entryZ).applyMatrix4(originalFrame).toArray(),
        hinge:holeWorldRotation.snapshot().hingeWorld};
    });
    await movePhysicalCamera(page,portal.missInside,portal.outward);
    await movePhysicalCamera(page,portal.missOutside,portal.outward);
    await nativeFrames(page,3);
    assert.equal((await turnEvidence(page)).turn.phase,'complete','crossing beside the vertical aperture must miss');
    await movePhysicalCamera(page,portal.missInside,portal.outward);
    await movePhysicalCamera(page,portal.inside,portal.outward);
    await nativeFrames(page,3);
    const returnEye=await movePhysicalCamera(page,portal.outside,portal.outward);
    await page.waitForFunction(()=>window.__debug.holeWorldRotation.snapshot().phase==='returning',undefined,{timeout:4000});
    await page.waitForFunction(()=>{const s=window.__debug.holeWorldRotation.snapshot();return s.phase==='returning'&&s.angleDegrees<60;},undefined,{timeout:6000});
    const returnMiddle=await capturePaused(page,'holeWorldRotation',path.join(output,`${prefix}hole-turn-return-easing.png`));
    assert.equal(returnMiddle.phase,'returning');assert.ok(returnMiddle.angleDegrees>0&&returnMiddle.angleDegrees<90);
    await page.waitForFunction(()=>window.__debug.holeWorldRotation.snapshot().phase==='original',undefined,{timeout:8000});
    await nativeFrames(page,2);
    const returned=await turnEvidence(page);
    nearArray(returned.camera,returnEye,'physical camera during automatic return');
    nearArray(returned.turn.matrix,identity,'returned world');nearArray(returned.presentation,identity,'returned presentation');
    nearArray(returned.turn.hingeWorld,portal.hinge,'frozen return hinge');
    nearArray(returned.source,initial.source,'canonical source after return');
    assert.equal(returned.resourcesStable,true);assert.equal(returned.trackedStable,true);
    assert.equal(returned.roomTiltingPlaying,false,'Standing original pose must silence return movement audio');
    assert.ok(returned.nativeTiltStarts>final.nativeTiltStarts,'The portal return needs a fresh native movement source');
    await nativeFrames(page,4);
    assert.equal((await turnEvidence(page)).turn.phase,'original','standing outside after return cannot queue another turn');
    assert.equal((await turnEvidence(page)).nativeTiltStarts,returned.nativeTiltStarts,'A stationary original pose restarted the tilt loop');
    await page.screenshot({path:path.join(output,`${prefix}hole-turn-returned.png`),fullPage:true,timeout:60000});
    const repeatEye=await movePhysicalCamera(page,portal.repeatEntry);
    await page.waitForFunction(()=>window.__debug.holeTransition.snapshot().phase==='anticipating',undefined,{timeout:6000});
    await page.waitForFunction(()=>window.__debug.holeWorldRotation.snapshot().phase==='complete',undefined,{timeout:10000});
    await nativeFrames(page,2);
    const repeated=await turnEvidence(page);
    nearArray(repeated.camera,repeatEye,'physical camera during repeated forward turn');
    nearArray(repeated.turn.matrix,final.state.matrix,'same frozen world pose on repeat');
    nearArray(repeated.turn.hingeWorld,portal.hinge,'same hinge on repeat');
    assert.equal(repeated.resourcesStable,true);assert.equal(repeated.trackedStable,true);
    assert.equal(repeated.roomTiltingPlaying,false);assert.ok(repeated.nativeTiltStarts>returned.nativeTiltStarts,'Repeated outward motion did not play the cached tilt sound');
    await movePhysicalCamera(page,portal.inside,portal.outward);await nativeFrames(page,3);
    const secondReturnEye=await movePhysicalCamera(page,portal.outside,portal.outward);
    await page.waitForFunction(()=>window.__debug.holeWorldRotation.snapshot().phase==='original',undefined,{timeout:10000});
    await nativeFrames(page,2);
    const secondReturn=await turnEvidence(page);
    nearArray(secondReturn.camera,secondReturnEye,'physical camera during second return');
    nearArray(secondReturn.turn.matrix,identity,'second exact return');nearArray(secondReturn.turn.hingeWorld,portal.hinge,'second fixed hinge');
    assert.equal(secondReturn.resourcesStable,true);assert.equal(secondReturn.trackedStable,true);
    assert.equal(secondReturn.roomTiltingPlaying,false);assert.ok(secondReturn.nativeTiltStarts>repeated.nativeTiltStarts,'Second return did not play movement audio');
    assert.equal(secondReturn.transition3Requests,1,'repeat crossings must not replay Transition 3');
    const movementAudio=await page.evaluate(()=>{
      const e=window.__holeTurnEvidence,sources=e.tiltSources;
      if(sources.length<4||sources.some(source=>!source.active||source.angleDelta<=1e-10||
        !['turning','returning','complete','original'].includes(source.phase)))throw Error('A native tilt source started without actual world-angle movement.');
      if(!sources.some(source=>source.phase==='turning')||!sources.some(source=>source.phase==='returning'))throw Error('Both directions need their own movement audio.');
      if(sources.some(source=>source.buffer!==sources[0].buffer||(!source.stopped&&!source.ended)))throw Error('Repeated turns did not reuse/stop the original decoded tilt buffer.');
      return {nativeSourceStarts:sources.length,actualAngleMovementOnly:true,noAnticipationOrHeldPlayback:true,
        entryAndReturnNativeScheduled:true,twoCyclesReuseOneBuffer:true,allSourcesStopped:true,
        loopBounds:sources.map(({loopStart,loopEnd})=>[loopStart,loopEnd]),audioOutputMuted:true};
    });
    const authoring=await page.evaluate(()=>{
      const {experience,splats}=window.__debug;
      const before=experience.installation.snapshot(),scan=splats.matrix.toArray();
      const ids=['experience-show-box','experience-hide-box','experience-rotate','experience-show-second-box',
        'experience-hide-second-box','experience-apply','experience-pick-center','experience-pick-second-line','experience-flip-apply'];
      const disabled=ids.every(id=>document.getElementById(id).disabled);
      for(const id of ids)document.getElementById(id).dispatchEvent(new MouseEvent('click',{bubbles:true}));
      const after=experience.installation.snapshot();
      return {disabled,unchanged:JSON.stringify(before)===JSON.stringify(after)&&JSON.stringify(scan)===JSON.stringify(splats.matrix.toArray())};
    });
    assert.equal(authoring.disabled,true);assert.equal(authoring.unchanged,true,'forced authoring events must preserve held geometry');
    await page.locator('#experience-floor-hole').click();
    assert.equal((await turnEvidence(page)).turn.phase,'idle');
    await page.locator('#experience-floor-hole').click();
    await movePhysicalCamera(page,portal.repeatEntry);
    await page.waitForFunction(()=>window.__debug.holeTransition.snapshot().phase==='anticipating',undefined,{timeout:6000});
    await page.locator('#experience-floor-hole').click();await nativeFrames(page,3);
    const reopened=await page.evaluate(()=>({turn:window.__debug.holeWorldRotation.snapshot(),transition:window.__debug.holeTransition.snapshot(),
      cutVisible:window.__debug.hallwayCut.snapshot().visible}));
    assert.equal(reopened.turn.phase,'idle');assert.equal(reopened.transition.phase,'idle');assert.equal(reopened.cutVisible,false);
    const recovery=await page.evaluate(()=>{
      const {experience,floorHole,hallwayCut,holeWorldRotation,worldPresentation}=window.__debug;
      const actions=[];
      for(const direction of ['turning','returning'])for(const action of ['close','STOP','reset','calibration']) {
        document.getElementById('experience-reset').click();
        if(!floorHole.show())throw Error(`Recovery fixture hole failed: ${floorHole.snapshot().status}`);
        const floorSide=hallwayCut.snapshot().floorSide;
        if(!holeWorldRotation.start({...floorHole.snapshot(),floorSide}))throw Error('Recovery fixture did not start.');
        if(direction==='returning') {
          for(let index=0;index<16;index++)holeWorldRotation.update(.25,true);
          if(!holeWorldRotation.returnToOriginal())throw Error('Recovery return fixture did not start.');
        }
        holeWorldRotation.update(.25,true);worldPresentation.apply(holeWorldRotation.matrix());
        if(action==='close')floorHole.close();
        else if(action==='STOP')document.getElementById('experience-stop').click();
        else if(action==='reset')document.getElementById('experience-reset').click();
        else {experience.prepareForCalibration();experience.setCalibrationActive(false);}
        if(holeWorldRotation.snapshot().phase!=='idle'||hallwayCut.snapshot().visible||
          !worldPresentation.snapshot().matrix.every((v,i)=>Math.abs(v-(i%5===0?1:0))<1e-8))throw Error(`${action} retained the quarter-turn`);
        actions.push(`${direction}:${action}`);
      }
      return actions;
    });
    return {initial,middle,final,physicalWalkMetres:walking.distance,returnMiddle,returned,repeated,secondReturn,
      verticalApertureMissIgnored:true,completedCycles:2,transition3OnlyOnce:true,authoring,reopened,
      recovery,movementAudio,actualMainEntry:true,actualMainPortalReturn:true,desktopOnly:true};
  } finally {
    await page.evaluate(saved=>{
      document.getElementById('experience-reset').click();
      const {camera,controls,experience}=window.__debug,e=window.__holeTurnEvidence;
      if(e?.pausedClock)e.pausedClock.clock.update=e.pausedClock.update;
      if(e?.originalTransition)experience.gameplayAudio.transition=e.originalTransition;
      if(e?.originalSetTilting)experience.gameplayAudio.setRoomTilting=e.originalSetTilting;
      if(e?.sourcePrototype)e.sourcePrototype.createBufferSource=e.originalCreateSource;
      experience.voices.setMuted(saved.muted);
      camera.position.fromArray(saved.camera);controls.target.fromArray(saved.target);
      controls.enableDamping=saved.damping;controls.update();delete window.__holeTurnEvidence;
    },saved).catch(()=>{});
  }
}
