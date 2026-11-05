import assert from 'node:assert/strict';
import path from 'node:path';
import { runLightingRecoveryScenario } from './lightingRecoveryScenario.mjs';
import { GAMEPLAY_TIMING } from '../../src/experience/gameplayTiming.ts';

/** Actual second-box controls, main-loop visibility hook, shader and local decoder. */
export async function runSecondBoxLightsScenario(page, output) {
  await page.locator('#experience-lights-out').click(); // prime local sound from an actual operator gesture
  await page.waitForFunction(() => window.__debug.lightFlickerAudio.snapshot().ready);
  const before = await page.evaluate(() => {
    const { experience, hallwayLighting, lightFlickerAudio, controls } = window.__debug;
    window.__secondLights = { update: hallwayLighting.update, installUpdate: experience.installation.update,
      transition: experience.gameplayAudio.transition, transitionCalls: [], elapsed: 0, damping: controls.enableDamping };
    experience.gameplayAudio.transition = index => {
      window.__secondLights.transitionCalls.push({ index, seconds: window.__secondLights.elapsed,
        phase: hallwayLighting.snapshot().cuePhase });
      return window.__secondLights.transition(index);
    };
    controls.enableDamping = false; controls.update();
    hallwayLighting.update = () => {};
    experience.installation.update = () => {};
    hallwayLighting.reset();
    experience.installation.hideSecondBox(); window.__secondLights.installUpdate(2);
    hallwayLighting.observeSecondBox(false);
    return { audio: lightFlickerAudio.snapshot(), preference: Number(localStorage.getItem('hallway-lights-out-brightness') ?? '.3') };
  });
  const step = seconds => page.evaluate(seconds => {
    while (seconds > 1e-9) {
      const dt = Math.min(.1, seconds); window.__secondLights.elapsed += dt;
      window.__secondLights.update(dt); seconds -= dt;
    }
    return { lighting: window.__debug.hallwayLighting.snapshot(), sound: window.__debug.lightFlickerAudio.snapshot(),
      transitionCalls: window.__secondLights.transitionCalls };
  }, seconds);
  const pixels = save => page.evaluate(async save => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { scene, camera, renderer, splats, spawnMarker } = window.__debug;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    splats.viewer.update(renderer, camera); await splats.viewer.sortPromise;
    splats.viewer.splatMesh.updateTransforms(); await splats.viewer.runSplatSort(true, true);
    const visible = spawnMarker.visible, background = scene.background;
    const previousTarget = renderer.getRenderTarget(), viewport = renderer.getViewport(new THREE.Vector4());
    const scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
    const bytes = new Uint8Array(size.x * size.y * 4);
    try {
      // Isolate emitted scan/fog RGB from the fixed white application void.
      spawnMarker.visible = false; scene.background = new THREE.Color(0);
      renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, bytes);
    } finally {
      spawnMarker.visible = visible; scene.background = background;
      renderer.setRenderTarget(previousTarget); renderer.setViewport(viewport);
      renderer.setScissor(scissor); renderer.setScissorTest(scissorTest); target.dispose();
    }
    let rgb = 0, alphaDifferences = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      rgb += bytes[i] + bytes[i + 1] + bytes[i + 2];
      if (!save && bytes[i + 3] !== window.__secondLightPixels[i + 3]) alphaDifferences++;
    }
    if (save) {
      window.__secondLightPixels = bytes;
      const mesh = splats.viewer.splatMesh;
      window.__secondLightResources = { material: mesh.material, geometry: mesh.geometry, version: mesh.material.version,
        textures: mesh.splatDataTextures, worker: splats.viewer.sortWorker, source: mesh.splatDataTextures.baseData.centers,
        scan: splats.matrixWorld.toArray() };
    }
    return { rgb, alphaDifferences, brightness: window.__debug.hallwayLighting.snapshot().brightness,
      isolatedLightingTarget: true, productionBackground: background?.isColor ? background.getHex() : null };
  }, save);
  try {
    await page.locator('#experience-show-second-box').click();
    await page.evaluate(() => window.__secondLights.installUpdate(1.49));
    await step(.3);
    assert.equal(await page.evaluate(() => window.__debug.hallwayLighting.snapshot().cuePhase), 'cancelled',
      'do not time from the start of a still-submerged rise');
    await page.evaluate(() => window.__secondLights.installUpdate(.01));
    await page.waitForFunction(() => window.__debug.hallwayLighting.snapshot().cuePhase === 'waiting');
    await step(.001); // observed completion frame starts the full authored delay
    await page.evaluate(() => { window.__secondLights.elapsed = 0; });
    const bright = await pixels(true);
    const beforeAnticipation = await step(GAMEPLAY_TIMING.flickerDelaySeconds - GAMEPLAY_TIMING.flickerLeadSeconds - .01);
    assert.equal(beforeAnticipation.lighting.cuePhase, 'waiting');
    assert.deepEqual(beforeAnticipation.transitionCalls, [], 'music must wait for the authored two-second lead');
    const anticipated = await step(.01);
    assert.equal(anticipated.lighting.brightness, 1);
    assert.equal(anticipated.sound.playCount, before.audio.playCount);
    assert.equal(anticipated.transitionCalls.length, 1);
    assert.equal(anticipated.transitionCalls[0].index, 2);
    assert.equal(anticipated.transitionCalls[0].phase, 'waiting');
    assert.ok(Math.abs(anticipated.transitionCalls[0].seconds -
      (GAMEPLAY_TIMING.flickerDelaySeconds - GAMEPLAY_TIMING.flickerLeadSeconds)) < 1e-8);
    const waiting = await step(GAMEPLAY_TIMING.flickerLeadSeconds - .01);
    assert.equal(waiting.lighting.brightness, 1); assert.equal(waiting.lighting.cuePhase, 'waiting');
    assert.equal(waiting.sound.playCount, before.audio.playCount);
    assert.equal(waiting.transitionCalls.length, 1, 'the anticipation hook must run once per box reveal');
    const started = await step(.01);
    assert.equal(started.lighting.flickering, true); assert.equal(started.lighting.lightsOutBrightness, .3);
    assert.equal(started.sound.playCount, before.audio.playCount + 1); assert.equal(started.sound.playing, true);
    assert.equal(started.transitionCalls.length, 1, 'actual flicker must not restart the transition music');
    await step(.07); const dip = await pixels(false);
    assert.ok(Math.abs(dip.brightness - .3) < 1e-8);
    await page.screenshot({ path: path.join(output, 'lights-flicker.png'), fullPage: true });
    await step(.06); const relit = await pixels(false);
    assert.ok(relit.rgb > dip.rgb * 2, 'the actual framebuffer must relight between glitches');
    const complete = await step(.87); const dark = await pixels(false);
    assert.equal(complete.lighting.cuePhase, 'dark'); assert.equal(complete.lighting.brightness, .3);
    assert.equal(complete.sound.playing, false);
    assert.equal(complete.transitionCalls.length, 1);
    assert.ok(dark.rgb / bright.rgb > .28 && dark.rgb / bright.rgb < .32);
    assert.equal(dip.alphaDifferences + relit.alphaDifferences + dark.alphaDifferences, 0);
    assert.equal(await page.locator('#experience-lights-brightness-value').textContent(), '30%');
    await page.screenshot({ path: path.join(output, 'lights-second-box-dark.png'), fullPage: true });
    const resourcesStable = await page.evaluate(() => {
      const { splats, hallwayLighting, lightFlickerAudio } = window.__debug;
      const saved = window.__secondLightResources, mesh = splats.viewer.splatMesh;
      const stable = mesh.material === saved.material && mesh.geometry === saved.geometry && mesh.material.version === saved.version &&
        mesh.splatDataTextures === saved.textures && splats.viewer.sortWorker === saved.worker &&
        mesh.splatDataTextures.baseData.centers === saved.source && JSON.stringify(splats.matrixWorld.toArray()) === JSON.stringify(saved.scan);
      lightFlickerAudio.play(); hallwayLighting.reset();
      if (lightFlickerAudio.snapshot().playing) throw new Error('Lighting reset left sound playing');
      return stable;
    });
    assert.equal(resourcesStable, true);
    return { settledRiseStartsDelay: true, delaySeconds: GAMEPLAY_TIMING.flickerDelaySeconds,
      musicLeadSeconds: GAMEPLAY_TIMING.flickerLeadSeconds, musicAnticipationOnce: true,
      transitionCalls: complete.transitionCalls, flickerSeconds: 1, finalBrightness: .3,
      clip: '/audio/light_flicker.mp3', sourceDuration: before.audio.sourceDuration, gain: before.audio.gain,
      soundStartSynchronized: true, soundStoppedOnReset: true, bright, dip, relit, dark, resourcesStable,
      lifecycle: await runLightingRecoveryScenario(page, before.preference, true),
      screenshots: ['lights-flicker.png', 'lights-second-box-dark.png'] };
  } finally {
    await page.evaluate(() => {
      const { experience, hallwayLighting, controls } = window.__debug;
      hallwayLighting.reset(); hallwayLighting.update = window.__secondLights.update;
      experience.installation.update = window.__secondLights.installUpdate;
      experience.gameplayAudio.transition = window.__secondLights.transition;
      controls.enableDamping = window.__secondLights.damping;
      delete window.__secondLights; delete window.__secondLightPixels; delete window.__secondLightResources;
    });
  }
}
