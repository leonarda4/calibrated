import type { ShaderMaterial } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { SecondBoxLights, SECOND_BOX_DARK_BRIGHTNESS } from '../experience/secondBoxLights.ts';

// The scan has baked lighting. Dim its colors, never its calibration alpha.
export const LIGHTS_OUT_BRIGHTNESS = SECOND_BOX_DARK_BRIGHTNESS;
export const LIGHTS_FADE_SECONDS = 0.65;
type SplatMaterial = Pick<ShaderMaterial, 'fragmentShader' | 'uniforms' | 'needsUpdate'>;

export function patchHallwayLighting(material: SplatMaterial, brightness: number): boolean {
  if (material.uniforms.uHallwayBrightness) {
    material.uniforms.uHallwayBrightness.value = brightness;
    return true;
  }
  const target = 'gl_FragColor = vec4(color.rgb,';
  if (!material.fragmentShader.includes(target)) return false;
  material.fragmentShader = 'uniform float uHallwayBrightness;\n' + material.fragmentShader.replace(
    target, 'gl_FragColor = vec4(color.rgb * uHallwayBrightness,',
  );
  material.uniforms.uHallwayBrightness = { value: brightness };
  material.needsUpdate = true;
  return true;
}

/** RGB-only lighting, with operator override and the guarded second-box cue. */
export function createHallwayLighting(options: { scanRoot: DropInViewer; blockReason(): string | null;
  onFlickerStart?(): void; onFlickerStop?(): void }) {
  let ready = false;
  let lightsOut = false;
  let lightsOutBrightness = LIGHTS_OUT_BRIGHTNESS;
  let brightness = 1;
  let from = 1;
  let elapsed = LIGHTS_FADE_SECONDS;
  let flickerFrom = 1;
  const cue = new SecondBoxLights();
  const cancelAutomatic = () => { cue.cancel(); options.onFlickerStop?.(); };
  const material = () => options.scanRoot.viewer.splatMesh.material as unknown as SplatMaterial;
  const write = () => {
    if (!ready) return;
    const uniform = material().uniforms.uHallwayBrightness;
    if (uniform) uniform.value = brightness;
  };
  const setLightsOut = (enabled: boolean): boolean => {
    if (typeof enabled !== 'boolean') return false;
    if (enabled && (!ready || options.blockReason() !== null)) return false;
    const wasFlickering = cue.snapshot().phase === 'flickering';
    cancelAutomatic();
    if (enabled === lightsOut && !wasFlickering) return true; // repeated commands do not restart the fade
    lightsOut = enabled;
    from = brightness;
    elapsed = 0;
    return true;
  };
  return {
    setLightsOut,
    observeSecondBox(visible: boolean) {
      const wasFlickering = cue.snapshot().phase === 'flickering';
      cue.observe(visible);
      if (wasFlickering && cue.snapshot().phase === 'cancelled') {
        lightsOut = false; brightness = from = 1; elapsed = LIGHTS_FADE_SECONDS;
        options.onFlickerStop?.(); write();
      }
    },
    setLightsOutBrightness(value: number): boolean {
      if (!Number.isFinite(value) || value < 0 || value > 1) return false;
      if (lightsOut && options.blockReason() !== null) return false;
      cancelAutomatic();
      lightsOutBrightness = value;
      if (lightsOut) {
        // Direct preview follows the slider without restarting a fade per input.
        brightness = from = value; elapsed = LIGHTS_FADE_SECONDS;
        write();
      }
      return true;
    },
    toggle: () => setLightsOut(!lightsOut),
    initialize() {
      if (!patchHallwayLighting(material(), brightness)) throw new Error('Hallway brightness shader patch failed.');
      ready = true;
    },
    reset() {
      cancelAutomatic();
      lightsOut = false; brightness = from = 1; elapsed = LIGHTS_FADE_SECONDS;
      write();
    },
    update(deltaSeconds: number) {
      if (!ready || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
      const previous = cue.snapshot().phase;
      cue.update(deltaSeconds);
      let state = cue.snapshot();
      if (state.phase === 'flickering' && previous !== 'flickering') {
        if (options.blockReason() !== null) { cancelAutomatic(); state = cue.snapshot(); }
        else {
          lightsOut = true; lightsOutBrightness = SECOND_BOX_DARK_BRIGHTNESS;
          flickerFrom = brightness; elapsed = LIGHTS_FADE_SECONDS;
          options.onFlickerStart?.();
        }
      }
      if (previous === 'flickering' && state.phase !== 'flickering') {
        options.onFlickerStop?.();
        if (state.phase === 'cancelled') {
          lightsOut = false; brightness = from = 1; elapsed = LIGHTS_FADE_SECONDS;
        }
      }
      if (state.phase === 'flickering') {
        brightness = from = SECOND_BOX_DARK_BRIGHTNESS + (flickerFrom - SECOND_BOX_DARK_BRIGHTNESS) * state.relight;
        write(); return;
      }
      elapsed = Math.min(LIGHTS_FADE_SECONDS, elapsed + deltaSeconds);
      const t = elapsed / LIGHTS_FADE_SECONDS;
      const eased = t * t * (3 - 2 * t);
      const target = lightsOut ? lightsOutBrightness : 1;
      brightness = elapsed === LIGHTS_FADE_SECONDS ? target : from + (target - from) * eased;
      write();
    },
    snapshot: () => ({ ready, lightsOut, lightsOutBrightness, brightness, fading: elapsed < LIGHTS_FADE_SECONDS,
      flickering: cue.snapshot().phase === 'flickering', cuePhase: cue.snapshot().phase }),
  };
}

export type HallwayLighting = ReturnType<typeof createHallwayLighting>;
