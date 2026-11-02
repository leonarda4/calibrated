// Entry point: wire the viewer rig, the XR gate, the spawn picker and the
// desktop inspection controls. Keep this thin — logic lives in src/viewer,
// src/xr and src/ui.

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  createViewerRig, loadScene, applyStartPoint, createSpawnMarker, getScanUrl,
} from './viewer/splatViewer';
import { setupEnterVr } from './xr/enterVR';
import { setupCalibrationCapture } from './xr/calibrationCapture';
import { makeHud } from './ui/hud';
import { bindSpawnPanel } from './ui/spawnPanel';
import { bindOperatorPanel } from './ui/operatorPanel';
import { createXrDebugOverlay, gpuRendererString } from './ui/xrDebugOverlay';
import { logger } from './debug/logger';
import { START_POINT } from './viewer/splatViewer';

logger.info('boot', 'app starting');

const hud = makeHud();

const { renderer, scene, camera, splats } = createViewerRig();
const enterVr = setupEnterVr(renderer);
const xrDebug = createXrDebugOverlay();
const gpuInfo = xrDebug
  ? gpuRendererString(renderer.getContext() as WebGL2RenderingContext)
  : '';
let debugTick = 0;

// Desktop inspection: orbit around the spawn point with the mouse
// (left-drag rotate, wheel zoom, right-drag pan). Disabled while in XR.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;
controls.update();

// Cyan marker at the XR origin = where you will physically stand in VR.
const spawnMarker = createSpawnMarker();
scene.add(spawnMarker);

hud.setStatus('loading hallway scan …');
let lastLoggedPercent = 0;
loadScene(splats, (percent) => {
  // ultra/max parse for minutes — a live percentage prevents "stuck" looks
  hud.setStatus(`loading ${getScanUrl().split('/').pop()} … ${Math.round(percent)}%`);
  if (percent - lastLoggedPercent >= 25) {           // log every 25%
    lastLoggedPercent = percent;
    logger.info('load', `scan ${Math.round(percent)}%`);
  }
})
  .then((url) => { logger.info('load', `scan loaded: ${url}`); hud.setStatus(`loaded ✓ (${url.split('/').pop()})`); })
  .catch((err: unknown) => { logger.error('load', 'scan load FAILED:', err); hud.setStatus(`load error: ${String(err)}`); });

// Operator panel: shift the map around the player, live, before entering VR.
// Prefilled with the committed START_POINT so the UI mirrors the constant.
bindSpawnPanel((point) => applyStartPoint(splats, point), START_POINT);

// PC operator panel: drives the calibration from the flat page while the
// person in the headset (Link route) only places the remotes.
const operatorPanel = bindOperatorPanel();

// Placement-only calibration: predefined landmarks, remotes as probes.
// Desktop clicks on the scan pick landmark coordinates (copy into
// src/calibration/landmarks.ts).
const calibration = setupCalibrationCapture(
  renderer, scene, camera, splats,
  (solution) => {
    const cm = solution.residuals.map((r) => `${(r * 100).toFixed(1)} cm`).join(', ');
    const t = solution.translation.map((v) => v.toFixed(3)).join(', ');
    hud.appendStatus(
      `calibrated ✓ yaw ${(solution.yaw * 180 / Math.PI).toFixed(2)}°, ` +
      `translation [${t}], fit error ${cm}`,
    );
    const panel = document.getElementById('spawn-panel');
    if (panel) panel.style.display = 'none';
  },
  (which, point) => {
    hud.appendStatus(
      `landmark ${which}: [${point.map((n) => n.toFixed(2)).join(', ')}] ` +
      '→ copy into src/calibration/landmarks.ts',
    );
  },
  (text) => { operatorPanel.setStatus(text); },
  (editActive) => { operatorPanel.setEditActive(editActive); },
);
operatorPanel.onCalibrateClick(() => calibration.startCalibration());
operatorPanel.onEditClick(() => {
  // toggle via the module (it owns the state and reports it back)
  const active = !document.getElementById('calib-edit')?.classList.contains('active');
  calibration.setLandmarkEdit(active);
});

// Render loop — works on desktop and inside XR (three switches cameras).
// Explicit splats.viewer.update() keeps the projection uniforms current
// (the library's callback-mesh path missed frames → black screen).
let lastHead: [number, number, number] | null = null;
let headY: number | null = null;
let headLogAt = 0;
let lastTime = performance.now();
let fpsWindowStart = lastTime;
let fpsFrames = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05); // clamp gaps (tab throttling)
  lastTime = now;
  const presenting = renderer.xr.isPresenting;
  const activeCamera = presenting ? renderer.xr.getCamera() : camera;
  controls.enabled = !presenting;
  splats.viewer.update(renderer, activeCamera);
  controls.update();
  renderer.render(scene, camera);
  hud.tickFrame(presenting);
  spawnMarker.visible = !presenting;
  if (presenting) enterVr.noteXrFrame(); // first-frame + watchdog accounting
  // periodic fps sample in the console (every 5 s)
  fpsFrames++;
  if (now - fpsWindowStart >= 5000) {
    const fps = (fpsFrames * 1000) / (now - fpsWindowStart);
    logger.debug('fps', `${fps.toFixed(1)} fps (${presenting ? 'XR presenting' : 'flat view'})`);
    fpsWindowStart = now;
    fpsFrames = 0;
  }
  // ?xrDebug=1 overlay (PC operator view): GPU, layer path, frame counts
  if (xrDebug) {
    debugTick += dt;
    if (debugTick >= 0.5) {
      debugTick = 0;
      const s = enterVr.stats();
      xrDebug.update(
        `gpu: ${gpuInfo}\n` +
        `layer path: ${s.path}\n` +
        `presenting: ${s.presenting ? 'yes' : 'no'}\n` +
        `frames: ${s.frames}\n` +
        `first frame: ${s.firstFrameSeconds !== null ? s.firstFrameSeconds.toFixed(2) + 's' : '—'}\n` +
        `watchdog: ${s.watchdogFired ? 'NO XR FRAMES!' : 'ok'}\n` +
        `head y: ${headY !== null ? headY.toFixed(2) + ' m' : '—'}`);
    }
  }
  if (presenting) {
    const p = activeCamera.position;
    lastHead = [p.x, p.y, p.z]; // still recorded: useful when there IS room to walk
    // head-height telemetry: with a correct floor calibration the head sits
    // at ~1.5–1.8 m; near 0.0 m means the runtime's floor is at eye height
    // (fix in SteamVR Room Setup), and the world appears "floor at head".
    headY = p.y;
    headLogAt += dt;
    if (headLogAt >= 2) {
      headLogAt = 0;
      logger.debug('xr-head', `head y=${p.y.toFixed(2)} m (floor-calibration check)`);
    }
  }
});

// After leaving VR: print the last head position so it can be copied into
// START_POINT in src/viewer/splatViewer.ts (persist across sessions).
renderer.xr.addEventListener('sessionend', () => {
  if (lastHead) {
    hud.appendStatus(
      `last head position in VR: [${lastHead.map((n) => n.toFixed(2)).join(', ')}]` +
      ' — copy into START_POINT to spawn here',
    );
    lastHead = null;
  }
  hud.showOverlay();
});

// Debug hook for automated visual checks (readPixels etc.)
Object.assign(window as unknown as Record<string, unknown>, {
  __debug: { renderer, scene, camera, splats, controls, spawnMarker },
});