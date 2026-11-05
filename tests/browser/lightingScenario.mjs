import assert from 'node:assert/strict';
import path from 'node:path';
import { runLightingRecoveryScenario } from './lightingRecoveryScenario.mjs';

async function pixels(page, save = false) {
  return page.evaluate(async save => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { renderer, scene, camera, spawnMarker, splats } = window.__debug;
    const visible = spawnMarker.visible, background = scene.background;
    const previousTarget = renderer.getRenderTarget(), viewport = renderer.getViewport(new THREE.Vector4());
    const scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
    const bytes = new Uint8Array(size.x * size.y * 4);
    try {
      // Measure only emitted scene RGB. The production white void must not
      // contribute a constant term to the unchanged 30% lighting assertion.
      spawnMarker.visible = false; scene.background = new THREE.Color(0);
      renderer.setRenderTarget(target); renderer.setScissorTest(false);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, bytes);
    } finally {
      spawnMarker.visible = visible; scene.background = background;
      renderer.setRenderTarget(previousTarget); renderer.setViewport(viewport);
      renderer.setScissor(scissor); renderer.setScissorTest(scissorTest); target.dispose();
    }
    let rgb = 0, alpha = 0, alphaDifferences = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      rgb += bytes[i] + bytes[i + 1] + bytes[i + 2];
      alpha += bytes[i + 3];
      if (!save && bytes[i + 3] !== window.__lightingPixels[i + 3]) alphaDifferences++;
    }
    if (save) window.__lightingPixels = bytes;
    return { rgb, alpha, alphaDifferences, opacity: splats.viewer.splatMesh.material.uniforms.uGlobalOpacity.value,
      isolatedLightingTarget: true, productionBackground: background?.isColor ? background.getHex() : null };
  }, save);
}

export async function runLightingScenario(page, output) {
  // Compare identical animated-density samples while changing only lighting.
  // Fog motion itself is exercised by the separate 30-second render check.
  await page.evaluate(() => {
    const fog=window.__debug.hallwayFog;
    window.__lightingFogUpdate=fog.update;fog.update=()=>window.__lightingFogUpdate(0);
  });
  try { return await runFrozenLightingScenario(page, output); }
  finally { await page.evaluate(() => {
    window.__debug.hallwayFog.update=window.__lightingFogUpdate;delete window.__lightingFogUpdate;
  }); }
}

