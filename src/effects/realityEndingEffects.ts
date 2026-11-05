import { Matrix4, Vector3, type ShaderMaterial } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import type { Point3 } from '../boundary/geometry.ts';
import { captureRealityDamage, protectRealityUser, type RealityDamageCapture } from '../experience/realityEndingDamage.ts';
import { realityDamageGLSL, realityEndingUniforms } from './realityEndingShader.ts';

/** Independent presentation opacity leaves calibration's opacity ownership intact. */
export function createRealityEndingEffects(options:{scanRoot:DropInViewer;getCenters():Float32Array|undefined;setEnvironmentVisible(visible:boolean):void}) {
  let capture:RealityDamageCapture|null=null, active=false, opacity=1, glitch=0, seed=0, ready=false;
  const material=()=>options.scanRoot.viewer?.splatMesh?.material as ShaderMaterial|undefined;
  const sync=()=>{
    const u=material()?.uniforms;if(!u?.uRealityDamage)return;
    u.uRealityDamage.value.set(active?1:0,capture?.safeRange[0]??-4,capture?.safeRange[1]??4,seed);
    if(capture){u.uRealityRawToRoute.value.fromArray(capture.rawToRoute);u.uRealityEnds.value.set(...capture.endRange);}
    u.uRealityOpacity.value=opacity;u.uRealityGlitch.value=glitch;
  };
  return {
    initialize(){
      const m=material();if(!m)throw Error('Ending needs the loaded shared splat material.');
      if(!m.uniforms.uRealityDamage){
        const covariance='mat3 J;';
        if(!m.vertexShader.includes(covariance)||!m.vertexShader.includes('float collapseNoise'))throw Error('Prepare corridor disintegration before the ending.');
        m.vertexShader=realityDamageGLSL+m.vertexShader.replace(covariance,`
          if(uRealityOpacity<=0.001){gl_Position=vec4(0,0,2,1);return;}
          if(int(sceneIndex)==0 && uRealityDamage.x>0.5){
            vec3 p=(uRealityRawToRoute*vec4(splatCenter,1.0)).xyz;
            vec3 axis=vec3(uRealityRawToRoute[0][2],uRealityRawToRoute[1][2],uRealityRawToRoute[2][2]);
            float sigma=sqrt(max(0.0,dot(axis,Vrk*axis)));
            float clearance=max(uRealityDamage.y-p.z,p.z-uRealityDamage.z)-4.0*sigma-0.15;
            if(clearance>0.0){
              float lost=realityEndLoss(p)*smoothstep(0.0,1.0,clearance);
              float cluster=collapseNoise(p*vec3(3.5,3.5,2.5)+0.37*uRealityDamage.w);
              float grain=mix(0.04,0.96,pow(0.85*cluster+0.15*collapseHash(floor(splatCenter*137.0)),1.5));
              float survive=1.0-smoothstep(grain-0.07,grain+0.09,lost);
              vColor.a*=survive;
              if(survive<0.001){gl_Position=vec4(0,0,2,1);return;}
            }
          }
          if(uRealityGlitch>0.0){
            float slice=floor(splatCenter.y*7.0)+floor(uRealityGlitch*27.0);
            float dropout=collapseHash(vec3(slice,floor(splatCenter.x*2.0),floor(splatCenter.z*2.0)));
            if(dropout>uRealityOpacity){gl_Position=vec4(0,0,2,1);return;}
            viewCenter.x+=sin(slice*17.1)*uRealityGlitch*0.08;
          }
          vColor.a*=uRealityOpacity;
          ${covariance}`);
        Object.assign(m.uniforms,realityEndingUniforms());m.needsUpdate=true;
      }
      ready=true;sync();
    },
    arm(input:{routeToWorld:readonly number[];positionWorld:Point3;openingRange:readonly[number,number];boundaryPoints?:readonly Point3[]|null;seed?:number}):boolean {
      if(capture)return true;
      const centers=options.getCenters();if(!ready||!centers)return false;
      options.scanRoot.updateWorldMatrix(true,false);
      const worldToRoute=new Matrix4().fromArray(input.routeToWorld).invert();
      const rawToRoute=worldToRoute.clone().multiply(options.scanRoot.matrixWorld);
      const point=new Vector3(...input.positionWorld).applyMatrix4(worldToRoute).toArray();
      capture=captureRealityDamage(centers,rawToRoute,point,input.openingRange,
        input.boundaryPoints?.map(p=>new Vector3(...p).applyMatrix4(worldToRoute).z));
      seed=((input.seed??0x51ce2026)>>>0)%1000;sync();return !!capture;
    },
    update(state:{originalDamage:boolean;environmentOpacity:number;glitchProgress:number},positionWorld?:Point3|null){
      active=state.originalDamage&&!!capture;opacity=state.environmentOpacity;glitch=state.glitchProgress;
      if(active&&capture&&positionWorld){
        const rawToRoute=new Matrix4().fromArray(capture.rawToRoute);
        options.scanRoot.updateWorldMatrix(true,false);
        const worldToRoute=rawToRoute.multiply(options.scanRoot.matrixWorld.clone().invert());
        protectRealityUser(capture,new Vector3(...positionWorld).applyMatrix4(worldToRoute).z);
      }
      options.setEnvironmentVisible(opacity>0.001);sync();
    },
    reset(){capture=null;active=false;opacity=1;glitch=0;options.setEnvironmentVisible(true);sync();},
    snapshot:()=>({ready,active,opacity,glitch,seed,rawToRoute:capture?[...capture.rawToRoute]:null,
      safeRange:capture?[...capture.safeRange]:null,endRange:capture?[...capture.endRange]:null}),
  };
}
