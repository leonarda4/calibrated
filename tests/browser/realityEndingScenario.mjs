import assert from 'node:assert/strict';
import path from 'node:path';
import { runHallwayCollapseScenario } from './hallwayCollapseScenario.mjs';

async function nativeFrame(page) {
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Ending evidence missed its native frame.')),2000);
    requestAnimationFrame(()=>{clearTimeout(timeout);resolve();});
  }));
}

async function advanceTo(page,seconds) {
  await nativeFrame(page);
  await page.evaluate(seconds=>{
    const s=window.__collapseCheck;s.endingStopAt=seconds;s.paused=false;
  },seconds);
  await page.waitForFunction(seconds=>window.__debug.realityEnding.snapshot().dimensionSeconds>=seconds-1e-8,seconds,{timeout:9000});
}

async function capture(page,output,name) {
  const result=await page.evaluate(async()=>{
    const s=window.__collapseCheck,d=window.__debug;s.paused=true;await s.settleView();
    const {renderer,scene,camera,splats,realityEnding,realityEndingEffects,hallwayLighting,experience}=d;
    renderer.render(scene,camera);const gl=renderer.getContext(),bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
    gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    let nonWhite=0,minAlpha=255;for(let i=0;i<bytes.length;i+=4){
      if(bytes[i]!==255||bytes[i+1]!==255||bytes[i+2]!==255)nonWhite++;minAlpha=Math.min(minAlpha,bytes[i+3]);
    }
    const uniforms=splats.viewer.splatMesh.material.uniforms;
    return {state:realityEnding.snapshot(),effects:realityEndingEffects.snapshot(),lighting:hallwayLighting.snapshot(),
      audio:experience.gameplayAudio.snapshot(),camera:camera.matrixWorld.toArray(),nonWhite,minAlpha,
      opacity:uniforms.uRealityOpacity.value,glitch:uniforms.uRealityGlitch.value,
      authoredVisible:scene.getObjectByName('hallway-world-presentation').visible,
      lights:[...window.__endingCheck.lights],narrations:[...window.__endingCheck.narrations]};
  });
  await page.screenshot({path:path.join(output,name),fullPage:true,timeout:60000});
  return result;
}

