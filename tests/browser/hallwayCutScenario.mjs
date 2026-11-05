import assert from 'node:assert/strict';
import path from 'node:path';

/** Actual shared renderer, asymmetric corridor and calibrated trapezoid. */
export async function runHallwayCutScenario(page, output, {privateAsset = false} = {}) {
  const saved = await page.evaluate(() => {
    const {camera,controls,splats,experience,floorHole}=window.__debug;
    const mesh=splats.viewer.splatMesh;
    window.__cutResources={geometry:mesh.geometry,material:mesh.material,textures:mesh.splatDataTextures,worker:splats.viewer.sortWorker};
    const state={camera:camera.position.toArray(),target:controls.target.toArray(),damping:controls.enableDamping,
      props:Array.from({length:splats.getSceneCount()-1},(_,i)=>({i:i+1,visible:splats.getSplatScene(i+1).visible}))};
    window.__cutExperienceUpdate=experience.update;
    controls.enableDamping=false;experience.update=()=>{};floorHole.close();return state;
  });
  try {
    await page.locator('#experience-floor-hole').click({timeout:60000});
    const evidence=await page.evaluate(async () => {
      const THREE=await import('/node_modules/.vite/deps/three.js');
      const {renderer,scene,camera,controls,splats,floorHole,hallwayCut}=window.__debug;
      const hole=floorHole.snapshot(), cut=hallwayCut.snapshot();
      if(!hole.open||!cut.visible||cut.error)throw Error(`Cutout did not attach: ${JSON.stringify({hole,cut})}`);
      const mouth=cut.mouthWorld;
      if(!hole.worldCorners.every(corner=>mouth.some(p=>new THREE.Vector3(...p).distanceTo(new THREE.Vector3(...corner))<1e-7)))throw Error('Mouth corners are disconnected.');
      const frame=new THREE.Matrix4().fromArray(hole.routeToWorld), middle=(hole.startZ+hole.endZ)/2;
      camera.position.copy(new THREE.Vector3(0,2.1,hole.endZ+1.6).applyMatrix4(frame));
      controls.target.copy(new THREE.Vector3(0,-1,middle).applyMatrix4(frame));controls.update();camera.updateMatrixWorld(true);
      window.__debug.spawnMarker.visible=false;
      const settle=async promise=>{let timer;try{await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Cutout sort timeout')),45000);})]);}finally{clearTimeout(timer);}};
      scene.updateMatrixWorld(true);splats.viewer.update(renderer,camera);await settle(splats.viewer.sortPromise);
      splats.viewer.splatMesh.updateTransforms();await settle(splats.viewer.runSplatSort(true,true));await settle(splats.viewer.sortPromise);
      const crop=splats.getSplatScene(cut.sceneIndex),gl=renderer.getContext();
      const read=(x,z)=>{
        const point=new THREE.Vector3(x,0,z).applyMatrix4(frame).project(camera),bytes=new Uint8Array(4);
        gl.readPixels(Math.floor((point.x+1)*gl.drawingBufferWidth/2),Math.floor((point.y+1)*gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
        return [...bytes.slice(0,3)];
      };
      const probes=[];
      for(const s of [.1,.25,.5,.75,.9]) {
        const left=THREE.MathUtils.lerp(hole.nearBounds[0],hole.farBounds[0],s),right=THREE.MathUtils.lerp(hole.nearBounds[1],hole.farBounds[1],s);
        for(const t of [.15,.35,.5,.65,.85])probes.push([THREE.MathUtils.lerp(left,right,t),THREE.MathUtils.lerp(hole.startZ,hole.endZ,s)]);
      }
      const outside=[[0,hole.startZ-.08],[0,hole.endZ+.08]];
      crop.visible=false;renderer.render(scene,camera);const empty=probes.map(p=>read(...p)),outsideEmpty=outside.map(p=>read(...p));
      crop.visible=true;renderer.render(scene,camera);const connected=probes.map(p=>read(...p)),outsideConnected=outside.map(p=>read(...p));
      const changed=connected.filter((rgb,i)=>rgb.some((v,c)=>Math.abs(v-empty[i][c])>15)).length;
      if(changed<10)throw Error(`Connected hallway is absent in aperture (${changed}/25): ${JSON.stringify(connected)}`);
      if(JSON.stringify(outsideEmpty)!==JSON.stringify(outsideConnected))throw Error('Cutout leaked beyond the floor opening.');
      const originalRoot={p:splats.position.clone(),q:splats.quaternion.clone()};
      const before=hallwayCut.snapshot().mouthWorld;
      splats.position.x+=.37;splats.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.4));
      splats.updateWorldMatrix(true,false);floorHole.update();hallwayCut.update();
      const after=hallwayCut.snapshot().mouthWorld;
      if(JSON.stringify(before)!==JSON.stringify(after))throw Error('A later scan edit detached the frozen mouth.');
      splats.position.copy(originalRoot.p);splats.quaternion.copy(originalRoot.q);splats.updateWorldMatrix(true,false);hallwayCut.update();
      const resources=window.__cutResources,mesh=splats.viewer.splatMesh;
      const debug=gl.getExtension('WEBGL_debug_renderer_info');
      return {hole,cut,changedProbes:changed,empty,connected,outsideEmpty,outsideConnected,stableMouth:true,
        sourceSplats:splats.getSplatScene(0).splatBuffer.getSplatCount(),cutoutSplats:crop.splatBuffer.getSplatCount(),
        rendererBackend:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unavailable',
        resourcesStable:resources.geometry===mesh.geometry&&resources.material===mesh.material&&resources.textures===mesh.splatDataTextures&&resources.worker===splats.viewer.sortWorker};
    });
    assert.equal(evidence.resourcesStable,true);
    await page.screenshot({path:path.join(output,`${privateAsset?'private-':''}hole-hallway-connected.png`),fullPage:true,timeout:60000});
    await page.locator('#experience-floor-hole').click({timeout:60000});
    assert.equal(await page.evaluate(()=>window.__debug.hallwayCut.snapshot().visible),false);
    await page.locator('#experience-floor-hole').click({timeout:60000});
    await page.locator('#experience-stop').click({timeout:60000});
    assert.equal(await page.evaluate(()=>window.__debug.hallwayCut.snapshot().visible),false);
    await page.locator('#experience-reset').click({timeout:60000});
    return evidence;
  } finally {
    await page.evaluate(saved=>{
      const {camera,controls,floorHole,splats,experience}=window.__debug;floorHole.close();
      experience.update=window.__cutExperienceUpdate;delete window.__cutExperienceUpdate;
      camera.position.fromArray(saved.camera);controls.target.fromArray(saved.target);controls.enableDamping=saved.damping;controls.update();
      for(const {i,visible}of saved.props)if(i!==window.__debug.hallwayCut.snapshot().sceneIndex)splats.getSplatScene(i).visible=visible;
    },saved);
  }
}
