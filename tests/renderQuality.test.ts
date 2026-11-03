import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRenderQuality } from '../src/viewer/quality.ts';

test('quality controls use bounded local assets and reject invalid overrides', () => {
  const settings = parseRenderQuality('?scan=../../private&quality=invalid&sh=90&alphaCutoff=NaN&format=https://bad');
  assert.equal(settings.modelUrl, '/models/hallway_high.ply');
  assert.equal(settings.profile, 'balanced');
  assert.equal(settings.sphericalHarmonicsDegree, 2);
  assert.equal(settings.alphaRemovalThreshold, 5);
  assert.equal(settings.antialiased, false);
});

test('compressed detail profile selects full-detail source without changing coordinates', () => {
  const settings = parseRenderQuality('?quality=detail&format=ksplat');
  assert.equal(settings.modelUrl, '/models/hallway_ultra.ksplat');
  assert.equal(settings.alphaRemovalThreshold, 1);
  assert.equal(settings.desktopPixelRatioLimit, 2);
  assert.equal(settings.antialiased, false);
});

test('explicit source and training-compensation controls remain available for A/B checks', () => {
  const settings = parseRenderQuality('?quality=detail&scan=max&splatAA=1&sh=0&alphaCutoff=255');
  assert.equal(settings.modelUrl, '/models/hallway_max.ply');
  assert.equal(settings.sphericalHarmonicsDegree, 0);
  assert.equal(settings.antialiased, true);
  assert.equal(settings.alphaRemovalThreshold, 255);
});
