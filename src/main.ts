// Entry point: wire the viewer rig, the XR gate, the spawn picker and the
// desktop inspection controls. Keep this thin — logic lives in src/viewer,
// src/xr and src/ui.

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Matrix4, Quaternion, Vector3, type ShaderMaterial } from 'three';
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
import { createHallwayCut } from './viewer/hallwayCut';
import { bindFloorHoleControl } from './ui/floorHoleControl';
import { createWallMovementAudio } from './audio/wallMovement';
import { GAMEPLAY_TIMING } from './experience/gameplayTiming';
import { createHoleTransition, headsetAboveHole, headsetClearOfHole } from './experience/holeTransition';
import { HoleWorldRotation } from './experience/holeWorldRotation';
import { BroomEncounter } from './experience/broomEncounter';
import { HallwayCollapse } from './experience/hallwayCollapse';
import { RealityEnding } from './experience/realityEnding';
import { createRealityEndingEffects } from './effects/realityEndingEffects';
import { createFractureRumble } from './audio/fractureRumble';
import { HolePortalCrossing } from './experience/holePortalCrossing';
import { createWorldPresentation } from './viewer/worldPresentation';
import { createVolumeFog } from './effects/volumeFog';
import { createRoomMist } from './effects/roomMist';
import { bindMistControl } from './ui/mistControl';
import { createFractureBursts } from './effects/fractureBursts';
import { prepareCutoutDisintegration } from './effects/cutoutDisintegration';
import { writeDestructionUniforms } from './effects/collapseDamage';
import { cutOpeningFromMetadata } from './viewer/hallwayCutPlacement';

logger.info('boot', 'app starting');

const hud = makeHud();

const { renderer, scene, camera, splats } = createViewerRig();
const showWorldGuides = new URLSearchParams(window.location.search).get('worldGuides') === '1';
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
const worldEditBlockReason = () => ['turning','complete','returning','original'].includes(holeWorldRotation.snapshot().phase)
  ? 'Reset baseline before changing props after the hallway transition.' : null;
const wallBlockReason = () => worldEditBlockReason() ?? propBlockReason('wall');
const broomBlockReason = () => worldEditBlockReason() ?? propBlockReason('broom');
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
const wallMovementAudio = createWallMovementAudio();
let audioMuted = false;
let resetBoundaryVoice = () => {};
const hallwayLighting = createHallwayLighting({ scanRoot: splats, blockReason: lightingBlockReason,
  secondBoxDelaySeconds: GAMEPLAY_TIMING.flickerDelaySeconds, anticipationSeconds: GAMEPLAY_TIMING.flickerLeadSeconds,
  onFlickerAnticipate: () => { experience.gameplayAudio.transition(2); },
  onFlickerStart: () => { if (!audioMuted) lightFlickerAudio.play(); }, onFlickerStop: () => lightFlickerAudio.stop() });
const lightAudioGestures = new AbortController();
const primeLightAudio = () => { void lightFlickerAudio.unlock(); void wallMovementAudio.unlock(); };
document.addEventListener('pointerdown', primeLightAudio, { capture: true, signal: lightAudioGestures.signal });
document.addEventListener('keydown', primeLightAudio, { capture: true, signal: lightAudioGestures.signal });
window.addEventListener('pagehide', () => {
  lightAudioGestures.abort(); experience.dispose(); hallwayLighting.reset(); lightFlickerAudio.dispose(); wallMovementAudio.dispose();
}, { once: true });
const floorHoleBlockReason = () => worldEditBlockReason() ?? propBlockReason('floor opening');
let wallPlayerPosition: readonly [number, number, number] | null = null;
let wallPlayerForward: readonly [number, number, number] | null = null;
const getRotationState = () => {
  const state = experience.installation.snapshot();
  return { phase: state.phase, offsetWorld: state.rotationOffsetWorld };
};
const placementFrame = createHallwayPlacementFrame(splats);
const wallBlocker = createWallBlocker({ scanRoot: splats, canShow: wallBlockReason, placementFrame,
  getPlayerPosition: () => wallPlayerPosition,
  getPlayerForward: () => wallPlayerForward,
  getTargetPosition: () => {
    const state = experience.installation.snapshot();
    if (state.placementSource === 'unplaced') return null;
    const box = state.config;
    return [box.centerX, box.floorY, box.centerZ];
  },
  getRevealReady: () => {
    const state = experience.installation.snapshot();
    return state.phase === 'reversed' && state.boxGlitch.phase === 'hidden';
  },
  onPrepareHole: placement => floorHole.prepareBehindWall(placement),
  getPreparedHole: () => {
    const hole = floorHole.snapshot();
    return hole.prepared && hole.cornersRoute ? { cornersRoute: hole.cornersRoute } : null;
  },
  onRevealHole: () => floorHole.revealPrepared(true),
  onArrived: () => floorHole.showBehindWall(wallBlocker.arrivalPlacement()),
  onAppeared: () => { experience.wallAppeared(); },
  onSequenceCancelled: () => { floorHole.reset(); experience.cancelWallPrompts(); } });
