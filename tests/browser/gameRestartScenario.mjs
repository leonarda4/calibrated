import assert from 'node:assert/strict';

/** Full fresh-fit replay with real coordinator/placement and inert XR poses. */
export async function runGameRestartScenario(parentPage) {
  const page = await parentPage.context().newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.goto(new URL('/', parentPage.url()).href, { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(async () => {
      const [THREE, { setupExperience }, { createHallwayPlacementFrame, calibratedWallRoute }] = await Promise.all([
        import('/node_modules/.vite/deps/three.js'), import('/src/experience/setupExperience.ts'),
        import('/src/viewer/wallRouteFrame.ts'),
      ]);
      const ensure = (condition, message) => { if (!condition) throw new Error(`Game restart regression: ${message}`); };
      const near = (a, b, label, tolerance = 1e-6) => ensure(Math.abs(a - b) < tolerance, `${label}: ${a} versus ${b}`);
      document.body.replaceChildren();
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), scan = new THREE.Group();
      scene.add(camera, scan);
      scan.position.set(-2, 1.45, 20);
      scan.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); scan.updateMatrixWorld(true);
      const authored = scan.matrixWorld.clone(), points = [];
      for (const x of [.95, 3.05]) for (let y = 15; y <= 29.001; y += .05) {
        for (let z = -1; z <= .251; z += .1) points.push(x, y, z);
      }
      const source = new Float32Array(points), material = new THREE.ShaderMaterial({ uniforms: { uGlobalOpacity: { value: 1 } } });
      const data = { centers: source };
      scan.viewer = { splatMesh: { material, splatDataTextures: { baseData: data } } };
      const reference = new THREE.EventDispatcher(), session = new THREE.EventDispatcher(), xr = new THREE.EventDispatcher();
      session.visibilityState = 'visible'; session.inputSources = []; session.enabledFeatures = [];
      Object.assign(xr, { isPresenting: false, getSession: () => session, getReferenceSpace: () => reference });
      const placementFrame = createHallwayPlacementFrame(scan);
      let gameplayStarts = 0, completedTurns = 0, disarms = 0, cancelled = 0;
      const experience = setupExperience({ xr, domElement: document.createElement('canvas') }, scene, camera, scan, {
        isScanReady: () => true, placementFrame,
        onCalibrationApplied() {
          scan.updateWorldMatrix(true, false);
          placementFrame.set(calibratedWallRoute(authored, scan.matrixWorld));
        },
        onGameplayStart() { gameplayStarts++; }, onTurnCompleted() { completedTurns++; },
        onDisarm() { disarms++; }, onScenarioCancelled() { cancelled++; },
      });
      const installation = experience.installation, state = () => installation.snapshot(), clock = () => experience.scenario.snapshot();
      const cues = [];
      let audioStops = 0, viewerValid = true, viewerPosition = { x: 10, y: 1.65, z: 0 };
      const stop = experience.voices.stop;
      experience.voices.stop = () => { audioStops++; stop(); };
      experience.voices.play = async cue => { cues.push({ cue, elapsed: clock().elapsedSeconds, phase: state().phase }); };
      experience.voices.preload = async () => {};
      const frame = { getViewerPose: () => viewerValid ? {
        emulatedPosition: false, transform: { position: viewerPosition },
      } : null };
      const advance = seconds => {
        for (let remaining = seconds; remaining > 1e-8;) {
          const dt = Math.min(.1, remaining); experience.update(dt, frame); remaining -= dt;
        }
      };
      const until = seconds => {
        const remaining = seconds - clock().elapsedSeconds;
        ensure(remaining >= -1e-6, `Attempted to reverse the fresh game's clock: ${clock().elapsedSeconds} to ${seconds}`);
        if (remaining > 0) advance(remaining);
      };
      const setEnabled = enabled => {
        const checkbox = document.getElementById('experience-test-scenario');
        checkbox.checked = enabled; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const freshFit = (yaw = 0, alreadyInside = true) => {
        session.visibilityState = 'visible'; viewerValid = true;
        experience.prepareForCalibration();
        const fitted = new THREE.Matrix4().makeRotationY(yaw).setPosition(3, 0, -4);
        fitted.clone().multiply(authored).decompose(scan.position, scan.quaternion, scan.scale); scan.updateMatrixWorld(true);
        // The known primary station in route coordinates comes from raw [2,21.1,-1.45].
        const viewerRoute = alreadyInside ? new THREE.Vector3(2, 21.1, -1.45).applyMatrix4(authored)
          : new THREE.Vector3(10, 0, 0);
        viewerRoute.y = 1.65;
        const viewer = viewerRoute.applyMatrix4(fitted);
        viewerPosition = { x: viewer.x, y: viewer.y, z: viewer.z };
        experience.update(.01, frame);
        cues.length = 0;
        experience.calibrated();
        ensure(document.getElementById('experience-test-scenario').checked,
          'Fresh live calibration retained a prior manual-only checkbox');
        ensure(clock().running && clock().stage === 'waitingWelcome', 'Fresh fit did not restart the complete game');
        near(clock().elapsedSeconds, 0, 'Fresh fit elapsed clock');
        ensure(cues.length === 0, 'Fresh fit played welcome before its one-second deadline');
        ensure(state().calibrated && state().phase === 'ready' && state().boxReveal.motion === 'hidden' && !state().secondBox.visible,
          'Fresh fit retained old placement/appearance/phase');
        return fitted;
      };
      const runComplete = () => {
        until(.999);
        ensure(cues.length === 0, 'Welcome played before one second');
        until(1.0001);
        ensure(cues.length === 1 && cues[0].cue === 'scenarioWelcome', 'The one-second welcome did not play exactly once');
        until(7.999);
        ensure(state().phase === 'ready' && cues.length === 1, 'First box or narration occurred before 8 s');
        advance(.0011);
        ensure(state().phase === 'box' && cues.length === 2 && cues[1].cue === 'scenarioBox',
          `The 8 s box/narration did not run exactly once: ${JSON.stringify({ state: state(), clock: clock(), cues })}`);
        near(cues[1].elapsed, 8, 'First-box narration deadline', .002);
        until(9.6);
        ensure(state().boxReveal.motion === 'visible', 'The first box did not finish rising');
        ensure(installation.headsetInsideTrigger([viewerPosition.x, viewerPosition.y, viewerPosition.z]),
          'The already-inside headset fixture does not occupy the shown box');
        until(12.999);
        ensure(state().phase === 'box' && cues.length === 2, 'Headset entry interrupted the first-box narration slot');
        advance(.0011);
        ensure(state().phase === 'box' && clock().stage === 'anticipatingTurn' && cues.length === 2,
          'The armed headset did not start a two-second transition anticipation after the announcement');
        until(14.999);
        ensure(state().phase === 'box' && cues.length === 2, 'The visual turn started before its full music anticipation');
        advance(.0011);
        ensure(state().phase === 'rotating' && cues.length === 3 && cues[2].cue === 'scenarioTurn',
          'The armed headset did not trigger one turn at 15 s');
        near(cues[2].elapsed, 15, 'Narrated turn arm time', .002);
        until(19.1); ensure(state().phase === 'reversed', 'The fixed four-second turn did not complete');
        until(20.001);
        ensure(clock().stage === 'complete' && state().secondBox.visible && cues.length === 4 && cues[3].cue === 'scenarioSeat',
          `Full game did not finish with the second seat: ${JSON.stringify({ state: state(), clock: clock(), cues })}`);
        near(cues[3].elapsed, 20, 'Seat narration after turn', .002);
        ensure(cues.map(event => event.cue).join(',') === 'scenarioWelcome,scenarioBox,scenarioTurn,scenarioSeat',
          'A previous run leaked a cue or skipped part of the game');
        scene.updateMatrixWorld(true);
        const inverse = new THREE.Matrix4().fromArray(placementFrame.matrix()).invert();
        const seat = state().secondBox;
        const seatRoute = new THREE.Vector3(...seat.base).applyMatrix4(inverse).toArray();
        near(seatRoute[1], 0, 'Seat floor');
        const object = scene.getObjectByName('installation-second-box');
        const corners = [];
        for (const x of [-.5, .5]) for (const z of [-.5, .5]) {
          corners.push(new THREE.Vector3(x, -.5, z).applyMatrix4(object.matrixWorld).applyMatrix4(inverse));
        }
        ensure(corners.every(p => Math.abs(p.x) <= 1.05 + 1e-5), 'Mapped seat footprint leaves the corridor');
        ensure([-1.05, 1.05].some(edge => corners.filter(p => Math.abs(p.x - edge) < 1e-5).length === 2),
          'Mapped seat lacks a whole edge on its route-space wall');
        const completeCues = cues.map(event => ({ ...event }));
        advance(2);
        ensure(cues.length === 4, 'A completed game replayed old narration');
        return { cues: completeCues, seatRoute };
      };

      // A pending desktop audio-unlock continuation belongs to its old request,
      // and must not replace the newly calibrated live game when it resolves.
      let finishUnlock;
      experience.voices.unlock = () => new Promise(resolve => { finishUnlock = resolve; });
      document.getElementById('experience-preview-scenario').click();
      ensure(typeof finishUnlock === 'function', 'Pending preview audio request was not created');
      xr.isPresenting = true; xr.dispatchEvent({ type: 'sessionstart' });
      freshFit();
      finishUnlock(true); await Promise.resolve(); await Promise.resolve();
      ensure(clock().running && clock().elapsedSeconds === 0 && cues.length === 0,
        'An older audio-unlock callback replaced or duplicated the fresh game');
      experience.voices.unlock = async () => true;

      const restartResults = [];
      for (const previous of ['waiting', 'box', 'rotating', 'reversed', 'complete', 'cancelled', 'manual-only']) {
        freshFit();
        if (previous === 'waiting') advance(3);
        if (previous === 'box') until(8.2);
        if (previous === 'rotating') until(15.2);
        if (previous === 'reversed') until(19.2);
        if (previous === 'complete') until(20.2);
        if (previous === 'cancelled') experience.invalidate('Synthetic prior game cancellation.');
        if (previous === 'manual-only') setEnabled(false);
        const oldPhase = state().phase;
        freshFit();
        const complete = runComplete();
        restartResults.push({ previous, oldPhase, ...complete });
      }

      const yawResults = [];
      let canonicalSeat = null;
      for (const yaw of [0, Math.PI / 2, Math.PI, -.63]) {
        freshFit(yaw);
        const completed = runComplete();
        if (canonicalSeat === null) canonicalSeat = completed.seatRoute;
        else completed.seatRoute.forEach((v, i) => near(v, canonicalSeat[i], 'Calibrated route-space seat station'));
        yawResults.push({ yaw, ...completed });
      }

      const isCuePlaying = experience.voices.isCuePlaying;
      let leadBusy = true;
      experience.voices.isCuePlaying = cue => cue === 'scenarioBox' && leadBusy;
      freshFit(); until(15.6);
      ensure(state().phase === 'box' && cues.length === 2,
        'A resumed/delayed lead was cut off at the minimum trigger time');
      leadBusy = false; advance(.01);
      ensure(state().phase === 'box' && clock().stage === 'anticipatingTurn' && cues.length === 2,
        'Headset trigger did not start anticipation after the actual box lead ended');
      until(17.609);
      ensure(state().phase === 'box' && cues.length === 2, 'Delayed narration shortened transition anticipation');
      until(17.611);
      ensure(state().phase === 'rotating' && cues.length === 3 && cues.at(-1).cue === 'scenarioTurn',
        'Headset trigger did not release after the actual box lead and transition anticipation ended');
      experience.voices.isCuePlaying = isCuePlaying;

      freshFit();
      const partial = [];
      for (let i = 0; i < source.length; i += 3) if (source[i + 1] < 21.7) partial.push(source[i], source[i + 1], source[i + 2]);
      try {
        // Primary-station walls still span nearly two metres. The later seat
        // station has no supported opposing section, so preparation must fail.
        data.centers = new Float32Array(partial);
        until(8.01);
        ensure(!clock().running && state().phase === 'stopped', 'Failed secondary placement left the game pretending to run');
        ensure(state().boxReveal.motion === 'hidden' && !state().secondBox.visible,
          'Failed seat preparation left a silent, untriggerable first box visible');
        ensure(cues.length === 1 && cues[0].cue === 'scenarioWelcome', 'Failed placement narrated a successful box appearance');
        advance(25);
        ensure(cues.length === 1 && state().phase === 'stopped', 'Failed game fell back into an un-narrated headset turn');
      } finally { data.centers = source; }
      freshFit();
      const recovered = runComplete();
      ensure(camera.parent === scene && camera.position.length() === 0 && camera.quaternion.equals(new THREE.Quaternion()) &&
        camera.scale.equals(new THREE.Vector3(1, 1, 1)), 'Game restarts changed the tracked camera rig');
      experience.dispose(); material.dispose();
      return { restartResults, yawResults, recovered, gameplayStarts, completedTurns, disarms, cancelled, audioStops,
        staleUnlockCancelled: true, alreadyInsideWaitsUntil15: true, delayedLeadFinishesBeforeTurn: true, secondaryFailureIsAtomic: true,
        freshFitRecovers: true, trackedRigIdentity: true, syntheticXrOnly: true };
    });
    assert.equal(result.restartResults.length, 7); assert.equal(result.yawResults.length, 4);
    assert.deepEqual(errors, []);
    return result;
  } finally { await page.close(); }
}
