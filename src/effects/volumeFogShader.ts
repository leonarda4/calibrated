import { FOG } from './volumeFogConfig.ts';
import { collapseDamageGLSL } from './collapseDamage.ts';

export const fogVertex = `
  varying vec3 vLocal;
  void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** Local metre sampling; every eye uses its own view matrix, including inside the volume. */
export const fogFragment = `
  precision highp sampler3D;
  uniform sampler3D uDensity;
  uniform vec3 uTextureMin, uTextureSize, uMin, uMax;
  uniform vec4 uSides;
  ${collapseDamageGLSL}
  uniform mat4 uWorldToFog;
  uniform float uTime, uOpacity, uBrightness, uPortalHeight;
  uniform float uDensityScale, uExtinction, uFogHeight;
  varying vec3 vLocal;
  vec2 sides(float z) { return mix(uSides.xy, uSides.zw, (z-uMin.z)/(uMax.z-uMin.z)); }
  float sampleDensity(vec3 p) {
    vec3 scroll=vec3(0.02,0.0,0.06)*uTime;
    float d1=texture(uDensity,(p+scroll-uTextureMin)/uTextureSize).r;
    float d2=texture(uDensity,(p*vec3(1.3,1.0,1.3)+vec3(-0.015,0.0,0.035)*uTime-uTextureMin)/uTextureSize).r;
    return mix(d1,d2,0.4)*uDensityScale;
  }
  void main() {
    if(uOpacity<=0.0) discard;
    vec3 eye=(uWorldToFog*inverse(viewMatrix)*vec4(0.0,0.0,0.0,1.0)).xyz;
    vec3 ray=normalize(vLocal-eye);
    // Analytic corridor/portal visibility compensates for missing splat depth.
    if(uPortalHeight>0.5 && eye.z<0.0) {
      if(ray.z<=0.0) discard;
      vec3 mouth=eye+ray*(-eye.z/ray.z);
      vec2 mouthSides=sides(0.0);
      if(mouth.x<mouthSides.x+${FOG.wallInset} || mouth.x>mouthSides.y-${FOG.wallInset} || mouth.y<0.0 || mouth.y>uPortalHeight) discard;
    } else {
      vec2 corridor=sides(eye.z);
      if(eye.x<corridor.x || eye.x>corridor.y || eye.y<0.0 || eye.y>2.8) discard;
    }
    vec3 safeRay=sign(ray)*max(abs(ray),vec3(1e-7));
    safeRay=vec3(safeRay.x==0.0?1e-7:safeRay.x,safeRay.y==0.0?1e-7:safeRay.y,safeRay.z==0.0?1e-7:safeRay.z);
    vec3 a=(uMin-eye)/safeRay,b=(uMax-eye)/safeRay;
    float enter=max(0.0,max(max(min(a.x,b.x),min(a.y,b.y)),min(a.z,b.z)));
    float exit=min(min(max(a.x,b.x),max(a.y,b.y)),max(a.z,b.z));
    if(exit<=enter) discard;
    float dt=(exit-enter)/${FOG.steps}.0;
    float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
    float transmittance=1.0; vec3 colour=vec3(0.0);
    vec3 light=normalize(vec3(-0.3,1.0,-0.4));
    for(int i=0;i<${FOG.steps};i++) {
      vec3 p=eye+ray*(enter+(float(i)+jitter)*dt);
      vec2 walls=sides(p.z);
      float edge=smoothstep(${FOG.wallInset},${FOG.wallInset + FOG.wallFade},min(p.x-walls.x,walls.y-p.x));
      edge*=smoothstep(0.0,${FOG.endFade},min(p.z-uMin.z,uMax.z-p.z));
      float d=sampleDensity(p)*edge;
      d*=1.0-collapseDamage(p);
      if(d>0.001) {
        float shadow=0.0;
        float lightStep=uFogHeight/float(${FOG.lightSteps});
        for(int j=1;j<=${FOG.lightSteps};j++) {
          vec3 q=p+light*(float(j)*lightStep);
          if(q.y<=uFogHeight) shadow+=sampleDensity(q)*lightStep;
        }
        vec3 lit=mix(vec3(0.32,0.34,0.36),vec3(0.8,0.85,0.9),exp(-uExtinction*shadow));
        float alpha=1.0-exp(-uExtinction*d*dt);
        colour+=transmittance*alpha*lit; transmittance*=1.0-alpha;
        if(transmittance<0.02) break;
      }
    }
    float alpha=(1.0-transmittance)*uOpacity;
    if(alpha<0.001) discard;
    gl_FragColor=vec4(colour/max(1e-5,1.0-transmittance)+(jitter-0.5)/255.0,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Match the scan's baked display-colour dimming, rather than applying the
    // same number in linear light and leaving fog too bright in lights-out.
    gl_FragColor.rgb *= uBrightness;
  }
`;
