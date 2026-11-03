/** Restored Nov-2 trigger/countdown calibration with detached current-frame poses.
 * Timers run outside the active XRFrame. This is synthetic regression evidence.
 */
export async function runCalibrationScenario(page) {
  const isolated = await page.context().newPage();
  isolated.setDefaultTimeout(15000);
  try {
    await isolated.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await isolated.goto(new URL('/', page.url()).href, { waitUntil: 'domcontentloaded' });
    return await isolated.evaluate(async () => {
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
      const gamepad = { axes: [], buttons: [] };
      const leftSpace = {}, rightSpace = {}, handSpace = {}, nullHandSpace = {};
      const leftSource = { handedness: 'left', gamepad, gripSpace: leftSpace, profiles: ['synthetic-controller'] };
      const rightSource = { handedness: 'right', gamepad, gripSpace: rightSpace, profiles: ['synthetic-controller'] };
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
      const leftPosition = scan.localToWorld(new THREE.Vector3(...landmarks.SCAN_POINT_A)).applyQuaternion(rotation).add(translation);
      const rightPosition = scan.localToWorld(new THREE.Vector3(...landmarks.SCAN_POINT_B)).applyQuaternion(rotation).add(translation);
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
      );
      const status = () => statuses.at(-1) ?? '';
      const opacity = () => material.uniforms.uGlobalOpacity.value;
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
        connect(0, leftSource); connect(1, rightSource); connect(2, handSource); connect(3, nullHandSource);
        trigger(2); trigger(3);
        ensure(intervals.size === 0, 'a hand pinch started calibration from READY');
        const beforeBlocked = beforeCount;
        calibration.startCalibration(); trigger(0);
        ensure(intervals.size === 0 && beforeCount === beforeBlocked, 'scan-loading gate started capture or reset calibration');
        scanReady = true; trackingBlocked = 'HEADSET NOT READY: keep the headset on and close system menus.';
        calibration.startCalibration(); trigger(0);
        ensure(intervals.size === 0 && beforeCount === beforeBlocked, 'hidden/untracked viewer started capture');
        trackingBlocked = null;

        trigger(0);
        ensure(intervals.size === 1 && /7s|7 s|7 seconds/i.test(status()), 'READY trigger did not start one seven-second countdown');
        sample();
        ensure(poseCalls === 2 && handPoseCalls === 0, 'sampling included a hand or hand=null generic-hand profile');
        tick(6);
        ensure(fits.length === 0 && intervals.size === 1, 'countdown captured before seven seconds');
        tick(1);
        ensure(fits.length === 1 && intervals.size === 0 && inactivePoseCalls === 0, 'timer did not use buffered current-frame poses');
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
        trigger(2);
        ensure(fits.length === 2 && inactivePoseCalls === 0 && handPoseCalls === 0, 'hand confirmation measured a hand or an inactive frame');
        modes.delete(leftSpace); sample(); disconnect(0); disconnect(1); trigger(3);
        ensure(fits.length === 3 && handPoseCalls === 0 && inactivePoseCalls === 0, 'CONFIRM pinch did not use physical buffers only');

        connect(0, leftSource); connect(1, rightSource);
        calibration.startCalibration(); sample(); modes.set(rightSpace, 'missing'); sample(); tick();
        ensure(fits.length === 3 && /WAITING FOR REMOTES/i.test(status()), 'connected pose loss retained an earlier measurement');
        modes.delete(rightSpace); calibration.invalidate('Synthetic operator stop');
        ensure(intervals.size === 0 && !camera.children.some(child => child.visible), 'invalidation retained capture or duplicated the STOP HUD');
        const beforeInterruptedTrigger = beforeCount;
        trigger(0); sample(); tick(10);
        ensure(fits.length === 3 && beforeCount === beforeInterruptedTrigger && intervals.size === 0, 'interrupted trigger or timer restarted without explicit PC recovery');
        calibration.startCalibration(); sample();
        ensure(intervals.size === 1, 'explicit PC restart did not start a fresh capture');
        reference.dispatchEvent({ type: 'reset' });
        ensure(intervals.size === 0, 'reference reset did not cancel countdown');
        trigger(0); sample(); tick(10);
        ensure(fits.length === 3 && intervals.size === 0, 'reset retained buffers or applied a delayed fit');

        calibration.startCalibration(); sample(); trackingBlocked = 'HEADSET NO LONGER VISIBLE'; tick();
        ensure(fits.length === 3 && intervals.size === 0, 'timer captured after viewer gate closed');
        trackingBlocked = null; sample();
        ensure(fits.length === 3 && intervals.size === 0, 'viewer recovery auto-accepted buffered landmarks');
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
        tick(10); sample(1, null);
        ensure(fits.length === 3 && same(scan.matrix.toArray(), beforeEnd), 'ended session applied delayed fit or moved scan');
        xr.isPresenting = true; xr.dispatchEvent({ type: 'sessionstart' }); sample(1, null);
        ensure(intervals.size === 0 && opacity() === 0 && fits.length === 3, 'new session captured or restored old acceptance automatically');
        ensure(inactivePoseCalls === 0 && handPoseCalls === 0, 'any path sampled an inactive frame or used hand grips');
        return {
          passed: true, evidence: 'Restored Nov-2 trigger/countdown with detached synthetic XR poses and clock; no hardware result',
          checks: ['PC capture requires running VR', 'READY title and seven-second trigger countdown', 'scan/viewer capture gates',
            'current-frame controller reads only', 'nonzero-yaw buffered fit', 'disconnected hand takeover retains buffers',
            'connected invalid/emulated poses clear buffers', 'hands and hand=null generic-hand profiles excluded',
            'CONFIRM pinch uses physical buffers only', 'DONE trigger returns to title', 'one-second reveal',
            'fit-rejection message persists', 'interruptions require explicit PC restart', 'timer rechecks viewer gate',
            'session end restores desktop view', 'new session never restores acceptance'],
          successfulFits: fits.length, beforeCalibrationCalls: beforeCount, poseCalls, inactivePoseCalls, handPoseCalls,
          finalFitResidual: fits[0].rmsResidual,
        };
      } finally {
        reference.removeEventListener('reset', reset);
        calibration.dispose(); material.dispose();
        window.setInterval = originalSetInterval; window.clearInterval = originalClearInterval;
        if (originalNow) Object.defineProperty(performance, 'now', originalNow); else delete performance.now;
      }
    });
  } finally { await isolated.close(); }
}
