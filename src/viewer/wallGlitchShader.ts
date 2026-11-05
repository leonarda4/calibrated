import { Vector3, type ShaderMaterial } from 'three';
import { WALL_SECTION } from './wallSectionConfig.ts';

type WorldDirection = Readonly<{ x: number; y: number; z: number }>;

/** Startup-only patch; runtime commands change uniforms on the shared material. */
export function prepareWallGlitchShader(material: ShaderMaterial): void {
  if (material.uniforms.uWallGlitch) return;
  const projection = 'gl_Position = quadPos;', fragment = 'void main () {';
  if (!material.vertexShader.includes(projection) || !material.fragmentShader.includes(fragment)) {
    throw new Error('The installed splat shader cannot glitch the wall.');
  }
  material.vertexShader = `
    uniform float uWallGlitch;
    uniform int uWallGlitchSceneIndex;
    uniform vec3 uWallGlitchRight;
    varying float vWallGlitchDrop;
  ` + material.vertexShader.replace(projection, `
    vWallGlitchDrop = 0.0;
    if (int(sceneIndex) == uWallGlitchSceneIndex && uWallGlitch > 0.0) {
      float band = floor(splatCenter.y * 18.0);
      float tick = floor(uWallGlitch * 18.0);
      float jitter = fract(sin(band * 127.1 + tick * 311.7) * 43758.5453);
      float chunk = fract(sin(dot(floor(splatCenter * vec3(18.0, 28.0, 4.0)),
        vec3(12.9898, 78.233, 39.425))) * 43758.5453);
      vWallGlitchDrop = step(chunk, uWallGlitch);
      float shift = (jitter - 0.5) * 0.20 * sin(uWallGlitch * 3.14159265);
      vec4 shiftedWallClip = clipCenter + projectionMatrix * viewMatrix * vec4(uWallGlitchRight * shift, 0.0);
      quadPos.xy += shiftedWallClip.xy / shiftedWallClip.w - ndcCenter.xy;
    }
    ${projection}
  `);
  material.fragmentShader = 'varying float vWallGlitchDrop;\n' + material.fragmentShader.replace(fragment,
    `${fragment}\n if (vWallGlitchDrop > 0.5) discard;`);
  material.uniforms.uWallGlitch = { value: 0 };
  material.uniforms.uWallGlitchSceneIndex = { value: WALL_SECTION.sceneIndex };
  material.uniforms.uWallGlitchRight = { value: new Vector3(1, 0, 0) };
  material.needsUpdate = true;
}

/** The wall's frozen world right axis supplies stereo-correct visual displacement. */
export function setWallGlitch(material: ShaderMaterial, progress: number, rightWorld?: WorldDirection): void {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new Error('Wall glitch progress must be between zero and one.');
  }
  if (rightWorld && (![rightWorld.x, rightWorld.y, rightWorld.z].every(Number.isFinite) ||
      Math.hypot(rightWorld.x, rightWorld.y, rightWorld.z) <= 1e-9)) {
    throw new Error('Wall glitch needs a finite nonzero world right direction.');
  }
  if (!material.uniforms.uWallGlitch || !material.uniforms.uWallGlitchRight) {
    throw new Error('Prepare the wall glitch shader during startup before using it.');
  }
  if (rightWorld) material.uniforms.uWallGlitchRight.value.set(rightWorld.x, rightWorld.y, rightWorld.z).normalize();
  material.uniforms.uWallGlitch.value = progress;
}
