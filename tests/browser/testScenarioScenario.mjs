import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

/** Actual timed coordinator/buttons with fabricated walls and an inert XR adapter. */
export async function runTestScenarioScenario(parentPage) {
  const page = await parentPage.context().newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.goto(new URL('/', parentPage.url()).href, { waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 1300, height: 900 });
    const result = await page.evaluate(async () => {
      const [THREE, { setupExperience }, { VOICE_CUES }] = await Promise.all([
        import('/node_modules/.vite/deps/three.js'),
        import('/src/experience/setupExperience.ts'),
        import('/src/audio/voiceCues.ts'),
      ]);
      const ensure = (condition, message) => {
        if (!condition) throw new Error(`Timed scenario regression: ${message}`);
      };
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      document.body.replaceChildren();
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x101824);
      const camera = new THREE.PerspectiveCamera();
      const scan = new THREE.Group();
      scene.add(camera, scan);
      // Fabricated corridor, raw Y along its length and raw Z above its floor.
      // These dense opposing wall samples exercise the real placement guards.
      scan.position.set(-2, 1.45, 20);
      scan.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      scan.updateMatrixWorld(true);
      const points = [];
      for (const x of [.95, 3.05]) {
        for (let y = 18; y <= 26.001; y += .05) {
          for (let z = -1; z <= .251; z += .1) points.push(x, y, z);
        }
      }
      const material = new THREE.ShaderMaterial({ uniforms: { uGlobalOpacity: { value: 1 } } });
      scan.viewer = { splatMesh: { material, splatDataTextures: { baseData: { centers: new Float32Array(points) } } } };
      const reference = new THREE.EventDispatcher();
      const session = new THREE.EventDispatcher();
      session.visibilityState = 'visible';
      session.inputSources = [];
      session.enabledFeatures = [];
      const xr = new THREE.EventDispatcher();
      Object.assign(xr, { isPresenting: false, getSession: () => session, getReferenceSpace: () => reference });
      const render = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      render.setSize(940, 640);
      render.domElement.style.cssText = 'display:block;margin:100px 0 0 12px;max-width:calc(100vw - 350px);height:auto';
      document.body.append(render.domElement);
      const experience = setupExperience({ xr, domElement: render.domElement }, scene, camera, scan, { isScanReady: () => true });
      const installation = experience.installation;
      const state = () => installation.snapshot();
      const clock = () => experience.scenario.snapshot();
      const events = [];
      let stoppedAudio = 0;
      const originalStop = experience.voices.stop;
      experience.voices.stop = () => { stoppedAudio++; originalStop(); };
      experience.voices.unlock = async () => true;
      experience.voices.preload = async () => {};
      experience.voices.play = async cue => {
        events.push({ cue, elapsed: clock().elapsedSeconds, phase: state().phase, yaw: state().yaw });
      };
      let viewerValid = true;
      const frame = { getViewerPose: () => viewerValid ? {
        emulatedPosition: false, transform: { position: { x: 0, y: 1.65, z: 0 } },
      } : null };
      const advance = seconds => {
        for (let remaining = seconds; remaining > 1e-8;) {
          const step = Math.min(.25, remaining);
          experience.update(step, xr.isPresenting ? frame : undefined);
          remaining -= step;
        }
      };
      const until = elapsed => {
        const duration = elapsed - clock().elapsedSeconds;
        ensure(duration >= -1e-7, `test attempted to reverse its own clock (${elapsed})`);
        if (duration > 0) advance(duration);
      };
      const setEnabled = enabled => {
        const checkbox = document.querySelector('#experience-test-scenario');
        checkbox.checked = enabled;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const freshFit = () => {
        session.visibilityState = 'visible'; viewerValid = true;
        experience.prepareForCalibration();
        experience.update(.01, frame);
        events.length = 0;
        experience.calibrated();
      };
      const noLaterActions = reason => {
        const before = events.length;
        advance(25);
        ensure(!clock().running && events.length === before, `${reason} allowed a later narrated action`);
      };

      ensure(document.querySelector('#experience-test-scenario')?.checked,
        'scenario does not default to enabled for the next calibration');
      // A desktop fit helper must not silently launch a live-experience clock.
      experience.calibrated();
      ensure(!clock().running && events.length === 0, 'desktop calibrated() launched the XR sequence');
      document.querySelector('#experience-reset').click();
      ensure(!document.querySelector('#experience-preview-scenario').disabled, 'loaded desktop preview is unavailable');
      document.querySelector('#experience-preview-scenario').click();
      await Promise.resolve();
      ensure(clock().running && events[0]?.cue === 'scenarioWelcome', 'preview button failed to launch the welcome');
      const previewCueCount = events.length;
      document.querySelector('#voice-panel [data-action="preview"]').click();
      await Promise.resolve();
      ensure(clock().running && events.length === previewCueCount,
        'legacy voice audition replaced narration during a running desktop scenario');
      advance(2);
      document.querySelector('#experience-reset').click();
      noLaterActions('desktop reset');
      let finishUnlock;
      experience.voices.unlock = () => new Promise(resolve => { finishUnlock = resolve; });
      document.querySelector('#experience-preview-scenario').click();
      document.querySelector('#experience-reset').click();
      finishUnlock(true);
      await Promise.resolve();
      ensure(!clock().running, 'delayed audio unlock revived a preview cancelled by Reset');
      const cuesBeforeStaleAudition = events.length;
      document.querySelector('#voice-panel [data-action="preview"]').click();
      document.querySelector('#experience-reset').click();
      finishUnlock(true);
      await Promise.resolve();
      ensure(events.length === cuesBeforeStaleAudition,
        'delayed legacy voice audition played after Reset cancelled its audio request');
      experience.voices.unlock = async () => true;

      xr.isPresenting = true;
      xr.dispatchEvent({ type: 'sessionstart' });
      experience.update(.01, frame);
      installation.configure({ ...state().config, rotationSeconds: 8 });
      freshFit();
      ensure(state().config.rotationSeconds === 8, 'custom manual duration fixture was not retained before the timed turn');
      ensure(clock().running && clock().elapsedSeconds === 0 && events[0]?.cue === 'scenarioWelcome',
        'fresh XR fit did not start exactly one welcome immediately');
      ensure(state().phase === 'ready' && !scene.getObjectByName('installation-fixed-props').visible,
        'calibration start displayed the box before its deadline');
      ensure(document.querySelector('#experience-show-box').disabled && document.querySelector('#experience-rotate').disabled,
        'manual controls can advance an active timed sequence early');
      until(9.999);
      ensure(state().phase === 'ready' && events.length === 1, 'first box appeared before ten seconds');
      until(10.001);
      ensure(state().phase === 'box' && scene.getObjectByName('installation-fixed-props').visible,
        'ten-second event failed to show the actual box');
      ensure(state().secondBox.placed && !state().secondBox.visible, 'first show did not prepare the hidden second box');
      scene.updateMatrixWorld(true);
      const primaryPose = scene.getObjectByName('installation-box').matrixWorld.toArray();
      const secondPose = { base: state().secondBox.base, yaw: state().secondBox.yaw };
      ensure(events.at(-1).cue === 'scenarioBox' && events.at(-1).phase === 'box',
        'box narration did not accompany its successful reveal');
      until(14.999);
      ensure(state().phase === 'box' && state().yaw === 0, 'hallway turn started before fifteen seconds');
      until(15.001);
      ensure(state().phase === 'rotating' && events.at(-1).cue === 'scenarioTurn' && events.at(-1).phase === 'rotating',
        'turn narration did not start while the hallway was turning');
      ensure(state().config.rotationSeconds === 4,
        'timed scenario retained the custom eight-second manual turn and would miss its seat deadline');
      until(19.1);
      ensure(state().phase === 'reversed' && Math.abs(state().yaw - Math.PI) < 1e-9 && !state().secondBox.visible,
        'four-second turn did not finish before the still-hidden seat reveal');
      until(19.999);
      ensure(!state().secondBox.visible && events.length === 3, 'seat appeared before twenty seconds');
      until(20.001);
      ensure(!clock().running && clock().stage === 'complete' && state().secondBox.visible &&
        scene.getObjectByName('installation-second-box').visible, 'twenty-second event did not reveal the actual second mesh');
      ensure(same({ base: state().secondBox.base, yaw: state().secondBox.yaw }, secondPose),
        'seat reveal recomputed or moved its frozen pre-turn pose');
      scene.updateMatrixWorld(true);
      ensure(same(scene.getObjectByName('installation-box').matrixWorld.toArray(), primaryPose),
        'timed turn/reveal moved the first box');
      ensure(same(events.map(event => event.cue), ['scenarioWelcome', 'scenarioBox', 'scenarioTurn', 'scenarioSeat']),
        'narration order differs from the requested four lines');
      const completedEvents = events.map(event => ({ ...event, transcript: VOICE_CUES[event.cue].caption }));
      const finishedPose = state().secondBox;
      noLaterActions('completed sequence');

      const cancellations = [];
      for (const [reason, cancel] of [
        ['operator STOP', () => document.querySelector('#experience-stop').click()],
        ['direct installation stop', () => installation.stop('Synthetic direct installation stop.')],
        ['reset baseline', () => document.querySelector('#experience-reset').click()],
        ['fresh calibration preparation', () => experience.prepareForCalibration()],
        ['reference-space reset', () => reference.dispatchEvent({ type: 'reset' })],
        ['hidden session', () => { session.visibilityState = 'hidden'; session.dispatchEvent({ type: 'visibilitychange' }); }],
        ['missing viewer pose', () => { viewerValid = false; experience.update(.01, frame); }],
        ['session end', () => { xr.isPresenting = false; xr.dispatchEvent({ type: 'sessionend' }); }],
      ]) {
        if (!xr.isPresenting) { xr.isPresenting = true; xr.dispatchEvent({ type: 'sessionstart' }); }
        freshFit(); advance(1);
        const stoppedBefore = stoppedAudio;
        cancel();
        ensure(!clock().running && stoppedAudio > stoppedBefore, `${reason} failed to cancel the clock and stop audio`);
        noLaterActions(reason);
        cancellations.push(reason);
      }
      if (!xr.isPresenting) { xr.isPresenting = true; xr.dispatchEvent({ type: 'sessionstart' }); }
      freshFit();
      experience.update(.6, frame);
      ensure(!clock().running && state().phase === 'stopped', 'stalled XR frames fast-forwarded the timed scenario');
      noLaterActions('frame stall');
      cancellations.push('XR frame stall');

      freshFit(); advance(1); setEnabled(false);
      ensure(!clock().running, 'unchecking the timed scenario left it running');
      noLaterActions('disabled scenario');
      freshFit(); advance(21);
      ensure(!clock().running && events.length === 0 && state().phase === 'ready',
        'disabled scenario automatically narrated or showed a box after a fit');
      document.querySelector('#experience-show-box').click();
      ensure(state().phase === 'box', 'disabled scenario prevented the existing manual Show box action');
      document.querySelector('#experience-rotate').click();
      ensure(state().phase === 'rotating', 'disabled scenario prevented manual rotation');
      advance(4.1);
      document.querySelector('#experience-show-second-box').click();
      ensure(state().secondBox.visible, 'disabled scenario prevented manual second-box reveal');

      // A failed appearance fit cancels the clock instead of narrating an event
      // that never happened or continuing into an unsupported rotation.
      setEnabled(true); freshFit();
      const savedCenters = scan.viewer.splatMesh.splatDataTextures.baseData.centers;
      scan.viewer.splatMesh.splatDataTextures.baseData.centers = new Float32Array([0, 0, 0]);
      advance(10.1);
      ensure(!clock().running && clock().stage === 'cancelled' && state().phase !== 'box' && events.length === 1,
        'weak wall fit continued the scenario or narrated an unsuccessful reveal');
      noLaterActions('failed placement');
      scan.viewer.splatMesh.splatDataTextures.baseData.centers = savedCenters;

      // Leave a finished production scene/control panel for visual inspection.
      freshFit(); advance(20.1);
      ensure(state().secondBox.visible && !clock().running, 'fresh calibration failed to restart after cancellation');
      ensure(camera.parent === scene && same(camera.position.toArray(), [0, 0, 0]) &&
        same(camera.quaternion.toArray(), [0, 0, 0, 1]) && same(camera.scale.toArray(), [1, 1, 1]),
        'timed sequence moved the tracked camera rig');
      const grid = new THREE.GridHelper(12, 24, 0x718999, 0x304553);
      scene.add(grid);
      const view = new THREE.PerspectiveCamera(48, 940 / 640, .01, 100);
      view.position.set(3.8, 3, 4.3); view.lookAt(0, .2, -2.1);
      render.render(scene, view);
      const note = document.createElement('main');
      note.style.cssText = 'position:absolute;top:12px;left:24px;width:850px;color:#e3edf2;font:15px/1.45 system-ui,sans-serif';
      const heading = document.createElement('h1');
      heading.textContent = 'Post-calibration test scenario · synthetic desktop evidence';
      heading.style.fontSize = '20px';
      const text = document.createElement('p');
      text.textContent = '0 s Welcome → 10 s First box → 15 s Four-second turn → 20 s Second box. Actual fixed-world box meshes; fabricated scan-wall samples. No headset or narrated-audio acceptance.';
      note.append(heading, text); document.body.append(note);
      window.__timedScenarioCleanup = () => { experience.dispose(); material.dispose(); render.dispose(); };
      return {
        passed: true,
        environment: 'Actual setupExperience and Chrome controls; fabricated scan walls, fake session/current-frame viewer pose; no immersive session',
        checks: ['fresh XR fit automatically starts welcome; desktop fit does not',
          'desktop preview button starts the same guarded sequence',
          'delayed audio unlock cannot revive a cancelled preview',
          'legacy voice audition cannot replace active narration or play after a cancelled unlock',
          'first box at 10 seconds, turn at 15 seconds, frozen second box at 20 seconds',
          'timed turn uses four seconds even after a custom eight-second manual setting',
          'four-second rotation and turn narration occur before second-box reveal',
          'manual controls cannot advance an active timed sequence early',
          'completion and interruptions cannot replay delayed actions',
          'scenario can be disabled while manual controls continue to work',
          'weak wall fit cancels without false narration or rotation',
          'fresh calibration restarts the whole scenario', 'tracked camera rig stays at identity'],
        events: completedEvents, cancellations, finalSecondBox: finishedPose,
        audioStopCalls: stoppedAudio, screenshot: 'test-scenario.png',
      };
    });
    await page.screenshot({ path: fileURLToPath(new URL('../../.check/test-scenario.png', import.meta.url)), fullPage: true });
    assert.deepEqual(errors, []);
    return result;
  } finally {
    await page.evaluate(() => window.__timedScenarioCleanup?.()).catch(() => {});
    await page.close();
  }
}
