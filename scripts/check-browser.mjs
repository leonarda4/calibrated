// Bounded desktop evidence. This never starts or emulates an immersive session.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { Vector3, Quaternion } from 'three';
import { ACTIVE_SCAN } from '../src/viewer/scanAsset.ts';
import { WALL_SECTION } from '../src/viewer/wallSectionConfig.ts';
import { scanOriginForStart } from '../src/viewer/scanPlacement.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const reportName = process.env.CHECK_REPORT_NAME ?? '';
if (!/^[a-z\d_-]*$/i.test(reportName)) throw new Error('CHECK_REPORT_NAME must be a simple folder name.');
const output = path.join(root, '.check', reportName);
await fs.mkdir(output, { recursive: true });
// CHECK_WALL_ONLY=1 runs source/wall checks; CHECK_REAL_SCAN=1 adds the private wall image.
const wallOnly = process.env.CHECK_WALL_ONLY === '1';
const report = { date: new Date().toISOString(), environment: `${wallOnly ? 'Focused wall checks; ' : ''}Desktop Chrome; synthetic public corridor; no XR/hardware acceptance`, checks: [], consoleErrors: [], passed: false };
let server;
let browser;
let page;
let releaseModel;
let releaseWall;
const check = async (name, action) => {
  const details = await action();
  report.checks.push({ name, passed: true, ...(details === undefined ? {} : { details }) });
  console.log(`PASS ${name}`);
};

async function readBoxVisibility(targetPage, meshName = 'installation-box') {
  const colors = await targetPage.evaluate(async meshName => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { renderer, scene, camera } = window.__debug;
    renderer.render(scene, camera);
    const point = scene.getObjectByName(meshName).getWorldPosition(new THREE.Vector3()).project(camera);
    const gl = renderer.getContext();
    const x = Math.floor((point.x + 1) * gl.drawingBufferWidth / 2);
    const y = Math.floor((point.y + 1) * gl.drawingBufferHeight / 2);
    const bytes = new Uint8Array(3 * 3 * 4);
    gl.readPixels(x - 1, y - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return Array.from({ length: 9 }, (_, i) => Array.from(bytes.slice(i * 4, i * 4 + 3)));
  }, meshName);
  assert.ok(colors.some(rgb => rgb.every((value, i) => Math.abs(value - [120, 140, 162][i]) <= 4)),
    `Projected box is occluded by the scan: ${JSON.stringify(colors)}`);
  return colors[4];
}

function corridorPly() {
  const points = [];
  // Raw coordinates follow the inverse inspection transform. This fixture
  // depicts a made-up 2.10 m corridor and contains no captured space data.
  const inverseRotation = new Quaternion(...ACTIVE_SCAN.rotation).normalize().invert();
  const translation = new Vector3(...scanOriginForStart(ACTIVE_SCAN.startPoint, ACTIVE_SCAN.rotation));
  const add = (x, y, z, color) => {
    const raw = new Vector3(x, y, z).sub(translation).applyQuaternion(inverseRotation);
    points.push([...raw.toArray(), ...color]);
  };
  for (let z = -10; z <= 8; z += 0.12) {
    for (let y = 0; y <= 2.5; y += 0.12) {
      const stripe = Math.floor((z + 10) / 1.5) % 2;
      add(-1.05, y, z, stripe ? [0.56, 0.67, 0.72] : [0.38, 0.48, 0.55]);
      add(1.05, y, z, stripe ? [0.65, 0.60, 0.49] : [0.46, 0.45, 0.42]);
    }
    for (let x = -1.05; x <= 1.05; x += 0.10) {
      add(x, 0, z, [0.28, 0.32, 0.35]);
      add(x, 2.5, z, [0.72, 0.73, 0.69]);
    }
  }
  return pointsPly(points);
}

