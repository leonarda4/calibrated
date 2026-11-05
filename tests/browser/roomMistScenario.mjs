import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Full-height mist is attached only to the same added corridor as the stretched fog. */
export async function runRoomMistScenario(page,output,{privateAsset=false}={}){
  const result=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/.vite/deps/three.js');
    const {MIST}=await import('/src/effects/roomMistConfig.ts');
    const {HoleWorldRotation}=await import('/src/experience/holeWorldRotation.ts');
    const {scene,renderer,camera,controls,splats,hallwayMist:mist,hallwayFog:fog,experience,floorHole,hallwayCut,worldPresentation}=window.__debug;
    const ensure=(ok,msg)=>{if(!ok)throw Error(msg);};
    ensure(mist.snapshot().phase==='ready','Mist did not load: '+mist.snapshot().error);
    const saved={camera:camera.position.clone(),target:controls.target.clone(),up:camera.up.clone(),damping:controls.enableDamping,
      update:mist.update,experience:experience.update,fog:fog.snapshot().visibleRequested,visible:mist.snapshot().visibleRequested,density:mist.snapshot().density};
    const target=new THREE.WebGLRenderTarget(512,384),oldTarget=renderer.getRenderTarget(),images={};
    const mesh=mist.root.children[0],resources=[mesh.geometry,mesh.material];let presentation=new THREE.Matrix4();
    experience.update=()=>{};mist.update=()=>saved.update(0);controls.enableDamping=false;fog.setVisible(false);floorHole.close();
    const move=(from,to,up=new THREE.Vector3(0,1,0))=>{camera.up.copy(up);camera.position.copy(from);controls.target.copy(to);controls.update();camera.updateMatrixWorld(true);};
    const settle=async()=>{scene.updateMatrixWorld(true);splats.viewer.update(renderer,camera);await splats.viewer.sortPromise;
      splats.viewer.splatMesh.updateTransforms();await splats.viewer.runSplatSort(true,true);await splats.viewer.sortPromise;};
    const render=(visible,name)=>{
      worldPresentation.beginFrame();hallwayCut.update();mist.setVisible(visible);fog.update(0);worldPresentation.apply(presentation);
      scene.updateMatrixWorld(true);splats.viewer.splatMesh.updateTransforms();
      renderer.setRenderTarget(target);renderer.render(scene,camera);
      const bytes=new Uint8Array(512*384*4);renderer.readRenderTargetPixels(target,0,0,512,384,bytes);renderer.setRenderTarget(oldTarget);
      if(name){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=384;
        const ctx=canvas.getContext('2d'),p=ctx.createImageData(512,384);
        for(let y=0;y<384;y++)p.data.set(bytes.subarray(y*512*4,(y+1)*512*4),(383-y)*512*4);
        ctx.putImageData(p,0,0);images[name]=canvas.toDataURL('image/png').split(',')[1];}
      return bytes;
    };
    const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>6)n++;return n;};
    const probe=(a,b,p)=>{
      const q=p.clone().project(camera),x=Math.round((q.x+1)*256),y=Math.round((q.y+1)*192);
      ensure(x>1&&x<510&&y>1&&y<382,'Mist probe outside canvas');let n=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(let c=0;c<3;c++){
        const i=((y+dy)*512+x+dx)*4+c;n=Math.max(n,Math.abs(a[i]-b[i]));}return n;
    };
    try{
      ensure(mist.snapshot().volumes.length===1,'Original hallway mist volumes were not removed');
      for(const sign of [-1,1]){
        move(new THREE.Vector3(0,1.55,0),new THREE.Vector3(0,1.5,sign*18));await settle();
        ensure(diff(render(false),render(true,'mist-original-clear-'+sign))===0,'Closed added corridor leaves mist in original hallway');
      }
      ensure(floorHole.show(),'Could not open the added hallway');hallwayCut.update();saved.update(0);
      const initial=mist.snapshot(),canonical=mesh.matrix.clone();
      ensure(initial.height===2.6&&initial.volumes[0].min[2]===5&&initial.volumes[0].max[2]===33,'Mist moved away from the fog region');
      const originalEnds=[];
      for(const sign of [-1,1]){
        move(new THREE.Vector3(0,1.55,0),new THREE.Vector3(0,1.5,sign*18));await settle();
        const off=render(false),on=render(true);const change=probe(off,on,new THREE.Vector3(0,1.5,sign*18));
        ensure(change===0,'Mist still occupies an original hallway end');originalEnds.push({sign,probeDifference:change});
      }
      const local=(x,y,z)=>new THREE.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld);
      const setView=(depth=-1)=>{scene.updateMatrixWorld(true);move(local(0,1.55,depth),local(0,1,depth+12),new THREE.Vector3(0,1,0).transformDirection(mesh.matrixWorld));};
      setView();await settle();const off=render(false,'mist-downward-off'),on=render(true,'mist-downward-before-turn');
      const changed=diff(off,on);ensure(changed>100,'No mist in the added hallway');
      // Probe actual near surfaces. A ray through empty air in the clear gap
      // legitimately sees full-height mist farther down the corridor.
      const gapProbe=probe(off,on,local(0,.12,4.3)),wallProbe=probe(off,on,local(1.02,1.3,2));
      ensure(gapProbe===0&&wallProbe===0,'Mist escapes its near gap or walls: '+gapProbe+'/'+wallProbe);
      const material=splats.viewer.splatMesh.material,opacity=material.uniforms.uGlobalOpacity,brightness=material.uniforms.uHallwayBrightness;
      const priorOpacity=opacity.value,priorBrightness=brightness.value;
      try{opacity.value=0;ensure(diff(render(false),render(true))===0,'Hidden scan leaves visible mist');
        opacity.value=priorOpacity;brightness.value=0;ensure(diff(render(false),render(true))===0,'Black lighting leaves visible mist');
      }finally{opacity.value=priorOpacity;brightness.value=priorBrightness;}
      const turn=new HoleWorldRotation();ensure(turn.start({...floorHole.snapshot(),floorSide:hallwayCut.snapshot().floorSide}),'Invalid turn');
      const phases=[{name:'before-turn',matrix:new THREE.Matrix4()}];
      for(let i=1;i<=8;i++){turn.update(.5,true);if(i===4||i===8)phases.push({name:i===4?'mid-turn':'after-turn',matrix:turn.matrix().clone()});}
      ensure(turn.returnToOriginal(),'Invalid return');
      for(let i=1;i<=8;i++){turn.update(.5,true);if(i===4||i===8)phases.push({name:i===4?'mid-return':'after-return',matrix:turn.matrix().clone()});}
      const renderedPhases=[];
      for(const phase of phases){
        presentation=phase.matrix;render(true);const expected=phase.matrix.clone().multiply(canonical);
        ensure(mesh.matrixWorld.elements.every((n,i)=>Math.abs(n-expected.elements[i])<1e-7),'Mist detached during '+phase.name);
        setView();await settle();const count=diff(render(false),render(true,'mist-downward-'+phase.name));
        ensure(count>100,'Mist vanished during '+phase.name);renderedPhases.push({phase:phase.name,changedPixels:count});
      }
      setView();await settle();const still=render(true);for(let i=0;i<60;i++)saved.update(.5);
      ensure(diff(still,render(true,'mist-downward-drift'))>50,'Mist does not drift');
      fog.setVisible(true);render(true,'combined-downward-atmosphere');fog.setVisible(false);
      ensure(mesh.geometry===resources[0]&&mesh.material===resources[1],'Mist rebuilt resources');
      floorHole.close();saved.update(0);ensure(!mist.snapshot().visible,'Mist survives closing the added corridor');
      return {height:initial.height,density:saved.density,startDepth:MIST.startDepth,endDepth:MIST.endDepth,originalEnds,
        changedPixels:changed,gapProbe,wallProbe,renderedPhases,scanAndLightingFade:true,drift30Seconds:true,noResourceRebuild:true,closeHides:true,images};
    }finally{
      worldPresentation.reset();floorHole.close();mist.update=saved.update;mist.setDensity(saved.density);mist.setVisible(saved.visible);
      fog.setVisible(saved.fog);experience.update=saved.experience;camera.up.copy(saved.up);camera.position.copy(saved.camera);
      controls.target.copy(saved.target);controls.update();controls.enableDamping=saved.damping;renderer.setRenderTarget(oldTarget);target.dispose();
    }
  });
  await page.locator('#experience-mist-control details').evaluate(element=>{element.open=true;});
  await page.locator('#experience-mist-toggle').click();assert.equal(await page.evaluate(()=>window.__debug.hallwayMist.snapshot().visibleRequested),false);
  await page.locator('#experience-mist-density').evaluate(slider=>{slider.value='35';slider.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>window.__debug.hallwayMist.snapshot().density),.35);
  await page.locator('#experience-mist-toggle').click();await page.evaluate(density=>window.__debug.hallwayMist.setDensity(density),result.density);
  result.operatorControls=true;
  for(const[name,data]of Object.entries(result.images))await fs.writeFile(path.join(output,(privateAsset?'private-':'')+name+'.png'),Buffer.from(data,'base64'));
  delete result.images;assert.equal(result.originalEnds.length,2);return {...result,asset:privateAsset?'original hallway and cutout, supplied mist':'synthetic hallway and cutout, supplied mist'};
}
