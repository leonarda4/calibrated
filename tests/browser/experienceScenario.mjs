import { fileURLToPath } from 'node:url';

/** Actual lifecycle orchestration, isolated from the app and real XR devices. */
export async function runExperienceScenario(page) {
  const isolated = await page.context().newPage();
  isolated.setDefaultTimeout(15000);
  try {
    // A fresh page prevents duplicate operator-control IDs in the app under test.
    // Suppress its main entry; the scenario imports only the factory it exercises.
    await isolated.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await isolated.goto(new URL('/', page.url()).href, { waitUntil: 'domcontentloaded' });
    const result = await isolated.evaluate(async () => {
      const [THREE, { setupExperience }] = await Promise.all([
        import('/node_modules/.vite/deps/three.js'),
        import('/src/experience/setupExperience.ts'),
      ]);
      const ensure = (condition, message) => {
        if (!condition) throw new Error(`Experience lifecycle regression: ${message}`);
      };
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      const scan = new THREE.Group();
      scene.add(camera, scan);
      scan.position.set(3, 0.2, -5);
      scan.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      scan.updateMatrixWorld(true);
      const baseline = scan.matrix.toArray();
      const material = new THREE.ShaderMaterial({ uniforms: { uGlobalOpacity: { value: 1 } } });
      scan.viewer = { splatMesh: { material } };
      const canvas = document.createElement('canvas');
      const reference = new THREE.EventDispatcher();
      const session = new THREE.EventDispatcher();
      session.visibilityState = 'visible';
      session.inputSources = [];
      session.enabledFeatures = Object.freeze(['hand-tracking']);
      const xr = new THREE.EventDispatcher();
      Object.assign(xr, {
        isPresenting: false,
        getSession: () => session,
        getReferenceSpace: () => reference,
      });
      const renderer = { xr, domElement: canvas };
      const experience = setupExperience(renderer, scene, camera, scan);
      const originalHandUpdate = experience.hands.update;
      const originalHandClear = experience.hands.clear;
      let handUpdateCalls = 0;
      let handClearCalls = 0;
      experience.hands.update = (...args) => {
        handUpdateCalls++;
        return originalHandUpdate.apply(experience.hands, args);
      };
      experience.hands.clear = (...args) => {
        handClearCalls++;
        return originalHandClear.apply(experience.hands, args);
      };
      // Use real transcript/stop behaviour while making audio generation/playback
      // irrelevant to lifecycle assertions. This creates no AudioContext/fetch.
      experience.voices.setMuted(true);
      const invalidations = [];
      let capturing = false;
      experience.bindCalibrationCaptureState(() => capturing);
      experience.bindCalibrationInvalidator(reason => { invalidations.push(reason); capturing = false; });
      const installation = experience.installation;
      const stopHud = camera.getObjectByName('experience-stop');
      const stopContext = stopHud.material.map.image.getContext('2d');
      const originalStopFillText = stopContext.fillText;
      const originalStopClearRect = stopContext.clearRect;
      let stopLines = [];
      const copyHudCanvas = () => {
        const copy = document.createElement('canvas');
        copy.width = stopContext.canvas.width;
        copy.height = stopContext.canvas.height;
        copy.getContext('2d').drawImage(stopContext.canvas, 0, 0);
        return copy;
      };
      let pausedHudCopy;
      let restoredHudCopy;
      // Inspect the actual displayed recovery action, including line truncation,
      // without OCR or changing the shared viewer document's canvas methods.
      stopContext.clearRect = function (...args) { stopLines = []; return originalStopClearRect.apply(this, args); };
      stopContext.fillText = function (...args) { stopLines.push(String(args[0])); return originalStopFillText.apply(this, args); };
      let viewerMode = 'valid';
      let handPoseReads = 0;
      const frame = {
        getViewerPose(space) {
          ensure(space === reference, 'viewer pose used a different reference space');
          if (viewerMode === 'missing') return null;
          return {
            emulatedPosition: viewerMode === 'emulated',
            transform: { position: { x: 0, y: 1.65, z: 0 } },
          };
        },
        getJointPose() { handPoseReads++; return null; },
      };
      const state = () => installation.snapshot();
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const expectStopped = (count, reasonPart) => {
        ensure(state().phase === 'stopped', `${reasonPart}: sequence did not stop`);
        ensure(!state().calibrated && !state().placementConfirmed, `${reasonPart}: alignment authority survived`);
        ensure(invalidations.length === count, `${reasonPart}: expected exactly one calibration cancellation`);
        const hud = camera.getObjectByName('experience-stop');
        ensure(hud?.visible, `${reasonPart}: in-headset stop cue is hidden`);
      };
      const recoverAndShowBox = () => {
        viewerMode = 'valid';
        session.visibilityState = 'visible';
        experience.prepareForCalibration();
        experience.calibrated();
        // Explicit placement in this synthetic floor frame replaces the real
        // scan-centering operation. There are no narrative/attestation gates.
        installation.configure({
          ...state().config,
          centerX: 0, centerZ: -2, floorY: 0, hallwayWidth: 2.1,
        });
        ensure(state().placementSource === 'manual-world' && !state().placementConfirmed,
          'explicit synthetic placement unexpectedly retained a physical-check confirmation');
        ensure(!state().stationaryConfirmed, 'manual box fixture unexpectedly carried support confirmation');
        ensure(installation.showBox(false), 'fresh fit plus explicit placement could not show the box');
        experience.update(0.01, frame);
        ensure(state().phase === 'box' && state().calibrated, 'valid viewer did not retain the manually shown box');
      };

      try {
        ensure(document.querySelector('#experience-show-box') && document.querySelector('#experience-rotate'),
          'manual Chrome Show box / Rotate hallway controls were not created');
        for (const obsoleteId of ['experience-start', 'experience-preview', 'experience-reveal',
          'experience-collect', 'experience-stationary', 'experience-placement-check']) {
          ensure(!document.getElementById(obsoleteId), `obsolete narrative/attestation control remains: ${obsoleteId}`);
        }
        ensure(document.querySelector('#experience-floorY')?.readOnly,
          'local-floor display can still be edited as an arbitrary box height');
        // A desktop artistic turn must be undone before a fresh XR registration.
        installation.configure({ ...state().config, centerX: 0, centerZ: -2, floorY: 0, hallwayWidth: 2.1 });
        ensure(installation.showBox(true), 'initial desktop box did not appear');
        ensure(state().phase === 'box' && !state().stationaryConfirmed,
          'manual desktop box required a stationary confirmation');
        ensure(installation.rotateHallway(), 'manual desktop rotation did not start');
        experience.update(1);
        ensure(!same(scan.matrix.toArray(), baseline), 'preview did not rotate the visual scan');
        xr.isPresenting = true;
        xr.dispatchEvent({ type: 'sessionstart' });
        ensure(same(scan.matrix.toArray(), baseline), 'session start failed to restore the preview baseline');
        ensure(state().phase === 'idle' && !state().calibrated && !state().preview && state().yaw === 0,
          'session start retained preview or calibration authority');

        ensure(experience.calibrationBlockReason(), 'session start allowed capture before a visible viewer pose');
        session.visibilityState = 'hidden';
        viewerMode = 'missing';
        session.dispatchEvent({ type: 'visibilitychange' });
        experience.update(0.01, frame);
        session.visibilityState = 'visible-blurred';
        viewerMode = 'valid';
        experience.update(0.01, frame);
        ensure(state().phase === 'idle' && invalidations.length === 0,
          'initial hidden/blurred view latched a STOP before tracking was established');
        ensure(experience.calibrationBlockReason(), 'blurred startup allowed capture');
        session.visibilityState = 'visible';
        viewerMode = 'emulated';
        experience.update(0.01, frame);
        ensure(experience.calibrationBlockReason(), 'emulated startup allowed capture');
        viewerMode = 'valid';
        experience.update(0.01, frame);
        ensure(!experience.calibrationBlockReason(), 'visible tracked startup did not enable manual calibration');
        ensure(!state().calibrated, 'tracked startup granted alignment without a fit');

        // A first valid pose is not a fit. Opening a menu on the title screen
        // must wait for focus again, rather than permanently latching STOP.
        for (const visibilityState of ['visible-blurred', 'hidden']) {
          session.visibilityState = visibilityState;
          viewerMode = 'missing';
          session.dispatchEvent({ type: 'visibilitychange' });
          ensure(state().phase === 'idle' && invalidations.length === 0 && !stopHud.visible,
            `READY ${visibilityState} latched STOP after the first valid pose`);
          ensure(experience.calibrationBlockReason()?.toLowerCase().includes(visibilityState),
            `READY ${visibilityState} did not name the reported view state`);
          experience.update(0.01, frame);
          ensure(state().phase === 'idle' && invalidations.length === 0,
            `READY ${visibilityState} was misclassified as headset-position loss`);
          session.visibilityState = 'visible';
          viewerMode = 'valid';
          session.dispatchEvent({ type: 'visibilitychange' });
          experience.update(0.01, frame);
          ensure(!experience.calibrationBlockReason() && !state().calibrated && invalidations.length === 0,
            'closing a READY menu failed to restore capture readiness or automatically granted alignment');
        }

        const updatesBeforeCapture = handUpdateCalls;
        const clearsBeforeCapture = handClearCalls;
        const originalFeatures = session.enabledFeatures;
        experience.prepareForCalibration();
        experience.update(0.01, frame);
        ensure(handUpdateCalls === updatesBeforeCapture && handClearCalls > clearsBeforeCapture,
          'calibration advanced the hand adapter instead of hiding app hands and clearing contact authority');
        ensure(!state().calibrated && invalidations.length === 0,
          'hand suppression granted calibration or created a tracking interruption');
        experience.calibrated();
        experience.update(0.01, frame);
        ensure(handUpdateCalls === updatesBeforeCapture + 1,
          'calibration completion did not resume the hand adapter for the experience');
        ensure(session.enabledFeatures === originalFeatures && session.enabledFeatures.includes('hand-tracking'),
          'calibration changed the session hand-tracking feature instead of controlling app hands');

        recoverAndShowBox();
        experience.update(0.1, frame);
        ensure(state().phase === 'box' && state().calibrated && invalidations.length === 0,
          'missing unused hands invalidated a valid viewer');
        ensure(handPoseReads === 0, 'empty hand input sources caused joint sampling');

        viewerMode = 'missing';
        experience.update(0.01, frame);
        experience.update(0.01, frame);
        expectStopped(1, 'missing viewer');
        installation.reset();
        ensure(!state().calibrated && !installation.showBox(false), 'reset revived invalidated alignment authority');

        recoverAndShowBox();
        viewerMode = 'emulated';
        experience.update(0.01, frame);
        experience.update(0.01, frame);
        expectStopped(2, 'emulated viewer');

        recoverAndShowBox();
        reference.dispatchEvent({ type: 'reset' });
        reference.dispatchEvent({ type: 'reset' });
        expectStopped(3, 'reference-space reset');

        recoverAndShowBox();
        session.visibilityState = 'hidden';
        session.dispatchEvent({ type: 'visibilitychange' });
        experience.update(0.01, frame);
        expectStopped(4, 'session visibility interruption');
        ensure(experience.calibrationBlockReason(), 'hidden view allowed a new capture');
        session.visibilityState = 'visible';
        experience.update(0.01, frame);
        ensure(!experience.calibrationBlockReason(), 'visible recovery did not permit manual recalibration');
        expectStopped(4, 'visibility recovery requires manual recalibration');

        recoverAndShowBox();
        ensure(!state().stationaryConfirmed && installation.rotateHallway(),
          'manual rotation unexpectedly required support confirmation or contact');
        experience.update(0.1, frame);
        ensure(state().phase === 'rotating' && state().yaw > 0, 'frame-gap test did not start a partial turn');
        const frozenAt = scan.matrix.toArray();
        experience.update(0.6, frame);
        expectStopped(5, 'XR callback gap');
        ensure(same(scan.matrix.toArray(), frozenAt), 'callback gap jumped the scan instead of freezing it');

        recoverAndShowBox();
        xr.isPresenting = false;
        xr.dispatchEvent({ type: 'sessionend' });
        ensure(state().phase === 'stopped' && !state().calibrated, 'session end retained alignment authority');
        ensure(state().status.includes('Resume VR'), 'ended-session status did not explain how to re-enter VR');
        ensure(!camera.getObjectByName('experience-stop').visible,
          'ended session left a stale headset STOP overlay in desktop inspection');
        experience.update(0.3);
        ensure(!camera.getObjectByName('experience-stop').visible,
          'periodic installation publication restored the stale ended-session HUD');
        ensure(document.querySelector('#experience-status').textContent.includes('Resume VR'),
          'operator panel did not retain the session re-entry instructions');

        const stop = document.querySelector('#experience-stop');
        ensure(stop, 'operator STOP control was not created');
        for (const expected of [6, 7]) {
          installation.reset();
          ensure(installation.showBox(true), 'desktop box did not reappear after session end/reset');
          experience.update(0.01);
          stop.click();
          expectStopped(expected, 'repeated operator STOP after desktop reset');
        }

        // A real capture must cancel from the visibility event itself: hidden
        // sessions are allowed to stop delivering animation frames entirely.
        xr.isPresenting = true;
        session.visibilityState = 'visible';
        viewerMode = 'valid';
        xr.dispatchEvent({ type: 'sessionstart' });
        experience.update(0.01, frame);
        for (const [index, visibilityState] of ['visible-blurred', 'hidden'].entries()) {
          experience.prepareForCalibration();
          capturing = true;
          experience.update(0.01, frame);
          const expected = 8 + index;
          session.visibilityState = visibilityState;
          viewerMode = 'missing';
          session.dispatchEvent({ type: 'visibilitychange' });
          expectStopped(expected, `capture ${visibilityState} cancels without another frame`);
          ensure(!capturing, 'visibility event failed to cancel the active calibration capture');
          ensure(state().status.toLowerCase().includes(visibilityState),
            'capture interruption omitted the actual runtime visibility state');
          ensure(experience.calibrationBlockReason()?.toLowerCase().includes(visibilityState),
            'visibility state did not take priority over unavailable viewer pose');
          if (index === 0) pausedHudCopy = copyHudCanvas();
          session.dispatchEvent({ type: 'visibilitychange' });
          expectStopped(expected, 'repeated visibility event cancels once');
          session.visibilityState = 'visible';
          viewerMode = 'valid';
          session.dispatchEvent({ type: 'visibilitychange' });
          experience.update(0.01, frame);
          expectStopped(expected, 'restored visibility requires explicit fresh calibration');
          ensure(!experience.calibrationBlockReason(), 'restored visible real pose still blocks explicit calibration');
          const recoveryCopy = stopLines.join(' ').toUpperCase();
          ensure(recoveryCopy.includes('VIEW RESTORED') && recoveryCopy.includes('FRONT TRIGGER'),
            'visible HUD recovery action was stale or truncated before the front-trigger instruction');
          if (index === 0) restoredHudCopy = copyHudCanvas();
          ensure(!state().calibrated && !state().placementConfirmed && !installation.showBox(false),
            'recovered view silently accepted the interrupted calibration');
        }

        ensure(same(scene.position.toArray(), [0, 0, 0]) && same(scene.quaternion.toArray(), [0, 0, 0, 1]) &&
          same(scene.scale.toArray(), [1, 1, 1]), 'experience moved/scaled the XR scene parent');
        ensure(camera.parent === scene && same(camera.position.toArray(), [0, 0, 0]) &&
          same(camera.quaternion.toArray(), [0, 0, 0, 1]) && same(camera.scale.toArray(), [1, 1, 1]),
          'experience moved/scaled the tracked camera rig');
        for (const side of ['left', 'right']) {
          const hand = scene.getObjectByName(`tracked-${side}-hand`);
          ensure(hand?.parent === scene && same(hand.position.toArray(), [0, 0, 0]) &&
            same(hand.quaternion.toArray(), [0, 0, 0, 1]) && same(hand.scale.toArray(), [1, 1, 1]),
            'experience moved/scaled a tracked-hand parent');
        }
        ensure(pausedHudCopy && restoredHudCopy, 'synthetic pause/recovery canvas copies were not captured');
        const preview = document.createElement('main');
        Object.assign(preview.style, { maxWidth: '1080px', margin: '0 auto', padding: '24px',
          boxSizing: 'border-box', color: '#edf2f7', font: '16px/1.45 system-ui, sans-serif' });
        const heading = document.createElement('h1');
        heading.textContent = 'Synthetic headset HUD: pause and recovery';
        heading.style.fontSize = '22px';
        const explanation = document.createElement('p');
        explanation.textContent = 'Copies of the actual HUD texture after synthetic lifecycle events. No immersive session or headset result. Calibration remains invalid after the view returns.';
        explanation.style.color = '#c2cdd8';
        preview.append(heading, explanation);
        for (const [labelText, copy] of [
          ['1. Capture interrupted by visible-blurred', pausedHudCopy],
          ['2. Visible real viewer pose restored; explicit calibration required', restoredHudCopy],
        ]) {
          const label = document.createElement('h2');
          label.textContent = labelText;
          Object.assign(label.style, { fontSize: '16px', margin: '24px 0 8px' });
          Object.assign(copy.style, { width: '100%', height: 'auto', display: 'block',
            border: '1px solid #536579', boxSizing: 'border-box' });
          preview.append(label, copy);
        }
        document.body.replaceChildren(preview);
        return {
          passed: true,
          evidence: 'Actual setupExperience with synthetic session/reference/frame and detached scene; no headset result',
          checks: ['session start restores preview baseline and disarms', 'current fit plus explicit placement shows the box',
            'manual Show box and Rotate hallway need no stationary/support confirmation or orb contact',
            'manual Chrome controls replace narrative/attestation controls; local-floor is read-only',
            'hidden/blurred startup waits without STOP', 'capture waits for visible non-emulated pose',
            'READY menu opening after a valid pose waits without STOP',
            'waiting messages name visible-blurred/hidden before unavailable pose',
            'active capture cancels immediately on visibility event without another frame',
            'view-restored headset action remains visible and requires explicit calibration',
            'calibration hides app hands and clears contacts without disabling hand tracking',
            'calibrated experience resumes the hand adapter',
            'visibility recovery never auto-restores alignment',
            'unused hand loss preserves alignment', 'missing viewer invalidates once', 'emulated viewer invalidates once',
            'reference reset invalidates once', 'hidden headset view invalidates once', 'long frame gap freezes turn',
            'reset cannot revive authority', 'session end invalidates', 'ended session explains Resume VR recovery',
            'ended-session HUD stays hidden on desktop', 'repeated operator STOP remains effective',
            'tracked camera and hand parents remain identity'],
          calibrationCancellations: invalidations.length,
          handPoseReads,
          handUpdateCalls,
          handClearCalls,
          finalPhase: state().phase,
          hudScreenshot: 'pause-recovery-synthetic.png',
        };
      } finally {
        stopContext.fillText = originalStopFillText;
        stopContext.clearRect = originalStopClearRect;
        experience.hands.update = originalHandUpdate;
        experience.hands.clear = originalHandClear;
        experience.dispose();
        material.dispose();
      }
    });
    await isolated.setViewportSize({ width: 1200, height: 900 });
    await isolated.screenshot({
      path: fileURLToPath(new URL('../../.check/pause-recovery-synthetic.png', import.meta.url)),
      fullPage: true,
    });
    return result;
  } finally { await isolated.close(); }
}
