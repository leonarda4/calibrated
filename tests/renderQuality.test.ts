import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRenderQuality } from '../src/viewer/quality.ts';

test('quality controls use bounded local assets and reject invalid overrides', () => {
  const settings = parseRenderQuality('?scan=../../private&quality=invalid&sh=90&alphaCutoff=NaN&format=https://bad');
  assert.equal(settings.modelUrl, '/splats/hallway3/hallway3_0.ply');
  assert.equal(settings.profile, 'balanced');
  assert.equal(settings.sphericalHarmonicsDegree, 2);
  assert.equal(settings.alphaRemovalThreshold, 5);
  assert.equal(settings.antialiased, false);
});

test('detail profile uses the original PLY even for a stale compressed-format bookmark', () => {
  const settings = parseRenderQuality('?quality=detail&format=ksplat');
  assert.equal(settings.modelUrl, '/splats/hallway3/hallway3_0.ply');
  assert.equal(settings.format, 'ply');
  assert.equal(settings.alphaRemovalThreshold, 1);
  assert.equal(settings.desktopPixelRatioLimit, 2);
  assert.equal(settings.antialiased, false);
});

test('explicit source and training-compensation controls remain available for A/B checks', () => {
  const settings = parseRenderQuality('?quality=detail&scan=max&splatAA=1&sh=0&alphaCutoff=255');
  assert.equal(settings.modelUrl, '/splats/hallway3/hallway3_0.ply');
  assert.equal(settings.sphericalHarmonicsDegree, 0);
  assert.equal(settings.antialiased, true);
  assert.equal(settings.alphaRemovalThreshold, 255);
});

test('new scan replaces every old profile/bookmark without selecting old or empty PLY files', () => {
  for (const quality of ['fast', 'balanced', 'detail']) {
    for (const scan of ['std', 'high', 'ultra', 'max', 'hallway3', 'hallway3_1']) {
      const settings = parseRenderQuality(`?quality=${quality}&scan=${scan}`);
      assert.equal(settings.variant, 'hallway3');
      assert.equal(settings.modelUrl, '/splats/hallway3/hallway3_0.ply');
      assert.equal(parseRenderQuality(`?quality=${quality}&scan=${scan}&format=ply`).modelUrl,
        '/splats/hallway3/hallway3_0.ply');
    }
  }
});
