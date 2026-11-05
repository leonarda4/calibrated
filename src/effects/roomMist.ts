import * as THREE from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { loadVolume, type VolumeMetadata } from './volumeTexture.ts';
import { HALLWAY_CUT,cutOpeningFromMetadata,type HoleMouth,type Point3 } from '../viewer/hallwayCutPlacement.ts';
import { corridorAtmosphereMatrix,stretchVolumeHeight } from './corridorAtmosphere.ts';
import { MIST } from './roomMistConfig.ts';
import { mistVertex, mistFragment } from './roomMistShader.ts';
import { destructionUniforms,writeDestructionUniforms,type CutoutDestructionMask } from './collapseDamage.ts';

export function createRoomMist(options: {
  scene: THREE.Scene; scanRoot: DropInViewer; getHole(): HoleMouth; getSecondBoxRoute(): Point3|null;
  getDestruction?(): CutoutDestructionMask; canRender(): boolean; enabled?: boolean;
}) {
  const root=new THREE.Group(); root.name='downward-hallway-mist'; root.visible=false; options.scene.add(root);
  const meshes: THREE.Mesh<THREE.BoxGeometry,THREE.ShaderMaterial>[]=[];
  const abort=new AbortController();
  let phase:'loading'|'ready'|'off'|'error'=options.enabled===false?'off':'loading';
  let error:string|null=null, texture:THREE.Data3DTexture|null=null, spec:VolumeMetadata|null=null;
  let disposed=false, visibleRequested=true, strength:number=MIST.density, time=0,height=0,cutKey='';
  const scanMaterial=()=>options.scanRoot.viewer.splatMesh.material as THREE.ShaderMaterial;
  const update=(dt=0)=>{
    if(Number.isFinite(dt)&&dt>0&&dt<=.5)time+=dt;
    const hole=options.getHole();
    root.visible=!disposed&&phase==='ready'&&visibleRequested&&options.canRender()&&options.scanRoot.visible!==false&&hole.open;
    for(const mesh of meshes){
      mesh.visible=root.visible;
      if(root.visible)try{
        const signature=JSON.stringify([hole,options.getSecondBoxRoute()]);
        if(signature!==cutKey){
          mesh.matrix.copy(corridorAtmosphereMatrix(cutOpeningFromMetadata(options.scanRoot.userData.hallwayCutMetadata),hole,options.getSecondBoxRoute(),height));
          cutKey=signature;
        }
      }catch{mesh.visible=false;}
    }
    root.updateMatrixWorld(true);
  };
  return {root,update,
    async initialize(){
      if(phase==='off'||disposed)return;
      try{
        const loaded=await loadVolume(MIST.metadataUrl,MIST.densityUrl,abort.signal);
        if(disposed){loaded.texture.dispose();return;}
        texture=loaded.texture;spec=loaded.spec;
        const source=cutOpeningFromMetadata(options.scanRoot.userData.hallwayCutMetadata);
        height=source.height;
        const sampling=stretchVolumeHeight(spec,height);
        {
          const min=new THREE.Vector3(-source.width/2,0,MIST.startDepth);
          const max=new THREE.Vector3(source.width/2,height,MIST.endDepth);
          const geometry=new THREE.BoxGeometry(...max.clone().sub(min).toArray()).translate(...min.clone().add(max).multiplyScalar(.5).toArray());
          const material=new THREE.ShaderMaterial({vertexShader:mistVertex,fragmentShader:mistFragment,
            transparent:true,depthWrite:false,depthTest:true,side:THREE.BackSide,uniforms:{
              uDensity:{value:texture},uTextureMin:{value:new THREE.Vector3(...sampling.min)},uTextureSize:{value:new THREE.Vector3(...sampling.size)},
              uMin:{value:min},uMax:{value:max},uSides:{value:new THREE.Vector4(-source.width/2,source.width/2,-source.width/2,source.width/2)},
              uWorldToMist:{value:new THREE.Matrix4()},uTime:{value:0},uOpacity:{value:0},uBrightness:{value:1},
              uStrength:{value:strength},uGroundBoost:{value:spec.groundBoost},uPortalHeight:{value:source.height},
              ...destructionUniforms(),
            }});
          const mesh=new THREE.Mesh(geometry,material);mesh.name='added-hallway-mist';mesh.matrixAutoUpdate=false;mesh.renderOrder=21;
          mesh.onBeforeRender=()=>{
            const scan=scanMaterial(),u=material.uniforms;
            u.uWorldToMist.value.copy(mesh.matrixWorld).invert();u.uTime.value=time;u.uStrength.value=strength;
            u.uOpacity.value=options.scanRoot.visible===false?0:(scan.uniforms?.uGlobalOpacity?.value??1)*(scan.uniforms?.uRealityOpacity?.value??1);
            if(!options.scanRoot.getSplatScene(HALLWAY_CUT.sceneIndex).visible)u.uOpacity.value=0;
            const mask=options.getDestruction?.();if(mask)writeDestructionUniforms(u,mask);
            u.uBrightness.value=scan.uniforms?.uHallwayBrightness?.value??1;material.uniformsNeedUpdate=true;
          };
          root.add(mesh);meshes.push(mesh);
        }
        phase='ready';update();
      }catch(cause){
        if(disposed)return;phase='error';error=cause instanceof Error?cause.message:String(cause);root.visible=false;
        texture?.dispose();for(const m of meshes){m.geometry.dispose();m.material.dispose();root.remove(m);}meshes.length=0;
      }
    },
    setVisible(value:boolean){visibleRequested=value;update();},
    setDensity(value:number){if(!Number.isFinite(value)||value<0||value>MIST.maxDensity)return false;strength=value;return true;},
    async warmup(renderer:THREE.WebGLRenderer,camera:THREE.Camera){
      if(phase!=='ready'||disposed)return;
      if(texture)renderer.initTexture(texture);
      const visible=root.visible;root.visible=true;meshes.forEach(m=>{m.visible=true;});
      try{await renderer.compileAsync(root,camera);}finally{root.visible=visible;meshes.forEach(m=>{m.visible=visible;});}
    },
    snapshot:()=>({phase,error,visible:root.visible,visibleRequested,density:strength,height,time,
      volumes:meshes.map(m=>({name:m.name,matrix:m.matrix.toArray(),min:m.material.uniforms.uMin.value.toArray(),
        max:m.material.uniforms.uMax.value.toArray(),sides:m.material.uniforms.uSides.value.toArray()}))}),
    dispose(){if(disposed)return;disposed=true;abort.abort();root.visible=false;texture?.dispose();for(const m of meshes){m.geometry.dispose();m.material.dispose();}root.removeFromParent();},
  };
}