const authoredScanMatrix = new Matrix4().compose(
  new Vector3(...scanOriginForStart(ACTIVE_SCAN.startPoint, ACTIVE_SCAN.rotation)),
  new Quaternion(...ACTIVE_SCAN.rotation), new Vector3(1, 1, 1));
const broom = createBroom({ scene, scanRoot: splats, blockReason: broomBlockReason, placementFrame,
  onReveal: () => experience.gameplayAudio.speech('cleanRoom'),
  getPivot: () => experience.installation.snapshot().config, getRotationState,
  getSourceCenters: () => getSourceCenters(splats) });
const floorHole = createFloorHole({ scanRoot: splats, getSourceCenters: () => getSourceCenters(splats),
  blockReason: floorHoleBlockReason, getRotationState, placementFrame,
  onChange: () => { if (!floorHole.snapshot().open) resetHoleTurn(); hallwayCut.update(); },
  getWallArrival: () => wallBlocker.arrivalPlacement() });
const hallwayCut = createHallwayCut({ scanRoot: splats, getHole: () => floorHole.snapshot(),
  getSecondBoxRoute: () => {
    const box = experience.installation.snapshot().secondBox;
    return box.placed && box.base ? placementFrame.routePoint(new Vector3(...box.base)).toArray() : null;
  } });
const holeWorldRotation = new HoleWorldRotation();
const broomEncounter = new BroomEncounter();
const hallwayCollapse = new HallwayCollapse();
const realityEnding = new RealityEnding();
let fractureRumble: ReturnType<typeof createFractureRumble> | null = null;
let collapsePending = false;
let destructionMask = hallwayCollapse.snapshot().mask;
const holePortalCrossing = new HolePortalCrossing();
let repeatHoleEntryArmed = false;
const worldPresentation = createWorldPresentation(scene, splats);
worldPresentation.attach(splats);
const realityEndingEffects = createRealityEndingEffects({scanRoot:splats,getCenters:()=>getSourceCenters(splats),
  setEnvironmentVisible:visible=>worldPresentation.setVisible(visible)});
const hallwayCollapseEffects = createFractureBursts({ scene, scanRoot: splats });
worldPresentation.attach(hallwayCollapseEffects.root);
window.addEventListener('pagehide', () => hallwayCollapseEffects.dispose(), { once: true });
const syncDestructionMask = () => {
  destructionMask = hallwayCollapse.snapshot().mask;
  const uniforms = (splats.viewer?.splatMesh?.material as ShaderMaterial | undefined)?.uniforms;
  if (uniforms?.uCutoutDestruction) writeDestructionUniforms(uniforms, destructionMask);
};
const resetHallwayCollapse = (rearm = false) => {
  collapsePending = false;
  if (rearm) hallwayCollapse.reset();
  else if (hallwayCollapse.snapshot().phase !== 'idle') hallwayCollapse.cancel();
  if (rearm) fractureRumble?.reset(); else fractureRumble?.stop();
  hallwayCollapseEffects.reset(); syncDestructionMask();
};
const resetRealityEnding = (rearm=false) => {
  if(rearm) realityEnding.reset();
  else if(realityEnding.snapshot().phase!=='idle') realityEnding.cancel();
  realityEndingEffects.reset();hallwayLighting.setPresentationBrightness(null);lightFlickerAudio.stop();
};
const resetHoleTurn = () => {
  experience.gameplayAudio.setRoomTilting(false);
  resetRealityEnding();
  resetHallwayCollapse();
  if (broomEncounter.snapshot().phase !== 'idle') {
    broomEncounter.cancel();
    if (broom.snapshot().mode === 'cutout') broom.reset();
  }
  worldPresentation.reset(); holeWorldRotation.reset(); holePortalCrossing.reset(); repeatHoleEntryArmed = false;
  holeTransition.reset();
};
const holeTransition = createHoleTransition({ leadSeconds: GAMEPLAY_TIMING.holeLeadSeconds,
  onAnticipate: () => {
    if (holeWorldRotation.snapshot().phase === 'idle') experience.gameplayAudio.transition(3);
  },
  onTransition: () => {
    if (holeWorldRotation.snapshot().phase === 'original') {
      if (!holeWorldRotation.rotateIntoCutout()) holeWorldRotation.cancel();
      return;
    }
    const floorSide = hallwayCut.snapshot().floorSide;
    if ((floorSide !== 'start' && floorSide !== 'end') || !holeWorldRotation.start({ ...floorHole.snapshot(), floorSide })) holeWorldRotation.cancel();
  } });
