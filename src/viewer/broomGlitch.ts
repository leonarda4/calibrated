import type { ShaderMaterial } from 'three';
import { BROOM } from './broomConfig.ts';

/** Patch only the preloaded broom; raw-space jitter follows every world turn. */
export function prepareBroomGlitch(material: ShaderMaterial): void {
  if (material.uniforms.uBroomGlitch) return;
  const vertex = 'gl_Position = quadPos;', fragment = 'void main () {';
  if (!material.vertexShader.includes(vertex) || !material.fragmentShader.includes(fragment)) {
    throw new Error('The installed splat shader cannot glitch the broom.');
  }
  material.vertexShader = 'uniform float uBroomGlitch; varying float vBroomGlitchDrop;\n' +
    material.vertexShader.replace(vertex, `
      vBroomGlitchDrop = 0.0;
      if (int(sceneIndex) == ${BROOM.sceneIndex}) vColor.rgb = min(vec3(1.0), vColor.rgb * ${BROOM.brightness});
      if (int(sceneIndex) == ${BROOM.sceneIndex} && uBroomGlitch > 0.0) {
        float band = floor(-splatCenter.z * 45.0);
        float tick = floor(uBroomGlitch * 20.0);
        float jitter = fract(sin(band * 127.1 + tick * 311.7) * 43758.5453);
        float chunk = fract(sin(dot(floor(splatCenter * 65.0), vec3(12.9898,78.233,39.425))) * 43758.5453);
        vBroomGlitchDrop = step(chunk, uBroomGlitch);
        float shift = (jitter - 0.5) * 0.12 * sin(uBroomGlitch * 3.14159265);
        vec4 shiftedBroomClip = clipCenter + projectionMatrix * transformModelViewMatrix * vec4(0.0,-shift,0.0,0.0);
        quadPos.xy += shiftedBroomClip.xy / shiftedBroomClip.w - ndcCenter.xy;
      }
      ${vertex}
    `);
  material.fragmentShader = 'varying float vBroomGlitchDrop;\n' + material.fragmentShader.replace(fragment,
    `${fragment}\n if (vBroomGlitchDrop > 0.5) discard;`);
  material.uniforms.uBroomGlitch = { value: 0 };
  material.needsUpdate = true;
}
