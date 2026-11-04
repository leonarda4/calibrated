// Entry point: wire the viewer rig, the XR gate, the spawn picker and the
// desktop inspection controls. Keep this thin — logic lives in src/viewer,
// src/xr and src/ui.

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Matrix4, Quaternion, Vector3 } from 'three';
import {
  createViewerRig, loadScene, createSpawnMarker, getScanUrl, setScanOpacity, getSourceCenters,
} from './viewer/splatViewer';
import { setupEnterVr } from './xr/enterVR';
import { setupCalibrationCapture } from './xr/calibrationCapture';
import { makeHud } from './ui/hud';
import { bindSpawnPanel } from './ui/spawnPanel';
import { bindOperatorPanel } from './ui/operatorPanel';
import { createXrDebugOverlay, gpuRendererString } from './ui/xrDebugOverlay';
import { logger } from './debug/logger';
import { START_POINT } from './viewer/splatViewer';
import { ACTIVE_SCAN } from './viewer/scanAsset';
import { SCAN_LANDMARKS } from './calibration/landmarks';
import { setupExperience } from './experience/setupExperience';
import { setupDesktopBoundary } from './experience/setupDesktopBoundary';
import { createWallBlocker } from './viewer/wallBlocker';
import { calibratedWallRoute, createHallwayPlacementFrame } from './viewer/wallRouteFrame';
import { scanOriginForStart } from './viewer/scanPlacement';
import { bindWallControl } from './ui/wallControl';
import { createBroom } from './viewer/broom';
import { bindBroomControl } from './ui/broomControl';
import { createHallwayLighting } from './viewer/hallwayLighting';
import { createLightFlickerAudio } from './audio/lightFlicker';
import { bindLightingControl } from './ui/lightingControl';
import { createFloorHole } from './viewer/floorHole';
import { bindFloorHoleControl } from './ui/floorHoleControl';

logger.info('boot', 'app starting');

const hud = makeHud();

const { renderer, scene, camera, splats } = createViewerRig();
let scanReady = false;
const operatorPanel = bindOperatorPanel();
operatorPanel.setStatus(SCAN_LANDMARKS
  ? 'Configured A/B loaded. Match LEFT to physical A and RIGHT to physical B, then calibrate in VR.'
  : 'New scan: use EDIT A/B on the desktop to select both floor landmarks before calibration.');
const propBlockReason = (prop: string): string | null => {
  if (!scanReady) return 'Wait for the hallway scan to finish loading.';
  const state = experience.installation.snapshot();
  if (state.phase === 'stopped') return `Reset baseline and recalibrate in VR before showing the ${prop}.`;
  if (state.phase === 'rotating') return 'Wait for the hallway turn to finish.';
  if (calibration.isCapturing()) return `Finish calibration before showing the ${prop}.`;
  if (renderer.xr.isPresenting && (!state.calibrated || experience.calibrationBlockReason() !== null)) {
    return `Complete a fresh A/B calibration with visible headset tracking before showing the ${prop} in VR.`;
  }
  return null;
};
const wallBlockReason = () => propBlockReason('wall');
const broomBlockReason = () => propBlockReason('broom');
const lightingBlockReason = (): string | null => {
  if (!scanReady) return 'Wait for the hallway scan to finish loading.';
  const state = experience.installation.snapshot();
  if (state.phase === 'stopped') return 'Reset baseline and recalibrate in VR before turning the lights out.';
  if (calibration.isCapturing()) return 'Finish calibration before turning the lights out.';
  if (renderer.xr.isPresenting && (!state.calibrated || experience.calibrationBlockReason() !== null)) {
    return 'Complete a fresh A/B calibration with visible headset tracking before turning the lights out in VR.';
  }
  return null;
};
const lightFlickerAudio = createLightFlickerAudio();
const hallwayLighting = createHallwayLighting({ scanRoot: splats, blockReason: lightingBlockReason,
  onFlickerStart: () => { lightFlickerAudio.play(); }, onFlickerStop: () => lightFlickerAudio.stop() });
