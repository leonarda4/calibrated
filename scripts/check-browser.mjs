// Bounded desktop evidence. This never starts or emulates an immersive session.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer as createPortProbe } from 'node:net';
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
import { BROOM } from '../src/viewer/broomConfig.ts';
import { runBroomScenario } from '../tests/browser/broomScenario.mjs';
import { runBroomEncounterScenario } from '../tests/browser/broomEncounterScenario.mjs';
import { runHallwayCollapseScenario } from '../tests/browser/hallwayCollapseScenario.mjs';
import { runRealityEndingScenario } from '../tests/browser/realityEndingScenario.mjs';
import { runDevReloadScenario } from '../tests/browser/devReloadScenario.mjs';
import { runFractureRumbleScenario } from '../tests/browser/fractureRumbleScenario.mjs';
import { runLightingScenario } from '../tests/browser/lightingScenario.mjs';
import { runSecondBoxLightsScenario } from '../tests/browser/secondBoxLightsScenario.mjs';
import { runFloorHoleScenario, capturePrivateFloorHole } from '../tests/browser/floorHoleScenario.mjs';
import { WOODEN_BOX, woodenBoxSourceTransform } from '../src/viewer/woodenBox.ts';
import { runWoodenBoxScenario } from '../tests/browser/woodenBoxScenario.mjs';
import { captureWallFaces } from '../tests/browser/wallFacesScenario.mjs';
import { runWallGameplayScenario } from '../tests/browser/wallGameplayScenario.mjs';
import { runWallRouteFrameScenario } from '../tests/browser/wallRouteFrameScenario.mjs';
import { runWallMovementScenario } from '../tests/browser/wallMovementScenario.mjs';
import { runWallRevealScenario, capturePrivateWallReveal } from '../tests/browser/wallRevealScenario.mjs';
import { runGameRestartScenario } from '../tests/browser/gameRestartScenario.mjs';
import { runGameplayAudioScenario } from '../tests/browser/gameplayAudioScenario.mjs';
import { runBoundaryVoiceScenario } from '../tests/browser/boundaryVoiceScenario.mjs';
import { runGameplayTriggerScenario } from '../tests/browser/gameplayTriggerScenario.mjs';
import { runRotationOffsetScenario } from '../tests/browser/rotationOffsetScenario.mjs';
import { runSpawnPanelScenario } from '../tests/browser/spawnPanelScenario.mjs';
import { HALLWAY_CUT } from '../src/viewer/hallwayCutPlacement.ts';
import { hallwayCutMetadata, hallwayCutPoints } from '../tests/fixtures/hallwayCutFixture.mjs';
import { runHallwayCutScenario } from '../tests/browser/hallwayCutScenario.mjs';
import { runHoleWorldTurnScenario } from '../tests/browser/holeWorldTurnScenario.mjs';
import { runOpaqueFrameScenario } from '../tests/browser/opaqueFrameScenario.mjs';
import { runVolumeFogScenario, runPrivateFogScenario } from '../tests/browser/volumeFogScenario.mjs';
import { runRoomMistScenario } from '../tests/browser/roomMistScenario.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const reportName = process.env.CHECK_REPORT_NAME ?? '';
if (!/^[a-z\d_-]*$/i.test(reportName)) throw new Error('CHECK_REPORT_NAME must be a simple folder name.');
const output = path.join(root, '.check', reportName);
await fs.mkdir(output, { recursive: true });
// CHECK_WALL_ONLY=1 runs source/wall checks; CHECK_REAL_SCAN=1 adds the private wall image.
const wallOnly = process.env.CHECK_WALL_ONLY === '1';
const startPanelOnly = process.env.CHECK_START_PANEL_ONLY === '1';
const fogOnly = process.env.CHECK_FOG_ONLY === '1';
const endingOnly = process.env.CHECK_ENDING_ONLY === '1';
const realMain = process.env.CHECK_REAL_MAIN === '1';
if(realMain&&!endingOnly)throw Error('CHECK_REAL_MAIN is supported only with CHECK_ENDING_ONLY=1.');
const collapseOnly = process.env.CHECK_COLLAPSE_ONLY === '1' || endingOnly;
const broomAudioOnly = process.env.CHECK_BROOM_AUDIO_ONLY === '1';
const boundaryVoiceOnly = process.env.CHECK_BOUNDARY_VOICE_ONLY === '1';
const audioOnly = process.env.CHECK_AUDIO_ONLY === '1';
const cutOnly = process.env.CHECK_HALLWAY_CUT_ONLY === '1' || collapseOnly || broomAudioOnly;
const privateCut = process.env.CHECK_REAL_CUT === '1';
const desktopGpu = process.env.CHECK_DESKTOP_GPU === '1';
const report = { date: new Date().toISOString(), environment: `${boundaryVoiceOnly ? 'Focused headset boundary voice checks; ' : broomAudioOnly ? 'Focused broom/tilt audio checks; ' : cutOnly ? 'Focused hallway-cutout checks; ' : startPanelOnly ? 'Focused start-panel checks; ' : wallOnly ? 'Focused wall checks; ' : ''}Desktop Chrome; ${realMain?'private original corridor':'synthetic public corridor'}${privateCut ? ' with private cutout' : ''}; ${desktopGpu ? 'desktop D3D11 requested' : 'SwiftShader'}; no XR/hardware acceptance`, checks: [], consoleErrors: [], passed: false };
let server;
let browser;
let page;
let releaseModel;
let releaseWall;
let releaseBroom;
let releaseBox;
const corePixelFogIsolations = [];
/** Geometry/light pixel probes remain separate from the dedicated fog checks. */
async function isolateCorePixels(targetPage) {
  const visible = await targetPage.evaluate(() => {
    const {hallwayFog:fog,hallwayMist:mist}=window.__debug;
    const visible={fog:fog.snapshot().visibleRequested,mist:mist.snapshot().visibleRequested};
    fog.setVisible(false);mist.setVisible(false);return visible;
  });
  corePixelFogIsolations.push({ targetPage, visible });
  report.corePixelFogIsolation = 'Fog/mist hidden only in legacy geometry/light captures; dedicated atmosphere scenarios retain the supplied effects.';
}
const check = async (name, action) => {
  const details = await action();
  report.checks.push({ name, passed: true, ...(details === undefined ? {} : { details }) });
  console.log(`PASS ${name}`);
};