function pointsPly(points, radius = .075) {
  const fields = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${points.length}\n${fields.map(name => `property float ${name}`).join('\n')}\nend_header\n`);
  const body = Buffer.alloc(points.length * fields.length * 4);
  let offset = 0;
  for (const [x, y, z, r, g, b] of points) {
    for (const value of [x, y, z, 0, 0, 0, (r - .5) / .28209479, (g - .5) / .28209479, (b - .5) / .28209479, 3.5, ...Array(3).fill(Math.log(radius)), 1, 0, 0, 0]) {
      body.writeFloatLE(value, offset); offset += 4;
    }
  }
  return Buffer.concat([header, body]);
}

function wallPly() {
  // A deliberately public test panel: no private scan splats or captured color.
  const points = [];
  for (let ix = 0; ix <= 42; ix++) {
    for (let iy = 0; iy <= 48; iy++) {
      const stripe = Math.floor(iy / 8) % 2;
      points.push([-1.05 + ix * .05, iy * WALL_SECTION.height / 48, 0,
        ...(stripe ? [.76, .57, .31] : [.61, .42, .22])]);
    }
  }
  return pointsPly(points, .045);
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

try {
  // IDE edits must not reload this isolated browser part-way through a check.
  // Vite's pinned server API supports watch:null to disable its file watcher.
  server = await createServer({ configFile: path.join(root, 'vite.http.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: null, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string', 'The isolated check server did not bind a TCP port.');
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  // A second Chrome XR process shares SteamVR's app key with the wearer's
  // browser. It must never discover/register with the physical runtime.
  // Chromium's explicit no-runtime selector also covers xrCompatible WebGL.
  const noHardwareXr = '--force-webxr-runtime=no-xr-runtime';
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-automation', noHardwareXr] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Applied before application scripts on every page/navigation. Detached
  // regression factories may replace this with their own fake XRSystem.
  await context.addInitScript(() => {
    const unsupportedXr = Object.assign(new EventTarget(), {
      isSessionSupported: async () => false,
      requestSession: async () => { throw new DOMException('Physical XR is disabled in desktop checks.', 'NotSupportedError'); },
    });
    // The pinned splat library registers sessiongranted at module load whenever
    // 'xr' exists. Supply an inert EventTarget, never the native XRSystem.
    Object.defineProperty(navigator, 'xr', { configurable: true, value: unsupportedXr });
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.consoleErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await check('desktop checks are isolated from the physical XR runtime', async () => {
    const cdp = await browser.newBrowserCDPSession();
    try {
      const command = await cdp.send('Browser.getBrowserCommandLine');
      assert.ok(command.arguments.includes(noHardwareXr), 'Test Chrome can still select the live XR runtime.');
    } finally { await cdp.detach(); }
    assert.equal(await page.evaluate(() => navigator.xr.isSessionSupported('immersive-vr')), false);
    return { forcedRuntime: 'no-xr-runtime', nativeXrReplacedWithInertStub: true,
      syntheticXrOnly: true, applicationBrowserChanged: false };
  });
  const modelGate = new Promise(resolve => { releaseModel = resolve; });
  await page.route('**/splats/hallway3/*.ply', async route => {
    await modelGate;
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: corridorPly() });
  });
  let wallRequests = 0;
  const wallGate = new Promise(resolve => { releaseWall = resolve; });
  await page.route('**/splats/wall-section/wall-section.ply', async route => {
    wallRequests++;
    await wallGate;
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: wallPly() });
  });
  // Missing clips report on the PC; they must never create headset captions.
  await page.route('**/audio/generated/*.mp3', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>clips not generated</html>' }));
  await page.goto(`${baseUrl}?format=ply`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__debug);
  // The public fixture uses a known corridor view for pointer/prop checks.
  // The separate actual-asset smoke below retains the production overview.
  await page.evaluate(() => {
    const { camera, controls } = window.__debug;
    camera.position.set(0, 1.6, 10);
    controls.target.set(0, 1.2, 0);
    controls.update();
  });
  await check('installation preview waits for initial scan placement to finish', async () => {
    assert.equal(await page.locator('#experience-show-box').isDisabled(), true);
    assert.equal(await page.locator('#experience-rotate').isDisabled(), true);
    assert.equal(await page.locator('#experience-show-wall').isDisabled(), true);
    assert.equal(wallRequests, 0);
    assert.equal(await page.evaluate(() => window.__debug.wallBlocker.snapshot().visible), false);
    assert.equal(await page.evaluate(async () => {
      const { getSourceCenters } = await import('/src/viewer/splatViewer.ts');
      return getSourceCenters(window.__debug.splats) === undefined;
    }), true, 'Picking an unfinished source scan must return no centres without querying a missing scene.');
    assert.equal(await page.evaluate(() => window.__debug.experience.installation.snapshot().phase), 'idle');
  });
  releaseModel();
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('loaded'));
  await page.waitForTimeout(1000); // allow the asynchronous splat sort to present
  await page.screenshot({ path: path.join(output, 'loaded.png'), fullPage: true });
  await check('scan preserves manual placement and loads the supplied A/B pair', async () => {
    return await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { parseRenderQuality } = await import('/src/viewer/quality.ts');
      const { ACTIVE_SCAN } = await import('/src/viewer/scanAsset.ts');
      const { splats, scene, experience, calibration } = window.__debug;
      const state = experience.installation.snapshot();
      const box = scene.getObjectByName('installation-box');
      if (state.placementSource !== 'unplaced' || state.placementConfirmed) throw new Error('Manual box reused the stale asset anchor before operator action.');
      const landmarks = calibration.snapshot();
      if (!landmarks.landmarksReady || JSON.stringify(landmarks.scanPointA) !== JSON.stringify([2.99, 19.14, -1.41]) ||
        JSON.stringify(landmarks.scanPointB) !== JSON.stringify([2.90, 18.16, -1.26])) throw new Error('User-supplied A/B were not loaded.');
      const startPoint = ACTIVE_SCAN.startPoint;
      if (['spawn-x', 'spawn-y', 'spawn-z'].some((id, i) => Number(document.getElementById(id).value) !== startPoint[i])) throw new Error('Start fields do not use the supplied raw PLY point.');
      splats.updateWorldMatrix(true, false);
      if (splats.localToWorld(new THREE.Vector3(...startPoint)).length() > 1e-8) throw new Error('Raw start floor point did not map to the XR origin.');
      const configuredRotation = new THREE.Quaternion(...ACTIVE_SCAN.rotation).normalize();
      if (1 - Math.abs(splats.quaternion.dot(configuredRotation)) > 1e-8) throw new Error('Scan did not retain the manually configured orientation.');
      if (state.config.floorY !== 0 || scene.getObjectByName('installation-fixed-props').visible) throw new Error('Box appeared automatically or changed the local-floor plane.');
      if (parseRenderQuality('?scan=max&quality=detail&format=ksplat').modelUrl !== '/splats/hallway3/hallway3_0.ply') throw new Error('Legacy bookmark loaded an old or compressed export.');
      if (state.config.boxWidth !== .36 || state.config.boxDepth !== .36 || state.config.boxHeight !== .43) throw new Error('Real box dimensions changed.');
      if (box.parent === splats) throw new Error('Physical box inherits the artistic scan turn.');
      return { placementSource: state.placementSource, landmarksReady: true, scanPointA: landmarks.scanPointA, scanPointB: landmarks.scanPointB,
        startPoint, manualBoxPending: true, floorY: state.config.floorY, boxDimensions: [.36, .36, .43] };
    });
  });
  await check('scan loads with a nonblank canvas and gated physical start', async () => {
    assert.equal(await page.locator('#experience-show-box').isDisabled(), false);
    assert.equal(await page.locator('#experience-rotate').isDisabled(), true);
    return await page.evaluate(() => {
      const { renderer, scene, camera, splats } = window.__debug;
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 16) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) lit++;
      if (lit < 100) throw new Error(`Synthetic corridor canvas is blank (${lit} lit samples).`);
      return { litSamples: lit, experienceOpacity: splats.viewer.splatMesh.material.uniforms.uGlobalOpacity.value };
    });
  });
  await check('wall loads only on request and a reset cancels its pending reveal', async () => {
    assert.equal(wallRequests, 0);
    assert.equal(await page.locator('#experience-show-wall').isDisabled(), false);
    await page.locator('#experience-show-wall').click();
    await page.waitForFunction(() => window.__debug.wallBlocker.snapshot().phase === 'loading');
    await page.locator('#experience-reset').click();
    assert.equal(await page.evaluate(() => window.__debug.wallBlocker.snapshot().requested), false);
    releaseWall();
    await page.waitForFunction(() => window.__debug.wallBlocker.snapshot().phase === 'ready');
    const state = await page.evaluate(async () => {
      const { getSourceCenters } = await import('/src/viewer/splatViewer.ts');
      const { splats, wallBlocker } = window.__debug;
      const snapshot = wallBlocker.snapshot();
      return { ...snapshot, sceneVisible: splats.getSplatScene(snapshot.sceneIndex).visible,
        sourceCenterLength: getSourceCenters(splats).length,
        sourceSplatCount: splats.getSplatScene(0).splatBuffer.getSplatCount(),
        mergedCenterLength: splats.viewer.splatMesh.splatDataTextures.baseData.centers.length };
    });
    assert.equal(state.visible, false);
    assert.equal(state.sceneVisible, false);
    assert.equal(state.requested, false);
    assert.equal(state.sourceCenterLength, state.sourceSplatCount * 3);
    assert.ok(state.sourceCenterLength < state.mergedCenterLength,
      'Calibration and placement must exclude the new prop from the hallway source centres.');
    assert.equal(wallRequests, 1);
    return { ...state, requests: wallRequests, canceledReveal: true };
  });
  await check('Show wall reveals one metric wall across the corridor and Hide wall removes it', async () => {
    const original = await page.evaluate(() => {
      const { splats, camera, controls } = window.__debug;
      splats.updateMatrixWorld(true);
      return { scan: splats.matrixWorld.toArray(), camera: camera.position.toArray(), target: controls.target.toArray(),
        cameraParent: camera.parent?.uuid, scanCount: splats.viewer.getSceneCount() };
    });
    await page.locator('#experience-show-wall').click();
    await page.waitForFunction(() => window.__debug.wallBlocker.snapshot().visible);
    const details = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { renderer, scene, splats, wallBlocker, camera, controls } = window.__debug;
      const snapshot = wallBlocker.snapshot();
      const wall = splats.getSplatScene(snapshot.sceneIndex);
      wall.updateWorldMatrix(true, false);
      const objectToWorld = wall.matrixWorld;
      const edge = new THREE.Vector3(snapshot.width / 2, 0, 0).applyMatrix4(objectToWorld)
        .sub(new THREE.Vector3(-snapshot.width / 2, 0, 0).applyMatrix4(objectToWorld));
      const vertical = new THREE.Vector3(0, snapshot.height, 0).applyMatrix4(objectToWorld)
        .sub(new THREE.Vector3().applyMatrix4(objectToWorld));
      const corridor = new THREE.Vector3(0, 1, 0).transformDirection(splats.matrixWorld);
      const base = new THREE.Vector3(...snapshot.baseRaw).applyMatrix4(splats.matrixWorld);
      const unchanged = { scan: splats.matrixWorld.toArray(), camera: camera.position.toArray(), target: controls.target.toArray(),
        cameraParent: camera.parent?.uuid, scanCount: splats.viewer.getSceneCount() };
      // Face the panel down the corridor for readable, useful visual evidence.
      camera.position.copy(base).addScaledVector(corridor, 3.8); camera.position.y = base.y + 1.5;
      controls.target.copy(base); controls.target.y += snapshot.height / 2; controls.update();
      splats.viewer.update(renderer, camera); renderer.render(scene, camera);
      return { ...snapshot, sceneVisible: wall.visible, metricWidth: edge.length(), metricHeight: vertical.length(),
        transverseDot: edge.clone().normalize().dot(corridor), uprightDot: vertical.clone().normalize().y,
        baseWorld: base.toArray(), scale: wall.scale.toArray(), unchanged };
    });
    assert.equal(details.visible, true);
    assert.equal(details.sceneVisible, true);
    assert.ok(Math.abs(details.metricWidth - 2.10) < 1e-7);
    assert.ok(Math.abs(details.metricHeight - WALL_SECTION.height) < 1e-7);
    assert.ok(Math.abs(details.transverseDot) < 1e-7);
    assert.ok(Math.abs(details.uprightDot - 1) < 1e-7);
    assert.deepEqual(details.scale, [1, 1, 1]);
    assert.deepEqual(details.unchanged, original);
    assert.equal(await page.locator('#experience-show-wall').textContent(), 'Hide wall');
    await page.waitForTimeout(500); // global splat sorting is asynchronous
    await page.screenshot({ path: path.join(output, 'wall-blocker.png'), fullPage: true });
    await page.locator('#experience-show-wall').click();
    assert.equal(await page.evaluate(() => window.__debug.wallBlocker.snapshot().visible), false);
    assert.equal(await page.locator('#experience-show-wall').textContent(), 'Show wall');
    assert.equal(wallRequests, 1);
    await page.locator('#experience-show-wall').click();
    await page.waitForFunction(() => window.__debug.wallBlocker.snapshot().visible);
    const disarmed = await page.evaluate(() => {
      const { experience, splats, wallBlocker } = window.__debug;
      experience.prepareForCalibration();
      const snapshot = wallBlocker.snapshot();
      return { visible: snapshot.visible, requested: snapshot.requested,
        sceneVisible: splats.getSplatScene(snapshot.sceneIndex).visible };
    });
    assert.deepEqual(disarmed, { visible: false, requested: false, sceneVisible: false });
    await page.evaluate(original => {
      const { camera, controls } = window.__debug;
      camera.position.set(...original.camera); controls.target.set(...original.target); controls.update();
    }, original);
    return { ...details, requests: wallRequests, sharedDepthSort: true, cameraAndScanUnchanged: true,
      calibrationPreparationClearsReveal: true };
  });
  if (!wallOnly) {
  await check('CALIBRATE requires a running VR session and cannot queue startup', async () => {
    const prepared = await page.evaluate(() => {
      window.__debug.calibration.startCalibration();
      return { setup: window.__debug.calibration.snapshot(), experience: window.__debug.experience.installation.snapshot() };
    });
    assert.equal(prepared.setup.step, 'READY');
    assert.equal(prepared.setup.hasLeft, false);
    assert.equal(prepared.setup.hasRight, false);
    assert.equal(prepared.experience.calibrated, false);
    assert.equal(await page.evaluate(() => window.__debug.renderer.xr.isPresenting), false);
    assert.match(await page.locator('#calib-status').textContent(), /No VR session running/i);
    assert.equal(await page.locator('#calib-start').textContent(), 'CALIBRATE');
    await page.screenshot({ path: path.join(output, 'calibration-ready.png'), fullPage: true });
    return { noQueuedStartup: true, calibrationAccepted: false, enterVrFirst: true };
  });
  await check('Show box fits equal wall distances on the existing floor without automatic progression', async () => {
    await page.locator('#experience-show-box').click();
    await page.waitForFunction(() => window.__debug.experience.installation.snapshot().phase === 'box');
    await page.waitForFunction(() => window.__debug.spawnMarker.userData.reference === 'box-turn-pivot');
    const state = await page.evaluate(() => {
      const { scene, camera, experience } = window.__debug;
      experience.installation.update(45);
      const snapshot = experience.installation.snapshot();
      return { snapshot, placement: experience.placementSnapshot(), measurement: experience.primaryWallMeasurement(),
        marker: window.__debug.spawnMarker.position.toArray(), propsVisible: scene.getObjectByName('installation-fixed-props').visible,
        box: scene.getObjectByName('installation-box').position.toArray(), orbExists: !!scene.getObjectByName('installation-badge'),
        narrativeHudExists: !!camera.getObjectByName('experience-captions'), stopVisible: camera.getObjectByName('experience-stop').visible };
    });
    assert.equal(state.snapshot.calibrated, false);
    assert.equal(state.snapshot.phase, 'box');
    assert.equal(state.snapshot.secondBox.placed, true);
    assert.equal(state.snapshot.secondBox.visible, false);
    assert.equal(await page.locator('#experience-show-second-box').isDisabled(), true);
    assert.equal(state.snapshot.yaw, 0);
    assert.ok(Math.abs(state.snapshot.config.hallwayWidth - 2.1) < .02);
    assert.equal(state.snapshot.config.floorY, 0);
    assert.equal(state.propsVisible, true);
    assert.equal(state.box[1], .215);
    assert.equal(state.orbExists, false);
    assert.equal(state.placement.ok, true);
    assert.ok(Math.abs(state.placement.clearanceLeft - state.placement.clearanceRight) < 1e-8);
    assert.ok(Math.abs(state.box[0]) < .02);
    assert.ok(state.measurement.centerDistances.imbalance < 1e-10);
    assert.ok(state.measurement.pivotDistances.imbalance < 1e-10);
    assert.equal(state.measurement.centerMatchesPivot, true);
    assert.deepEqual(state.marker, state.measurement.pivot);
    assert.equal(state.narrativeHudExists, false);
    assert.equal(state.stopVisible, false);
    assert.equal(await page.locator('#experience-rotate').isDisabled(), false);
    const boxPixel = await readBoxVisibility(page);
    await page.screenshot({ path: path.join(output, 'screenshot.png'), fullPage: true });
    return { phase: state.snapshot.phase, hallwayWidth: state.snapshot.config.hallwayWidth, box: state.box,
      centering: state.placement, measuredDistances: state.measurement, marker: state.marker, boxPixel };
  });
  await check('wall diagnostics measure the actual box after edits and Show box restores the exact bisector', async () => {
    const offset = await page.evaluate(() => {
      const { experience } = window.__debug;
      const config = experience.installation.snapshot().config;
      experience.installation.configure({ ...config, centerX: config.centerX + .1 });
      return experience.primaryWallMeasurement();
    });
    assert.ok(Math.abs(offset.centerDistances.imbalance - .2) < 1e-8);
    assert.ok(Math.abs(offset.pivotDistances.imbalance - .2) < 1e-8);
    assert.ok(offset.centerMatchesPivot);
    assert.match(await page.locator('#experience-wall-measurement').textContent(), /200\.000 mm/);
    await page.locator('#experience-show-box').click();
    const centered = await page.evaluate(() => window.__debug.experience.primaryWallMeasurement());
    assert.ok(centered.centerDistances.imbalance < 1e-10);
    assert.ok(centered.pivotDistances.imbalance < 1e-10);
    assert.ok(centered.edgeClearances.left > 0 && centered.edgeClearances.right > 0);
    return { offset, centered };
  });
  await check('box sides follow a fitted hallway heading after nonzero calibration yaw', async () => {
    const original = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { experience, splats } = window.__debug;
      const state = experience.installation.snapshot();
      const original = { position: splats.position.toArray(), quaternion: splats.quaternion.toArray(), config: state.config };
      experience.prepareForCalibration();
      const pivot = new THREE.Vector3(state.config.centerX, state.config.floorY, state.config.centerZ);
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .63);
      splats.position.sub(pivot).applyQuaternion(yaw).add(pivot);
      splats.quaternion.premultiply(yaw); splats.updateMatrixWorld(true);
      experience.calibrated(); // synthetic registration, not hardware acceptance
      return original;
    });
    await page.locator('#experience-show-box').click();
    const result = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { scene, experience } = window.__debug;
      const box = scene.getObjectByName('installation-box');
      const rotation = box.getWorldQuaternion(new THREE.Quaternion());
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
      const heading = new THREE.Vector3(...experience.placementSnapshot().directionWorld);
      return { parallel: forward.dot(heading), up: up.toArray(), position: box.position.toArray(),
        config: experience.installation.snapshot().config, boxYaw: experience.installation.snapshot().boxYaw };
    });
    assert.ok(Math.abs(result.parallel - 1) < 1e-8);
    assert.ok(Math.abs(result.boxYaw - .63) < 1e-6);
    assert.deepEqual(result.up, [0, 1, 0]);
    assert.ok(Math.abs(result.config.centerX - original.config.centerX) < 1e-6);
    assert.ok(Math.abs(result.config.centerZ - original.config.centerZ) < 1e-6);
    assert.equal(result.config.floorY, original.config.floorY);
    await page.screenshot({ path: path.join(output, 'aligned-box.png'), fullPage: true });
    await page.evaluate(original => {
      const { experience, splats } = window.__debug;
      experience.prepareForCalibration();
      splats.position.set(...original.position); splats.quaternion.set(...original.quaternion);
      splats.updateMatrixWorld(true); experience.calibrated();
    }, original);
    await page.locator('#experience-show-box').click();
    return result;
  });
  await check('a desktop floor-line pick refines the hidden second box before the turn', async () => {
    await page.locator('#experience-placement').evaluate(element => { element.open = true; });
    const before = await page.evaluate(() => window.__debug.experience.installation.snapshot());
    await page.locator('#experience-pick-second-line').click();
    assert.equal(await page.locator('#experience-rotate').isDisabled(), true);
    assert.equal(await page.locator('#experience-show-box').isDisabled(), true);
    const point = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { renderer, camera } = window.__debug;
      const rect = renderer.domElement.getBoundingClientRect();
      const p = new THREE.Vector3(-.8, 0, 4.7).project(camera);
      return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
    });
    const unsupportedPoint = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { renderer, camera } = window.__debug;
      const rect = renderer.domElement.getBoundingClientRect();
      const p = new THREE.Vector3(-.8, 0, -20).project(camera);
      return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
    });
    await page.mouse.click(unsupportedPoint.x, unsupportedPoint.y);
    assert.equal(await page.evaluate(() => window.__debug.experience.installation.snapshot().secondBox.placed), false);
    await page.locator('#experience-rotate').click();
    assert.equal(await page.evaluate(() => window.__debug.experience.installation.snapshot().phase), 'box');
    await page.locator('#experience-pick-second-line').click();
    await page.mouse.click(point.x, point.y);
    const after = await page.evaluate(() => ({ state: window.__debug.experience.installation.snapshot(),
      placement: window.__debug.experience.secondPlacementSnapshot() }));
    assert.equal(after.state.secondBox.placed, true);
    assert.equal(after.state.secondBox.visible, false);
    assert.ok(Math.abs(after.state.secondBox.base[2] - 4.88) < 1e-6);
    assert.ok(Math.abs(after.state.secondBox.base[2] - before.secondBox.base[2]) > .2);
    assert.deepEqual(after.state.config, before.config);
    assert.equal(await page.locator('#experience-rotate').isDisabled(), false);
    await page.locator('#experience-placement').evaluate(element => { element.open = false; });
    return { ...after.placement, failedRefinementClearsOldPreparation: true };
  });
  await check('manual Rotate button turns exactly 180 degrees with fixed floor and both box poses', async () => {
    const before = await page.evaluate(() => ({ position: window.__debug.splats.position.toArray(), box: window.__debug.scene.getObjectByName('installation-box').position.toArray(),
      second: window.__debug.experience.installation.snapshot().secondBox }));
    await page.locator('#experience-rotate').click();
    await page.waitForFunction(() => window.__debug.experience.installation.snapshot().phase === 'reversed', undefined, { timeout: 8000 });
    const after = await page.evaluate(() => ({ snapshot: window.__debug.experience.installation.snapshot(), position: window.__debug.splats.position.toArray(), box: window.__debug.scene.getObjectByName('installation-box').position.toArray(), propsVisible: window.__debug.scene.getObjectByName('installation-fixed-props').visible }));
    assert.equal(after.snapshot.yaw, Math.PI);
    assert.equal(after.position[1], before.position[1]);
    assert.deepEqual(after.box, before.box);
    assert.equal(after.propsVisible, true);
    assert.deepEqual(after.snapshot.secondBox.base, before.second.base);
    assert.equal(after.snapshot.secondBox.yaw, before.second.yaw);
    assert.equal(after.snapshot.secondBox.visible, false);
    assert.equal(await page.locator('#experience-show-second-box').isDisabled(), false);
    assert.equal(await page.locator('#experience-rotate').isDisabled(), true);
    const boxPixel = await readBoxVisibility(page);
    await page.screenshot({ path: path.join(output, 'reversed.png'), fullPage: true });
    return { yaw: after.snapshot.yaw, floorRootY: after.position[1], boxUnchanged: true, boxPixel };
  });
  await check('Show second box reveals the original world placement only after the turn', async () => {
    const before = await page.evaluate(() => ({ scan: window.__debug.splats.matrix.toArray(),
      first: window.__debug.scene.getObjectByName('installation-box').matrixWorld.toArray(),
      prepared: window.__debug.experience.installation.snapshot().secondBox }));
    await page.locator('#experience-show-second-box').click();
    const after = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { scene, splats, experience } = window.__debug;
      const box = scene.getObjectByName('installation-second-box');
      box.updateWorldMatrix(true, false);
      return { scan: splats.matrix.toArray(), first: scene.getObjectByName('installation-box').matrixWorld.toArray(),
        second: experience.installation.snapshot().secondBox, position: box.getWorldPosition(new THREE.Vector3()).toArray(),
        visible: box.visible, parentIsScene: box.parent === scene, scale: box.scale.toArray() };
    });
    assert.equal(after.visible, true);
    assert.equal(after.second.visible, true);
    assert.equal(after.parentIsScene, true);
    assert.deepEqual(after.second.base, before.prepared.base);
    assert.equal(after.second.yaw, before.prepared.yaw);
    assert.deepEqual(after.position, [before.prepared.base[0], .215, before.prepared.base[2]]);
    assert.deepEqual(after.scale, [.36, .43, .36]);
    assert.deepEqual(after.scan, before.scan);
    assert.deepEqual(after.first, before.first);
    assert.equal(await page.locator('#experience-show-second-box').isDisabled(), true);
    const pixel = await readBoxVisibility(page, 'installation-second-box');
    await page.screenshot({ path: path.join(output, 'second-box.png'), fullPage: true });
    return { prepared: before.prepared, revealed: after.second, pixel };
  });
  await check('stop freezes a partial turn and reset cannot grant calibration', async () => {
    await page.locator('#experience-reset').click();
    assert.equal(await page.evaluate(() => window.__debug.experience.installation.snapshot().secondBox.visible), false);
    await page.locator('#experience-show-box').click();
    await page.locator('#experience-rotate').click();
    await page.waitForTimeout(500);
    await page.locator('#experience-stop').click();
    const before = await page.evaluate(() => window.__debug.splats.matrix.toArray());
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => window.__debug.splats.matrix.toArray());
    assert.deepEqual(after, before);
    assert.equal(await page.evaluate(() => window.__debug.experience.installation.snapshot().phase), 'stopped');
    await page.locator('#experience-reset').click();
    assert.equal(await page.evaluate(() => window.__debug.experience.installation.snapshot().calibrated), false);
  });
  await check('unsaved placement and impossible hallway clearance cannot arm the sequence', async () => {
    await page.locator('#experience-placement').evaluate(element => { element.open = true; });
    const boxWidth = Number(await page.locator('#experience-boxWidth').inputValue());
    await page.locator('#experience-hallwayWidth').fill(String(boxWidth / 2));
    assert.equal(await page.locator('#experience-show-box').isDisabled(), true);
    assert.equal(await page.locator('#experience-rotate').isDisabled(), true);
    await page.locator('#experience-apply').click();
    assert.match(await page.locator('#experience-error').textContent(), /width|clearance/i);
    await page.locator('#experience-hallwayWidth').fill('2.1');
    await page.locator('#experience-apply').click();
    assert.equal(await page.locator('#experience-show-box').isDisabled(), false);
  });
  await check('Enter VR preserves the browser gesture and retains bounded error recovery', async () => {
    const { runSessionStartScenario } = await import('../tests/browser/sessionStartScenario.mjs');
    return await runSessionStartScenario(page);
  });
  await check('restored trigger/countdown calibration uses buffered controller placements', async () => {
    const { runCalibrationScenario } = await import('../tests/browser/calibrationScenario.mjs');
    return await runCalibrationScenario(page);
  });
  await check('tracking/session interruptions and repeated operator stop disarm the installation', async () => {
    const { runExperienceScenario } = await import('../tests/browser/experienceScenario.mjs');
    return await runExperienceScenario(page);
  });
  await check('post-calibration narration and timed box/turn/seat actions cancel cleanly', async () => {
    const { runTestScenarioScenario } = await import('../tests/browser/testScenarioScenario.mjs');
    return await runTestScenarioScenario(page);
  });
  await check('narrative transcripts stay on PC for muted, missing, blocked and playing audio', async () => {
    const { runVoiceCaptionScenario } = await import('../tests/browser/voiceCaptionScenario.mjs');
    return await runVoiceCaptionScenario(page);
  });
  await check('bundled skinned hands render offline and missing joints clear contact authority', async () => {
    const { runHandModelsScenario } = await import('../tests/browser/handModelsScenario.mjs');
    return await runHandModelsScenario(page);
  });
  await check('desktop runtime and manual movement boundaries retain distinct sources and tracking state', async () => {
    const { runBoundaryScenario } = await import('../tests/browser/boundaryScenario.mjs');
    return await runBoundaryScenario(page);
  });
  await check('scan-picked centreline follows calibration and remains unchecked', async () => {
    await page.locator('#experience-pick-center').click();
    const positions = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { renderer, camera } = window.__debug;
      const rect = renderer.domElement.getBoundingClientRect();
      return [-1.05, 1.05].map(x => {
        const point = new THREE.Vector3(x, 0, -2).project(camera);
        return { x: rect.left + (point.x + 1) / 2 * rect.width, y: rect.top + (1 - point.y) / 2 * rect.height };
      });
    });
    for (const position of positions) await page.mouse.click(position.x, position.y);
    await page.locator('#experience-show-box').click();
    await page.locator('#experience-pick-center').click();
    await page.mouse.click(positions[0].x, positions[0].y);
    assert.equal(await page.locator('#experience-show-box').isDisabled(), true);
    assert.equal(await page.locator('#experience-rotate').isDisabled(), true);
    await page.mouse.click(positions[1].x, positions[1].y);
    assert.equal(await page.locator('#experience-show-box').isDisabled(), false);
    assert.equal(await page.locator('#experience-rotate').isDisabled(), false);
    const before = await page.evaluate(() => window.__debug.experience.installation.snapshot());
    assert.equal(before.placementConfirmed, false);
    assert.ok(Math.abs(before.config.centerX) < 0.15, 'picked midpoint must lie near the corridor centreline');
    assert.match(await page.locator('#experience-error').textContent(), /scan width/);
    const after = await page.evaluate(() => {
      const { experience, splats } = window.__debug;
      experience.prepareForCalibration();
      splats.position.x += 2;
      splats.position.z -= 1;
      splats.updateMatrixWorld(true);
      experience.calibrated(); // synthetic transform exercise, never XR acceptance
      return experience.installation.snapshot();
    });
    assert.ok(Math.abs(after.config.centerX - before.config.centerX - 2) < 1e-6);
    assert.ok(Math.abs(after.config.centerZ - before.config.centerZ + 1) < 1e-6);
    assert.equal(after.placementConfirmed, false);
    const overridden = await page.evaluate(() => {
      const { experience, splats } = window.__debug;
      experience.installation.configure({ ...experience.installation.snapshot().config, centerX: 7, centerZ: 9, floorY: 0.35 });
      experience.prepareForCalibration();
      splats.position.x += 1;
      splats.updateMatrixWorld(true);
      experience.calibrated();
      return experience.installation.snapshot();
    });
    assert.equal(overridden.placementSource, 'manual-world');
    assert.equal(overridden.config.centerX, 7);
    assert.equal(overridden.config.centerZ, 9);
    assert.equal(overridden.config.floorY, 0.35);
    return { selectedWidth: before.config.hallwayWidth, calibrationTranslationFollowed: true, manualOverrideSurvivesCachedPicks: true,
      partialReplacementBlocksShowAndTurn: true };
  });
  }
  await check('no desktop JavaScript errors', () => { assert.deepEqual(report.consoleErrors, []); });

  if (process.env.CHECK_REAL_SCAN === '1') {
    console.log('Checking private original hallway3 PLY (desktop only).');
    const wallFile = path.join(root, 'public', WALL_SECTION.modelUrl.slice(1));
    const wallMetadata = JSON.parse(await fs.readFile(`${wallFile}.meta.json`, 'utf8'));
    assert.equal(wallMetadata.sourceSha256,
      await sha256File(path.join(root, 'public', ACTIVE_SCAN.plyUrl.slice(1))));
    assert.equal(wallMetadata.outputBytes, (await fs.stat(wallFile)).size);
    assert.equal(wallMetadata.objectDimensions.width, WALL_SECTION.width);
    assert.equal(wallMetadata.objectDimensions.height, WALL_SECTION.height);
    assert.equal(wallMetadata.compressionLevel, 0);
    assert.equal(wallMetadata.resampled, false);
    await page.evaluate(() => window.__debug.renderer.setAnimationLoop(null));
    const realPage = await context.newPage();
    const errors = [];
    realPage.on('pageerror', error => errors.push(error.message));
    await realPage.goto(`${baseUrl}?quality=detail`, { waitUntil: 'domcontentloaded' });
    await realPage.waitForFunction(() => document.getElementById('status')?.textContent?.includes('loaded'), undefined, { timeout: 180000 });
    await realPage.locator('#experience-show-box').click({ timeout: 60000 });
    await realPage.waitForFunction(() => window.__debug.experience.installation.snapshot().phase === 'box', undefined, { timeout: 60000 });
    await realPage.waitForFunction(() => window.__debug.spawnMarker.userData.reference === 'box-turn-pivot', undefined, { timeout: 60000 });
    await realPage.waitForFunction(() => !document.getElementById('experience-show-wall').disabled, undefined, { timeout: 60000 });
    // Software WebGL can queue expensive frames for a multi-million-splat scan.
    // Pause this desktop-only smoke before capture, leaving the last frame visible.
    const privateCenter = await realPage.evaluate(() => {
      const { renderer, scene, camera, controls, splats, experience } = window.__debug;
      renderer.setAnimationLoop(null);
      const box = scene.getObjectByName('installation-box');
      // Desktop inspection view only, to show both the real scan and new box.
      camera.position.set(box.position.x + 1.2, box.position.y + 1.8, box.position.z + 4);
      controls.target.copy(box.position); controls.update();
      splats.viewer.update(renderer, camera); renderer.render(scene, camera);
      return { centering: experience.placementSnapshot(), measurement: experience.primaryWallMeasurement(),
        marker: window.__debug.spawnMarker.position.toArray(), config: experience.installation.snapshot().config,
        second: experience.installation.snapshot().secondBox, secondPlacement: experience.secondPlacementSnapshot() };
    });
    await realPage.screenshot({ path: path.join(output, 'private-scan.png'), fullPage: true, timeout: 60000 });
    assert.deepEqual(errors, []);
    assert.equal(privateCenter.centering.ok, true);
    assert.equal(privateCenter.config.floorY, 0);
    assert.equal(privateCenter.second.placed, true);
    assert.equal(privateCenter.second.visible, false);
    assert.ok(Math.abs(privateCenter.centering.clearanceLeft - privateCenter.centering.clearanceRight) < 1e-8);
    assert.ok(privateCenter.measurement.centerDistances.imbalance < 1e-10);
    assert.ok(privateCenter.measurement.pivotDistances.imbalance < 1e-10);
    assert.deepEqual(privateCenter.marker, privateCenter.measurement.pivot);
    report.checks.push({ name: 'private original hallway3 PLY centres and shows the manual box', passed: true, details: privateCenter });
    await realPage.locator('#experience-show-wall').click({ timeout: 60000 });
    await realPage.waitForFunction(() => window.__debug.wallBlocker.snapshot().visible, undefined, { timeout: 60000 });
    const privateWall = await realPage.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { renderer, scene, camera, controls, splats, wallBlocker } = window.__debug;
      const snapshot = wallBlocker.snapshot();
      const wall = splats.getSplatScene(snapshot.sceneIndex);
      wall.updateWorldMatrix(true, false);
      const base = wall.getWorldPosition(new THREE.Vector3());
      const corridor = new THREE.Vector3(0, 1, 0).transformDirection(splats.matrixWorld);
      camera.position.copy(base).addScaledVector(corridor, -3.2); camera.position.y = base.y + 1.45;
      controls.target.copy(base); controls.target.y += snapshot.height / 2; controls.update();
      camera.updateMatrixWorld(true);
      scene.updateMatrixWorld(true);
      wallBlocker.update();
      splats.viewer.update(renderer, camera);
      // The paused software-rendering smoke must settle a fresh sort AFTER
      // both the camera and copied wall have their final transforms.
      const settleSort = async () => {
        let timer;
        try {
          await Promise.race([splats.viewer.sortPromise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('The private wall sort did not settle within 30 seconds.')), 30000);
          })]);
        } finally { clearTimeout(timer); }
      };
      await settleSort();
      splats.viewer.splatMesh.updateTransforms();
      await splats.viewer.runSplatSort(true, true);
      await settleSort();
      const sortCompletedAfterPlacement = !splats.viewer.sortRunning;
      renderer.render(scene, camera);
      return { ...snapshot, worldBase: base.toArray(), sceneVisible: wall.visible,
        splatCount: wall.splatBuffer.getSplatCount(), sourceSplatCount: splats.getSplatScene(0).splatBuffer.getSplatCount(),
        sortCompletedAfterPlacement };
    });
    await realPage.screenshot({ path: path.join(output, 'private-wall-blocker.png'), fullPage: true, timeout: 60000 });
    assert.equal(privateWall.visible, true);
    assert.equal(privateWall.sceneVisible, true);
    assert.equal(privateWall.sortCompletedAfterPlacement, true);
    assert.equal(privateWall.width, 2.10);
    assert.equal(privateWall.height, WALL_SECTION.height);
    assert.equal(privateWall.splatCount, wallMetadata.outputVertexCount);
    assert.equal(privateWall.sourceSplatCount, wallMetadata.sourceVertexCount);
    assert.deepEqual(errors, []);
    report.checks.push({ name: 'private extracted wall reveals across the original hallway without replacing its scan', passed: true,
      details: { ...privateWall, sourceSha256: wallMetadata.sourceSha256,
        sourceFingerprintMatched: true, compressionLevel: wallMetadata.compressionLevel } });
    await realPage.locator('#experience-show-wall').click({ timeout: 60000 });
    assert.equal(await realPage.evaluate(() => window.__debug.wallBlocker.snapshot().visible), false);
    await realPage.locator('#experience-rotate').click();
    // Synthetic elapsed time on this isolated desktop smoke; no hardware run.
    await realPage.evaluate(() => window.__debug.experience.installation.update(4));
    assert.equal(await realPage.locator('#experience-show-second-box').isDisabled(), false);
    await realPage.locator('#experience-show-second-box').click();
    const privateSecond = await realPage.evaluate(() => {
      const { renderer, scene, camera, controls, splats, experience } = window.__debug;
      const box = scene.getObjectByName('installation-second-box');
      camera.position.set(box.position.x + 1.2, box.position.y + 1.8, box.position.z + 4);
      controls.target.copy(box.position); controls.update();
      splats.viewer.update(renderer, camera); renderer.render(scene, camera);
      return experience.installation.snapshot().secondBox;
    });
    assert.equal(privateSecond.visible, true);
    assert.deepEqual(privateSecond.base, privateCenter.second.base);
    assert.equal(privateSecond.yaw, privateCenter.second.yaw);
    await realPage.screenshot({ path: path.join(output, 'private-second-box.png'), fullPage: true, timeout: 60000 });
    assert.deepEqual(errors, []);
    report.checks.push({ name: 'private original scan reveals the fixed pre-turn second box after rotation', passed: true,
      details: { prepared: privateCenter.second, revealed: privateSecond, placement: privateCenter.secondPlacement } });
    await realPage.close();
  }
  report.passed = true;
} catch (error) {
  report.error = error.stack ?? String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  releaseModel?.();
  releaseWall?.();
  await browser?.close();
  await server?.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