/** Both original ends, using actual scene0 pixels and a same-frame damage control. */
async function originalEnds(page) {
  return page.evaluate(async()=>{
    const d=window.__debug,s=window.__collapseCheck,{THREE}=s;
    const {renderer,scene,camera,controls,splats,realityEndingEffects}=d;
    s.paused=true;
    const capture=realityEndingEffects.snapshot();
    if(!capture.active||!capture.rawToRoute||!capture.safeRange||!capture.endRange)throw Error('Actual return did not capture original damage.');
    const rawToRoute=new THREE.Matrix4().fromArray(capture.rawToRoute);
    const routeToWorld=splats.matrixWorld.clone().multiply(rawToRoute.clone().invert());
    const player=camera.position.clone().applyMatrix4(routeToWorld.clone().invert());
    const floor=s.geometry.floorY,left=(s.geometry.nearBounds[0]+s.geometry.farBounds[0])/2,right=(s.geometry.nearBounds[1]+s.geometry.farBounds[1])/2;
    const objects=Array.from({length:6},(_,i)=>splats.getSplatScene(i)),visibility=objects.map(o=>o.visible),target=controls.target.clone();
    const atmospheres=[d.hallwayFog,d.hallwayMist,d.hallwayCollapseEffects].filter(Boolean),atmosphereVisibility=atmospheres.map(a=>a.root.visible);
    const material=splats.viewer.splatMesh.material,damage=material.uniforms.uRealityDamage.value,active=damage.x;
    const gl=renderer.getContext(),width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
    const read=()=>{splats.viewer.update(renderer,camera);renderer.render(scene,camera);const bytes=new Uint8Array(width*height*4);
      gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;};
    const white=rgb=>rgb&&rgb[3]===255&&765-rgb[0]-rgb[1]-rgb[2]<=6;
    const scan=rgb=>rgb&&765-rgb[0]-rgb[1]-rgb[2]>20&&rgb[0]+rgb[1]+rgb[2]>30;
    const sample=(bytes,route)=>{
      const p=new THREE.Vector3(...route).applyMatrix4(routeToWorld).project(camera),x=Math.round((p.x+1)*width/2),y=Math.round((p.y+1)*height/2);
      if(p.z< -1||p.z>1||x<2||x>=width-2||y<2||y>=height-2)return null;
      let result=null;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const at=((y+dy)*width+x+dx)*4,rgb=[...bytes.slice(at,at+4)];
        if(!result||rgb[0]+rgb[1]+rgb[2]<result[0]+result[1]+result[2])result=rgb;
      }return result;
    };
    const results=[];
    try {
      for(const side of [-1,1]){
        const direction=new THREE.Vector3(0,0,side).transformDirection(routeToWorld);
        controls.target.copy(camera.position).addScaledVector(direction,8).add(new THREE.Vector3(0,-.4,0));controls.update();await s.settleView();
        objects.forEach((o,i)=>{o.visible=i===0;});atmospheres.forEach(a=>{a.root.visible=false;});
        damage.x=0;const intact=read();damage.x=active;const broken=read();
        const probesAt=depth=>[left,right].flatMap(x=>[.35,.75,1.2,1.7,2.2].map(y=>[x,floor+y,depth]))
          .concat([-.5,0,.5].map(x=>[player.x+x,floor,depth]));
        const compare=points=>points.map(point=>{
          const before=sample(intact,point),after=sample(broken,point);
          return {point,before,after,delta:before&&after?before.slice(0,3).reduce((n,v,c)=>n+Math.abs(v-after[c]),0):null};
        }).filter(p=>scan(p.before)&&p.after);
        const near=compare(probesAt(player.z+side*1.8));
        const safe=capture.safeRange[side<0?0:1],end=capture.endRange[side<0?0:1];
        const rows=[.12,.25,.4,.55,.7,.82,.94].map(t=>{
          const depth=safe+(end-safe)*t,points=compare(probesAt(depth));
          return {depth,visible:points.length,changed:points.filter(p=>p.delta>20).length,
            missing:points.filter(p=>white(p.after)).length,surviving:points.filter(p=>p.delta<=6).length};
        });
        const far=compare(probesAt(end-side*.2));
        results.push({side,near,far,rows});
      }
      return {capture,player:player.toArray(),directions:results};
    } finally {
      damage.x=active;objects.forEach((o,i)=>{o.visible=visibility[i];});atmospheres.forEach((a,i)=>{a.root.visible=atmosphereVisibility[i];});
      controls.target.copy(target);controls.update();await s.settleView();renderer.render(scene,camera);
    }
  });
}

