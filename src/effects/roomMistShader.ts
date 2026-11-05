import { MIST } from './roomMistConfig.ts';
import { collapseDamageGLSL } from './collapseDamage.ts';

export const mistVertex = `
  varying vec3 vLocal;
  void main() { vLocal=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
export const mistFragment = `
  precision highp sampler3D;
  uniform sampler3D uDensity;
  ${collapseDamageGLSL}
  uniform vec3 uTextureMin,uTextureSize,uMin,uMax;
  uniform vec4 uSides;
  uniform mat4 uWorldToMist;
  uniform float uTime,uOpacity,uBrightness,uStrength,uGroundBoost,uPortalHeight;
  varying vec3 vLocal;
  vec2 sides(float z) { return mix(uSides.xy,uSides.zw,(z-uMin.z)/(uMax.z-uMin.z)); }
  float density(vec3 p,vec3 eye) {
    float a=texture(uDensity,(p+vec3(.03,0.0,.08)*uTime-uTextureMin)/uTextureSize).r;
    float b=texture(uDensity,(p*1.4+vec3(-.02,.005,.05)*uTime-uTextureMin)/uTextureSize).r;
    float ground=mix(1.0,uGroundBoost,1.0-smoothstep(0.0,1.2,p.y));
    float nearEye=smoothstep(.2,.8,distance(p,eye));
    vec2 walls=sides(p.z);
    float edge=smoothstep(${MIST.wallInset},${MIST.wallInset+MIST.wallFade},min(p.x-walls.x,walls.y-p.x));
    edge*=smoothstep(0.0,${MIST.endFade}.0,min(p.z-uMin.z,uMax.z-p.z));
    float damage=collapseDamage(p);
    return mix(a,b,.35)*ground*nearEye*edge*uStrength*(1.0-damage);
  }
  void main() {
    if(uOpacity<=0.0 || uStrength<=0.0 || uBrightness<=0.0) discard;
    vec3 eye=(uWorldToMist*inverse(viewMatrix)*vec4(0.0,0.0,0.0,1.0)).xyz;
    vec3 ray=normalize(vLocal-eye);
    if(eye.z<0.0){
      if(ray.z<=0.0)discard;
      vec3 mouth=eye+ray*(-eye.z/ray.z);vec2 edge=sides(0.0);
      if(mouth.x<edge.x+${MIST.wallInset}||mouth.x>edge.y-${MIST.wallInset}||mouth.y<0.0||mouth.y>uPortalHeight)discard;
    }else{
      vec2 corridor=sides(eye.z);
      if(eye.x<corridor.x||eye.x>corridor.y||eye.y<0.0||eye.y>uPortalHeight+.2)discard;
    }
    vec3 safeRay=vec3(ray.x==0.0?1e-7:ray.x,ray.y==0.0?1e-7:ray.y,ray.z==0.0?1e-7:ray.z);
    vec3 a=(uMin-eye)/safeRay,b=(uMax-eye)/safeRay;
    float enter=max(0.0,max(max(min(a.x,b.x),min(a.y,b.y)),min(a.z,b.z)));
    float exit=min(min(max(a.x,b.x),max(a.y,b.y)),max(a.z,b.z));
    if(exit<=enter) discard;
    float dt=(exit-enter)/${MIST.steps}.0;
    float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
    float transmission=1.0;
    for(int i=0;i<${MIST.steps};i++) {
      vec3 p=eye+ray*(enter+(float(i)+jitter)*dt);
      transmission*=exp(-density(p,eye)*dt);
      if(transmission<.02) break;
    }
    float alpha=(1.0-transmission)*uOpacity;
    if(alpha<.001) discard;
    gl_FragColor=vec4(vec3(.78,.8,.84)+(jitter-.5)/255.0,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb*=uBrightness;
  }
`;
