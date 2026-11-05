import test from 'node:test';
import assert from 'node:assert/strict';
import { ShaderMaterial } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { createHallwayLighting, patchHallwayLighting, LIGHTS_FADE_SECONDS, LIGHTS_OUT_BRIGHTNESS } from '../src/viewer/hallwayLighting.ts';

function fixture() {
  const material = new ShaderMaterial({
    fragmentShader: 'uniform float uGlobalOpacity; void main() { gl_FragColor = vec4(color.rgb, opacity * uGlobalOpacity); }',
    uniforms: { uGlobalOpacity: { value: .5 } },
  });
  let reason: string | null = null;
  const scanRoot = { viewer: { splatMesh: { material } } } as unknown as DropInViewer;
  return { material, lighting: createHallwayLighting({ scanRoot, blockReason: () => reason }),
    block(value: string | null) { reason = value; } };
}

test('ending relight owns displayed brightness without changing calibration alpha, and reset clears it', () => {
  const {lighting,material}=fixture();lighting.initialize();
  lighting.setLightsOut(true);lighting.update(LIGHTS_FADE_SECONDS);
  const resources=material.version;
  for(const value of [.3,.7,.35,1]) {
    assert.equal(lighting.setPresentationBrightness(value),true);lighting.update(.1);
    assert.equal(lighting.snapshot().brightness,value);
    assert.equal(material.uniforms.uHallwayBrightness.value,value);
    assert.equal(material.uniforms.uGlobalOpacity.value,.5);
  }
  assert.equal(lighting.setPresentationBrightness(NaN),false);
  assert.equal(material.version,resources);
  lighting.setPresentationBrightness(null);assert.equal(lighting.snapshot().brightness,.3);
  lighting.setPresentationBrightness(.4);lighting.reset();
  assert.equal(lighting.snapshot().brightness,1);assert.equal(material.uniforms.uHallwayBrightness.value,1);
});

test('lighting patches RGB independently of opacity and compiles only once', () => {
  const { material, lighting } = fixture();
  const version = material.version;
  lighting.initialize();
  assert.equal(material.version, version + 1);
  assert.ok(material.fragmentShader.includes('vec4(color.rgb * uHallwayBrightness, opacity * uGlobalOpacity)'));
  const shader = material.fragmentShader;
  lighting.setLightsOut(true); lighting.update(LIGHTS_FADE_SECONDS);
  assert.equal(material.uniforms.uHallwayBrightness.value, LIGHTS_OUT_BRIGHTNESS);
  assert.equal(material.uniforms.uGlobalOpacity.value, .5);
  lighting.initialize();
  assert.equal(material.fragmentShader, shader);
  assert.equal(material.version, version + 1);
  const unsupported = new ShaderMaterial({ fragmentShader: 'void main() {}' });
  assert.equal(patchHallwayLighting(unsupported, 1), false);
  assert.equal(unsupported.version, 0);
});

test('lights fade monotonically, reverse without a jump and ignore invalid frames', () => {
  const { lighting } = fixture(); lighting.initialize();
  lighting.setLightsOut(true);
  let previous = 1;
  for (let i = 0; i < 3; i++) {
    lighting.update(LIGHTS_FADE_SECONDS / 8);
    assert.ok(lighting.snapshot().brightness < previous);
    previous = lighting.snapshot().brightness;
  }
  const before = lighting.snapshot();
  [0, -1, NaN, Infinity].forEach(dt => lighting.update(dt));
  assert.deepEqual(lighting.snapshot(), before);
  lighting.setLightsOut(true);
  lighting.update(LIGHTS_FADE_SECONDS / 8);
  assert.ok(lighting.snapshot().brightness < previous);
  const reversing = lighting.snapshot().brightness;
  lighting.setLightsOut(false);
  assert.equal(lighting.snapshot().brightness, reversing);
  lighting.update(LIGHTS_FADE_SECONDS / 2);
  assert.ok(lighting.snapshot().brightness > reversing);
  lighting.update(LIGHTS_FADE_SECONDS / 2);
  assert.equal(lighting.snapshot().brightness, 1);
  assert.equal(lighting.snapshot().fading, false);
});

test('system commands respect loading/recovery gates while lights-on and reset always recover', () => {
  const { material, lighting, block } = fixture();
  lighting.reset();
  assert.equal(lighting.setLightsOut(true), false);
  lighting.initialize(); block('Calibration required');
  assert.equal(lighting.setLightsOut(true), false);
  block(null); assert.equal(lighting.setLightsOut(true), true);
  lighting.update(LIGHTS_FADE_SECONDS);
  block('Tracking lost');
  assert.equal(lighting.setLightsOut(false), true);
  lighting.update(LIGHTS_FADE_SECONDS / 2);
  assert.ok(lighting.snapshot().brightness > LIGHTS_OUT_BRIGHTNESS);
  lighting.reset(); lighting.update(100);
  assert.deepEqual(lighting.snapshot(), { ready: true, lightsOut: false, lightsOutBrightness: LIGHTS_OUT_BRIGHTNESS, brightness: 1, fading: false,
    flickering: false, cuePhase: 'cancelled' });
  assert.equal(material.uniforms.uHallwayBrightness.value, 1);
  assert.equal(lighting.toggle(), false);
});