/** Real main-loop fallbacks; synthetic live boundary data never requests XR. */
async function fallbacks(page,output,prefix) {
  const results=[];
  const advance=async seconds=>{
    await nativeFrame(page);
    await page.evaluate(seconds=>{const s=window.__collapseCheck;s.endingStopAt=seconds;s.paused=false;},seconds);
    await page.waitForFunction(seconds=>{
      const e=window.__debug.realityEnding.snapshot();
      const clock=e.trigger==='timeout'?5+e.dimensionSeconds:e.trigger==='boundary'?e.dimensionSeconds:e.afterExplosionsSeconds??0;
      return clock>=seconds-1e-8;
    },seconds,{timeout:10000});
  };
  for(const branch of ['timeout','boundary']) {
    await page.evaluate(branch=>{
      const s=window.__collapseCheck,d=window.__debug,e=window.__endingCheck;
      document.getElementById('experience-reset').click();
      s.paused=true;s.holdFallback=false;s.fallbackClock=true;s.collapseSpeed=1;s.stopAt=null;s.endingStopAt=undefined;
      if(!d.floorHole.show()||!d.holeWorldRotation.start(s.geometry))throw Error('Fallback needs the captured opening.');
      for(let i=0;i<8;i++)s.turnUpdate.call(d.holeWorldRotation,.5,true);
      d.camera.position.fromArray(s.positions.view);d.controls.target.fromArray(s.positions.forwardTarget);d.controls.update();
      if(!s.collapseArm.call(d.hallwayCollapse,s.geometry,d.holeWorldRotation.matrix(),s.source,d.hallwayCollapseEffects.snapshot().farDepth,d.camera.position.toArray()))
        throw Error('Fallback must rearm the same actual collapse path.');
      if(branch==='timeout'){
        const end=Math.max(...d.hallwayCollapse.snapshot().blasts.map(b=>b.start+b.duration));
        let remaining=end;
        while(remaining>1e-9){const dt=Math.min(.25,remaining);s.collapseUpdate.call(d.hallwayCollapse,{dt,eligible:true,upright:true,
          positionWorld:d.camera.position.toArray(),presentation:d.holeWorldRotation.matrix()});remaining-=dt;}
      }
      e.branchCounts={lights:e.lights.length,narrations:e.narrations.length};
      e.boundarySnapshot=d.desktopBoundary.snapshot;
      if(branch==='boundary'){
        const {THREE}=s,openingToWorld=new THREE.Matrix4().fromArray(d.hallwayCollapse.snapshot().worldToOpening).invert();
        const head=d.camera.position.clone(),forward=new THREE.Vector3(0,0,1).transformDirection(openingToWorld);
        forward.y=0;forward.normalize();const right=new THREE.Vector3(forward.z,0,-forward.x);
        // Head starts near a side edge but five metres from the far edge.
        const rectangle=(far)=>[[-.05,-3],[2,-3],[2,far],[-.05,far]].map(([x,z])=>head.clone().addScaledVector(right,x).addScaledVector(forward,z).toArray());
        e.boundaryFar=5;
        d.desktopBoundary.snapshot=()=>{const state=e.boundarySnapshot();return {...state,runtime:{...state.runtime,live:true,head:head.toArray(),points:rectangle(e.boundaryFar)}};};
      }
      s.endingStopAt=branch==='timeout'?0:undefined;s.paused=false;
    },branch);
    try {
      if(branch==='timeout'){
        await page.waitForFunction(()=>window.__debug.realityEnding.snapshot().afterExplosionsSeconds===0);
        await advance(4.9);
      } else {
        await nativeFrame(page);await nativeFrame(page);
        assert.equal(await page.evaluate(()=>window.__debug.realityEnding.snapshot().trigger),null,'A nearby lateral edge cannot end the world.');
        await page.evaluate(()=>{window.__endingCheck.boundaryFar=1;window.__collapseCheck.endingStopAt=0;});
        await page.waitForFunction(()=>window.__debug.realityEnding.snapshot().trigger==='boundary');
      }
      const before=await capture(page,output,`${prefix}reality-ending-${branch}-before.png`);
      assert.equal(before.state.returnedCount,0);assert.equal(before.state.originalDamage,false);
      if(branch==='timeout')assert.equal(before.state.trigger,null);
      else assert.equal(before.state.phase,'glitching');
      await advance(branch==='timeout'?5.42:.42);
      const glitch=await capture(page,output,`${prefix}reality-ending-${branch}-glitch.png`);
      assert.equal(glitch.state.trigger,branch);assert.equal(glitch.state.phase,'glitching');
      assert.ok(glitch.opacity>0&&glitch.opacity<1);assert.ok(glitch.nonWhite<before.nonWhite);
      await advance(branch==='timeout'?6:1);
      const white=await capture(page,output,`${prefix}reality-ending-${branch}-white.png`);
      assert.equal(white.state.phase,'white');assert.equal(white.state.returnedCount,0);
      assert.equal(white.nonWhite,0);assert.equal(white.minAlpha,255);assert.equal(white.opacity,0);
      assert.equal(white.authoredVisible,false);assert.equal(white.audio.realityFinished,true);
      const endpoint=await page.evaluate(()=>{
        const d=window.__debug,e=window.__endingCheck;
        return {world:d.holeWorldRotation.snapshot().phase,collapse:d.hallwayCollapse.snapshot().phase,
          lights:e.lights.length-e.branchCounts.lights,narrations:e.narrations.length-e.branchCounts.narrations,
          rumble:d.fractureRumble.snapshot().playing,lifecycle:window.__collapseCheck.lifecycle};
      });
      assert.equal(endpoint.world,'complete');assert.equal(endpoint.lights,1);assert.equal(endpoint.narrations,1);
      assert.equal(endpoint.rumble,false);assert.deepEqual(endpoint.lifecycle,{sessionEnds:0,contextLosses:0});
      if(branch==='timeout')assert.notEqual(endpoint.collapse,'complete','The deadline uses explosion end, before residual fading finishes.');
      white.camera.forEach((v,i)=>assert.ok(Math.abs(v-before.camera[i])<1e-7,'Fallback never turns or moves the viewpoint.'));
      // Let subsequent authored bursts advance behind the white scene. None may
      // restart rumble over the solo final narration.
      const lateRumble=await page.evaluate(()=>{
        const s=window.__collapseCheck,d=window.__debug,before=d.fractureRumble.snapshot().playCount;
        const next=d.hallwayCollapse.snapshot().blasts.find(b=>b.age<0);
        if(next){
          let remaining=next.start+.05-d.hallwayCollapse.snapshot().elapsedSeconds;
          while(remaining>1e-9){const dt=Math.min(.25,remaining);s.collapseUpdate.call(d.hallwayCollapse,{dt,eligible:true,upright:true,
            positionWorld:d.camera.position.toArray(),presentation:d.holeWorldRotation.matrix()});remaining-=dt;}
        }
        s.endingStopAt=undefined;s.paused=false;return {before,nextId:next?.id??null};
      });
      await nativeFrame(page);await nativeFrame(page);
      assert.equal(await page.evaluate(()=>window.__debug.fractureRumble.snapshot().playing),false);
      assert.equal(await page.evaluate(()=>window.__debug.fractureRumble.snapshot().playCount),lateRumble.before);
      if(branch==='boundary')assert.notEqual(lateRumble.nextId,null,'Boundary finale must test a genuinely upcoming blast.');
      results.push({branch,before,glitch,white,endpoint,lateRumble});
    } finally {
      await page.evaluate(()=>{
        const d=window.__debug,e=window.__endingCheck;if(e.boundarySnapshot)d.desktopBoundary.snapshot=e.boundarySnapshot;
        delete e.boundarySnapshot;window.__collapseCheck.paused=true;
      });
    }
  }
  return results;
}