async function readBoxVisibility(targetPage, meshName = 'installation-box') {
  await targetPage.waitForFunction(meshName => {
    const state = window.__debug.experience.installation.snapshot();
    return (meshName === 'installation-box' ? state.boxReveal : state.secondBox.reveal).motion === 'visible';
  }, meshName);
  const colors = await targetPage.evaluate(async meshName => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { renderer, scene, camera, splats } = window.__debug;
    const object = splats.getSplatScene(meshName === 'installation-box' ? 3 : 4);
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    splats.viewer.update(renderer, camera);
    const settle = async () => {
      let timer;
      try {
        await Promise.race([splats.viewer.sortPromise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Box visibility sort did not settle.')), 30000);
        })]);
      } finally { clearTimeout(timer); }
    };
    await settle(); splats.viewer.splatMesh.updateTransforms();
    await splats.viewer.runSplatSort(true, true); await settle();
    const point = scene.getObjectByName(meshName).getWorldPosition(new THREE.Vector3()).project(camera);
    const gl = renderer.getContext();
    const x = Math.floor((point.x + 1) * gl.drawingBufferWidth / 2);
    const y = Math.floor((point.y + 1) * gl.drawingBufferHeight / 2);
    const read = () => {
      splats.viewer.update(renderer, camera); renderer.render(scene, camera);
      const bytes = new Uint8Array(11 * 11 * 4);
      gl.readPixels(x - 5, y - 5, 11, 11, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes;
    };
    const shown = read();
    object.opacity = 0;
    const hidden = read();
    object.opacity = 1;
    read();
    return { changedChannels: shown.reduce((sum, value, i) => sum + (i % 4 !== 3 && Math.abs(value - hidden[i]) > 3 ? 1 : 0), 0),
      center: Array.from(shown.slice(60 * 4, 60 * 4 + 3)), splats: object.splatBuffer.getSplatCount() };
  }, meshName);
  assert.ok(colors.changedChannels > 10,
    `Projected box is occluded by the scan: ${JSON.stringify(colors)}`);
  return colors;
}

function woodenBoxPly() {
  const points = [], inverse = woodenBoxSourceTransform(.36, .43, .36).invert();
  for (let x = -.18; x <= .1801; x += .018) for (let z = -.18; z <= .1801; z += .018) {
    for (let y = 0; y <= .4301; y += .0215) {
      if (Math.abs(x) < .179 && Math.abs(z) < .179 && y > .001 && y < .429) continue;
      const p = new Vector3(x, y, z).applyMatrix4(inverse);
      points.push([...p.toArray(), .5 + .12 * Math.sin(y * 100), .32, .16]);
    }
  }
  return pointsPly(points, .025);
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
  // Include the fitting windows for -8 m before and after the pivoted turn.
  for (let z = -24; z <= 24; z += 0.12) {
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
      const x = -1.05 + ix * .05, y = iy * WALL_SECTION.height / 48;
      const color = stripe ? [.76, .25 + ix * .008, .31] : [.61, .20 + ix * .008, .22];
      points.push([x, y, WALL_SECTION.faceOffset, ...color]);
      points.push([-x, y, -WALL_SECTION.faceOffset, ...color]);
    }
  }
  return pointsPly(points, .045);
}

