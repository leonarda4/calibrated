import { fileURLToPath } from 'node:url';

/** Desktop integration evidence only: all runtime/session data here is synthetic. */
export async function runBoundaryScenario(parentPage) {
  const page = await parentPage.context().newPage();
  page.setDefaultTimeout(15000);
  const screenshotPath = fileURLToPath(new URL('../../.check/boundary.png', import.meta.url));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.goto(new URL('/', parentPage.url()).href, { waitUntil: 'domcontentloaded' });
    const initial = await page.evaluate(async () => {
      const [THREE, { setupDesktopBoundary }] = await Promise.all([
        import('/node_modules/.vite/deps/three.js'),
        import('/src/experience/setupDesktopBoundary.ts'),
      ]);
      document.body.innerHTML = '';
      const ensure = (condition, message) => {
        if (!condition) throw new Error(`Movement boundary regression: ${message}`);
      };
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x101823);
      const inspection = new THREE.WebGLRenderer({ antialias: false });
      inspection.setPixelRatio(1);
      inspection.setSize(1440, 900);
      document.body.appendChild(inspection.domElement);
      const camera = new THREE.PerspectiveCamera(48, 1440 / 900, 0.1, 100);
      camera.position.set(5.8, 6.4, 6.2);
      camera.lookAt(0.4, 0, -0.2);
      const grid = new THREE.GridHelper(12, 24, 0x405361, 0x253541);
      grid.position.y = 0.07;
      scene.add(grid);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.43, 0.36), new THREE.MeshBasicMaterial({ color: 0x607787 }));
      box.position.set(0.25, 0.07 + 0.43 / 2, -0.3);
      scene.add(box);
      const scanWitness = new THREE.Group();
      scanWitness.name = 'unrelated-scan-fixture';
      scene.add(scanWitness);

      const activeReference = new THREE.EventDispatcher();
      const boundedReference = new THREE.EventDispatcher();
      boundedReference.boundsGeometry = [
        { x: -1, y: 0, z: -1, w: 1 }, { x: 1, y: 0, z: -1, w: 1 },
        { x: 1, y: 0, z: 1, w: 1 }, { x: -1, y: 0, z: 1, w: 1 },
      ];
      const session = new THREE.EventDispatcher();
      session.visibilityState = 'visible';
      session.inputSources = [];
      session.requestReferenceSpace = async kind => {
        ensure(kind === 'bounded-floor', 'runtime requested a different boundary space');
        return boundedReference;
      };
      let currentSession = session;
      const xr = new THREE.EventDispatcher();
      Object.assign(xr, {
        isPresenting: false,
        getSession: () => currentSession,
        getReferenceSpace: () => activeReference,
      });
      const quietScene = new THREE.Scene();
      const quietBoundary = setupDesktopBoundary({ xr }, quietScene);
      quietBoundary.setManualVisible(true);
      quietBoundary.update();
      ensure(!quietScene.getObjectByName('desktop-movement-boundaries').visible,
        'default movement diagnostics leaked guides into the world');
      ensure(quietBoundary.snapshot().manual.visible && quietBoundary.snapshot().manual.points.length === 4,
        'hiding world guides disabled the manual boundary data/map');
      quietBoundary.dispose();
      const boundary = setupDesktopBoundary({ xr }, scene, {
        showWorldGuides: true,
        getBox: () => ({ centerX: box.position.x, centerZ: box.position.z, boxWidth: 0.36, boxDepth: 0.36, floorY: 0.07 }),
      });
      const boundaryRoot = scene.getObjectByName('desktop-movement-boundaries');
      const manualLine = scene.getObjectByName('desktop-manual-boundary');
      const runtimeLine = scene.getObjectByName('desktop-headset-boundary');
      ensure(boundaryRoot && manualLine && runtimeLine, 'desktop floor-outline nodes are missing');
      const initial = boundary.snapshot();
      ensure(!initial.manual.visible && initial.manual.config.width === 2.1 && initial.manual.config.depth === 2.1,
        'manual area is not a hidden provisional 2.1 × 2.1 metre rectangle');
      ensure(!manualLine.visible && !runtimeLine.visible, 'factory invented a visible area before setup');
      ensure(!initial.runtime.live && initial.runtime.points.length === 0, 'factory invented a headset polygon');
      let rejected = false;
      try { boundary.configureManual({ ...initial.manual.config, width: 0 }); } catch { rejected = true; }
      ensure(rejected && boundary.snapshot().manual.config.width === 2.1, 'invalid manual dimensions replaced the valid draft');
      inspection.render(scene, camera);
      window.__boundaryScenario = {
        THREE, ensure, scene, inspection, camera, box, grid, scanWitness, boundary,
        boundaryRoot, manualLine, runtimeLine, activeReference, boundedReference, session, xr,
        setCurrentSession: value => { currentSession = value; },
      };
      return { manualInitiallyHidden: true, provisionalWidth: initial.manual.config.width, provisionalDepth: initial.manual.config.depth };
    });

    await page.locator('#movement-boundary-panel details').evaluate(element => { element.open = true; });
    await page.locator('#movement-manual-width').fill('0');
    await page.locator('#movement-manual-apply').click();
    const error = await page.locator('#movement-boundary-error').textContent();
    if (!error) throw new Error('Movement boundary regression: invalid manual input did not show an error');
    await page.locator('#movement-manual-width').fill('2.4');
    await page.locator('#movement-manual-depth').fill('3');
    await page.locator('#movement-manual-centerX').fill('0.25');
    await page.locator('#movement-manual-centerZ').fill('-0.3');
    await page.locator('#movement-manual-floorY').fill('0.07');
    await page.locator('#movement-manual-yawDegrees').fill('25');
    await page.locator('#movement-manual-apply').click();
    await page.locator('#movement-manual-visible').check();

    const rendered = await page.evaluate(async () => {
      const f = window.__boundaryScenario;
      const { THREE, ensure, scene, inspection, camera, scanWitness, boundary, boundaryRoot, manualLine,
        runtimeLine, activeReference, boundedReference, session, xr } = f;
      const manual = boundary.snapshot().manual;
      ensure(manual.visible && manual.config.width === 2.4 && manual.config.depth === 3 && manual.config.yawDegrees === 25,
        'manual Apply/toggle did not update the actual outline configuration');
      ensure(boundaryRoot.visible && manualLine.visible, 'checked manual outline is hidden in desktop view');
      ensure(manualLine.geometry.getAttribute('position').count === manual.points.length * 4,
        'manual floor segments and corner ticks are missing');
      const worldVertices = line => {
        scene.updateMatrixWorld(true);
        const positions = line.geometry.getAttribute('position');
        return Array.from({ length: positions.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(line.matrixWorld).toArray());
      };
      const before = worldVertices(manualLine);
      const cameraPosition = camera.position.clone();
      const cameraQuaternion = camera.quaternion.clone();
      scanWitness.position.set(9, 2, -8);
      scanWitness.rotation.y = 1.2;
      camera.position.set(-6, 5, 7);
      camera.lookAt(0, 0, 0);
      boundary.update();
      ensure(JSON.stringify(worldVertices(manualLine)) === JSON.stringify(before),
        'scan/camera movement changed the XR-space manual outline');
      ensure(boundaryRoot.parent === scene && manualLine.parent === boundaryRoot,
        'boundary geometry inherited the scan or camera transform');
      camera.position.copy(cameraPosition); camera.quaternion.copy(cameraQuaternion);

      const yaw = 0.4;
      const translation = [1.3, 0.07, -0.7];
      const relative = new THREE.Matrix4().makeRotationY(yaw).setPosition(...translation);
      const head = [0.45, 1.65, -0.3];
      let frameActive = false;
      let inactiveReads = 0;
      let poseAvailable = true;
      const frame = {
        getViewerPose(reference) {
          if (!frameActive) { inactiveReads++; throw new DOMException('Inactive test frame', 'InvalidStateError'); }
          ensure(reference === activeReference, 'head pose requested in a different reference space');
          if (!poseAvailable) return null;
          return { emulatedPosition: false, transform: {
            position: { x: head[0], y: head[1], z: head[2] },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
            matrix: new THREE.Matrix4().makeTranslation(...head).toArray(),
          } };
        },
        getPose(space, reference) {
          if (!frameActive) { inactiveReads++; throw new DOMException('Inactive test frame', 'InvalidStateError'); }
          ensure(space === boundedReference && reference === activeReference, 'boundary pose used mismatched spaces');
          return { emulatedPosition: false, transform: {
            matrix: relative.toArray(), position: { x: translation[0], y: translation[1], z: translation[2] },
            orientation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
          } };
        },
      };
      const sample = () => {
        frameActive = true;
        try { boundary.update(frame); } finally { frameActive = false; }
        boundary.setRuntimeVisible(true); // force the DOM map to draw this frame
      };
      const flushReferenceRequest = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
      xr.isPresenting = true;
      xr.dispatchEvent({ type: 'sessionstart' });
      await flushReferenceRequest();
      sample();
      const live = boundary.snapshot().runtime;
      ensure(live.live && live.status === 'live' && live.points.length === 4, 'supported runtime polygon did not become live');
      const expected = boundedReference.boundsGeometry.map(point => [
        Math.cos(yaw) * point.x + Math.sin(yaw) * point.z + translation[0],
        point.y + translation[1],
        -Math.sin(yaw) * point.x + Math.cos(yaw) * point.z + translation[2],
      ]);
      for (let index = 0; index < expected.length; index++) for (let axis = 0; axis < 3; axis++) {
        ensure(Math.abs(live.points[index][axis] - expected[index][axis]) < 1e-6,
          'bounded-floor polygon was not transformed into the active XR frame');
      }
      ensure(live.head && Math.abs(live.head[0] - head[0]) < 1e-9 && Math.abs(live.head[2] - head[2]) < 1e-9,
        'current head position did not reach the desktop map');
      ensure(!boundaryRoot.visible, 'desktop diagnostic outline entered the immersive view');
      const context = document.querySelector('#movement-boundary-map').getContext('2d');
      const pixels = context.getImageData(0, 0, 480, 320).data;
      let cyanPixels = 0, amberPixels = 0, whitePixels = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 160 && pixels[i + 1] > 170 && pixels[i + 2] > 180) cyanPixels++;
        if (pixels[i] > 190 && pixels[i + 1] > 130 && pixels[i + 1] < 230 && pixels[i + 2] < 150) amberPixels++;
        if (pixels[i] > 245 && pixels[i + 1] > 245 && pixels[i + 2] > 245) whitePixels++;
      }
      ensure(cyanPixels > 50 && amberPixels > 50 && whitePixels > 10, 'live desktop map omitted runtime/manual/head markers');

      session.visibilityState = 'hidden';
      session.dispatchEvent({ type: 'visibilitychange' });
      sample();
      const hidden = boundary.snapshot().runtime;
      ensure(!hidden.live && hidden.head === null, 'hidden headset session retained a live head/boundary claim');
      ensure(boundary.snapshot().manual.visible, 'headset interruption removed the manual area');
      session.visibilityState = 'visible';
      poseAvailable = false;
      sample();
      ensure(!boundary.snapshot().runtime.live && boundary.snapshot().runtime.head === null,
        'missing viewer pose retained live boundary authority');
      poseAvailable = true;
      sample();
      ensure(boundary.snapshot().runtime.live, 'fresh current pose could not restore this diagnostic display');
      const finalLive = boundary.snapshot().runtime;
      xr.isPresenting = false;
      xr.dispatchEvent({ type: 'sessionend' });
      boundary.update(); boundary.setRuntimeVisible(true);
      const snapshot = boundary.snapshot().runtime;
      ensure(snapshot.status === 'snapshot' && !snapshot.live && snapshot.head === null && snapshot.points.length === 4,
        'session end did not label the retained outline as a nonlive snapshot');
      ensure(boundaryRoot.visible && runtimeLine.visible && manualLine.visible,
        'desktop session-end outlines are not visible');
      ensure(/snapshot|last|previous/i.test(document.querySelector('#movement-boundary-status').textContent),
        'desktop status did not label saved runtime geometry');
      ensure(inactiveReads === 0, 'boundary diagnostic sampled an inactive XRFrame');
      inspection.render(scene, camera);
      f.sample = sample;
      f.flushReferenceRequest = flushReferenceRequest;
      return {
        manualInputApply: true, manualWidth: manual.config.width, manualDepth: manual.config.depth,
        worldOutlineIndependentOfScanAndCamera: true,
        runtimePointCount: finalLive.points.length, runtimeHead: finalLive.head,
        referenceYawRadians: yaw, referenceTranslation: translation,
        mapPixels: { cyanPixels, amberPixels, whitePixels },
        sessionEndStatus: snapshot.status, inactiveFrameReads: inactiveReads,
      };
    });

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const unsupported = await page.evaluate(async () => {
      const f = window.__boundaryScenario;
      const { THREE, ensure, boundary, xr } = f;
      const session = new THREE.EventDispatcher();
      session.visibilityState = 'visible'; session.inputSources = [];
      session.requestReferenceSpace = async () => { throw new DOMException('No bounded-floor feature on this route', 'NotSupportedError'); };
      f.setCurrentSession(session);
      xr.isPresenting = true;
      xr.dispatchEvent({ type: 'sessionstart' });
      const entering = boundary.snapshot().runtime;
      ensure(!entering.live && entering.points.length === 0 && entering.head === null,
        'new session inherited the previous session snapshot as current geometry');
      await f.flushReferenceRequest();
      f.sample();
      const state = boundary.snapshot();
      ensure(state.runtime.status === 'unavailable' && !state.runtime.live && state.runtime.points.length === 0,
        'unsupported bounded-floor was presented as a real runtime polygon');
      ensure(state.manual.visible && state.manual.points.length === 4,
        'unsupported runtime removed the separately configured manual rectangle');
      ensure(state.head && Math.abs(state.head[0] - 0.45) < 1e-9 && Math.abs(state.head[2] + 0.3) < 1e-9,
        'manual area lost a valid current viewer marker when runtime bounds were unsupported');
      boundary.setRuntimeVisible(false);
      ensure(document.querySelector('#movement-runtime-visible').checked === false,
        'runtime visibility API did not update its desktop control');
      boundary.setManualVisible(false);
      ensure(!f.manualLine.visible && !document.querySelector('#movement-manual-visible').checked,
        'manual visibility control did not hide the outline');
      boundary.setManualVisible(true);
      ensure(f.manualLine.visible && boundary.snapshot().manual.visible, 'manual area could not be shown without runtime support');
      xr.isPresenting = false;
      xr.dispatchEvent({ type: 'sessionend' });
      boundary.update();
      ensure(boundary.snapshot().runtime.points.length === 0 && !boundary.snapshot().runtime.live,
        'unsupported session end invented a runtime snapshot');
      return { unsupportedRouteInventedNoPolygon: true, manualSurvivesUnsupportedRuntime: true, manualHeadWithoutRuntimeBoundary: true, newSessionClearsPreviousGeometry: true };
    });
    return {
      passed: true,
      evidence: 'Actual desktop boundary UI/geometry with synthetic bounded-floor data; no real Guardian or hardware proof',
      screenshot: '.check/boundary.png',
      ...initial, ...rendered, ...unsupported,
    };
  } finally {
    await page.evaluate(() => {
      const f = window.__boundaryScenario;
      if (!f) return;
      f.boundary.dispose(); f.inspection.dispose(); f.box.geometry.dispose(); f.box.material.dispose();
      f.grid.geometry.dispose();
      const materials = Array.isArray(f.grid.material) ? f.grid.material : [f.grid.material];
      materials.forEach(material => material.dispose());
      delete window.__boundaryScenario;
    }).catch(() => {});
    await page.close();
  }
}