/** Extends one actual collapse/portal path through the timed white ending. */
export async function runRealityEndingScenario(page,output,options={}) {
  await page.waitForFunction(()=>window.__debug.realityEnding&&window.__debug.realityEndingEffects);
  await page.evaluate(()=>{
    const {experience,lightFlickerAudio}=window.__debug;
    const e={finish:experience.gameplayAudio.finishReality,light:lightFlickerAudio.play,narrations:[],lights:[]};window.__endingCheck=e;
    experience.gameplayAudio.finishReality=function(...args){e.narrations.push(window.__debug.realityEnding.snapshot());return e.finish.apply(this,args);};
    lightFlickerAudio.play=function(...args){e.lights.push(window.__debug.realityEnding.snapshot());return e.light.apply(this,args);};
  });
  try {
    const result=await runHallwayCollapseScenario(page,output,{...options,
      beforeReturn:async()=>{
        const accepted=await page.evaluate(()=>{
          const lighting=window.__debug.hallwayLighting;
          return lighting.setLightsOutBrightness(.3)&&lighting.setLightsOut(true);
        });
        assert.equal(accepted,true,'The return fixture must recreate the existing dimmed hallway.');
        await page.waitForFunction(()=>!window.__debug.hallwayLighting.snapshot().fading,undefined,{timeout:3000});
        await page.evaluate(()=>{window.__collapseCheck.endingStopAt=0;});
      },
      onReturning:async(_page,{prefix})=>{
        const returning=await capture(page,output,`${prefix}reality-ending-returning.png`);
        assert.equal(returning.state.phase,'returning');assert.equal(returning.state.originalDamage,true);assert.equal(returning.effects.active,true);
        await nativeFrame(page);await page.evaluate(()=>{window.__collapseCheck.paused=false;});
      },
      onReturned:async(_page,{prefix})=>{
        const endpoint=await page.evaluate(()=>window.__collapseCheck.endingEndpoint);
        assert.ok(endpoint,'The ending must observe the actual automatic portal endpoint.');
        assert.equal(endpoint.state.dimensionSeconds,0);assert.equal(endpoint.state.returnedCount,1);
        assert.ok(Math.abs(endpoint.state.capturedBrightness-.3)<1e-7);
        const ends=await originalEnds(page);
        for(const direction of ends.directions){
          assert.ok(direction.near.length>=4,'Near user-area comparison needs visible original scan pixels.');
          assert.ok(direction.near.every(p=>p.delta===0),`The protected original area stays unchanged: ${JSON.stringify(direction.near)}`);
          assert.ok(direction.far.filter(p=>p.after&&765-p.after[0]-p.after[1]-p.after[2]<=6&&p.after[3]===255).length>=2,
            `The original end must already be white: ${JSON.stringify(direction)}`);
          assert.ok(direction.rows.some(row=>row.changed>0&&row.surviving>0),'The original damage approach retains irregular survivors.');
        }
        await advanceTo(page,.35);
        const relight=await capture(page,output,`${prefix}reality-ending-relight.png`);
        assert.equal(relight.state.phase,'relighting');assert.ok(relight.state.brightness>.3&&relight.state.brightness<.9);
        assert.equal(relight.lights.length,1);assert.equal(relight.narrations.length,0);assert.equal(relight.opacity,1);
        await advanceTo(page,1.1);
        const hold=await capture(page,output,`${prefix}reality-ending-original-damage.png`);
        assert.equal(hold.state.phase,'holding');assert.equal(hold.state.brightness,1);assert.ok(hold.nonWhite>100);
        await advanceTo(page,4.9);
        const beforeGlitch=await capture(page,output,`${prefix}reality-ending-before-glitch.png`);
        assert.equal(beforeGlitch.state.phase,'holding');assert.equal(beforeGlitch.opacity,1);assert.equal(beforeGlitch.narrations.length,0);
        await advanceTo(page,5);
        await advanceTo(page,5.42);
        const glitch=await capture(page,output,`${prefix}reality-ending-world-glitch.png`);
        assert.equal(glitch.state.phase,'glitching');assert.ok(glitch.opacity>0&&glitch.opacity<1);assert.ok(glitch.glitch>0);
        assert.ok(glitch.nonWhite<beforeGlitch.nonWhite,'The whole-world glitch removes actual authored pixels.');
        assert.equal(glitch.lights.length,2);assert.equal(glitch.lights[1].dimensionSeconds,5);assert.equal(glitch.narrations.length,0);
        await advanceTo(page,6);
        const white=await capture(page,output,`${prefix}reality-ending-white.png`);
        assert.equal(white.state.phase,'white');assert.equal(white.state.dimensionSeconds,6);assert.equal(white.state.narrationCount,1);
        assert.equal(white.opacity,0);assert.equal(white.authoredVisible,false);assert.equal(white.nonWhite,0);assert.equal(white.minAlpha,255);
        assert.equal(white.narrations.length,1);assert.equal(white.narrations[0].dimensionSeconds,6);assert.equal(white.audio.realityFinished,true);
        white.camera.forEach((v,i)=>assert.ok(Math.abs(v-endpoint.camera[i])<1e-7,'The ending never changes the physical camera.'));
        await nativeFrame(page);await nativeFrame(page);
        assert.equal(await page.evaluate(()=>window.__endingCheck.narrations.length),1,'The full ending line is requested once.');
        const fallbackResults=await fallbacks(page,output,prefix);
        return {endpoint,ends,relight,hold,beforeGlitch,glitch,white,fallbacks:fallbackResults,
          events:await page.evaluate(()=>window.__collapseCheck.endingEvents),
          screenshots:['returning','relight','original-damage','before-glitch','world-glitch','white'].map(s=>`${prefix}reality-ending-${s}.png`)};
      }});
    await nativeFrame(page);await nativeFrame(page);
    const recovered=await page.evaluate(()=>({state:window.__debug.realityEnding.snapshot(),effects:window.__debug.realityEndingEffects.snapshot(),
      narrationRequests:window.__endingCheck.narrations.length,lightRequests:window.__endingCheck.lights.length}));
    assert.equal(recovered.state.active,false);assert.equal(recovered.effects.opacity,1);assert.equal(recovered.effects.active,false);
    assert.equal(recovered.narrationRequests,3);assert.equal(recovered.lightRequests,4);
    return {...result,recovered};
  } finally {
    await page.evaluate(()=>{
      const e=window.__endingCheck;if(!e)return;
      window.__debug.experience.gameplayAudio.finishReality=e.finish;window.__debug.lightFlickerAudio.play=e.light;delete window.__endingCheck;
    });
  }
}
