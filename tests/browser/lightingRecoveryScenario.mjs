/** Detached synthetic lifecycle checks; never starts a physical XR session. */
export async function runLightingRecoveryScenario(page, expectedBrightness, automatic = false) {
  const isolated = await page.context().newPage();
  try {
    await isolated.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await isolated.goto(new URL('/', page.url()).href, { waitUntil: 'domcontentloaded' });
    return await isolated.evaluate(async ({ expectedBrightness, automatic }) => {
      const [THREE, { setupExperience }, { createHallwayLighting }, { bindLightingControl }] = await Promise.all([
        import('/node_modules/.vite/deps/three.js'), import('/src/experience/setupExperience.ts'), import('/src/viewer/hallwayLighting.ts'),
        import('/src/ui/lightingControl.ts'),
      ]);
      const ensure = (value, reason) => { if (!value) throw new Error(`Lighting recovery: ${reason}`); };
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), scan = new THREE.Group();
      scene.add(camera, scan);
      scan.viewer = { splatMesh: { material: new THREE.ShaderMaterial({
        fragmentShader: 'void main() { gl_FragColor = vec4(color.rgb, opacity); }',
      }) } };
      const reference = new THREE.EventDispatcher(), session = new THREE.EventDispatcher(), xr = new THREE.EventDispatcher();
      Object.assign(session, { visibilityState: 'visible', inputSources: [] });
      Object.assign(xr, { isPresenting: false, getSession: () => session, getReferenceSpace: () => reference });
      const renderer = { xr, domElement: document.createElement('canvas') };
      let soundPlaying = false, soundStarts = 0;
      const lighting = createHallwayLighting({ scanRoot: scan, blockReason: () => null,
        onFlickerStart: () => { soundPlaying = true; soundStarts++; }, onFlickerStop: () => { soundPlaying = false; } });
      lighting.initialize();
      const experience = setupExperience(renderer, scene, camera, scan, { onDisarm: () => lighting.reset() });
      bindLightingControl(lighting, () => null);
      ensure(lighting.snapshot().lightsOutBrightness === expectedBrightness, 'new page did not restore the selected appearance preference');
      ensure(!lighting.snapshot().lightsOut && lighting.snapshot().brightness === 1, 'restoring a preference activated dark mode');
      experience.voices.setMuted(true);
      const narration = document.getElementById('experience-test-scenario');
      narration.checked = false; narration.dispatchEvent(new Event('change'));
      let poseMode = 'valid';
      const frame = { getViewerPose: () => poseMode === 'missing' ? null : ({
        emulatedPosition: poseMode === 'emulated', transform: { position: { x: 0, y: 1.65, z: 0 } },
      }), getJointPose: () => null };
      const darken = () => {
        if (automatic) {
          lighting.observeSecondBox(false); lighting.observeSecondBox(true); lighting.update(.01);
          for (let i = 0; i < 4; i++) lighting.update(.5);
          lighting.update(.07);
          ensure(lighting.snapshot().flickering && soundPlaying, 'automatic light/sound was not active');
        } else { ensure(lighting.setLightsOut(true), 'could not activate the system effect'); lighting.update(.2); }
        ensure(lighting.snapshot().brightness < 1, 'effect was not active before interruption');
      };
      const restore = reason => {
        lighting.update(10);
        ensure(lighting.snapshot().brightness === 1 && !lighting.snapshot().lightsOut && !lighting.snapshot().fading,
          `${reason} failed to restore/cancel lighting`);
        ensure(scan.viewer.splatMesh.material.uniforms.uHallwayBrightness.value === 1, `${reason} left a dark shader`);
        ensure(lighting.snapshot().lightsOutBrightness === (automatic ? .3 : expectedBrightness), `${reason} erased the selected brightness`);
        if (automatic) {
          const count = soundStarts;
          for (let i = 0; i < 35; i++) { lighting.observeSecondBox(true); lighting.update(.1); }
          ensure(!soundPlaying && count === soundStarts && lighting.snapshot().brightness === 1,
            `${reason} revived the flicker or sound`);
        }
      };
      const begin = () => {
        xr.isPresenting = true; session.visibilityState = 'visible'; poseMode = 'valid';
        xr.dispatchEvent({ type: 'sessionstart' });
        experience.update(.01, frame); experience.calibrated(); darken();
      };
      const cases = [
        ['hidden view', () => { session.visibilityState = 'hidden'; session.dispatchEvent({ type: 'visibilitychange' }); }],
        ['blurred view', () => { session.visibilityState = 'visible-blurred'; session.dispatchEvent({ type: 'visibilitychange' }); }],
        ['missing viewer', () => { poseMode = 'missing'; experience.update(.01, frame); }],
        ['emulated viewer', () => { poseMode = 'emulated'; experience.update(.01, frame); }],
        ['paused frames', () => experience.update(.6, frame)],
        ['reference reset', () => reference.dispatchEvent({ type: 'reset' })],
        ['session end', () => { xr.isPresenting = false; xr.dispatchEvent({ type: 'sessionend' }); }],
      ];
      const checked = [];
      for (const [reason, interrupt] of cases) { begin(); interrupt(); restore(reason); checked.push(reason); }
      xr.isPresenting = false; darken();
      xr.isPresenting = true; xr.dispatchEvent({ type: 'sessionstart' }); restore('new session'); checked.push('new session');
      darken(); experience.dispose(); restore('dispose'); checked.push('dispose');
      return { syntheticOnly: true, restoredWithoutRevival: checked, automaticFlicker: automatic,
        soundCancelledWithoutRevival: automatic, preferenceRestoredInNewPage: expectedBrightness };
    }, { expectedBrightness, automatic });
  } finally { await isolated.close(); }
}
