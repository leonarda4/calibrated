// Bounded desktop evidence. This never starts or emulates an immersive session.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.check');
await fs.mkdir(output, { recursive: true });
const report = { date: new Date().toISOString(), environment: 'Desktop Chrome; synthetic public corridor; no XR/hardware acceptance', checks: [], consoleErrors: [], passed: false };
let server;
let browser;
let page;
const check = async (name, action) => {
  const details = await action();
  report.checks.push({ name, passed: true, ...(details === undefined ? {} : { details }) });
  console.log(`PASS ${name}`);
};

function corridorPly() {
  const points = [];
  // Raw coordinates offset to the current viewer normalization. This fixture
  // depicts a made-up 2.10 m corridor and contains no captured space data.
  const add = (x, y, z, color) => points.push([x - 18.3, -z - 13.55, y - 1.27, ...color]);
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
  await page.route('**/models/*.ply', route => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: corridorPly() }));
  // Missing clips report on the PC; they must never create headset captions.
  await page.route('**/audio/generated/*.mp3', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>clips not generated</html>' }));
  await page.goto('http://127.0.0.1:5175/?scan=std', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('loaded'));
  await page.waitForTimeout(1000); // allow the asynchronous splat sort to present
  await page.screenshot({ path: path.join(output, 'loaded.png'), fullPage: true });
  await check('scan loads with a nonblank canvas and gated physical start', async () => {
    assert.equal(await page.locator('#experience-start').isDisabled(), true);
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
  await check('desktop preview has no narrative HUD; badge props and box stay visible', async () => {
    await page.locator('#experience-preview').click();
    await page.locator('#experience-reveal').click();
    await page.waitForFunction(() => window.__debug.experience.installation.snapshot().phase === 'badge');
    const state = await page.evaluate(() => {
      const { scene, camera, experience } = window.__debug;
      const snapshot = experience.installation.snapshot();
      return { snapshot, box: scene.getObjectByName('installation-box').position.toArray(), orbVisible: scene.getObjectByName('installation-badge').visible,
        narrativeHudExists: !!camera.getObjectByName('experience-captions'), stopVisible: camera.getObjectByName('experience-stop').visible };
    });
    assert.equal(state.snapshot.calibrated, false);
    assert.equal(state.snapshot.config.hallwayWidth, 2.1);
    assert.equal(state.orbVisible, true);
    assert.equal(state.narrativeHudExists, false);
    assert.equal(state.stopVisible, false);
    assert.equal(await page.locator('#experience-collect').isDisabled(), true);
    await page.screenshot({ path: path.join(output, 'screenshot.png'), fullPage: true });
    return { phase: state.snapshot.phase, hallwayWidth: state.snapshot.config.hallwayWidth, box: state.box };
  });
  await check('one-shot preview collection turns exactly 180 degrees with fixed floor and box', async () => {
    const before = await page.evaluate(() => ({ position: window.__debug.splats.position.toArray(), box: window.__debug.scene.getObjectByName('installation-box').position.toArray() }));
    await page.locator('#experience-stationary').check();
    await page.locator('#experience-collect').click();
    await page.waitForFunction(() => window.__debug.experience.installation.snapshot().phase === 'reversed', undefined, { timeout: 8000 });
    const after = await page.evaluate(() => ({ snapshot: window.__debug.experience.installation.snapshot(), position: window.__debug.splats.position.toArray(), box: window.__debug.scene.getObjectByName('installation-box').position.toArray(), orbVisible: window.__debug.scene.getObjectByName('installation-badge').visible }));
    assert.equal(after.snapshot.yaw, Math.PI);
    assert.equal(after.position[1], before.position[1]);
    assert.deepEqual(after.box, before.box);
    assert.equal(after.orbVisible, false);
    await page.screenshot({ path: path.join(output, 'reversed.png'), fullPage: true });
    return { yaw: after.snapshot.yaw, floorRootY: after.position[1], boxUnchanged: true };
  });
  await check('stop freezes a partial turn and reset cannot grant calibration', async () => {
    await page.locator('#experience-reset').click();
    await page.locator('#experience-preview').click();
    await page.locator('#experience-reveal').click();
    await page.locator('#experience-stationary').check();
    await page.locator('#experience-collect').click();
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
    assert.equal(await page.locator('#experience-placement-check').isDisabled(), true);
    assert.equal(await page.locator('#experience-preview').isDisabled(), true);
    await page.locator('#experience-apply').click();
    assert.match(await page.locator('#experience-error').textContent(), /width|clearance/i);
    await page.locator('#experience-hallwayWidth').fill('2.1');
    await page.locator('#experience-apply').click();
    assert.equal(await page.locator('#experience-preview').isDisabled(), false);
    assert.equal(await page.locator('#experience-start').isDisabled(), true);
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
    return { selectedWidth: before.config.hallwayWidth, calibrationTranslationFollowed: true };
  });
  await check('no desktop JavaScript errors', () => { assert.deepEqual(report.consoleErrors, []); });

  if (process.env.CHECK_REAL_SCAN === '1') {
    console.log('Checking private compressed ultra scan (desktop only).');
    await page.evaluate(() => window.__debug.renderer.setAnimationLoop(null));
    const realPage = await context.newPage();
    const errors = [];
    realPage.on('pageerror', error => errors.push(error.message));
    await realPage.goto('http://127.0.0.1:5175/?quality=detail&format=ksplat', { waitUntil: 'domcontentloaded' });
    await realPage.waitForFunction(() => document.getElementById('status')?.textContent?.includes('loaded'), undefined, { timeout: 180000 });
    // Software WebGL can queue expensive frames for a multi-million-splat scan.
    // Pause this desktop-only smoke before capture, leaving the last frame visible.
    await realPage.evaluate(() => window.__debug.renderer.setAnimationLoop(null));
    await realPage.screenshot({ path: path.join(output, 'private-scan.png'), fullPage: true, timeout: 60000 });
    assert.deepEqual(errors, []);
    report.checks.push({ name: 'private compressed ultra scan loads on desktop', passed: true, details: await realPage.locator('#status').textContent() });
    await realPage.close();
  }
  report.passed = true;
} catch (error) {
  report.error = error.stack ?? String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
