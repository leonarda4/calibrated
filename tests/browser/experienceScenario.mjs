/** Actual lifecycle orchestration, isolated from the app and real XR devices. */
export async function runExperienceScenario(page) {
  const isolated = await page.context().newPage();
  isolated.setDefaultTimeout(15000);
  try {
    // A fresh page prevents duplicate operator-control IDs in the app under test.
    // Suppress its main entry; the scenario imports only the factory it exercises.
    await isolated.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await isolated.goto(new URL('/', page.url()).href, { waitUntil: 'domcontentloaded' });
    return await isolated.evaluate(async () => {
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
      experience.bindCalibrationInvalidator(reason => invalidations.push(reason));
      const installation = experience.installation;
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
      const recoverAndStart = () => {
        viewerMode = 'valid';
        session.visibilityState = 'visible';
        experience.prepareForCalibration();
        experience.calibrated();
        installation.configure({ ...state().config, explorationSeconds: 0 });
        installation.confirmPlacement(true);
        ensure(installation.start(false), 'fresh fit plus placement confirmation could not start');
        experience.update(0.01, frame);
        ensure(state().phase === 'badge' && state().calibrated, 'valid viewer did not reach the badge stage');
      };

      try {
        // A desktop artistic turn must be undone before a fresh XR registration.
        ensure(installation.start(true), 'initial desktop preview did not start');
        installation.previewAdvance();
        installation.confirmStationary(true);
        ensure(installation.simulateCollection(), 'preview collection did not arm a synthetic turn');
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

        recoverAndStart();
        experience.update(0.1, frame);
        ensure(state().phase === 'badge' && state().calibrated && invalidations.length === 0,
          'missing unused hands invalidated a valid viewer');
        ensure(handPoseReads === 0, 'empty hand input sources caused joint sampling');

        viewerMode = 'missing';
        experience.update(0.01, frame);
        experience.update(0.01, frame);
        expectStopped(1, 'missing viewer');
        installation.reset();
        ensure(!state().calibrated && !installation.start(false), 'reset revived invalidated alignment authority');

        recoverAndStart();
        viewerMode = 'emulated';
        experience.update(0.01, frame);
        experience.update(0.01, frame);
        expectStopped(2, 'emulated viewer');

        recoverAndStart();
        reference.dispatchEvent({ type: 'reset' });
        reference.dispatchEvent({ type: 'reset' });
        expectStopped(3, 'reference-space reset');

        recoverAndStart();
        session.visibilityState = 'hidden';
        session.dispatchEvent({ type: 'visibilitychange' });
        experience.update(0.01, frame);
        expectStopped(4, 'session visibility interruption');
        ensure(experience.calibrationBlockReason(), 'hidden view allowed a new capture');
        session.visibilityState = 'visible';
        experience.update(0.01, frame);
        ensure(!experience.calibrationBlockReason(), 'visible recovery did not permit manual recalibration');
        expectStopped(4, 'visibility recovery requires manual recalibration');

        recoverAndStart();
        installation.confirmStationary(true);
        const config = state().config;
        const now = performance.now();
        // Direct synthetic contact authorizes the pure sequence; no fake hand
        // source/GLB asset is introduced into the runtime adapter under test.
        installation.update(0.01, [{
          position: [config.centerX, config.floorY + config.orbHeight, config.centerZ],
          tracked: true, timestampMs: now,
        }], now);
        experience.update(0.1, frame);
        ensure(state().phase === 'rotating' && state().yaw > 0, 'frame-gap test did not start a partial turn');
        const frozenAt = scan.matrix.toArray();
        experience.update(0.6, frame);
        expectStopped(5, 'XR callback gap');
        ensure(same(scan.matrix.toArray(), frozenAt), 'callback gap jumped the scan instead of freezing it');

        recoverAndStart();
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
          ensure(installation.start(true), 'desktop preview did not restart after session end/reset');
          experience.update(0.01);
          stop.click();
          expectStopped(expected, 'repeated operator STOP after desktop reset');
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
        return {
          passed: true,
          evidence: 'Actual setupExperience with synthetic session/reference/frame and detached scene; no headset result',
          checks: ['session start restores preview baseline and disarms', 'current fit plus confirmed placement starts',
            'hidden/blurred startup waits without STOP', 'capture waits for visible non-emulated pose',
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
        };
      } finally {
        experience.hands.update = originalHandUpdate;
        experience.hands.clear = originalHandClear;
        experience.dispose();
        material.dispose();
      }
    });
  } finally { await isolated.close(); }
}
