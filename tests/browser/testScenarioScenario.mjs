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
        for (let y = 15; y <= 29.001; y += .05) {
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
      const wallEvents = [];
      let currentViewer = null;
      let currentForward = null;
      const experience = setupExperience({ xr, domElement: render.domElement }, scene, camera, scan, {
        isScanReady: () => true,
        onGameplayStart() { wallEvents.push({ action: 'arm' }); },
        onTurnCompleted() { wallEvents.push({ action: 'turnCompleted', phase: experience.installation.snapshot().phase }); },
        onViewerPosition(position, forward) { currentViewer = position; currentForward = forward; },
      });
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
      let viewerPosition = { x: 10, y: 1.65, z: 0 };
      let viewerOrientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      const frame = { getViewerPose: () => viewerValid ? {
        emulatedPosition: false, transform: { position: viewerPosition, orientation: viewerOrientation },
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
        viewerPosition = { x: 10, y: 1.65, z: 0 };
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
      ensure(clock().running && clock().stage === 'waitingWelcome' && events.length === 0,
        'preview button failed to launch the one-second welcome wait');
      advance(1);
      ensure(events[0]?.cue === 'scenarioWelcome', 'preview did not play welcome at one second');
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
      ensure(clock().running && clock().elapsedSeconds === 0 && clock().stage === 'waitingWelcome' && events.length === 0,
        'fresh XR fit did not wait one second before welcome');
      ensure(state().phase === 'ready' && !scene.getObjectByName('installation-fixed-props').visible,
        'calibration start displayed the box before its deadline');
      ensure(document.querySelector('#experience-show-box').disabled && document.querySelector('#experience-rotate').disabled,
        'manual controls can advance an active timed sequence early');
      until(.999);
      ensure(events.length === 0, 'welcome played before its one-second deadline');
      until(1.001);
      ensure(events.length === 1 && events[0].cue === 'scenarioWelcome', 'one-second welcome was missing or duplicated');
      until(7.999);
      ensure(state().phase === 'ready' && events.length === 1, 'first box appeared before eight seconds');
      until(8.001);
      ensure(state().phase === 'box' && scene.getObjectByName('installation-fixed-props').visible,
        'eight-second event failed to show the actual box');
      ensure(state().secondBox.placed && !state().secondBox.visible, 'first show did not prepare the hidden second box');
      scene.updateMatrixWorld(true);
      const primaryPose = scene.getObjectByName('installation-box').matrixWorld.toArray();
      const secondPose = { base: state().secondBox.base, yaw: state().secondBox.yaw };
      ensure(events.at(-1).cue === 'scenarioBox' && events.at(-1).phase === 'box',
        'box narration did not accompany its successful reveal');
      until(30);
      ensure(state().phase === 'box' && state().yaw === 0, 'old timer rotated without headset entry');
      viewerPosition = { x: state().config.centerX + 1, y: 2, z: state().config.centerZ };
      advance(.25);
      ensure(state().phase === 'box', 'headset beside the box triggered a turn');
      viewerPosition = { x: state().config.centerX, y: 2, z: state().config.centerZ };
      advance(.25);
      ensure(state().phase === 'box' && clock().stage === 'anticipatingTurn' && events.length === 2,
        'headset entry did not start anticipation before moving the hallway');
      until(32.499);
      ensure(state().phase === 'box' && events.length === 2, 'turn began before its two-second anticipation');
      until(32.5);
      ensure(state().phase === 'rotating' && events.at(-1).cue === 'scenarioTurn' && events.at(-1).phase === 'rotating',
        'turn narration did not start while the hallway was turning');
      ensure(state().config.rotationSeconds === 4,
        'timed scenario retained the custom eight-second manual turn and would miss its seat deadline');
      until(36.6);
      ensure(state().phase === 'reversed' && Math.abs(state().yaw - Math.PI) < 1e-9 && !state().secondBox.visible,
        'four-second turn did not finish before the still-hidden seat reveal');
      until(37.499);
      ensure(!state().secondBox.visible && events.length === 3, 'seat appeared before five seconds after actual turn onset');
      until(37.501);
      ensure(!clock().running && clock().stage === 'complete' && state().secondBox.visible &&
        scene.getObjectByName('installation-second-box').visible,
        `post-turn event did not reveal the actual second mesh: ${state().secondBox.alignmentError ?? clock().status}`);
      ensure(wallEvents.at(-1).action === 'turnCompleted' && wallEvents.at(-1).phase === 'reversed' &&
        wallEvents.some(event => event.action === 'arm'), 'wall was not armed and notified of the actual completed turn');
      ensure(same(currentViewer, [viewerPosition.x, viewerPosition.y, viewerPosition.z]),
        'wall proximity did not receive the current real viewer position');
      ensure(currentForward && Math.abs(currentForward[0] + 1) < 1e-9 && Math.abs(currentForward[1]) < 1e-9 && Math.abs(currentForward[2]) < 1e-9,
        'wall gaze did not receive the current XR orientation from the same viewer pose');
      viewerOrientation = { x: NaN, y: 0, z: 0, w: 1 }; experience.update(.01, frame);
      ensure(currentForward === null, 'Invalid current XR orientation fell back to the desktop viewing direction');
      viewerOrientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      ensure(Math.abs(state().secondBox.base[2] - secondPose.base[2]) < 1e-8 &&
        Math.abs(state().secondBox.base[1] - secondPose.base[1]) < 1e-8 && !state().secondBox.alignmentError,
        'seat lost its authored floor/Z station or current-wall alignment');
      scene.updateMatrixWorld(true);
      ensure(same(scene.getObjectByName('installation-box').matrixWorld.toArray(), primaryPose),
        'timed turn/reveal moved the first box');
      ensure(same(events.map(event => event.cue), ['scenarioWelcome', 'scenarioBox', 'scenarioTurn', 'scenarioSeat']),
        'narration order differs from the requested four lines');
      const completedEvents = events.map(event => ({ ...event, transcript: VOICE_CUES[event.cue].caption }));
      const completedWallEvents = wallEvents.map(event => ({ ...event }));
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
      freshFit();
      ensure(clock().running && clock().stage === 'waitingWelcome' && events.length === 0 &&
        document.querySelector('#experience-test-scenario').checked,
        'fresh calibration did not restore the full game after a manual-only run');
      setEnabled(false); events.length = 0; advance(21);
      ensure(!clock().running && events.length === 0 && state().phase === 'ready',
        'explicit manual-only mode failed to cancel this run');
      document.querySelector('#experience-show-box').click();
      ensure(state().phase === 'box', 'disabled scenario prevented the existing manual Show box action');
      viewerPosition = { x: state().config.centerX, y: 2, z: state().config.centerZ };
      advance(.25);
      ensure(state().phase === 'box', 'headset triggered before the box finished rising');
      advance(1.5);
      ensure(state().phase === 'rotating', 'headset entry failed with narration disabled');
      advance(4.1);
      document.querySelector('#experience-show-second-box').click();
      ensure(state().secondBox.visible, 'disabled scenario prevented manual second-box reveal');

      // A failed appearance fit cancels the clock instead of narrating an event
      // that never happened or continuing into an unsupported rotation.
      setEnabled(true); freshFit();
      const savedCenters = scan.viewer.splatMesh.splatDataTextures.baseData.centers;
      scan.viewer.splatMesh.splatDataTextures.baseData.centers = new Float32Array([0, 0, 0]);
      advance(8.1);
      ensure(!clock().running && clock().stage === 'cancelled' && state().phase !== 'box' && events.length === 1,
        'weak wall fit continued the scenario or narrated an unsuccessful reveal');
      noLaterActions('failed placement');
      scan.viewer.splatMesh.splatDataTextures.baseData.centers = savedCenters;

      // Leave a finished production scene/control panel for visual inspection.
      freshFit(); advance(8.1);
      viewerPosition = { x: state().config.centerX, y: 2, z: state().config.centerZ };
      advance(1.5); // the existing floor-rise must finish before headset entry can trigger the turn
      until(20.6); // complete box announcement, actual headset turn, then seat
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
      text.textContent = 'Welcome at 1 s; first box at 8 s; eligible headset entry starts 2 s of transition music before a 4 s turn; second box 5 s after turn onset. Fixed world boxes and fabricated scan walls. Synthetic poses only; no hardware or audible-output acceptance.';
      note.append(heading, text); document.body.append(note);
      window.__timedScenarioCleanup = () => { experience.dispose(); material.dispose(); render.dispose(); };
      return {
        passed: true,
        environment: 'Actual setupExperience and Chrome controls; fabricated scan walls, fake session/current-frame viewer pose; no immersive session',
        checks: ['fresh XR fit automatically starts the one-second welcome wait; desktop fit does not',
          'desktop preview button starts the same guarded sequence',
          'delayed audio unlock cannot revive a cancelled preview',
          'legacy voice audition cannot replace active narration or play after a cancelled unlock',
          'first box at 8 seconds; no timer turn; headset entry at 30.5 starts two-second anticipation; fixed second box five seconds after turn onset',
          'timed turn uses four seconds even after a custom eight-second manual setting',
          'four-second rotation and turn narration occur before second-box reveal',
          'manual controls cannot advance an active timed sequence early',
          'completion and interruptions cannot replay delayed actions',
          'headset box trigger also works with narration disabled',
          'weak wall fit cancels without false narration or rotation',
          'fresh calibration restarts the whole scenario', 'tracked camera rig stays at identity'],
        events: completedEvents, wallEvents: completedWallEvents, cancellations, finalSecondBox: finishedPose,
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
