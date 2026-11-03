// Bounded desktop evidence. This never starts or emulates an immersive session.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { Vector3, Quaternion } from 'three';
import { ACTIVE_SCAN } from '../src/viewer/scanAsset.ts';
import { scanOriginForStart } from '../src/viewer/scanPlacement.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.check');
await fs.mkdir(output, { recursive: true });
const report = { date: new Date().toISOString(), environment: 'Desktop Chrome; synthetic public corridor; no XR/hardware acceptance', checks: [], consoleErrors: [], passed: false };
let server;
let browser;
let page;
let releaseModel;
const check = async (name, action) => {
  const details = await action();
  report.checks.push({ name, passed: true, ...(details === undefined ? {} : { details }) });
  console.log(`PASS ${name}`);
};

async function readBoxVisibility(targetPage) {
  const colors = await targetPage.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { renderer, scene, camera } = window.__debug;
    renderer.render(scene, camera);
    const point = scene.getObjectByName('installation-box').getWorldPosition(new THREE.Vector3()).project(camera);
    const gl = renderer.getContext();
    const x = Math.floor((point.x + 1) * gl.drawingBufferWidth / 2);
    const y = Math.floor((point.y + 1) * gl.drawingBufferHeight / 2);
    const bytes = new Uint8Array(3 * 3 * 4);
    gl.readPixels(x - 1, y - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return Array.from({ length: 9 }, (_, i) => Array.from(bytes.slice(i * 4, i * 4 + 3)));
  });
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
  for (let z = -10; z <= 6; z += 0.12) {
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
  const fields = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${points.length}\n${fields.map(name => `property float ${name}`).join('\n')}\nend_header\n`);
  const body = Buffer.alloc(points.length * fields.length * 4);
  let offset = 0;
  for (const [x, y, z, r, g, b] of points) {
    for (const value of [x, y, z, 0, 0, 0, (r - .5) / .28209479, (g - .5) / .28209479, (b - .5) / .28209479, 3.5, ...Array(3).fill(Math.log(.075)), 1, 0, 0, 0]) {
      body.writeFloatLE(value, offset); offset += 4;
    }
  }
  return Buffer.concat([header, body]);
}

try {
  server = await createServer({ configFile: path.join(root, 'vite.http.config.ts'), server: { host: '127.0.0.1', port: 5175, strictPort: true } });
  await server.listen();
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
  // Missing clips report on the PC; they must never create headset captions.
  await page.route('**/audio/generated/*.mp3', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>clips not generated</html>' }));
  await page.goto('http://127.0.0.1:5175/?format=ply', { waitUntil: 'domcontentloaded' });
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
    const state = await page.evaluate(() => {
      const { scene, camera, experience } = window.__debug;
      experience.installation.update(45);
      const snapshot = experience.installation.snapshot();
      return { snapshot, placement: experience.placementSnapshot(), propsVisible: scene.getObjectByName('installation-fixed-props').visible,
        box: scene.getObjectByName('installation-box').position.toArray(), orbExists: !!scene.getObjectByName('installation-badge'),
        narrativeHudExists: !!camera.getObjectByName('experience-captions'), stopVisible: camera.getObjectByName('experience-stop').visible };
    });
    assert.equal(state.snapshot.calibrated, false);
    assert.equal(state.snapshot.phase, 'box');
    assert.equal(state.snapshot.yaw, 0);
    assert.ok(Math.abs(state.snapshot.config.hallwayWidth - 2.1) < .02);
    assert.equal(state.snapshot.config.floorY, 0);
    assert.equal(state.propsVisible, true);
    assert.equal(state.box[1], .215);
    assert.equal(state.orbExists, false);
    assert.equal(state.placement.ok, true);
    assert.ok(Math.abs(state.placement.clearanceLeft - state.placement.clearanceRight) < 1e-8);
    assert.ok(Math.abs(state.box[0]) < .02);
    assert.equal(state.narrativeHudExists, false);
    assert.equal(state.stopVisible, false);
    assert.equal(await page.locator('#experience-rotate').isDisabled(), false);
    const boxPixel = await readBoxVisibility(page);
    await page.screenshot({ path: path.join(output, 'screenshot.png'), fullPage: true });
    return { phase: state.snapshot.phase, hallwayWidth: state.snapshot.config.hallwayWidth, box: state.box, centering: state.placement, boxPixel };
  });
  await check('manual Rotate button turns exactly 180 degrees with fixed floor and box', async () => {
    const before = await page.evaluate(() => ({ position: window.__debug.splats.position.toArray(), box: window.__debug.scene.getObjectByName('installation-box').position.toArray() }));
    await page.locator('#experience-rotate').click();
    await page.waitForFunction(() => window.__debug.experience.installation.snapshot().phase === 'reversed', undefined, { timeout: 8000 });
    const after = await page.evaluate(() => ({ snapshot: window.__debug.experience.installation.snapshot(), position: window.__debug.splats.position.toArray(), box: window.__debug.scene.getObjectByName('installation-box').position.toArray(), propsVisible: window.__debug.scene.getObjectByName('installation-fixed-props').visible }));
    assert.equal(after.snapshot.yaw, Math.PI);
    assert.equal(after.position[1], before.position[1]);
    assert.deepEqual(after.box, before.box);
    assert.equal(after.propsVisible, true);
    assert.equal(await page.locator('#experience-rotate').isDisabled(), true);
    const boxPixel = await readBoxVisibility(page);
    await page.screenshot({ path: path.join(output, 'reversed.png'), fullPage: true });
    return { yaw: after.snapshot.yaw, floorRootY: after.position[1], boxUnchanged: true, boxPixel };
  });
  await check('stop freezes a partial turn and reset cannot grant calibration', async () => {
    await page.locator('#experience-reset').click();
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
  await check('no desktop JavaScript errors', () => { assert.deepEqual(report.consoleErrors, []); });

  if (process.env.CHECK_REAL_SCAN === '1') {
    console.log('Checking private original hallway3 PLY (desktop only).');
    await page.evaluate(() => window.__debug.renderer.setAnimationLoop(null));
    const realPage = await context.newPage();
    const errors = [];
    realPage.on('pageerror', error => errors.push(error.message));
    await realPage.goto('http://127.0.0.1:5175/?quality=detail', { waitUntil: 'domcontentloaded' });
    await realPage.waitForFunction(() => document.getElementById('status')?.textContent?.includes('loaded'), undefined, { timeout: 180000 });
    await realPage.locator('#experience-show-box').click({ timeout: 60000 });
    await realPage.waitForFunction(() => window.__debug.experience.installation.snapshot().phase === 'box', undefined, { timeout: 60000 });
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
      return { centering: experience.placementSnapshot(), config: experience.installation.snapshot().config };
    });
    await realPage.screenshot({ path: path.join(output, 'private-scan.png'), fullPage: true, timeout: 60000 });
    assert.deepEqual(errors, []);
    assert.equal(privateCenter.centering.ok, true);
    assert.equal(privateCenter.config.floorY, 0);
    assert.ok(Math.abs(privateCenter.centering.clearanceLeft - privateCenter.centering.clearanceRight) < 1e-8);
    report.checks.push({ name: 'private original hallway3 PLY centres and shows the manual box', passed: true, details: privateCenter });
    await realPage.close();
  }
  report.passed = true;
} catch (error) {
  report.error = error.stack ?? String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  releaseModel?.();
  await browser?.close();
  await server?.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
