/** Restored Nov-2 trigger/countdown calibration with detached current-frame poses.
 * Timers run outside the active XRFrame. This is synthetic regression evidence.
 */
import { fileURLToPath } from 'node:url';

export async function runCalibrationScenario(page) {
  const isolated = await page.context().newPage();
  isolated.setDefaultTimeout(15000);
  try {
    await isolated.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await isolated.goto(new URL('/', page.url()).href, { waitUntil: 'domcontentloaded' });
    const result = await isolated.evaluate(async () => {
      const [THREE, { setupCalibrationCapture }, landmarks] = await Promise.all([
        import('/node_modules/.vite/deps/three.js'), import('/src/xr/calibrationCapture.ts'), import('/src/calibration/landmarks.ts'),
      ]);
      const ensure = (condition, message) => { if (!condition) throw new Error(`Restored calibration regression: ${message}`); };
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      const scan = new THREE.Group();
      scene.add(camera, scan);
      scan.position.set(3, 0.2, -5);
      scan.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      scan.updateMatrixWorld(true);
      const material = new THREE.ShaderMaterial({ uniforms: { uGlobalOpacity: { value: 1 } } });
      scan.viewer = { splatMesh: { material } };
      const canvas = document.createElement('canvas');
      const controllers = Array.from({ length: 4 }, () => new THREE.Group());
      const grips = Array.from({ length: 4 }, () => new THREE.Group());
      const reference = new THREE.EventDispatcher();
      const session = { inputSources: [] };
      const xr = new THREE.EventDispatcher();
      Object.assign(xr, {
        isPresenting: false, getSession: () => session,
        getController: index => controllers[index], getControllerGrip: index => grips[index], getReferenceSpace: () => reference,
      });
      const gamepad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ pressed: false })) };
      const leftSpace = {}, rightSpace = {}, handSpace = {}, nullHandSpace = {};
      const controllerProfiles = ['oculus-touch', 'generic-trigger-squeeze-thumbstick'];
      const controllerJoints = new Map([['wrist', {}], ['index-finger-tip', {}]]);
      const leftSource = { handedness: 'left', gamepad, gripSpace: leftSpace, profiles: controllerProfiles, hand: controllerJoints };
      const rightSource = { handedness: 'right', gamepad, gripSpace: rightSpace, profiles: controllerProfiles, hand: controllerJoints };
      const handSource = { handedness: 'left', hand: new Map(), gamepad, gripSpace: handSpace, profiles: ['generic-hand-select'] };
      const nullHandSource = { handedness: 'right', hand: null, gamepad, gripSpace: nullHandSpace, profiles: ['generic-hand-select'] };
      const sources = Array(4).fill(null);
      const connect = (slot, source) => {
        sources[slot] = source; session.inputSources = sources.filter(Boolean);
        controllers[slot].dispatchEvent({ type: 'connected', data: source });
      };
      const disconnect = slot => {
        sources[slot] = null; session.inputSources = sources.filter(Boolean);
        controllers[slot].dispatchEvent({ type: 'disconnected' });
      };
      const trigger = slot => controllers[slot].dispatchEvent({ type: 'selectstart', data: sources[slot] });
      const yaw = 0.35;
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const translation = new THREE.Vector3(0.4, 0.05, -0.7);
      // Public synthetic annotation metadata, independent of the private asset.
      // This supplies scan correspondences only; physical poses still come
      // through the normal current-frame controller capture below.
      const fixturePair = { a: [0, 0, 0], b: [1, 0, 0] };
      const leftPosition = scan.localToWorld(new THREE.Vector3(...fixturePair.a)).applyQuaternion(rotation).add(translation);
      const rightPosition = scan.localToWorld(new THREE.Vector3(...fixturePair.b)).applyQuaternion(rotation).add(translation);
      const positions = new Map([[leftSpace, leftPosition], [rightSpace, rightPosition]]);
      const modes = new Map();
      let activeFrame = false, poseCalls = 0, inactivePoseCalls = 0, handPoseCalls = 0;
      const frame = { getPose(space, referenceSpace) {
        poseCalls++;
        if (!activeFrame) { inactivePoseCalls++; throw new DOMException('XRFrame is no longer active', 'InvalidStateError'); }
        ensure(referenceSpace === reference, 'capture changed the reference space');
        if (space === handSpace || space === nullHandSpace) handPoseCalls++;
        if (modes.get(space) === 'missing') return null;
        const p = positions.get(space);
        if (!p) return null;
        return { emulatedPosition: modes.get(space) === 'emulated', transform: {
          position: { x: p.x, y: p.y, z: p.z }, orientation: { x: 0, y: 0, z: 0, w: 1 },
        } };
      } };
      let clockMs = 1000, nextInterval = 800000;
      const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
      const originalSetInterval = window.setInterval, originalClearInterval = window.clearInterval;
      const intervals = new Map();
      Object.defineProperty(performance, 'now', { configurable: true, value: () => clockMs });
      window.setInterval = (callback, delay) => {
        ensure(typeof callback === 'function' && delay === 1000, 'placement countdown cadence changed');
        const id = nextInterval++; intervals.set(id, callback); return id;
      };
      window.clearInterval = id => { if (!intervals.delete(Number(id))) originalClearInterval.call(window, id); };
      let beforeCount = 0, scanReady = false, trackingBlocked = null;
      const fits = [], statuses = [];
      const calibration = setupCalibrationCapture(
        { xr, domElement: canvas }, scene, camera, scan, solution => fits.push(solution), undefined,
        text => statuses.push(text), undefined, () => { beforeCount++; }, () => scanReady, () => trackingBlocked,
        { landmarks: fixturePair },
      );
      const status = () => statuses.at(-1) ?? '';
      const opacity = () => material.uniforms.uGlobalOpacity.value;
      const instructionImages = [];
      const captureInstructions = label => {
        const sprite = camera.children.find(child => child.name === 'calibration-instructions');
        const source = sprite?.material?.map?.image;
        ensure(source instanceof HTMLCanvasElement, 'instruction texture is not an inspectable canvas');
        const image = document.createElement('canvas');
        image.width = source.width; image.height = source.height;
        image.getContext('2d').drawImage(source, 0, 0);
        instructionImages.push({ label, image });
      };
      const confirmBudget = remaining => {
        const state = calibration.snapshot();
        ensure(state.step === 'CONFIRM' && state.confirmAttempts === 3 - remaining && state.confirmRemainingAttempts === remaining,
          `CONFIRM budget should have ${remaining} attempts left`);
        ensure(new RegExp(`${remaining}\\s+attempts?\\s+left`, 'i').test(status()),
          `CONFIRM hint omitted its ${remaining} remaining attempts`);
        ensure(state.confirmStartedAt > 0, 'CONFIRM did not record a deadline origin');
        return state;
      };
      const clearedConfirm = label => {
        const state = calibration.snapshot();
        ensure(state.confirmAttempts === 0 && state.confirmStartedAt === 0 && state.confirmRemainingAttempts === 0,
          `${label}: previous CONFIRM failure budget/deadline survived`);
      };
      const sample = (dt = 1 / 72, suppliedFrame = frame) => {
        clockMs += dt * 1000; activeFrame = true;
        try { calibration.sample(dt, suppliedFrame ?? undefined); } finally { activeFrame = false; }
      };
      const tick = (count = 7) => {
        for (let i = 0; i < count; i++) {
          clockMs += 1000;
          for (const [id, callback] of [...intervals]) if (intervals.has(id)) callback();
        }
      };
      const reset = () => calibration.invalidate('Synthetic tracking-origin reset; capture batch discarded.');
      reference.addEventListener('reset', reset);
      try {
        calibration.startCalibration();
        ensure(intervals.size === 0 && fits.length === 0 && beforeCount === 0, 'PC calibration queued or began capture before VR existed');
        ensure(/session|enter vr|resume vr/i.test(status()), 'no-session status omitted the required VR start');
        xr.isPresenting = true; xr.dispatchEvent({ type: 'sessionstart' });
        ensure(opacity() === 0 && intervals.size === 0 && /TRIGGER/i.test(status()), 'session entry did not show the hidden-scan title');
        ensure(!calibration.isCapturing(), 'READY incorrectly reported active capture');
        connect(0, leftSource); connect(1, rightSource); connect(2, handSource); connect(3, nullHandSource);
        ensure(/LEFT: controller connected/.test(status()) && /RIGHT: controller connected/.test(status()),
          'Oculus Touch with joint data was mislabeled as hands-only input');
        captureInstructions('READY: both controllers recognized with joint data');
        disconnect(0); trigger(0);
        ensure(intervals.size === 0 && /LEFT: hand active/.test(status()),
          'disconnected trigger started capture or hand takeover omitted the left-side action');
        captureInstructions('READY: left controller disconnected, hand input active');
        connect(0, leftSource);
        scanReady = true;
        leftSource.profiles = ['generic-hand-select', ...controllerProfiles];
        sample(0, null); trigger(0);
        ensure(intervals.size === 0 && /LEFT: hand active/.test(status()),
          'mutable hand-profile takeover was still allowed to start controller capture');
        leftSource.profiles = controllerProfiles;
        sample(0, null);
        ensure(/LEFT: controller connected/.test(status()), 'controller return required an extra connected event');
        controllers[0].visible = grips[0].visible = false; // Three hides an unavailable tracked pose.
        sample(0, null);
        ensure(!controllers[0].visible && !grips[0].visible,
          'unchanged input classification overrode Three tracking visibility with a stale controller pose');
        scanReady = false;
        trigger(2); trigger(3);
        ensure(intervals.size === 0, 'a hand pinch started calibration from READY');
        const beforeBlocked = beforeCount;
        for (const [label, request] of [['PC', () => calibration.startCalibration()], ['controller', () => trigger(0)]]) {
          scanReady = false;
          request();
          ensure(intervals.size === 0 && beforeCount === beforeBlocked && /loading/i.test(status()),
            `${label} request bypassed the scan-loading gate or omitted its explanation`);
          scanReady = true; // Clears before a single waiting sample runs.
          sample(0, null);
          ensure(calibration.snapshot().step === 'READY' && intervals.size === 0 && fits.length === 0 &&
            beforeCount === beforeBlocked && /HALLWAY PROJECT/i.test(status()) && /TRIGGER/i.test(status()),
            `${label} loading rejection left stale text or automatically began calibration`);
          trackingBlocked = 'HEADSET NOT READY: keep the headset on and close system menus.';
          request();
          ensure(intervals.size === 0 && beforeCount === beforeBlocked && status() === trackingBlocked,
            `${label} request bypassed the viewer gate or omitted its explanation`);
          trackingBlocked = null; // Also clears before a waiting sample.
          sample(0, null);
          ensure(calibration.snapshot().step === 'READY' && intervals.size === 0 && fits.length === 0 &&
            beforeCount === beforeBlocked && /HALLWAY PROJECT/i.test(status()) && /TRIGGER/i.test(status()),
            `${label} viewer rejection left stale text or automatically began calibration`);
        }

        trigger(0);
        ensure(intervals.size === 1 && /7s|7 s|7 seconds/i.test(status()), 'READY trigger did not start one seven-second countdown');
        ensure(calibration.isCapturing(), 'COUNTDOWN did not report active capture');
        sample();
        ensure(poseCalls === 2 && handPoseCalls === 0, 'sampling included a hand or hand=null generic-hand profile');
        tick(6);
        ensure(fits.length === 0 && intervals.size === 1, 'countdown captured before seven seconds');
        tick(1);
        ensure(fits.length === 1 && intervals.size === 0 && inactivePoseCalls === 0, 'timer did not use buffered current-frame poses');
        ensure(!calibration.isCapturing(), 'successful fit retained active capture');
        ensure(fits[0].rmsResidual < 1e-9 && Math.abs(fits[0].yaw - yaw) < 1e-9, 'known nonzero-yaw fit was not recovered');
        sample(1); ensure(opacity() === 1, 'successful fit did not finish the one-second reveal');
        trigger(2);
        ensure(opacity() === 1 && intervals.size === 0, 'hand pinch restarted DONE');
        trigger(0);
        ensure(opacity() === 0 && intervals.size === 0 && /TRIGGER/i.test(status()), 'DONE trigger did not return to title only');
        trigger(1); sample(); disconnect(0); disconnect(1); tick();
        ensure(fits.length === 2 && inactivePoseCalls === 0, 'disconnected hand takeover discarded buffered controller positions');

        connect(0, leftSource); connect(1, rightSource);
        calibration.startCalibration(); sample(); modes.set(leftSpace, 'emulated'); sample(); tick();
        ensure(fits.length === 2 && /WAITING FOR REMOTES/i.test(status()), 'connected emulated pose reused an earlier buffer');
        ensure(calibration.isCapturing(), 'CONFIRM did not report active capture');
        trigger(2);
        ensure(fits.length === 2 && inactivePoseCalls === 0 && handPoseCalls === 0, 'hand confirmation measured a hand or an inactive frame');
        modes.delete(leftSpace); sample(); disconnect(0); disconnect(1); trigger(3);
        ensure(fits.length === 3 && handPoseCalls === 0 && inactivePoseCalls === 0, 'CONFIRM pinch did not use physical buffers only');

        connect(0, leftSource); connect(1, rightSource);
        calibration.startCalibration(); sample(); modes.set(rightSpace, 'missing'); sample(); tick();
        ensure(fits.length === 3 && /WAITING FOR REMOTES/i.test(status()), 'connected pose loss retained an earlier measurement');
        modes.delete(rightSpace); calibration.invalidate('Synthetic operator stop');
        ensure(intervals.size === 0 && !camera.children.some(child => child.visible), 'invalidation retained capture or duplicated the STOP HUD');
        ensure(!calibration.isCapturing(), 'interruption retained active capture status');
        const beforeInterruptedTrigger = beforeCount;
        trackingBlocked = 'HEADSET TRACKING STILL PAUSED';
        trigger(0); sample(); tick(10);
        ensure(fits.length === 3 && beforeCount === beforeInterruptedTrigger && intervals.size === 0 &&
          calibration.snapshot().step === 'INTERRUPTED', 'physical trigger restarted while viewer tracking remained blocked');
        ensure(!camera.children.some(child => child.visible), 'blocked restart duplicated the single STOP HUD');
        trackingBlocked = null; scanReady = false;
        trigger(1); sample();
        ensure(beforeCount === beforeInterruptedTrigger && intervals.size === 0 &&
          calibration.snapshot().step === 'INTERRUPTED', 'physical trigger bypassed scan-loading gate during recovery');
        scanReady = true;
        trigger(2); trigger(3); sample();
        ensure(beforeCount === beforeInterruptedTrigger && intervals.size === 0 &&
          calibration.snapshot().step === 'INTERRUPTED', 'hand pinch restarted interrupted calibration');
        trigger(1);
        ensure(intervals.size === 1 && beforeCount === beforeInterruptedTrigger + 1 && calibration.isCapturing() &&
          !calibration.snapshot().hasLeft && !calibration.snapshot().hasRight,
          'recovered physical trigger did not start a fresh countdown without a PC helper');
        tick();
        ensure(fits.length === 3 && calibration.snapshot().step === 'CONFIRM' && calibration.isCapturing(),
          'recovered countdown accepted old buffers without any fresh controller frame');
        calibration.invalidate('Synthetic fresh-stop before testing PC fallback');
        calibration.startCalibration(); sample();
        ensure(intervals.size === 1, 'explicit PC restart did not start a fresh capture');
        reference.dispatchEvent({ type: 'reset' });
        ensure(intervals.size === 0 && !calibration.isCapturing() && !calibration.snapshot().hasLeft &&
          !calibration.snapshot().hasRight, 'reference reset did not cancel countdown and discard its capture batch');
        trigger(2); trigger(3); sample(); tick(10);
        ensure(fits.length === 3 && intervals.size === 0, 'reset retained buffers, auto-fit or accepted hand-based restart');
        trigger(0);
        ensure(intervals.size === 1 && !calibration.snapshot().hasLeft && !calibration.snapshot().hasRight,
          'physical trigger could not restart after reference-space recovery');
        calibration.invalidate('Synthetic stop before timer-gate check');

        calibration.startCalibration(); sample(); trackingBlocked = 'HEADSET NO LONGER VISIBLE'; tick();
        ensure(fits.length === 3 && intervals.size === 0 && calibration.snapshot().step === 'READY' &&
          status() === trackingBlocked, 'timer captured after viewer gate closed or hid the current blocker');
        const beforeTimerGateRecovery = beforeCount;
        trackingBlocked = null; sample();
        ensure(fits.length === 3 && intervals.size === 0 && beforeCount === beforeTimerGateRecovery &&
          calibration.snapshot().step === 'READY' && /HALLWAY PROJECT/i.test(status()) && /TRIGGER/i.test(status()) &&
          !status().includes('HEADSET NO LONGER VISIBLE'),
          'viewer recovery retained the stale timer-end blocker or auto-started/accepted calibration');
        const beforeRejectedFit = scan.matrix.toArray();
        positions.set(rightSpace, rightPosition.clone().add(new THREE.Vector3(10, 0, 0)));
        calibration.startCalibration(); sample(); tick();
        ensure(fits.length === 3 && /reject|do not match|inconsistent/i.test(status()), 'bad fit was accepted or its explanation disappeared');
        const rejectedStatus = status(); sample();
        ensure(status() === rejectedStatus && same(scan.matrix.toArray(), beforeRejectedFit), 'rejected fit changed scan or lost its explanation');
        positions.set(rightSpace, rightPosition.clone());

        calibration.startCalibration(); sample();
        const beforeEnd = scan.matrix.toArray();
        xr.isPresenting = false; xr.dispatchEvent({ type: 'sessionend' });
        ensure(intervals.size === 0 && opacity() === 1 && !camera.children.some(child => child.visible), 'session end retained timer, hidden desktop scan or HUD');
        const beforeEndedTrigger = beforeCount;
        trigger(0); trigger(2); calibration.startCalibration();
        ensure(intervals.size === 0 && beforeCount === beforeEndedTrigger && !calibration.isCapturing(),
          'controller, hand or PC action restarted capture without an active VR session');
        tick(10); sample(1, null);
        ensure(fits.length === 3 && same(scan.matrix.toArray(), beforeEnd), 'ended session applied delayed fit or moved scan');
        xr.isPresenting = true; xr.dispatchEvent({ type: 'sessionstart' }); sample(1, null);
        ensure(intervals.size === 0 && opacity() === 0 && fits.length === 3, 'new session captured or restored old acceptance automatically');

        // Escape from a CONFIRM dead end is deliberate, bounded, and never a
        // new source of landmark authority. Keep the established fit count
        // above unchanged so these assertions extend the original scenarios.
        const pendingConfirm = () => {
          // Integer fake times make the exact >=30,000 ms boundary unambiguous.
          clockMs = Math.ceil(clockMs);
          calibration.startCalibration();
          ensure(calibration.snapshot().step === 'COUNTDOWN' && !calibration.snapshot().hasLeft && !calibration.snapshot().hasRight,
            'new attempt did not clear old physical measurement buffers');
          clearedConfirm('fresh placement countdown');
          tick();
          const state = confirmBudget(3);
          ensure(state.confirmStartedAt === clockMs && intervals.size === 0,
            'CONFIRM deadline was not freshly started at countdown completion');
          return state.confirmStartedAt;
        };
        pendingConfirm();
        const beforeFailedConfirms = scan.matrix.toArray();
        captureInstructions('CONFIRM entered: three attempts remain');
        trigger(2); confirmBudget(2);
        captureInstructions('Failed hand confirmation: two attempts remain');
        trigger(0); confirmBudget(1);
        captureInstructions('Failed controller confirmation: one attempt remains');
        trigger(3);
        ensure(calibration.snapshot().step === 'READY' && !calibration.isCapturing() && intervals.size === 0,
          'third failed confirmation did not escape to the title screen');
        clearedConfirm('three failed confirmations');
        ensure(/wake[\s\S]*both[\s\S]*(?:remotes|controllers)/i.test(status()),
          'failed-confirmation exit omitted the wake-both-remotes instruction');
        const wakeHint = status();
        captureInstructions('Third failed confirmation: wake both remotes and restart');
        sample(0);
        ensure(status() === wakeHint && fits.length === 3 && same(scan.matrix.toArray(), beforeFailedConfirms),
          'READY refresh erased the recovery hint, applied a fit, or moved the scan');
        disconnect(0); connect(0, leftSource);
        ensure(status() === wakeHint, 'waking/reconnecting a remote erased the READY recovery hint');
        trackingBlocked = 'TEMPORARY VIEW BLOCK AFTER CONFIRM RECOVERY';
        calibration.startCalibration();
        ensure(status() === trackingBlocked && intervals.size === 0, 'rejected READY request omitted the viewer blocker');
        trackingBlocked = null; sample(0, null);
        ensure(status() === wakeHint && calibration.snapshot().step === 'READY' && intervals.size === 0 && fits.length === 3,
          'rejected PC request erased the saved wake-both hint after viewer recovery');
        scanReady = false; trigger(0);
        ensure(/loading/i.test(status()) && intervals.size === 0, 'rejected READY trigger omitted the loading blocker');
        scanReady = true; sample(0, null);
        ensure(status() === wakeHint && calibration.snapshot().step === 'READY' && intervals.size === 0 && fits.length === 3,
          'rejected controller request erased the saved wake-both hint after loading');
        const beforeReadyHand = beforeCount;
        trigger(2); trigger(3);
        ensure(calibration.snapshot().step === 'READY' && intervals.size === 0 && beforeCount === beforeReadyHand,
          'a hand restarted READY after confirmation failure');

        const exactStart = pendingConfirm();
        const beforeExactTimeout = scan.matrix.toArray();
        clockMs = exactStart + 29999;
        sample(0, null);
        confirmBudget(3);
        const readsAtDeadline = poseCalls;
        clockMs = exactStart + 30000;
        sample(0);
        ensure(calibration.snapshot().step === 'READY' && !calibration.isCapturing() && poseCalls === readsAtDeadline,
          'exact 30-second timeout did not exit before reading a new controller pose');
        clearedConfirm('exact timeout');
        ensure(fits.length === 3 && same(scan.matrix.toArray(), beforeExactTimeout),
          'timeout accepted a measurement or moved the root');
        const timeoutHint = status();
        sample(0);
        ensure(status() === timeoutHint, 'timeout recovery hint vanished on the next title frame');

        const noFrameStart = pendingConfirm();
        const beforeNoFrameReads = poseCalls;
        clockMs = noFrameStart + 30000; // No intervening frame or select event.
        sample(0);
        ensure(calibration.snapshot().step === 'READY' && poseCalls === beforeNoFrameReads && fits.length === 3,
          'returning frame after 30 seconds without frames gained capture authority');
        clearedConfirm('no-frame timeout');

        const lateHandStart = pendingConfirm();
        sample(0);
        ensure(calibration.snapshot().hasLeft && calibration.snapshot().hasRight, 'late-confirm test has no physical buffers');
        clockMs = lateHandStart + 30000;
        trigger(2);
        ensure(calibration.snapshot().step === 'READY' && fits.length === 3,
          'hand confirmation accepted expired physical buffers without a new frame');
        clearedConfirm('late hand confirmation');
        const lateRemoteStart = pendingConfirm();
        sample(0);
        clockMs = lateRemoteStart + 30001;
        trigger(1);
        ensure(calibration.snapshot().step === 'READY' && fits.length === 3,
          'controller confirmation accepted expired physical buffers without a new frame');
        clearedConfirm('late controller confirmation');

        const blockedTimeoutStart = pendingConfirm();
        const beforeBlockedTimeout = scan.matrix.toArray();
        trackingBlocked = 'HEADSET VIEW TEMPORARILY BLOCKED: dismiss the menu.';
        clockMs = blockedTimeoutStart + 30000;
        sample(0);
        ensure(calibration.snapshot().step === 'READY' && !calibration.isCapturing() && intervals.size === 0 &&
          status() === trackingBlocked, 'expired CONFIRM hid the current headset-view blocker');
        clearedConfirm('timeout with blocked viewer');
        trackingBlocked = null;
        sample(0);
        ensure(calibration.snapshot().step === 'READY' && intervals.size === 0 && fits.length === 3 &&
          /wake[\s\S]*both[\s\S]*(?:remotes|controllers)/i.test(status()) && same(scan.matrix.toArray(), beforeBlockedTimeout),
          'restored viewer lost the wake-both hint, auto-started capture, or moved the scan after timeout');

        pendingConfirm();
        sample(0);
        confirmBudget(3);
        const beforeSuccessfulStatus = statuses.length;
        trigger(3);
        ensure(calibration.snapshot().step === 'DONE' && fits.length === 4 && fits.at(-1).rmsResidual < 1e-9,
          'valid hand CONFIRM did not preserve the physical-buffer fit path');
        ensure(!statuses.slice(beforeSuccessfulStatus).some(text => /[12]\s+attempts?\s+left/i.test(text)),
          'successful confirmation was presented as a failed attempt');
        clearedConfirm('successful physical-buffer confirmation');

        const resetStart = pendingConfirm();
        trigger(2); confirmBudget(2);
        reference.dispatchEvent({ type: 'reset' });
        ensure(calibration.snapshot().step === 'INTERRUPTED', 'reference reset failed to interrupt CONFIRM');
        clearedConfirm('reference reset');
        clockMs = resetStart + 60000;
        trigger(0);
        ensure(calibration.snapshot().step === 'COUNTDOWN', 'expired prior deadline blocked explicit reset recovery');
        tick(); confirmBudget(3); sample(0); trigger(2);
        ensure(calibration.snapshot().step === 'DONE' && fits.length === 5,
          'fresh post-reset attempt inherited the expired deadline or failure budget');
        clearedConfirm('post-reset successful fit');

        const replacedStart = pendingConfirm();
        trigger(0); confirmBudget(2);
        clockMs = replacedStart + 20000;
        calibration.startCalibration();
        ensure(calibration.snapshot().step === 'COUNTDOWN' && !calibration.snapshot().hasLeft && !calibration.snapshot().hasRight,
          'manual restart of CONFIRM retained old buffers');
        clearedConfirm('manual restart of CONFIRM');
        clockMs += 40000;
        tick(); confirmBudget(3);
        ensure(fits.length === 5, 'new countdown accepted an earlier attempt automatically');
        trigger(2); confirmBudget(2);
        xr.isPresenting = false; xr.dispatchEvent({ type: 'sessionend' });
        clearedConfirm('session end while confirming');
        clockMs += 90000;
        xr.isPresenting = true; xr.dispatchEvent({ type: 'sessionstart' });
        ensure(calibration.snapshot().step === 'READY' && !calibration.snapshot().hasLeft && !calibration.snapshot().hasRight,
          'new session retained old confirmation state or measurements');
        clearedConfirm('new session');
        pendingConfirm(); sample(0); trigger(3);
        ensure(calibration.snapshot().step === 'DONE' && fits.length === 6,
          'new session inherited an expired prior-session CONFIRM deadline');
        clearedConfirm('new-session successful fit');
        ensure(inactivePoseCalls === 0 && handPoseCalls === 0, 'any path sampled an inactive frame or used hand grips');

        const annotationReadiness = (() => {
          const suppliedPair = { a: [2.99, 19.14, -1.41], b: [2.90, 18.16, -1.26] };
          ensure(same(landmarks.SCAN_LANDMARKS, suppliedPair) && same(landmarks.SCAN_POINT_A, suppliedPair.a) &&
            same(landmarks.SCAN_POINT_B, suppliedPair.b), 'configured pair differs from the user-supplied landmarks');
          const pickerScene = new THREE.Scene();
          const pickerCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 20);
          const pickerScan = new THREE.Group();
          pickerScene.add(pickerCamera, pickerScan);
          pickerCamera.updateMatrixWorld(true);
          const pickerMaterial = new THREE.ShaderMaterial({ uniforms: { uGlobalOpacity: { value: 1 } } });
          pickerScan.viewer = { splatMesh: { material: pickerMaterial,
            splatDataTextures: { baseData: { centers: new Float32Array([-0.6, 0, -3, 0.6, 0, -3]) } } } };
          const pickerCanvas = document.createElement('canvas');
          pickerCanvas.width = pickerCanvas.height = 400;
          pickerCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
          const pickerControllers = Array.from({ length: 4 }, () => new THREE.Group());
          const pickerGrips = Array.from({ length: 4 }, () => new THREE.Group());
          const pickerReference = new THREE.EventDispatcher();
          const pickerXr = new THREE.EventDispatcher();
          Object.assign(pickerXr, {
            isPresenting: true,
            getSession: () => ({ inputSources: [leftSource, rightSource] }),
            getReferenceSpace: () => pickerReference,
            getController: index => pickerControllers[index],
            getControllerGrip: index => pickerGrips[index],
          });
          const pickerFits = [], pickerStatuses = [], picks = [];
          const configuredXr = Object.assign(new THREE.EventDispatcher(), {
            isPresenting: false, getSession: () => null,
            getController: () => new THREE.Group(), getControllerGrip: () => new THREE.Group(),
          });
          const configured = setupCalibrationCapture({ xr: configuredXr, domElement: document.createElement('canvas') },
            new THREE.Scene(), new THREE.PerspectiveCamera(), pickerScan);
          try {
            const state = configured.snapshot();
            ensure(state.landmarksReady && same(state.scanPointA, suppliedPair.a) && same(state.scanPointB, suppliedPair.b),
              'production defaults did not initialize the supplied A/B pair');
            ensure(!configured.isCapturing() && intervals.size === 0, 'configured landmarks auto-started physical capture');
          } finally { configured.dispose(); }
          // An explicitly unconfigured fixture still exercises missing/partial
          // annotation gates independently of the production landmark pair.
          const picker = setupCalibrationCapture({ xr: pickerXr, domElement: pickerCanvas }, pickerScene, pickerCamera, pickerScan,
            solution => pickerFits.push(solution), (which, point) => picks.push({ which, point }), text => pickerStatuses.push(text),
            undefined, undefined, undefined, undefined, { landmarks: null });
          const latest = () => pickerStatuses.at(-1) ?? '';
          const pickPoint = x => {
            const point = new THREE.Vector3(x, 0, -3).project(pickerCamera);
            pickerCanvas.dispatchEvent(new PointerEvent('pointerdown', {
              clientX: (point.x + 1) * 200, clientY: (1 - point.y) * 200, button: 0,
            }));
          };
          const enter = () => { pickerXr.isPresenting = true; pickerXr.dispatchEvent({ type: 'sessionstart' }); };
          const leave = () => { pickerXr.isPresenting = false; pickerXr.dispatchEvent({ type: 'sessionend' }); };
          try {
            pickerControllers[0].dispatchEvent({ type: 'connected', data: leftSource });
            pickerControllers[1].dispatchEvent({ type: 'connected', data: rightSource });
            enter();
            let state = picker.snapshot();
            ensure(!state.landmarksReady && !state.hasScanA && !state.hasScanB && state.scanPointA === null && state.scanPointB === null,
              'new scan started with hidden old A/B coordinates');
            picker.startCalibration();
            pickerControllers[0].dispatchEvent({ type: 'selectstart' });
            ensure(intervals.size === 0 && !picker.isCapturing() && /EDIT A\/B/i.test(latest()),
              'PC/controller start bypassed missing A/B or omitted desktop annotation instructions');
            picker.invalidate('Synthetic reset before scan annotation');
            pickerControllers[0].dispatchEvent({ type: 'selectstart' });
            ensure(intervals.size === 0 && picker.snapshot().step === 'INTERRUPTED' && /EDIT A\/B/i.test(latest()),
              'interrupted restart bypassed missing scan landmarks');

            leave(); picker.setLandmarkEdit(true); pickPoint(-0.6);
            state = picker.snapshot();
            ensure(state.hasScanA && !state.hasScanB && !state.landmarksReady && state.scanPointB === null && picks.length === 1,
              'first actual scan click silently supplied or reused B');
            enter(); picker.startCalibration(); pickerControllers[1].dispatchEvent({ type: 'selectstart' });
            ensure(intervals.size === 0 && !picker.isCapturing() && !picker.snapshot().landmarksReady,
              'partial A-only annotation started calibration');
            leave(); pickPoint(0.6);
            state = picker.snapshot();
            ensure(state.landmarksReady && state.hasScanA && state.hasScanB && picks.length === 2 &&
              Math.abs(state.scanPointA[0] + 0.6) < 1e-6 && Math.abs(state.scanPointB[0] - 0.6) < 1e-6,
              'second actual scan click did not complete the explicit pair');
            enter(); picker.startCalibration();
            ensure(intervals.size === 1 && picker.isCapturing() && picker.snapshot().step === 'COUNTDOWN' && pickerFits.length === 0,
              'complete scan annotation did not enable the unchanged placement countdown');
            picker.invalidate('Synthetic stop after pair-ready gate');

            // Starting another edit replaces the entire pair. A new A must
            // never be combined with the previously selected B.
            leave(); picker.setLandmarkEdit(true);
            ensure(!picker.snapshot().hasScanA && !picker.snapshot().hasScanB, 'new EDIT A/B did not clear both prior selections');
            pickPoint(-0.6); picker.setLandmarkEdit(false);
            ensure(picker.snapshot().hasScanA && picker.snapshot().scanPointB === null && !picker.snapshot().landmarksReady,
              'abandoned partial edit reused the previous complete pair');
            enter(); picker.startCalibration(); tick();
            ensure(intervals.size === 0 && !picker.isCapturing() && pickerFits.length === 0,
              'partial replacement pair gained fit/capture authority');
            return { productionUsesSuppliedPair: true, explicitNullStartsUnconfigured: true, actualPointerPairEnablesCountdown: true,
              partialPairCannotReuseOldB: true, syntheticPointerPicks: picks.length, fitsWithoutPhysicalCapture: pickerFits.length };
          } finally { picker.dispose(); pickerMaterial.dispose(); }
        })();

        // Inspectable copies of the actual instruction textures, not a recreated
        // text mock. The original sprites/canvases are left untouched.
        document.body.innerHTML = '';
        Object.assign(document.body.style, { margin: '0', padding: '18px', boxSizing: 'border-box', background: '#101018', color: '#e6eef3', font: '16px system-ui,sans-serif' });
        const title = document.createElement('h1'); title.style.fontSize = '20px'; title.textContent = 'Calibration CONFIRM recovery · actual HUD textures';
        const note = document.createElement('p'); note.textContent = 'Synthetic browser poses and clock. This is not headset or physical-alignment evidence.';
        const gallery = document.createElement('div');
        Object.assign(gallery.style, { display: 'grid', gridTemplateColumns: 'repeat(2, 512px)', gap: '16px' });
        for (const { label, image } of instructionImages) {
          const figure = document.createElement('figure'); figure.style.margin = '0';
          const caption = document.createElement('figcaption'); caption.textContent = label; caption.style.marginBottom = '6px';
          Object.assign(image.style, { width: '512px', height: '160px', display: 'block', border: '1px solid #42515f' });
          figure.append(caption, image); gallery.append(figure);
        }
        document.body.append(title, note, gallery);
        return {
          passed: true, evidence: 'Restored Nov-2 trigger/countdown with detached synthetic XR poses and clock; no hardware result',
          checks: ['PC capture requires running VR', 'READY title and seven-second trigger countdown', 'scan/viewer capture gates',
            'Oculus Touch with joint data remains a controller', 'per-side READY input and wake actions',
            'disconnected selects cannot restart capture', 'profile changes refresh without reconnect events',
            'rejected PC/controller READY starts restore title when gates clear before the next frame',
            'current-frame controller reads only', 'nonzero-yaw buffered fit', 'disconnected hand takeover retains buffers',
            'connected invalid/emulated poses clear buffers', 'hands and hand=null generic-hand profiles excluded',
            'CONFIRM pinch uses physical buffers only', 'DONE trigger returns to title', 'one-second reveal',
            'fit-rejection message persists', 'interrupted restart waits for visible tracking and loaded scan',
            'physical trigger starts fresh recovery countdown without PC helper', 'hands cannot restart interruption',
            'recovered countdown cannot reuse stale buffers', 'PC restart remains available',
            'capture status covers countdown and confirmation only', 'timer rechecks viewer gate',
            'timer-end transient viewer blocker restores the ordinary title after recovery',
            'session end restores desktop view', 'new session never restores acceptance',
            'CONFIRM failure budget 3→2→1→READY', 'wake-both-remotes hint persists', 'hands cannot restart READY',
            'rejected READY starts restore the saved wake-both hint after transient blockers',
            'fresh attempt clears buffers and resets confirmation budget', 'exact 30-second timeout precedes pose reads',
            'returning frame cannot revive expired CONFIRM', 'late hand/controller confirmation cannot fit expired buffers',
            'timeout shows current viewer blocker and restores wake-both hint without auto-start',
            'successful hand CONFIRM does not consume failure budget', 'reference reset clears confirmation deadline',
            'manual restart replaces confirmation deadline', 'session end and new session reset failure/deadline state',
            'production defaults use the supplied A/B without auto-capture', 'actual desktop pointer picks complete an explicitly unconfigured A/B pair',
            'missing/partial/replacement landmark pairs block PC/controller/interrupted capture'],
          successfulFits: fits.length, beforeCalibrationCalls: beforeCount, poseCalls, inactivePoseCalls, handPoseCalls,
          annotationReadiness,
          finalFitResidual: fits[0].rmsResidual,
        };
      } finally {
        reference.removeEventListener('reset', reset);
        calibration.dispose(); material.dispose();
        window.setInterval = originalSetInterval; window.clearInterval = originalClearInterval;
        if (originalNow) Object.defineProperty(performance, 'now', originalNow); else delete performance.now;
      }
    });
    await isolated.screenshot({ path: fileURLToPath(new URL('../../.check/confirm-recovery.png', import.meta.url)), fullPage: true });
    return { ...result, screenshot: '.check/confirm-recovery.png' };
  } finally { await isolated.close(); }
}