function broomPly() {
  // Public invented fixture in the supplied object's authored coordinate frame.
  const points = [], inverse = new Quaternion(...BROOM.sourceRotation).invert();
  for (let y = .02; y <= BROOM.height; y += .015) {
    const halfWidth = y < .32 ? .19 * (1 - y / .4) : .012;
    for (let x = -halfWidth; x <= halfWidth; x += .012) {
      const raw = new Vector3(x, y, 0).applyQuaternion(inverse).add(new Vector3(...BROOM.sourceBase));
      points.push([...raw.toArray(), .65, .48, .24]);
    }
  }
  return pointsPly(points, .012);
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

try {
  // Pinned Vite interprets port 0 as 5173. Ask the OS for a free nonzero
  // port first so a blocked/default user port cannot prevent isolated checks.
  const portProbe = createPortProbe();
  const checkPort = await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', () => resolve(portProbe.address().port));
  });
  await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));
  // IDE edits must not reload this isolated browser part-way through a check.
  // Keep test-only watch:null out of the development config's watch-object
  // merge, which can re-enable watching locked generated scan binaries.
  server = await createServer({ configFile: false, root,
    server: { host: '127.0.0.1', port: checkPort, strictPort: false, watch: null, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string', 'The isolated check server did not bind a TCP port.');
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  // A second Chrome XR process shares SteamVR's app key with the wearer's
  // browser. It must never discover/register with the physical runtime.
  // Chromium's explicit no-runtime selector also covers xrCompatible WebGL.
  const noHardwareXr = '--force-webxr-runtime=no-xr-runtime';
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: [desktopGpu ? '--use-angle=d3d11' : '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-automation', '--mute-audio', noHardwareXr] });
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
  if(realMain){
    const sourcePath=path.join(root,'public',ACTIVE_SCAN.plyUrl.slice(1)),metadata=await fs.stat(sourcePath);
    report.privateOriginal={asset:ACTIVE_SCAN.plyUrl,bytes:metadata.size,sha256:await sha256File(sourcePath),transport:'Local Vite stream after the startup gate'};
  }
  await page.route('**/splats/hallway3/*.ply', async route => {
    await modelGate;
    if(realMain)await route.continue();
    else await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: corridorPly() });
  });
  let wallRequests = 0;
  const wallGate = new Promise(resolve => { releaseWall = resolve; });
  await page.route('**/splats/wall-section/wall-section.ply', async route => {
    wallRequests++;
    await wallGate;
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: wallPly() });
  });
  let broomRequests = 0;
  const broomGate = new Promise(resolve => { releaseBroom = resolve; });
  const privateBroom = process.env.CHECK_REAL_BROOM === '1';
  const broomData = privateBroom ? await fs.readFile(path.join(root, 'public', BROOM.modelUrl.slice(1))) : broomPly();
  await page.route('**/splats/broooooommm.ply', async route => {
    broomRequests++; await broomGate;
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: broomData });
  });
  const boxGate = new Promise(resolve => { releaseBox = resolve; });
  const boxData = process.env.CHECK_REAL_BOX === '1'
    ? await fs.readFile(path.join(root, 'public', WOODEN_BOX.modelUrl.slice(1))) : woodenBoxPly();
  await page.route('**/splats/WoodenBox.ply', async route => {
    await boxGate;
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: boxData });
  });
  const cutMetadata = privateCut ? JSON.parse(await fs.readFile(path.join(root,'public',HALLWAY_CUT.metadataUrl.slice(1)),'utf8')) : hallwayCutMetadata;
  const cutData = privateCut ? await fs.readFile(path.join(root,'public',HALLWAY_CUT.modelUrl.slice(1))) : pointsPly(hallwayCutPoints(),.07);
  await page.route(`**${HALLWAY_CUT.metadataUrl}`, route => route.fulfill({ json: cutMetadata }));
  await page.route(`**${HALLWAY_CUT.modelUrl}`, route => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: cutData }));
  // Missing clips report on the PC; they must never create headset captions.
  await page.route('**/audio/generated/*.mp3', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>clips not generated</html>' }));
  const startupWallRequest = page.waitForRequest('**/splats/wall-section/wall-section.ply');
  const startupBroomRequest = page.waitForRequest('**/splats/broooooommm.ply');
  await page.goto(`${baseUrl}?format=ply`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__debug);
  await startupWallRequest;
  await startupBroomRequest;
  await check('loading clears an opaque white frame instead of exposing the XR environment',
    () => runOpaqueFrameScenario(page, output));
  // The public fixture uses a known corridor view for pointer/prop checks.
  // The separate actual-asset smoke below retains the production overview.
  await page.evaluate(() => {
    const { camera, controls } = window.__debug;
    camera.position.set(0, 1.6, 10);
    controls.target.set(0, 1.2, 0);
    controls.update();
  });
  await check('installation preview waits for initial scan placement to finish', async () => {
    await page.waitForFunction(() => document.getElementById('spawn-x')?.disabled);
    assert.equal(await page.locator('#spawn-y').isDisabled(), true);
    assert.equal(await page.locator('#spawn-z').isDisabled(), true);
    assert.equal(await page.locator('#experience-show-box').isDisabled(), true);
    assert.equal(await page.locator('#experience-rotate').isDisabled(), true);
    assert.equal(await page.locator('#experience-show-wall').isDisabled(), true);
    assert.equal(await page.locator('#experience-show-broom').isDisabled(), true);
    assert.equal(await page.locator('#experience-lights-out').isDisabled(), true);
    assert.equal(await page.locator('#experience-lights-brightness').isDisabled(), true);
    assert.equal(wallRequests, 1);
    assert.equal(await page.evaluate(() => window.__debug.wallBlocker.snapshot().visible), false);
    assert.equal(await page.evaluate(async () => {
      const { getSourceCenters } = await import('/src/viewer/splatViewer.ts');
      return getSourceCenters(window.__debug.splats) === undefined;
    }), true, 'Picking an unfinished source scan must return no centres without querying a missing scene.');
    assert.equal(await page.evaluate(() => window.__debug.experience.installation.snapshot().phase), 'idle');
  });
  await check('startup preloads the hidden wall before completing one shared scene build', async () => {
    const modelResponse = page.waitForResponse('**/splats/hallway3/*.ply');
    releaseModel();
    await modelResponse;
    assert.equal(await page.locator('#experience-show-box').isDisabled(), true);
    assert.equal(await page.locator('#experience-show-wall').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__debug.splats.getSceneCount()), 0,
      'The hallway was built alone while its wall was still loading.');
    await page.locator('#experience-reset').click();
    assert.equal(await page.evaluate(() => window.__debug.wallBlocker.snapshot().visible), false);
    releaseWall();
    // The third hidden object must join the same initial build as the hallway/wall.
    assert.equal(await page.locator('#experience-show-broom').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__debug.splats.getSceneCount()), 0);
    releaseBroom();
    assert.equal(await page.evaluate(() => window.__debug.splats.getSceneCount()), 0);
    releaseBox();
    await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('loaded'),undefined,{timeout:realMain?180000:15000});
    return await page.evaluate(() => {
      const { splats, wallBlocker } = window.__debug;
      const state = wallBlocker.snapshot();
      if (state.phase !== 'ready' || state.motion !== 'hidden' || state.visible || splats.getSceneCount() <= state.sceneIndex) {
        throw new Error('Both assets must finish startup with the wall hidden.');
      }
      const mesh = splats.viewer.splatMesh;
      window.__wallResources = { material: mesh.material, geometry: mesh.geometry,
        textures: mesh.splatDataTextures, worker: splats.viewer.sortWorker };
      if (!mesh.material.uniforms.uWallDimensions) throw new Error('Wall shader was not prepared during startup.');
      return { ...state, sceneCount: splats.getSceneCount(), preparedBeforeReady: true };
    });
  });
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('loaded'),undefined,{timeout:realMain?180000:15000});
  await page.waitForTimeout(1000); // allow the asynchronous splat sort to present
  await page.screenshot({ path: path.join(output, 'loaded.png'), fullPage: true, timeout: privateCut||realMain ? 60000 : 15000 });
  // Focused cutout/prop captures isolate fog from the first loaded-frame probe.
  // The default suite retains its actual-scene opacity and dedicated fog checks.
  if (cutOnly) await isolateCorePixels(page);
  await check('splat edges and calibration fades remain opaque to the compositor in an RGBA framebuffer',
    () => runOpaqueFrameScenario(page, output, true));
  await check('flipped hallway defaults to zero lateral correction', async () => {
    const original = await page.evaluate(() => {
      const { splats, experience } = window.__debug;
      splats.updateMatrix();
      return { matrix: splats.matrix.toArray(), state: experience.installation.snapshot() };
    });
    assert.equal(original.state.rotationOffsetMetres, 0);
    assert.deepEqual(original.state.rotationOffsetWorld, [0, 0, 0]);
    await page.locator('#experience-flip-alignment').evaluate(element => { element.open = true; });
    assert.equal(await page.locator('#experience-flip-offset').inputValue(), '0');
    // Continue the turn/prop checks with the actual production default.
    const after = await page.evaluate(() => {
      const { splats, experience } = window.__debug;
      splats.updateMatrix();
      return { matrix: splats.matrix.toArray(), offset: experience.installation.snapshot().rotationOffsetMetres };
    });
    assert.deepEqual(after.matrix, original.matrix);
    assert.equal(after.offset, 0);
    await page.locator('#experience-flip-alignment').evaluate(element => { element.open = false; });
    return { productionDraftMetres: 0, originalAlignmentUnchanged: true };
  });
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
      for (let i = 0; i < pixels.length; i += 16) if (765 - pixels[i] - pixels[i + 1] - pixels[i + 2] > 30) lit++;
      if (lit < 100) throw new Error(`Synthetic corridor canvas is blank (${lit} contrasting samples).`);
      return { litSamples: lit, experienceOpacity: splats.viewer.splatMesh.material.uniforms.uGlobalOpacity.value };
    });
  });
  await check('preloaded wall stays hidden and excluded from landmark and placement centres', async () => {
    assert.equal(wallRequests, 1);
    assert.equal(await page.locator('#experience-show-wall').isDisabled(), false);
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
    assert.equal(state.motion, 'hidden');
    assert.equal(state.sourceCenterLength, state.sourceSplatCount * 3);
    assert.ok(state.sourceCenterLength < state.mergedCenterLength,
      'Calibration and placement must exclude the new prop from the hallway source centres.');
    assert.equal(wallRequests, 1);
    return { ...state, requests: wallRequests, hiddenAfterStartupReset: true };
  });
  await check('development reload waits for headset exit without ending its session',()=>runDevReloadScenario(page));
  if (!audioOnly && !boundaryVoiceOnly && !cutOnly && !startPanelOnly && !wallOnly) {
    await check('mist occupies only the added hallway alongside half-height fog and follows both turn directions',
      () => runRoomMistScenario(page, output));
    await check('fixed fog retains its five-metre start in the downward hallway and remains throughout turning',
      () => runVolumeFogScenario(page, output));
  }
  if (!fogOnly && !cutOnly) await isolateCorePixels(page);
  if (audioOnly) {
    report.environment = `Focused native gameplay audio checks; ${report.environment}`;
    await check('supplied audio preserves the bed, randomized passing walkers and all speech/effect cancellation',
      () => runGameplayAudioScenario(page));
  } else if (boundaryVoiceOnly) {
    await check('only inside half-metre headset end strips play danger speech, with side/outside rejection and recovery',
      () => runBoundaryVoiceScenario(page, output));
  } else if (fogOnly) {
    if (process.env.CHECK_REAL_FOG === '1') {
      await page.evaluate(() => window.__debug.renderer.setAnimationLoop(null));
      await check('original cutout keeps fixed fog before, during and after the turn, with clear original hallway ends',
        () => runPrivateFogScenario(page, output));
    }
  } else if (cutOnly) {
    if (!collapseOnly) {
    await check('hallway cutout joins all hole corners and renders only through the aperture',
      () => runHallwayCutScenario(page, output, { privateAsset: privateCut }));
    await check('entering the hole eases the whole world horizontal with fixed viewpoint, a level floor and recovery',
      () => runHoleWorldTurnScenario(page, output, { privateAsset: privateCut }));
    await check('first upright cutout turn reveals the broom once, then proximity glitches it away after two seconds',
      () => runBroomEncounterScenario(page, output));
    }
    if (broomAudioOnly) {
      await check('supplied audio decodes, queues cleaning speech and reuses tilt sources without changing the music',
        () => runGameplayAudioScenario(page));
      await check('supplied speech captions remain on the PC through mute, queues and recovery', async () => {
        const { runVoiceCaptionScenario } = await import('../tests/browser/voiceCaptionScenario.mjs');
        return await runVoiceCaptionScenario(page);
      });
    } else {
    await check('each supplied fracture rumble uses one shared silent-tested audio context and cancels on recovery',
      () => runFractureRumbleScenario(page));
    if(endingOnly)await check('supplied final narration decodes and schedules its full duration once per game',
      () => runGameplayAudioScenario(page));
    await check(endingOnly?'actual physical return relights the damaged original world, glitches to opaque white and narrates once'
      :'completed broom glitch triggers local organic fractures and preserves the return corridor',
      () => (endingOnly?runRealityEndingScenario:runHallwayCollapseScenario)(page, output, { privateAsset: privateCut }));
    }
  } else if (startPanelOnly) {
    await check('raw start panel edits preserve the original view and survive later frames',
      () => runSpawnPanelScenario(page, output, 'idle'));
    await page.locator('#experience-test-scenario').uncheck();
    await page.locator('#experience-show-box').click();
    await page.waitForFunction(() => !document.getElementById('experience-rotate').disabled);
    await page.locator('#experience-rotate').click();
    await page.waitForFunction(() => document.getElementById('spawn-x').disabled);
    await page.waitForFunction(() => window.__debug.experience.installation.snapshot().phase === 'reversed', undefined, { timeout: 8000 });
    await check('raw start panel edits preserve the flipped view and survive later frames',
      () => runSpawnPanelScenario(page, output));
    await check('coordinate inspection rejects live XR, capture and turn edits without affecting recovery', async () => {
      const { runExperienceScenario } = await import('../tests/browser/experienceScenario.mjs');
      return await runExperienceScenario(page);
    });
  } else {
  if (!wallOnly) {
  await check('Show broom uses the scanned prop upright at world Z=6 and clears on recovery', async () => {
    const details = await runBroomScenario(page, output);
    assert.equal(broomRequests, 1);
    return { ...details, requests: broomRequests, privateBroom,
      ...(privateBroom ? { assetSha256: createHash('sha256').update(broomData).digest('hex') } : {}) };
  });
  await check('operator/system lights-out darkens RGB with unchanged alpha and restores on recovery',
    () => runLightingScenario(page, output));
  await check('floor button cuts the relocated void behind the wall endpoint, restores pixels and closes on recovery',
    () => runFloorHoleScenario(page, output));
  await check('hallway cutout joins the hole with floor toward the second box and a clipped downward passage',
    () => runHallwayCutScenario(page, output));
  await check('entering the hole eases the whole world horizontal with fixed viewpoint, a level floor and recovery',
    () => runHoleWorldTurnScenario(page, output));
  await check('first upright cutout turn reveals the broom once, then proximity glitches it away after two seconds',
    () => runBroomEncounterScenario(page, output));
  await check('each supplied fracture rumble uses one shared silent-tested audio context and cancels on recovery',
    () => runFractureRumbleScenario(page));
  await check('actual physical return relights the damaged original world, glitches to opaque white and narrates once',
    () => runRealityEndingScenario(page, output));
  }
  await check('wall rumble fades during its0.7s look-back movement and cancels on recovery',
    () => runWallMovementScenario(page, output));
  await check('Show arms an instant unseen wall and Hide preserves startup resources', async () => {
    const original = await page.evaluate(() => {
      const { splats, camera, controls, wallBlocker, experience } = window.__debug;
      const savedCamera = camera.position.toArray(), savedTarget = controls.target.toArray(), savedDamping = controls.enableDamping;
      window.__wallUpdate = wallBlocker.update;
      wallBlocker.update = () => window.__wallUpdate(0);
      controls.enableDamping = false;
      camera.position.set(0, 1.6, 5); controls.target.set(0, 1.3, -8); controls.update();
      camera.updateMatrixWorld(true); experience.update(0); splats.updateMatrixWorld(true);
      return { scan: splats.matrixWorld.toArray(), camera: savedCamera, target: savedTarget, damping: savedDamping,
        armedCamera: camera.position.toArray(), armedTarget: controls.target.toArray(),
        cameraParent: camera.parent?.uuid, scanCount: splats.viewer.getSceneCount() };
    });
    await page.locator('#experience-show-wall').click();
    const armed = await page.evaluate(() => {
      const { wallBlocker, splats, camera, controls } = window.__debug;
      return { ...wallBlocker.snapshot(), camera: camera.position.toArray(), target: controls.target.toArray(), scan: splats.matrixWorld.toArray() };
    });
    assert.deepEqual(armed.camera, original.armedCamera); assert.deepEqual(armed.target, original.armedTarget); assert.deepEqual(armed.scan, original.scan);
    assert.equal(armed.visible, false); assert.equal(armed.gameplayCue, 'waitingLookAway'); assert.equal(armed.offset, 0);
    assert.equal(await page.locator('#experience-show-wall').isDisabled(), false);
    await page.evaluate(() => {
      const { camera, controls, experience } = window.__debug;
      controls.target.set(camera.position.x, camera.position.y, camera.position.z + 5); controls.update(); camera.updateMatrixWorld(true);
      experience.update(0); window.__wallUpdate(.05);
    });
    const appeared = await page.evaluate(() => window.__debug.wallBlocker.snapshot());
    assert.equal(appeared.motion, 'visible'); assert.equal(appeared.visible, true); assert.equal(appeared.offset, 0);
    const details = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { WALL_SECTION } = await import('/src/viewer/wallSectionConfig.ts');
      const { renderer, scene, splats, wallBlocker, camera, controls } = window.__debug;
      const snapshot = wallBlocker.snapshot(), wall = splats.getSplatScene(snapshot.sceneIndex);
      wall.updateWorldMatrix(true, false);
      const edge = new THREE.Vector3(WALL_SECTION.width / 2, 0, 0).applyMatrix4(wall.matrixWorld)
        .sub(new THREE.Vector3(-WALL_SECTION.width / 2, 0, 0).applyMatrix4(wall.matrixWorld));
      const vertical = new THREE.Vector3(0, snapshot.height, 0).applyMatrix4(wall.matrixWorld)
        .sub(new THREE.Vector3().applyMatrix4(wall.matrixWorld));
      const base = new THREE.Vector3(...snapshot.baseWorld);
      camera.position.copy(base).add(new THREE.Vector3(0, 1.5, 3.8));
      controls.target.copy(base).add(new THREE.Vector3(0, snapshot.height / 2, 0)); controls.update();
      camera.updateMatrixWorld(true); scene.updateMatrixWorld(true); splats.viewer.update(renderer, camera); renderer.render(scene, camera);
      return { ...snapshot, sceneVisible: wall.visible, metricWidth: edge.length(), metricHeight: vertical.length(),
        transverseDot: edge.clone().normalize().z, uprightDot: vertical.clone().normalize().y, scale: wall.scale.toArray(),
        scan: splats.matrixWorld.toArray(), cameraParent: camera.parent?.uuid, scanCount: splats.viewer.getSceneCount() };
    });
    assert.equal(details.sceneVisible, true); assert.equal(details.offset, 0);
    assert.ok(Math.abs(details.metricWidth - details.width) < 1e-7);
    assert.ok(Math.abs(details.metricHeight - WALL_SECTION.height) < 1e-7);
    assert.ok(Math.abs(details.transverseDot) < 1e-7); assert.ok(Math.abs(details.uprightDot - 1) < 1e-7);
    assert.ok(Math.abs(details.scale[0] - details.width / WALL_SECTION.width) < 1e-7);
    assert.equal(details.scale[1], 1); assert.equal(details.scale[2], 1);
    assert.deepEqual(details.scan, original.scan); assert.equal(details.cameraParent, original.cameraParent); assert.equal(details.scanCount, original.scanCount);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(output, 'wall-blocker.png'), fullPage: true });
    const doubleFaces = await captureWallFaces(page, output);
    await page.locator('#experience-show-wall').click();
    const hidden = await page.evaluate(() => window.__debug.wallBlocker.snapshot());
    assert.equal(hidden.visible, false); assert.equal(hidden.motion, 'hidden'); assert.equal(hidden.offset, 0);
    assert.equal(await page.locator('#experience-show-wall').textContent(), 'Show wall');
    const disarmed = await page.evaluate(() => {
      const { experience, splats, wallBlocker, camera, controls } = window.__debug;
      controls.target.set(camera.position.x, camera.position.y, camera.position.z + 5); controls.update(); experience.update(0);
      wallBlocker.show(); experience.prepareForCalibration(); window.__wallUpdate(.5);
      const state = wallBlocker.snapshot(), mesh = splats.viewer.splatMesh, saved = window.__wallResources;
      return { visible: state.visible, motion: state.motion, sceneVisible: splats.getSplatScene(state.sceneIndex).visible,
        resourcesStable: mesh.material === saved.material && mesh.geometry === saved.geometry &&
          mesh.splatDataTextures === saved.textures && splats.viewer.sortWorker === saved.worker };
    });
    assert.deepEqual(disarmed, { visible: false, motion: 'hidden', sceneVisible: false, resourcesStable: true });
    await page.evaluate(original => {
      const { camera, controls, wallBlocker } = window.__debug;
      camera.position.fromArray(original.camera); controls.target.fromArray(original.target); controls.update();
      controls.enableDamping = original.damping;
      wallBlocker.update = window.__wallUpdate;
    }, original);
    assert.equal(wallRequests, 1);
    return { ...details, requests: wallRequests, watchedArming: true, instantUnseenReveal: true,
      immediateHide: true, resourcesStable: true, calibrationPreparationClearsReveal: true, doubleFaces };
  });
  await check('wall coordinates and forward/back controls preserve authored placement and shared resources', async () => {
    await page.evaluate(() => {
      const { wallBlocker, camera, controls, experience } = window.__debug;
      window.__wallCoordinateCamera = { position: camera.position.toArray(), target: controls.target.toArray(), damping: controls.enableDamping };
      window.__wallUpdate = wallBlocker.update;
      wallBlocker.update = () => window.__wallUpdate(0);
      camera.position.set(0, 1.7, 10); controls.target.set(0, 1.7, 15); controls.update(); camera.updateMatrixWorld(true);
      experience.update(0);
    });
    await page.locator('#experience-show-wall').click();
    await page.evaluate(() => window.__wallUpdate(.05));
    await page.locator('#experience-wall-settings summary').click();
    for (const [axis, value] of [['x', '.2'], ['y', '.05'], ['z', '5.5']]) {
      await page.locator(`#experience-wall-${axis}`).fill(value);
    }
    await page.locator('#experience-wall-apply').click();
    const placed = await page.evaluate(() => window.__debug.wallBlocker.snapshot());
    placed.baseWorld.forEach((value, i) => assert.ok(Math.abs(value - [.2, .05, 5.5][i]) < 1e-8));
    assert.equal(placed.placementSource, 'manual');
    await page.locator('#experience-wall-speed').fill('.1');
    await page.locator('#experience-wall-distance').fill('1');
    await page.locator('#experience-wall-forward').click();
    await page.evaluate(() => window.__wallUpdate(2));
    const forward = await page.evaluate(() => window.__debug.wallBlocker.snapshot());
    assert.ok(Math.abs(forward.baseWorld[2] - 5.7) < 1e-8);
    assert.ok(Math.abs(forward.baseWorld[1] - .05) < 1e-8);
    await page.locator('#experience-wall-stop').click();
    await page.evaluate(() => window.__wallUpdate(20));
    const stopped = await page.evaluate(() => window.__debug.wallBlocker.snapshot());
    assert.equal(stopped.travel.moving, false);
    assert.deepEqual(stopped.baseWorld, forward.baseWorld);
    await page.locator('#experience-wall-distance').fill('.4');
    await page.locator('#experience-wall-backward').click();
    await page.evaluate(() => window.__wallUpdate(4));
    const backward = await page.evaluate(() => window.__debug.wallBlocker.snapshot());
    assert.ok(Math.abs(backward.baseWorld[2] - 5.3) < 1e-8);
    assert.equal(backward.travel.moving, false);
    await page.locator('#experience-wall-speed').fill('0');
    await page.locator('#experience-wall-forward').click();
    const invalid = await page.evaluate(() => window.__debug.wallBlocker.snapshot());
    assert.equal(invalid.travel.moving, false);
    assert.deepEqual(invalid.baseWorld, backward.baseWorld);
    assert.match(invalid.error, /speed/);
    await page.locator('#experience-wall-speed').fill('.1');
    await page.locator('#experience-wall-loop').click();
    await page.evaluate(() => window.__wallUpdate(Math.PI * .4 / (.1 * 2)));
    const far = await page.evaluate(() => window.__debug.wallBlocker.snapshot());
    await page.evaluate(() => window.__wallUpdate(Math.PI * .4 / .1));
    const near = await page.evaluate(() => window.__debug.wallBlocker.snapshot());
    assert.ok(Math.abs(far.baseWorld[2] - 5.7) < 1e-8);
    assert.ok(Math.abs(near.baseWorld[2] - 4.9) < 1e-8);
    await page.locator('#experience-wall-stop').click();
    await page.locator('#experience-show-wall').click();
    await page.evaluate(() => window.__wallUpdate(.05));
    await page.locator('#experience-show-wall').click();
    await page.evaluate(() => window.__wallUpdate(.05));
    const restored = await page.evaluate(() => window.__debug.wallBlocker.snapshot());
    assert.ok(new Vector3(...restored.baseWorld).distanceTo(new Vector3(...near.baseWorld)) < 1e-8,
      'Hide/show must retain the wall anchor through scan-frame round trips.');
    await page.locator('#experience-wall-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'wall-position-motion.png'), fullPage: true });
    const reprojected = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { splats, wallBlocker, experience, camera, controls } = window.__debug;
      const position = splats.position.clone(), rotation = splats.quaternion.clone();
      const raw = new THREE.Vector3(...wallBlocker.snapshot().baseRaw);
      wallBlocker.reset();
      splats.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .5));
      splats.position.add(new THREE.Vector3(1, .1, -2)); splats.updateMatrixWorld(true);
      const expected = raw.clone().applyMatrix4(splats.matrixWorld);
      if (!wallBlocker.show()) throw new Error('A manual wall point could not follow a rigid scan fit.');
      window.__wallUpdate(2);
      const actual = wallBlocker.snapshot().baseWorld;
      if (new THREE.Vector3(...actual).distanceTo(expected) > 1e-8) throw new Error('Wall anchor did not reproject through the current scan transform.');
      wallBlocker.startTravel('forward', .4, .1); window.__wallUpdate(1);
      const delta = new THREE.Vector3(...wallBlocker.snapshot().baseWorld).sub(expected);
      if (delta.distanceTo(new THREE.Vector3(Math.sin(.5) * .1, 0, Math.cos(.5) * .1)) > 1e-6) throw new Error('Forward motion ignored the calibrated hallway heading.');
      wallBlocker.startTravel('loop', .4, .1); window.__wallUpdate(2);
      experience.prepareForCalibration(); window.__wallUpdate(100);
      const cancelled = wallBlocker.snapshot();
      if (cancelled.visible || cancelled.travel.moving || cancelled.motion !== 'hidden') throw new Error('Recovery revived wall motion.');
      splats.position.copy(position); splats.quaternion.copy(rotation); splats.updateMatrixWorld(true);
      wallBlocker.useFittedPosition();
      wallBlocker.update = window.__wallUpdate;
      const savedCamera = window.__wallCoordinateCamera;
      camera.position.fromArray(savedCamera.position); controls.target.fromArray(savedCamera.target); controls.update(); controls.enableDamping = savedCamera.damping;
      delete window.__wallCoordinateCamera;
      const mesh = splats.viewer.splatMesh, saved = window.__wallResources;
      return { delta: delta.toArray(), anchorReprojected: true, recoveryCancelled: true,
        resourcesStable: mesh.material === saved.material && mesh.geometry === saved.geometry &&
          mesh.splatDataTextures === saved.textures && splats.viewer.sortWorker === saved.worker };
    });
    assert.equal(reprojected.resourcesStable, true);
    assert.equal(wallRequests, 1);
    return { placed: placed.baseWorld, forward: forward.baseWorld, stopped: stopped.baseWorld,
      backward: backward.baseWorld, loopFar: far.baseWorld, loopNear: near.baseWorld,
      hideShowRetainsPosition: true, invalidCommandRetainsPosition: true, ...reprojected };
  });
  await check(`hallway-section entry reveals the wall unseen or after five watched seconds, with player passage`,
    () => runWallGameplayScenario(page, output));
  await check('live calibration preserves the desktop wall side and physical player clearance across XR axes',
    () => runWallRouteFrameScenario(page));
  await check('wall endpoint buttons and arrival glitch reveal the concealed hole in desktop and calibrated VR frames',
    () => runWallRevealScenario(page, output));
  if (wallOnly) {
    await check('supplied sit/classroom speech queues complete WAV takes without changing the background music',
      () => runGameplayAudioScenario(page));
    await check('headset-triggered coordinator publishes current viewer positions and actual turn completion', async () => {
      const { runTestScenarioScenario } = await import('../tests/browser/testScenarioScenario.mjs');
      return await runTestScenarioScenario(page);
    });
  }
  if (!wallOnly) {
  await check('CALIBRATE requires a running VR session and cannot queue startup', async () => {
    const prepared = await page.evaluate(() => {
      const beforeStep = window.__debug.calibration.snapshot().step;
      window.__debug.calibration.startCalibration();
      return { beforeStep, setup: window.__debug.calibration.snapshot(), experience: window.__debug.experience.installation.snapshot() };
    });
    assert.ok(['READY', 'INTERRUPTED'].includes(prepared.beforeStep));
    assert.equal(prepared.setup.step, prepared.beforeStep);
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
  await check('wooden splat rises upright from the floor and eases below it on Hide using existing resources',
    () => runWoodenBoxScenario(page, output));
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
      // Keep this miss beyond the public corridor's extended [-24,24] range.
      const p = new THREE.Vector3(-.8, 0, -40).project(camera);
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
    await page.waitForFunction(() => document.getElementById('spawn-x').disabled);
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
  await check('Show second box keeps a 10 cm wall gap at its authored station after the turn', async () => {
    const before = await page.evaluate(() => ({ scan: window.__debug.splats.matrix.toArray(),
      first: window.__debug.scene.getObjectByName('installation-box').matrixWorld.toArray(),
      prepared: window.__debug.experience.installation.snapshot().secondBox }));
    await page.locator('#experience-show-second-box').click();
    const after = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { scene, splats, experience } = window.__debug;
      const box = scene.getObjectByName('installation-second-box');
      box.updateWorldMatrix(true, false);
      const { measureWallDistances } = await import('/src/experience/hallwayCenter.ts');
      const section = experience.hallwaySection(experience.installation.snapshot().secondBox.base[2]);
      if (!section.ok) throw new Error(section.reason);
      const corners = [-.5, .5].flatMap(x => [-.5, .5].map(z =>
        new THREE.Vector3(x, -.5, z).applyMatrix4(box.matrixWorld)));
      const contact = ['left', 'right'].map(side => Math.min(...corners.map(p =>
        measureWallDistances(section.wallPlanes, p.toArray())[side])));
      return { scan: splats.matrix.toArray(), first: scene.getObjectByName('installation-box').matrixWorld.toArray(), contact,
        second: experience.installation.snapshot().secondBox, position: box.getWorldPosition(new THREE.Vector3()).toArray(),
        visible: box.visible, parentIsWorld: box.parent === splats.parent && box.parent?.name === 'hallway-world-presentation', scale: box.scale.toArray() };
    });
    assert.equal(after.visible, true);
    assert.equal(after.second.visible, true);
    assert.equal(after.parentIsWorld, true);
    assert.equal(after.second.base[2], before.prepared.base[2]);
    assert.equal(after.second.base[1], before.prepared.base[1]);
    assert.ok(Math.abs(Math.min(...after.contact) - .1) < 1e-6, 'a whole footprint edge must stay 10 cm from a current wall');
    assert.ok(after.contact.every(distance => distance >= -1e-6));
    assert.deepEqual(after.position, [after.second.base[0], after.second.base[1] + .215, after.second.base[2]]);
    assert.deepEqual(after.scale, [.36, .43, .36]);
    assert.deepEqual(after.scan, before.scan);
    assert.deepEqual(after.first, before.first);
    assert.equal(await page.locator('#experience-show-second-box').isDisabled(), true);
    const pixel = await readBoxVisibility(page, 'installation-second-box');
    await page.screenshot({ path: path.join(output, 'second-box.png'), fullPage: true });
    return { prepared: before.prepared, revealed: after.second, pixel };
  });
  await check('second-box appearance waits 6.5 seconds, anticipates flicker music by two seconds and holds 30 percent',
    () => runSecondBoxLightsScenario(page, output));
  await check('flipped-hallway controls keep the first box fixed and align other props with current walls',
    () => runRotationOffsetScenario(page, output));
  await check('raw start panel edits preserve the flipped view and survive later frames',
    () => runSpawnPanelScenario(page, output));
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
  await check('the pinned Three.js manager creates opaque classic XR layers and restores native constructors', async () => {
    const { runOpaqueLayerScenario } = await import('../tests/browser/opaqueLayerScenario.mjs');
    return await runOpaqueLayerScenario(page);
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
  await check('every fresh calibration restarts the full game with complete box narration across prior states and tracking axes',
    () => runGameRestartScenario(page));
  await check('supplied soundtrack streams all seven parts and native speech/effects queue and cancel without generated voices',
    () => runGameplayAudioScenario(page));
  await check('main gameplay hooks anticipate spin and flicker, and headset above the fitted hole triggers the third cue once',
    () => runGameplayTriggerScenario(page, output));
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
  await check('only inside half-metre headset end strips play danger speech, with side/outside rejection and recovery',
    () => runBoundaryVoiceScenario(page, output));
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
    await page.waitForFunction(() => window.__debug.experience.installation.snapshot().boxReveal.motion === 'visible');
    await page.waitForFunction(() => !document.getElementById('experience-show-box').disabled &&
      !document.getElementById('experience-rotate').disabled);
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
    assert.equal(wallMetadata.objectDimensions.depth, WALL_SECTION.depth);
    assert.equal(wallMetadata.faces.count, 2);
    assert.equal(wallMetadata.faces.sourceDepth, WALL_SECTION.sourceDepth);
    assert.equal(wallMetadata.faces.gap, WALL_SECTION.faceGap);
    assert.equal(wallMetadata.outputVertexCount, wallMetadata.sourceCropVertexCount * 2);
    assert.equal(wallMetadata.compressionLevel, 0);
    assert.equal(wallMetadata.resampled, false);
    await page.evaluate(() => window.__debug.renderer.setAnimationLoop(null));
    const realPage = await context.newPage();
    const errors = [];
    realPage.on('pageerror', error => errors.push(error.message));
    await realPage.goto(`${baseUrl}?quality=detail`, { waitUntil: 'domcontentloaded' });
    await realPage.waitForFunction(() => document.getElementById('status')?.textContent?.includes('loaded'), undefined, { timeout: 180000 });
    await isolateCorePixels(realPage);
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
    const privateFloor = await capturePrivateFloorHole(realPage, output);
    report.checks.push({ name: 'private original scan renders the floor opening into the void', passed: true, details: privateFloor });
    const privateReveal = await capturePrivateWallReveal(realPage, output);
    report.checks.push({ name: 'private original scan wall conceals the hole before glitching away at its endpoint', passed: true, details: privateReveal });
    await realPage.locator('#experience-wall-inspect-start').click({ timeout: 60000 });
    await realPage.waitForFunction(() => window.__debug.wallBlocker.snapshot().motion === 'visible', undefined, { timeout: 60000 });
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
    assert.ok(privateWall.width > .75 && privateWall.width < 4.3);
    assert.equal(privateWall.height, WALL_SECTION.height);
    assert.equal(privateWall.splatCount, wallMetadata.outputVertexCount);
    assert.equal(privateWall.sourceSplatCount, wallMetadata.sourceVertexCount);
    assert.deepEqual(errors, []);
    report.checks.push({ name: 'private extracted wall reveals across the original hallway without replacing its scan', passed: true,
      details: { ...privateWall, sourceSha256: wallMetadata.sourceSha256,
        sourceFingerprintMatched: true, compressionLevel: wallMetadata.compressionLevel } });
    const privateFaces = await captureWallFaces(realPage, output, 'private-wall');
    report.checks.push({ name: 'private wall renders the same good face outward on both full-thickness sides', passed: true, details: privateFaces });
    await realPage.locator('#experience-show-wall').click({ timeout: 60000 });
    assert.equal(await realPage.evaluate(() => window.__debug.wallBlocker.snapshot().visible), false);
    await realPage.locator('#experience-rotate').click();
    // Synthetic elapsed time on this isolated desktop smoke; no hardware run.
    await realPage.evaluate(() => window.__debug.experience.installation.update(4));
    assert.equal(await realPage.locator('#experience-show-second-box').isDisabled(), false);
    await realPage.locator('#experience-show-second-box').click();
    const privateSecond = await realPage.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { measureWallDistances } = await import('/src/experience/hallwayCenter.ts');
      const { renderer, scene, camera, controls, splats, experience } = window.__debug;
      experience.installation.update(1.5);
      const box = scene.getObjectByName('installation-second-box');
      box.updateWorldMatrix(true, false);
      const second = experience.installation.snapshot().secondBox;
      const section = experience.hallwaySection(second.base[2]);
      if (!section.ok) throw new Error(section.reason);
      const corners = [-.5, .5].flatMap(x => [-.5, .5].map(z => new THREE.Vector3(x, -.5, z).applyMatrix4(box.matrixWorld)));
      const contact = ['left', 'right'].map(side => Math.min(...corners.map(p => measureWallDistances(section.wallPlanes, p.toArray())[side])));
      camera.position.set(box.position.x + 1.2, box.position.y + 1.8, box.position.z + 4);
      controls.target.copy(box.position); controls.update();
      camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
      splats.viewer.update(renderer, camera);
      await splats.viewer.sortPromise;
      splats.viewer.splatMesh.updateTransforms();
      await splats.viewer.runSplatSort(true, true);
      renderer.render(scene, camera);
      return { ...second, contact };
    });
    assert.equal(privateSecond.visible, true);
    assert.equal(privateSecond.base[2], privateCenter.second.base[2]);
    assert.equal(privateSecond.base[1], privateCenter.second.base[1]);
    assert.ok(Math.abs(Math.min(...privateSecond.contact)) < 1e-6);
    assert.ok(privateSecond.contact.every(distance => distance >= -1e-6));
    await realPage.screenshot({ path: path.join(output, 'private-second-box.png'), fullPage: true, timeout: 60000 });
    assert.deepEqual(errors, []);
    report.checks.push({ name: 'private original scan reveals the second seat against the current rotated wall', passed: true,
      details: { prepared: privateCenter.second, revealed: privateSecond, placement: privateCenter.secondPlacement } });
    await check('private hallway crop renders downward through the fitted original-scan opening',
      () => runHallwayCutScenario(realPage, output, { privateAsset: true }));
    // Previous private captures pause the loop. Reload once to test the actual
    // entry/animation loop with both original assets, rather than a posed frame.
    await realPage.reload({ waitUntil: 'domcontentloaded' });
    await realPage.waitForFunction(() => document.getElementById('status')?.textContent?.includes('loaded'), undefined, { timeout: 180000 });
    await isolateCorePixels(realPage);
    await check('private original hallway and cutout perform the eased quarter-turn through the actual render loop',
      () => runHoleWorldTurnScenario(realPage, output, { privateAsset: true }));
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
  releaseBroom?.();
  releaseBox?.();
  for (const { targetPage, visible } of corePixelFogIsolations.reverse()) {
    if (!targetPage.isClosed()) {
      await targetPage.evaluate(visible => {window.__debug.hallwayFog.setVisible(visible.fog);window.__debug.hallwayMist.setVisible(visible.mist);}, visible).catch(() => {});
    }
  }
  await browser?.close();
  await server?.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