const lightAudioGestures = new AbortController();
const primeLightAudio = () => { void lightFlickerAudio.unlock(); };
document.addEventListener('pointerdown', primeLightAudio, { capture: true, signal: lightAudioGestures.signal });
document.addEventListener('keydown', primeLightAudio, { capture: true, signal: lightAudioGestures.signal });
window.addEventListener('pagehide', () => {
  lightAudioGestures.abort(); hallwayLighting.reset(); lightFlickerAudio.dispose();
}, { once: true });
const floorHoleBlockReason = () => propBlockReason('floor opening');
let wallPlayerPosition: readonly [number, number, number] | null = null;
const getRotationState = () => {
  const state = experience.installation.snapshot();
  return { phase: state.phase, offsetWorld: state.rotationOffsetWorld };
};
const placementFrame = createHallwayPlacementFrame(splats);
const wallBlocker = createWallBlocker({ scanRoot: splats, canShow: wallBlockReason, placementFrame,
  getPlayerPosition: () => wallPlayerPosition });
const authoredScanMatrix = new Matrix4().compose(
  new Vector3(...scanOriginForStart(ACTIVE_SCAN.startPoint, ACTIVE_SCAN.rotation)),
  new Quaternion(...ACTIVE_SCAN.rotation), new Vector3(1, 1, 1));
const broom = createBroom({ scene, scanRoot: splats, blockReason: broomBlockReason, placementFrame,
  getPivot: () => experience.installation.snapshot().config, getRotationState,
  getSourceCenters: () => getSourceCenters(splats) });
const floorHole = createFloorHole({ scanRoot: splats, getSourceCenters: () => getSourceCenters(splats),
  blockReason: floorHoleBlockReason, getRotationState, placementFrame });
const experience = setupExperience(renderer, scene, camera, splats, {
  initialRotationOffsetMetres: 0.1,
  isScanReady: () => scanReady,
  onDisarm: () => { wallBlocker.reset(); broom.reset(); floorHole.reset(); hallwayLighting.reset(); },
  onCalibrationApplied: () => {
    splats.updateWorldMatrix(true, false);
    wallBlocker.setRouteFrame(renderer.xr.isPresenting
      ? calibratedWallRoute(authoredScanMatrix, splats.matrixWorld) : undefined);
  },
  onGameplayStart: () => {
    if (!renderer.xr.isPresenting) wallBlocker.setRouteFrame();
    wallBlocker.startGameplay();
  },
  onTurnCompleted: () => wallBlocker.turnCompleted(),
  onViewerPosition: position => { wallPlayerPosition = position; },
  onScenarioCancelled: () => wallBlocker.cancelGameplay(),
});
const desktopBoundary = setupDesktopBoundary(renderer, scene, { getBox: () => {
  const state = experience.installation.snapshot();
  return state.placementSource === 'unplaced' ? undefined : state.config;
} });
const enterVr = setupEnterVr(renderer, text => operatorPanel.setStatus(text));
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

// Before Show box this is the XR origin; with a box it marks its actual turn pivot.
const spawnMarker = createSpawnMarker();
scene.add(spawnMarker);

hud.setStatus('loading hallway and objects …');
let lastLoggedPercent = 0;
loadScene(splats, (percent) => {
  // Keep asset preparation/loading progress visible to the operator.
  hud.setStatus(`loading ${getScanUrl().split('/').pop()} … ${Math.round(percent)}%`);
  if (percent - lastLoggedPercent >= 25) {           // log every 25%
    lastLoggedPercent = percent;
    logger.info('load', `scan ${Math.round(percent)}%`);
  }
})
  .then(async (url) => {
    wallBlocker.initialize();
    broom.initialize();
    floorHole.initialize();
    experience.installation.initializeVisuals();
    hallwayLighting.initialize();
    await renderer.compileAsync(scene, camera);
    scanReady = true;
    experience.scanTransformChanged();
    // Entering XR before an asset finishes loading must keep the unregistered
    // hallway hidden; the calibration reveal will make it visible after a fit.
    if (renderer.xr.isPresenting) setScanOpacity(splats, 0);
    logger.info('load', `scan loaded: ${url}`);
    hud.setStatus(`loaded ✓ (${url.split('/').pop()})`);
  })
  .catch((err: unknown) => {
    wallBlocker.loadingFailed(err);
    broom.loadingFailed(err);
    floorHole.loadingFailed(err);
    logger.error('load', 'scan load FAILED:', err);
    hud.setStatus(`load error: ${String(err)}`);
  });

// Translate the current desktop view without resetting its turn or heading.
const spawnPanel = bindSpawnPanel(point => { experience.inspectStartPoint(point); }, START_POINT);
const inspectionOrigin = new Vector3();