test('brightness selection previews immediately when active, retains preferences and rejects invalid changes', () => {
  const { lighting, material, block } = fixture(); lighting.initialize();
  assert.equal(lighting.snapshot().lightsOutBrightness, .30);
  assert.equal(lighting.setLightsOutBrightness(.4), true);
  assert.equal(lighting.snapshot().lightsOut, false);
  assert.equal(lighting.snapshot().brightness, 1);
  lighting.setLightsOut(true); lighting.update(LIGHTS_FADE_SECONDS / 2);
  assert.ok(Math.abs(lighting.snapshot().brightness - .7) < 1e-12);
  assert.equal(lighting.setLightsOutBrightness(.6), true);
  assert.equal(lighting.snapshot().brightness, .6);
  assert.equal(lighting.snapshot().fading, false);
  assert.equal(material.uniforms.uHallwayBrightness.value, .6);
  const before = lighting.snapshot();
  for (const value of [NaN, Infinity, -.01, 1.01]) assert.equal(lighting.setLightsOutBrightness(value), false);
  assert.deepEqual(lighting.snapshot(), before);
  for (const value of [0, 1]) {
    assert.equal(lighting.setLightsOutBrightness(value), true);
    assert.equal(material.uniforms.uHallwayBrightness.value, value);
  }
  lighting.setLightsOutBrightness(.6); lighting.setLightsOut(false); lighting.update(LIGHTS_FADE_SECONDS / 2);
  const restoring = lighting.snapshot().brightness;
  lighting.setLightsOutBrightness(.2);
  assert.equal(lighting.snapshot().brightness, restoring, 'changing the next target must not interrupt lights-on recovery');
  lighting.update(LIGHTS_FADE_SECONDS / 2); assert.equal(lighting.snapshot().brightness, 1);
  lighting.setLightsOut(true); lighting.update(LIGHTS_FADE_SECONDS);
  assert.equal(lighting.snapshot().brightness, .2);
  block('Tracking lost'); assert.equal(lighting.setLightsOutBrightness(0), false);
  lighting.reset(); lighting.update(10);
  assert.equal(lighting.snapshot().brightness, 1);
  assert.equal(lighting.snapshot().lightsOutBrightness, .2);
  assert.equal(material.uniforms.uGlobalOpacity.value, .5);
});

test('second-box flicker reaches exactly 30 percent, preserves alpha/resources and manual recovery cancels it', () => {
  let starts = 0, stops = 0;
  const { material } = fixture();
  const lighting = createHallwayLighting({ scanRoot: { viewer: { splatMesh: { material } } } as unknown as DropInViewer,
    blockReason: () => null, onFlickerStart: () => starts++, onFlickerStop: () => stops++ });
  lighting.initialize(); const shader = material.fragmentShader, version = material.version;
  const arm = () => {
    lighting.observeSecondBox(false); lighting.observeSecondBox(true); lighting.update(.01);
    for (let i = 0; i < 4; i++) lighting.update(.5);
  };
  lighting.setLightsOutBrightness(.6); arm();
  assert.equal(starts, 1); assert.equal(lighting.snapshot().lightsOutBrightness, .3);
  lighting.update(.07); assert.equal(lighting.snapshot().brightness, .3);
  lighting.update(.06); assert.ok(lighting.snapshot().brightness > .9, 'actual RGB uniform must relight');
  for (let i = 0; i < 87; i++) lighting.update(.01);
  assert.equal(lighting.snapshot().brightness, .3); assert.equal(lighting.snapshot().cuePhase, 'dark');
  assert.equal(material.uniforms.uGlobalOpacity.value, .5);
  assert.equal(material.fragmentShader, shader); assert.equal(material.version, version);
  assert.ok(stops >= 1);
  lighting.reset(); arm(); lighting.update(.07);
  lighting.setLightsOut(false); lighting.update(.5); lighting.update(.15);
  assert.equal(lighting.snapshot().brightness, 1);
  for (let i = 0; i < 50; i++) { lighting.observeSecondBox(true); lighting.update(.1); }
  assert.equal(starts, 2); assert.equal(lighting.snapshot().brightness, 1);
  lighting.reset(); arm(); lighting.update(.07); lighting.reset(); lighting.update(.1);
  assert.equal(lighting.snapshot().brightness, 1); assert.equal(lighting.snapshot().flickering, false);
});
