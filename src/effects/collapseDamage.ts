import { Vector4, type IUniform } from 'three';
import type { CollapseDamagePatch } from '../experience/hallwayCollapse.ts';

export interface CutoutDestructionMask {
  active: boolean;
  frontDepth: number;
  protectedDepth: number;
  feather: number;
  patches?: readonly CollapseDamagePatch[];
}

export const COLLAPSE_PATCH_LIMIT = 10;

export function destructionUniforms(): Record<string, IUniform> {
  return {
    // y/z retain diagnostic compatibility; damage comes only from local patches.
    uCutoutDestruction: { value: new Vector4(0, 0, .75, 6) },
    uCollapsePatchCount: { value: 0 },
    uCollapsePatchCenters: { value: Array.from({ length: COLLAPSE_PATCH_LIMIT }, () => new Vector4()) },
    uCollapsePatchShapes: { value: Array.from({ length: COLLAPSE_PATCH_LIMIT }, () => new Vector4()) },
  };
}

export function writeDestructionUniforms(uniforms: Record<string, IUniform>, mask: CutoutDestructionMask): void {
  if (![mask.frontDepth, mask.protectedDepth, mask.feather].every(Number.isFinite) ||
    mask.feather <= 0 || mask.protectedDepth < 0) throw new Error('Corridor destruction needs finite protected depths.');
  uniforms.uCutoutDestruction.value.set(mask.active ? 1 : 0, mask.frontDepth, mask.feather, mask.protectedDepth);
  const patches = (mask.patches ?? []).filter(patch => patch.active).slice(0, COLLAPSE_PATCH_LIMIT);
  uniforms.uCollapsePatchCount.value = patches.length;
  for (let i = 0; i < COLLAPSE_PATCH_LIMIT; i++) {
    const patch = patches[i], center: Vector4 = uniforms.uCollapsePatchCenters.value[i], shape: Vector4 = uniforms.uCollapsePatchShapes.value[i];
    if (patch) {
      center.set(...patch.centerOpening, patch.radiusDepth);
      shape.set(patch.radiusAcross, patch.radiusUp, patch.fadeProgress, patch.seed);
    } else { center.set(0, 0, 0, 0); shape.set(0, 0, 0, 0); }
  }
}

export const collapseNoiseGLSL = `
  float collapseHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float collapseNoise(vec3 p) {
    vec3 a = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(collapseHash(a),collapseHash(a+vec3(1,0,0)),f.x),
                   mix(collapseHash(a+vec3(0,1,0)),collapseHash(a+vec3(1,1,0)),f.x),f.y),
               mix(mix(collapseHash(a+vec3(0,0,1)),collapseHash(a+vec3(1,0,1)),f.x),
                   mix(collapseHash(a+vec3(0,1,1)),collapseHash(a+vec3(1,1,1)),f.x),f.y),f.z);
  }
`;

/** One stable source-space field for both Gaussians and fog: no moving slice. */
export const collapseDamageGLSL = `
  uniform vec4 uCutoutDestruction;
  uniform int uCollapsePatchCount;
  uniform vec4 uCollapsePatchCenters[${COLLAPSE_PATCH_LIMIT}];
  uniform vec4 uCollapsePatchShapes[${COLLAPSE_PATCH_LIMIT}];
  ${collapseNoiseGLSL}
  float collapseDamage(vec3 p) {
    if(uCutoutDestruction.x < 0.5 || p.z <= uCutoutDestruction.w) return 0.0;
    float survival = 1.0, coarse = -1.0, fine = 0.0;
    for(int i=0; i<${COLLAPSE_PATCH_LIMIT}; i++) {
      if(i >= uCollapsePatchCount) break;
      vec4 center = uCollapsePatchCenters[i], shape = uCollapsePatchShapes[i];
      // Chip immediately, then let the ragged cavity spread for the full three seconds.
      float dissolution = sqrt(max(0.0,shape.z));
      float growth = 0.3 + 0.95*dissolution;
      vec3 delta = (p-center.xyz)/(vec3(shape.xy,center.w)*growth);
      float distanceToBlast = length(delta);
      if(distanceToBlast > 1.35 || shape.z <= 0.0) continue;
      if(coarse < 0.0) {
        float seed = uCollapsePatchShapes[0].w;
        coarse = collapseNoise(p*vec3(1.7,2.2,0.65)+seed);
        fine = collapseNoise(p*vec3(8.0,8.0,5.0)+17.2+seed);
      }
      // Broad lobes leave fingers and islands; finer density varies within them.
      float lobe = mix(0.72,1.32,clamp(coarse+0.2*(fract(shape.w)-0.5),0.0,1.0));
      float envelope = 1.0-smoothstep(0.25,lobe,distanceToBlast);
      float loss = envelope*dissolution*mix(0.72,1.0,fine);
      survival *= 1.0-loss;
    }
    return (1.0-survival)*smoothstep(uCutoutDestruction.w,uCutoutDestruction.w+1.5,p.z);
  }
`;