async function runFrozenLightingScenario(page, output) {
  const button = page.locator('#experience-lights-out');
  const slider = page.getByRole('slider', { name: 'Dark-mode brightness' });
  assert.equal(await button.isDisabled(), false);
  assert.equal(await slider.inputValue(), '30');
  const original = await page.evaluate(async () => {
    const { splats, renderer, experience, hallwayLighting, camera, controls } = window.__debug;
    const damping = controls.enableDamping;
    controls.enableDamping = false; controls.update();
    // Finish the camera change/sort left by the preceding prop check before
    // comparing frames; alpha coverage must come from exactly the same view.
    await splats.viewer.sortPromise;
    splats.viewer.update(renderer, camera);
    await splats.viewer.runSplatSort(true, true);
    await splats.viewer.sortPromise;
    const mesh = splats.viewer.splatMesh;
    window.__lightingResources = { material: mesh.material, version: mesh.material.version,
      geometry: mesh.geometry, textures: mesh.splatDataTextures, worker: splats.viewer.sortWorker,
      source: mesh.splatDataTextures.baseData.centers, scan: splats.matrixWorld.toArray() };
    // Participant selects/squeezes do not have a lighting binding.
    for (let i = 0; i < 2; i++) {
      for (const type of ['select', 'selectstart', 'squeeze', 'squeezestart']) renderer.xr.getController(i).dispatchEvent({ type });
    }
    experience.update(.1);
    return { ...hallwayLighting.snapshot(), damping };
  });
  assert.equal(original.lightsOut, false); assert.equal(original.brightness, 1);
  const bright = await pixels(page, true);
  assert.ok(bright.rgb > 100000, 'Lighting comparison needs visible scan pixels.');
  await page.screenshot({ path: path.join(output, 'lights-on.png'), fullPage: true });
  await button.click();
  await page.waitForFunction(() => !window.__debug.hallwayLighting.snapshot().fading);
  assert.equal(await button.textContent(), 'Lights on');
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  const dark = await pixels(page);
  const ratio = dark.rgb / bright.rgb;
  assert.ok(ratio > .28 && ratio < .32, `Expected 30% brightness; RGB ratio is ${ratio}.`);
  assert.equal(dark.alphaDifferences, 0, 'Lights-out changed splat coverage/opacity.');
  assert.equal(dark.opacity, bright.opacity);
  await page.screenshot({ path: path.join(output, 'lights-out.png'), fullPage: true });
  await slider.focus(); await slider.press('Home');
  assert.equal(await slider.inputValue(), '0');
  const black = await pixels(page);
  assert.ok(black.rgb / bright.rgb < .01);
  assert.equal(black.alphaDifferences, 0);
  await slider.press('End');
  assert.equal(await slider.inputValue(), '100');
  const full = await pixels(page);
  assert.equal(full.rgb, bright.rgb); assert.equal(full.alphaDifferences, 0);
  await slider.evaluate(slider => { slider.value = '60'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.locator('#experience-lights-brightness-value').textContent(), '60%');
  assert.equal(await slider.getAttribute('aria-valuetext'), '60% brightness');
  const adjusted = await pixels(page);
  assert.ok(adjusted.rgb / bright.rgb > .58 && adjusted.rgb / bright.rgb < .62);
  assert.equal(adjusted.alphaDifferences, 0);
  await page.screenshot({ path: path.join(output, 'lights-slider.png'), fullPage: true });
  await button.click();
  await page.waitForFunction(() => !window.__debug.hallwayLighting.snapshot().fading);
  const restored = await pixels(page);
  assert.equal(restored.rgb, bright.rgb); assert.equal(restored.alphaDifferences, 0);
  // With lights on, changing the preference must not activate a dark preview.
  await slider.evaluate(slider => { slider.value = '40'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal((await pixels(page)).rgb, bright.rgb);
  await slider.evaluate(slider => { slider.value = '60'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
  const system = await page.evaluate(() => {
    const { hallwayLighting } = window.__debug;
    const accepted = hallwayLighting.setLightsOut(true);
    hallwayLighting.update(.325);
    return { accepted, ...hallwayLighting.snapshot() };
  });
  assert.equal(system.accepted, true); assert.ok(system.brightness < 1);
  await page.locator('#experience-reset').click();
  assert.equal(await page.evaluate(() => window.__debug.hallwayLighting.snapshot().brightness), 1);
  assert.equal(await slider.inputValue(), '60');
  const recovery = await page.evaluate(() => {
    const { experience, hallwayLighting, splats } = window.__debug;
    hallwayLighting.setLightsOut(true); hallwayLighting.update(.2);
    experience.prepareForCalibration(); hallwayLighting.update(10);
    const calibrationRestored = !hallwayLighting.snapshot().lightsOut && hallwayLighting.snapshot().brightness === 1;
    experience.setCalibrationActive(false);
    const mesh = splats.viewer.splatMesh, saved = window.__lightingResources;
    return { calibrationRestored, resourcesStable: mesh.material === saved.material && mesh.material.version === saved.version &&
      mesh.geometry === saved.geometry && mesh.splatDataTextures === saved.textures && splats.viewer.sortWorker === saved.worker,
      sourceUnchanged: mesh.splatDataTextures.baseData.centers === saved.source,
      scanUnchanged: JSON.stringify(splats.matrixWorld.toArray()) === JSON.stringify(saved.scan) };
  });
  assert.ok(recovery.calibrationRestored && recovery.resourcesStable && recovery.sourceUnchanged && recovery.scanUnchanged);
  await button.click();
  await page.locator('#experience-stop').click();
  const stopped = await page.evaluate(() => {
    const { hallwayLighting } = window.__debug;
    hallwayLighting.update(10);
    return { ...hallwayLighting.snapshot(), blocked: !hallwayLighting.setLightsOut(true), canRestore: hallwayLighting.setLightsOut(false) };
  });
  assert.equal(stopped.brightness, 1); assert.equal(stopped.lightsOut, false);
  assert.equal(stopped.blocked, true); assert.equal(stopped.canRestore, true);
  await page.locator('#experience-reset').click();
  await page.evaluate(damping => {
    window.__debug.controls.enableDamping = damping;
    delete window.__lightingPixels; delete window.__lightingResources;
  }, original.damping);
  return { bright, dark, ratio, black, full, adjusted, restored, system, ...recovery, stopRestored: true,
    participantInputsDoNotActivate: true, resetRestored: true, lifecycle: await runLightingRecoveryScenario(page, .6) };
}
