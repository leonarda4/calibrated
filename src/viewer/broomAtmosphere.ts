import { InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, DynamicDrawUsage, type Scene } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { BROOM } from './broomConfig.ts';

/** The authored broom precedes the haze. Preserve its Gaussian silhouette by
 * drawing only its existing sorted indices after the two transparent volumes.
 * No additional sort, texture copy, opaque proxy or source-asset edit. */
export function createBroomAtmosphere(scene:Scene,scanRoot: DropInViewer, atmosphereVisible: () => boolean) {
  const source=scanRoot.viewer.splatMesh as typeof scanRoot.viewer.splatMesh & {getSceneIndexForSplat(index:number):number};
  const material=source.material as ShaderMaterial;
  const target='float splatOpacityFromScene = sceneOpacity[sceneIndex];';
  if(!material.vertexShader.includes(target))throw Error('The installed splat shader cannot separate the foreground broom.');
  material.vertexShader='uniform float uBroomForeground;\n'+material.vertexShader.replace(target,`
    if(int(sceneIndex)==${BROOM.sceneIndex} && uBroomForeground>.5){
      gl_Position=vec4(0.0,0.0,2.0,1.0);return;
    }
    ${target}`);
  material.uniforms.uBroomForeground={value:0};material.needsUpdate=true;
  const geometry=new InstancedBufferGeometry(), foreground=new ShaderMaterial().copy(material);
  // All live transforms, scene visibility, lighting, opacity and texture uniforms
  // remain owned by the original renderer. Only the pass selector is independent.
  foreground.uniforms={...material.uniforms,uBroomForeground:{value:0}};
  const layer=new Mesh(geometry,foreground);layer.name='broom-in-front-of-atmosphere';
  layer.frustumCulled=false;layer.renderOrder=22;source.add(layer);
  const original=source.onBeforeRender,originalScene=scene.onBeforeRender;
  let indices:InstancedBufferAttribute|null=null,lastVersion=-1,lastCount=-1,lastGeometry:unknown=null,filteredCount=0,disposed=false;
  const active=()=>!disposed&&scanRoot.visible!==false&&source.visible&&atmosphereVisible()&&
    scanRoot.getSplatScene(BROOM.sceneIndex).visible;
  source.onBeforeRender=function(...args){
    original.apply(this,args);material.uniforms.uBroomForeground.value=active()?1:0;material.uniformsNeedUpdate=true;
  };
  // Prepare before three.js uploads geometry, rather than changing attributes
  // inside the layer's later onBeforeRender callback (which would lag a frame).
  scene.onBeforeRender=function(...args){
    originalScene.apply(this,args);
    if(!active()){geometry.instanceCount=0;return;}
    const current=source.geometry as InstancedBufferGeometry;
    const sorted=current.getAttribute('splatIndex') as InstancedBufferAttribute;
    if(lastGeometry!==current){
      geometry.setIndex(current.index?.clone()??null);
      for(const[name,attribute]of Object.entries(current.attributes))if(name!=='splatIndex')geometry.setAttribute(name,attribute.clone());
      lastGeometry=current;lastVersion=-1;
    }
    const count=Math.min(current.instanceCount,sorted.count);
    if(lastVersion!==sorted.version||lastCount!==count){
      // Storage scales with this object; filter each newly sorted list once.
      const capacity=scanRoot.getSplatScene(BROOM.sceneIndex).splatBuffer.getSplatCount();
      if(!indices||indices.count<capacity){indices=new InstancedBufferAttribute(new Uint32Array(capacity),1);indices.setUsage(DynamicDrawUsage);geometry.setAttribute('splatIndex',indices);}
      let next=0;for(let i=0;i<count;i++){const index=sorted.getX(i);if(source.getSceneIndexForSplat(index)===BROOM.sceneIndex)indices!.setX(next++,index);}
      if(indices)indices.needsUpdate=true;
      filteredCount=next;lastVersion=sorted.version;lastCount=count;
    }
    geometry.instanceCount=filteredCount;
    // Later shader patches (e.g. recovery/ending) must reach both passes.
    if(foreground.vertexShader!==material.vertexShader||foreground.fragmentShader!==material.fragmentShader){
      foreground.vertexShader=material.vertexShader;foreground.fragmentShader=material.fragmentShader;foreground.needsUpdate=true;
    }
    for(const[name,uniform]of Object.entries(material.uniforms))if(name!=='uBroomForeground')foreground.uniforms[name]=uniform;
    foreground.uniformsNeedUpdate=true;
  };
  return {layer,
    dispose(){if(disposed)return;disposed=true;source.onBeforeRender=original;material.uniforms.uBroomForeground.value=0;
      scene.onBeforeRender=originalScene;
      layer.removeFromParent();geometry.dispose();foreground.dispose();},
  };
}
