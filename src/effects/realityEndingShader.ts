import { Matrix4, Vector2, Vector4 } from 'three';

export const realityEndingUniforms = () => ({
  uRealityDamage:{value:new Vector4(0,-4,4,0)},
  uRealityEnds:{value:new Vector2(-20,20)},
  uRealityRawToRoute:{value:new Matrix4()},
  uRealityOpacity:{value:1}, uRealityGlitch:{value:0},
});

/** Uses the same stable noise as the added corridor, with both ends mature. */
export const realityDamageGLSL = `
  float collapseNoise(vec3 p);
  uniform vec4 uRealityDamage;
  uniform vec2 uRealityEnds;
  uniform mat4 uRealityRawToRoute;
  uniform float uRealityOpacity,uRealityGlitch;
  float realityEndLoss(vec3 p) {
    if(uRealityDamage.x<0.5 || (p.z>=uRealityDamage.y && p.z<=uRealityDamage.z)) return 0.0;
    bool lower=p.z<uRealityDamage.y;
    float distanceFromSafe=lower?uRealityDamage.y-p.z:p.z-uRealityDamage.z;
    float span=lower?uRealityDamage.y-uRealityEnds.x:uRealityEnds.y-uRealityDamage.z;
    if(span<2.0) return 0.0;
    float along=distanceFromSafe/span;
    float broad=collapseNoise(p*vec3(1.5,1.8,0.5)+uRealityDamage.w);
    float fine=collapseNoise(p*vec3(6.0,6.0,3.2)+19.7+uRealityDamage.w);
    float loss=smoothstep(0.02,0.82,along+(broad-0.5)*0.35)*mix(0.78,1.0,fine);
    // The outer ends are gone; their approach retains irregular islands/fingers.
    loss=mix(loss,1.0,smoothstep(0.62,0.9,along+(broad-0.5)*0.13));
    return loss*smoothstep(0.0,1.5,distanceFromSafe);
  }
`;