const experience = setupExperience(renderer, scene, camera, splats, {
  placementFrame,
  authoringBlockReason: worldEditBlockReason,
  isScanReady: () => scanReady,
  onDisarm: () => { resetBoundaryVoice(); resetHoleTurn(); resetRealityEnding(true); resetHallwayCollapse(true); broomEncounter.reset(); wallBlocker.reset(); wallMovementAudio.stop(); broom.reset(); floorHole.reset(); hallwayLighting.reset(); },
  onAudioMuted: muted => { audioMuted = muted; if (muted) { resetBoundaryVoice(); wallMovementAudio.stop(); lightFlickerAudio.stop(); fractureRumble?.stop(); } },
  onCalibrationApplied: () => {
    splats.updateWorldMatrix(true, false);
    wallBlocker.setRouteFrame(renderer.xr.isPresenting
      ? calibratedWallRoute(authoredScanMatrix, splats.matrixWorld) : undefined);
  },
  onGameplayStart: () => {
    if (!renderer.xr.isPresenting) wallBlocker.setRouteFrame();
    wallBlocker.startGameplay({ resetPlacement: true });
  },
  onTurnCompleted: () => wallBlocker.turnCompleted(),
  onSecondBoxTriggered: () => { wallBlocker.triggerSecondBox(); },
  onViewerPosition: (position, forward) => { wallPlayerPosition = position; wallPlayerForward = forward ?? null; },
  onScenarioCancelled: () => { resetHoleTurn(); wallBlocker.cancelGameplay(); hallwayLighting.reset(); lightFlickerAudio.stop(); },
});
fractureRumble = createFractureRumble({ getAudioBus: () => experience.gameplayAudio.getEffectBus() });
window.addEventListener('pagehide', () => fractureRumble?.dispose(), { once: true });
const desktopBoundary = setupDesktopBoundary(renderer, scene, { showWorldGuides, getBox: () => {
  const state = experience.installation.snapshot();
  return state.placementSource === 'unplaced' ? undefined : state.config;
}, onWarning: () => experience.gameplayAudio.warnDanger(),
  onWarningCancelled: () => experience.gameplayAudio.cancelDangerWarning(),
  isWarningEnabled: () => !audioMuted && experience.installation.snapshot().phase !== 'stopped' });
