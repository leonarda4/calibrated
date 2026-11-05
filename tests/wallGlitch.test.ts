import test from 'node:test';
import assert from 'node:assert/strict';
import { ShaderMaterial, Vector3 } from 'three';
import { WallGlitch } from '../src/viewer/wallGlitch.ts';
import { prepareWallGlitchShader, setWallGlitch } from '../src/viewer/wallGlitchShader.ts';

test('wall holds at arrival before its bounded glitch, then stays hidden despite repeated endpoint notifications', () => {
  const glitch = new WallGlitch();
  glitch.update(10);
  assert.deepEqual(glitch.snapshot(), { phase: 'idle', progress: 0 });
  assert.equal(glitch.arm(), true);
  glitch.update(.149);
  assert.deepEqual(glitch.snapshot(), { phase: 'waiting', progress: 0 });
  assert.equal(glitch.arm(), false);
  glitch.update(.001);
  assert.deepEqual(glitch.snapshot(), { phase: 'glitching', progress: 0 });
  glitch.update(.275);
  assert.ok(Math.abs(glitch.snapshot().progress - .5) < 1e-12);
  glitch.update(10);
  assert.deepEqual(glitch.snapshot(), { phase: 'hidden', progress: 1 });
  assert.equal(glitch.arm(), false);
  glitch.update(100);
  assert.deepEqual(glitch.snapshot(), { phase: 'hidden', progress: 1 });
});

test('manual and recovery resets cancel every exit stage without late-frame revival', () => {
  for (const elapsed of [.05, .35, 1]) {
    const glitch = new WallGlitch();
    glitch.arm(); glitch.update(elapsed); glitch.reset();
    for (const delta of [100, NaN, Infinity, -1, 0]) glitch.update(delta);
    assert.deepEqual(glitch.snapshot(), { phase: 'idle', progress: 0 });
    assert.equal(glitch.arm(), true);
    glitch.update(.15 + .55);
    assert.deepEqual(glitch.snapshot(), { phase: 'hidden', progress: 1 });
  }
});

test('configurable zero hold starts immediately and invalid frames cannot alter an active exit', () => {
  const glitch = new WallGlitch({ holdSeconds: 0, seconds: 1 });
  glitch.arm();
  assert.deepEqual(glitch.snapshot(), { phase: 'glitching', progress: 0 });
  glitch.update(.25);
  const before = glitch.snapshot();
  for (const delta of [NaN, Infinity, -1, 0]) glitch.update(delta);
  assert.deepEqual(glitch.snapshot(), before);
  for (const holdSeconds of [-1, NaN, Infinity]) assert.throws(() => new WallGlitch({ holdSeconds }));
  for (const seconds of [0, -1, NaN, Infinity]) assert.throws(() => new WallGlitch({ seconds }));
});

test('wall glitch uniform commands reuse the startup shader and preserve other prop effects', () => {
  const material = new ShaderMaterial({ vertexShader: 'void main () { gl_Position = quadPos; }',
    fragmentShader: 'void main () {}', uniforms: { uPivotBoxGlitch: { value: .4 }, uFloorHoleOpen: { value: 1 } } });
  prepareWallGlitchShader(material);
  const version = material.version, vertex = material.vertexShader, fragment = material.fragmentShader;
  const uniforms = material.uniforms, right = material.uniforms.uWallGlitchRight.value;
  setWallGlitch(material, .5, new Vector3(0, 0, -2));
  assert.deepEqual(right.toArray(), [0, 0, -1]);
  assert.equal(material.uniforms.uWallGlitch.value, .5);
  assert.equal(material.uniforms.uWallGlitchSceneIndex.value, 1);
  assert.equal(material.uniforms.uPivotBoxGlitch.value, .4);
  assert.equal(material.uniforms.uFloorHoleOpen.value, 1);
  prepareWallGlitchShader(material);
  setWallGlitch(material, 0);
  assert.equal(material.version, version);
  assert.equal(material.vertexShader, vertex); assert.equal(material.fragmentShader, fragment);
  assert.equal(material.uniforms, uniforms); assert.equal(material.uniforms.uWallGlitchRight.value, right);
  assert.equal(material.uniforms.uWallGlitch.value, 0);
});

test('unsupported startup shaders and invalid commands fail before mutating active state', () => {
  const unsupported = new ShaderMaterial();
  assert.throws(() => prepareWallGlitchShader(unsupported), /cannot glitch/);
  assert.throws(() => setWallGlitch(unsupported, .5), /Prepare/);
  const material = new ShaderMaterial({ vertexShader: 'gl_Position = quadPos;', fragmentShader: 'void main () {' });
  prepareWallGlitchShader(material); setWallGlitch(material, .4, new Vector3(1, 0, 0));
  for (const value of [NaN, Infinity, -.1, 1.1]) assert.throws(() => setWallGlitch(material, value));
  for (const direction of [new Vector3(), new Vector3(NaN, 0, 0)]) {
    assert.throws(() => setWallGlitch(material, .8, direction));
  }
  assert.equal(material.uniforms.uWallGlitch.value, .4);
  assert.deepEqual(material.uniforms.uWallGlitchRight.value.toArray(), [1, 0, 0]);
});