// Restored November 2 flow: enter VR first, then trigger/CALIBRATE starts
// the seven-second placement countdown for both controller landmarks.
// Desktop EDIT A/B picks the new export's raw-local landmark coordinates.
const calibration = setupCalibrationCapture(
  renderer, scene, camera, splats,
  (solution) => {
    experience.setCalibrationActive(false);
    experience.calibrated();
    const cm = solution.residuals.map((r) => `${(r * 100).toFixed(1)} cm`).join(', ');
    const t = solution.translation.map((v) => v.toFixed(3)).join(', ');
    hud.appendStatus(
      `calibrated ✓ yaw ${(solution.yaw * 180 / Math.PI).toFixed(2)}°, ` +
      `translation [${t}], fit error ${cm}`,
    );
  },
  (which, point) => {
    hud.appendStatus(
      `landmark ${which}: [${point.map((n) => n.toFixed(2)).join(', ')}] ` +
      `— ${ACTIVE_SCAN.id}, session selection; record for the active scan profile`,
    );
  },
  (text) => { operatorPanel.setStatus(text); },
  (editActive) => { operatorPanel.setEditActive(editActive); },
  () => { experience.prepareForCalibration(); experience.setCalibrationActive(true); },
  () => scanReady,
  () => experience.calibrationBlockReason(),
);
experience.bindCalibrationInvalidator(reason => calibration.invalidate(reason));
experience.bindCalibrationCaptureState(() => calibration.isCapturing());
const wallControl = bindWallControl(wallBlocker, wallBlockReason);
const broomControl = bindBroomControl(broom, broomBlockReason);
const lightingControl = bindLightingControl(hallwayLighting, lightingBlockReason);
const floorHoleControl = bindFloorHoleControl(floorHole, floorHoleBlockReason);
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
renderer.setAnimationLoop((_time, frame) => {
  const now = performance.now();
  const dt = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  const presenting = renderer.xr.isPresenting;
  const activeCamera = presenting ? renderer.xr.getCamera() : camera;
  controls.enabled = !presenting;
  if (!presenting) controls.update();
  spawnMarker.visible = !presenting;
  experience.update(dt, frame);
  splats.updateWorldMatrix(true, false);
  spawnPanel.refresh(scanReady ? splats.worldToLocal(inspectionOrigin.set(0, 0, 0)).toArray() : START_POINT,
    experience.canInspectStartPoint(), !presenting);
  const boxState = experience.installation.snapshot();
  const marksBoxPivot = ['box', 'rotating', 'reversed'].includes(boxState.phase);
  spawnMarker.position.set(
    marksBoxPivot ? boxState.config.centerX : 0,
    marksBoxPivot ? boxState.config.floorY : 0,
    marksBoxPivot ? boxState.config.centerZ : 0,
  );
  spawnMarker.userData.reference = marksBoxPivot ? 'box-turn-pivot' : 'xr-origin';
  wallControl.refresh();
  broomControl.refresh();
  lightingControl.refresh();
  floorHoleControl.refresh();
  desktopBoundary.update(frame);
  if (presenting) {
    enterVr.noteXrFrame(); // first-frame + watchdog accounting
    calibration.sample(dt, frame); // valid remote poses + post-fit reveal
  }
  wallBlocker.update(dt);
  broom.update();
  floorHole.update();
  hallwayLighting.observeSecondBox(scanReady && boxState.phase === 'reversed' &&
    boxState.secondBox.visible && boxState.secondBox.reveal.motion === 'visible');
  hallwayLighting.update(dt);
  splats.viewer.update(renderer, activeCamera);
  renderer.render(scene, camera);
  hud.tickFrame(presenting);
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
        `headset frames: ${s.watchdogFired ? 'waiting for headset / runtime' : 'ok'}\n` +
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

// Runtime-space telemetry is not a raw scan point or a start offset.
renderer.xr.addEventListener('sessionend', () => {
  hud.appendStatus('VR connection ended. Enter VR again while wearing the headset, then press CALIBRATE.');
  if (lastHead) {
    hud.appendStatus(
      `last head position in VR: [${lastHead.map((n) => n.toFixed(2)).join(', ')}]` +
      ' — runtime coordinates; choose scan start placement on the desktop',
    );
    lastHead = null;
  }
  hud.showOverlay();
});

// Debug hook for automated visual checks (readPixels etc.)
Object.assign(window as unknown as Record<string, unknown>, {
  __debug: { renderer, scene, camera, splats, controls, spawnMarker, experience, calibration, desktopBoundary, wallBlocker, broom, floorHole, hallwayLighting, lightFlickerAudio },
});