resetBoundaryVoice = desktopBoundary.resetWarning;
const effectQuery = new URLSearchParams(window.location.search);
const hallwayFog = createVolumeFog({ scene, scanRoot: splats,
  getDestruction: () => destructionMask,
  enabled: effectQuery.get('fx') !== '0' && effectQuery.get('fog') !== 'off',
  canRender: () => scanReady && experience.installation.snapshot().phase !== 'stopped' &&
    (!renderer.xr.isPresenting || (experience.installation.snapshot().calibrated && experience.calibrationBlockReason() === null)),
  getHole: () => floorHole.snapshot(),
  getSecondBoxRoute: () => {
    const box = experience.installation.snapshot().secondBox;
    return box.placed && box.base ? placementFrame.routePoint(new Vector3(...box.base)).toArray() : null;
  },
});
worldPresentation.attach(hallwayFog.root);
window.addEventListener('pagehide', () => hallwayFog.dispose(), {once:true});
const hallwayMist = createRoomMist({ scene, scanRoot: splats,
  getHole: () => floorHole.snapshot(),getDestruction: () => destructionMask,
  getSecondBoxRoute: () => {
    const box=experience.installation.snapshot().secondBox;
    return box.placed&&box.base?placementFrame.routePoint(new Vector3(...box.base)).toArray():null;
  },
  enabled: effectQuery.get('fx') !== '0' && effectQuery.get('mist') !== '0',
  canRender: () => scanReady && experience.installation.snapshot().phase !== 'stopped' &&
    (!renderer.xr.isPresenting || (experience.installation.snapshot().calibrated && experience.calibrationBlockReason() === null)),
});
worldPresentation.attach(hallwayMist.root);
window.addEventListener('pagehide', () => hallwayMist.dispose(), {once:true});
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
for (const name of ['installation-fixed-props', 'installation-second-box', 'broom-world-anchor']) {
  const content = scene.getObjectByName(name);
  if (!content) throw new Error(`Missing environment content for the hallway turn: ${name}`);
  worldPresentation.attach(content);
}
worldPresentation.attach(spawnMarker);

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
    hallwayCut.initialize();
    prepareCutoutDisintegration(splats.viewer.splatMesh.material as ShaderMaterial);
    realityEndingEffects.initialize();
    floorHole.initialize();
    experience.installation.initializeVisuals();
    hallwayLighting.initialize();
    await Promise.all([hallwayFog.initialize(), hallwayMist.initialize(), hallwayCollapseEffects.initialize(), fractureRumble?.prepare()]);
    if (hallwayFog.snapshot().error) logger.info('fog', hallwayFog.snapshot().error!);
    if (hallwayMist.snapshot().error) logger.info('mist', hallwayMist.snapshot().error!);
    if (hallwayCollapseEffects.snapshot().error) logger.info('fracture', hallwayCollapseEffects.snapshot().error!);
    await hallwayFog.warmup(renderer, camera);
    await hallwayMist.warmup(renderer, camera);
    await hallwayCollapseEffects.warmup(renderer, camera);
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
  { showWorldGuides },
);
experience.bindCalibrationInvalidator(reason => calibration.invalidate(reason));
experience.bindCalibrationCaptureState(() => calibration.isCapturing());
const wallControl = bindWallControl(wallBlocker, wallBlockReason);
const broomControl = bindBroomControl(broom, broomBlockReason, () => {
  if (broom.snapshot().mode === 'cutout') { broomEncounter.cancel(); broom.reset(); return true; }
  return broom.toggle();
});
const lightingControl = bindLightingControl(hallwayLighting, lightingBlockReason);
const mistControl = bindMistControl(hallwayMist);
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
  worldPresentation.beginFrame();
  const now = performance.now();
  const dt = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  const presenting = renderer.xr.isPresenting;
  const activeCamera = presenting ? renderer.xr.getCamera() : camera;
  controls.enabled = !presenting;
  if (!presenting) controls.update();
  spawnMarker.visible = showWorldGuides && !presenting;
  experience.update(dt, frame);
  splats.updateWorldMatrix(true, false);
  spawnPanel.refresh(scanReady ? splats.worldToLocal(inspectionOrigin.set(0, 0, 0)).toArray() : START_POINT,
    experience.canInspectStartPoint() && worldEditBlockReason() === null, !presenting);
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
  mistControl.refresh();
  floorHoleControl.refresh();
  desktopBoundary.update(frame);
  if (presenting) {
    enterVr.noteXrFrame(); // first-frame + watchdog accounting
    calibration.sample(dt, frame); // valid remote poses + post-fit reveal
  }
  wallBlocker.update(dt);
  const wallMotion = wallBlocker.snapshot();
  wallMovementAudio.setMoving(!audioMuted && wallMotion.moving, wallMotion.gaze.stopInSeconds ?? undefined);
  floorHole.update(dt);
  hallwayCut.update();
  hallwayLighting.observeSecondBox(scanReady && boxState.phase === 'reversed' &&
    boxState.secondBox.visible && boxState.secondBox.reveal.motion === 'visible');
  hallwayLighting.update(dt);
  hallwayFog.update(dt);
  hallwayMist.update(dt);
  const musicState = experience.gameplayAudio.snapshot();
  const holeState = floorHole.snapshot();
  const capturedHole = holeWorldRotation.geometry();
  const entryHole = capturedHole ?? holeState;
  const holePosition = wallPlayerPosition ? new Vector3(...wallPlayerPosition)
    .applyMatrix4(new Matrix4().fromArray(entryHole.routeToWorld).invert()).toArray() : null;
  const holeMusicReady = !musicState.running || (musicState.lastTransition >= 2 && musicState.transition !== 2);
  const holeEligible = holeMusicReady && propBlockReason('floor opening') === null && wallPlayerPosition !== null &&
    wallPlayerForward !== null && [...wallPlayerPosition, ...wallPlayerForward].every(Number.isFinite) &&
    holeState.open && hallwayCut.snapshot().visible;
  const previousHoleTurn = holeWorldRotation.snapshot();
  const previousHoleTurnPhase = previousHoleTurn.phase;
  const endingOwnsReturn = realityEnding.snapshot().originalDamage;
  if (previousHoleTurnPhase === 'original' && !endingOwnsReturn && holeEligible && headsetClearOfHole(holePosition, entryHole)) repeatHoleEntryArmed = true;
  if (previousHoleTurnPhase === 'idle' || (previousHoleTurnPhase === 'original' && !endingOwnsReturn)) {
    holeTransition.update(dt, holeEligible, (previousHoleTurnPhase === 'idle' || repeatHoleEntryArmed) && headsetAboveHole(holePosition, entryHole));
  }
  if (previousHoleTurnPhase === 'complete' && holePortalCrossing.update({ position: wallPlayerPosition, deltaSeconds: dt, eligible: holeEligible })) {
    holeWorldRotation.returnToOriginal();
  }
  // A newly started leg takes its first animation step on the following frame.
  if (previousHoleTurnPhase !== 'idle' && previousHoleTurnPhase === holeWorldRotation.snapshot().phase) holeWorldRotation.update(dt, holeEligible);
  const holeTurn = holeWorldRotation.snapshot();
  experience.gameplayAudio.setRoomTilting(!audioMuted && holeEligible && Number.isFinite(dt) && dt > 0 && dt <= .5 &&
    (holeTurn.phase === 'turning' || holeTurn.phase === 'returning' ||
      (previousHoleTurnPhase === 'turning' && holeTurn.phase === 'complete') ||
      (previousHoleTurnPhase === 'returning' && holeTurn.phase === 'original')) &&
    Math.abs(holeTurn.angleDegrees - previousHoleTurn.angleDegrees) > 1e-10);
  let broomJustArmed = false;
  if (holeTurn.phase === 'complete' && previousHoleTurnPhase !== 'complete') {
    const geometry = holeWorldRotation.geometry();
    if (!geometry || !holePortalCrossing.capture(geometry, holeWorldRotation.matrix())) holeWorldRotation.cancel();
    else if (broomEncounter.snapshot().phase === 'idle') broomJustArmed = broomEncounter.arm(geometry, holeWorldRotation.matrix());
  } else if (holeTurn.phase !== 'complete') holePortalCrossing.clearSamples();
  if (holeTurn.phase === 'original' && previousHoleTurnPhase !== 'original') {
    repeatHoleEntryArmed = false; holeTransition.reset();
  }
  const worldPhase = holeWorldRotation.snapshot().phase;
  const previousBroomPhase = broomEncounter.snapshot().phase;
  if (!broomJustArmed) broomEncounter.update(dt, holeEligible && !['idle', 'cancelled'].includes(worldPhase),
    wallPlayerPosition, worldPhase === 'complete');
  const encounterState = broomEncounter.snapshot();
  if (previousBroomPhase === 'glitchingOut' && encounterState.phase === 'complete') collapsePending = true;
  let collapseJustArmed = false;
  if (collapsePending && worldPhase === 'complete' && wallPlayerPosition && hallwayCollapseEffects.snapshot().phase === 'ready') {
    const geometry = holeWorldRotation.geometry();
    if (geometry) collapseJustArmed = hallwayCollapse.arm(geometry, holeWorldRotation.matrix(),
      cutOpeningFromMetadata(splats.userData.hallwayCutMetadata), hallwayCollapseEffects.snapshot().farDepth, wallPlayerPosition,
      { seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    collapsePending = false;
  }
  let boundaryPoints = null;
  if (hallwayCollapse.snapshot().active) {
    try {
      const physicalBounds = desktopBoundary.snapshot();
      boundaryPoints = presenting && physicalBounds.runtime.live ? physicalBounds.runtime.points
        : physicalBounds.manual.visible ? physicalBounds.manual.points : null;
    } catch { /* Optional diagnostics cannot gate a protected collapse or fog rendering. */ }
  }
  hallwayCollapse.update({ dt: collapseJustArmed ? 0 : dt, eligible: holeEligible && !['idle', 'cancelled'].includes(worldPhase),
    upright: worldPhase === 'complete', positionWorld: wallPlayerPosition, presentation: holeWorldRotation.matrix(), boundaryPoints });
  syncDestructionMask();
  hallwayCollapseEffects.update(hallwayCollapse, worldPhase === 'complete');
  const collapseAudioState = hallwayCollapse.snapshot();
  fractureRumble?.update(collapseAudioState.blasts, collapseAudioState.active && worldPhase === 'complete' && !audioMuted);
  const beforeEnding = realityEnding.snapshot();
  realityEnding.update({dt,eligible:holeEligible&&!['idle','cancelled'].includes(worldPhase),worldPhase,
    // A distant effect suppressed by its protection guard still owns its ending.
    collapseStarted:!['idle','cancelled'].includes(collapseAudioState.phase),brightness:hallwayLighting.snapshot().brightness});
  const ending = realityEnding.snapshot();
  if(ending.originalDamage&&!realityEndingEffects.snapshot().rawToRoute&&capturedHole&&wallPlayerPosition){
    const inversePresentation=holeWorldRotation.matrix().clone().invert();
    realityEndingEffects.arm({routeToWorld:capturedHole.routeToWorld,
      positionWorld:new Vector3(...wallPlayerPosition).applyMatrix4(inversePresentation).toArray(),
      openingRange:[capturedHole.startZ,capturedHole.endZ],seed:collapseAudioState.seed,
      boundaryPoints:boundaryPoints?.map(p=>new Vector3(...p).applyMatrix4(inversePresentation).toArray())});
  }
  hallwayLighting.setPresentationBrightness(ending.brightness);
  realityEndingEffects.update(ending,worldPhase==='original'?wallPlayerPosition:null);
  if(ending.returnedCount>beforeEnding.returnedCount || (ending.phase==='glitching'&&beforeEnding.phase!=='glitching')){
    if(!audioMuted) lightFlickerAudio.play();
  }
  if(ending.narrationCount>beforeEnding.narrationCount){
    resetBoundaryVoice();wallMovementAudio.stop();fractureRumble?.stop();
    experience.gameplayAudio.finishReality();
  }
  if (encounterState.canonicalMatrix && !['idle', 'cancelled'].includes(worldPhase)) {
    if (!broom.presentEncounter(encounterState)) { broomEncounter.cancel(); broom.reset(); }
  } else if (broom.snapshot().mode === 'cutout') broom.reset();
  broom.update();
  if (['turning','complete','returning'].includes(holeWorldRotation.snapshot().phase)) worldPresentation.apply(holeWorldRotation.matrix());
  floorHoleControl.setTransitionStatus(holeTransition.snapshot().phase, holeTransition.snapshot().remainingSeconds, holeWorldRotation.snapshot(),ending);
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
  __debug: { renderer, scene, camera, splats, controls, spawnMarker, experience, calibration, desktopBoundary, wallBlocker, broom, broomEncounter, hallwayCollapse, hallwayCollapseEffects, realityEnding, realityEndingEffects, fractureRumble, floorHole, hallwayCut, holeTransition, holeWorldRotation, holePortalCrossing, worldPresentation, hallwayLighting, hallwayFog, hallwayMist, lightFlickerAudio, wallMovementAudio },
});
