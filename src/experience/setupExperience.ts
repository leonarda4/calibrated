import * as THREE from 'three';
import { createInstallation } from './installation.ts';
import { setupPlacementPicker } from './placementPicker.ts';
import { bindExperiencePanel } from '../ui/experiencePanel.ts';
import { createExperienceHud } from '../ui/experienceHud.ts';
import { bindVoicePanel } from '../ui/voicePanel.ts';
import { createVoiceGuide } from '../audio/voiceGuide.ts';
import { setupTrackedHands } from '../xr/hands.ts';
import { logger } from '../debug/logger.ts';
import { estimateHallwayCenter, measureWallDistances } from './hallwayCenter.ts';
import { placeWallAdjacentBox } from './secondBoxPlacement.ts';
import { setupFloorLinePicker } from './floorLinePicker.ts';
import { getSourceCenters } from '../viewer/splatViewer.ts';
import { createTestScenario } from './testScenario.ts';
import { SCENARIO_VOICE_CUES } from '../audio/voiceCues.ts';

type ScanRoot = THREE.Object3D & { viewer: { splatMesh: unknown } };

// Approximate raw floor station visible in the supplied desktop screenshot.
const BOX_STATION_RAW = [2, 21.1, -1.45] as const;
// Same local-floor plane as the calibration grid and cyan origin marker.
const FLOOR_Y = 0;
const SECOND_BOX_GUIDE_RAW = [2.8, 23.3, -1.45] as const;
// A dark transverse band in the original floor splats supports this draft
// guide. A desktop click can refine it; it is not a surveyed physical line.
const SECOND_FLOOR_LINE_RAW = [2.8, 22.99, -1.45] as const;

/** Keep device/lifecycle orchestration out of both sequence math and main.ts. */
export function setupExperience(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, scanRoot: ScanRoot, options: { isScanReady?(): boolean; onDisarm?(): void } = {}) {
  const hud = createExperienceHud(camera);
  let reportAudio = (_text: string) => {};
  let reportCaption = (_text: string) => {};
  let reportHands = (_text: string) => {};
  let invalidateCalibration = (_reason: string) => {};
  let calibrationActive = false;
  let captureInProgress = () => false;
  const voices = createVoiceGuide({
    onCaption(text) { reportCaption(text); },
    onStatus(text) { reportAudio(text); },
  });
  let scenarioEnabled = true;
  let scenarioTime = 0;
  let scenarioEpoch = 0;
  let reportScenario = (_text: string) => {};
  let refreshPanel = () => {};
  const installation = createInstallation({
    scene, camera, scanRoot, defaultPlyCenter: null,
    onCue(cue) { void voices.play(cue); },
    onStopAudio() { voices.stop(); },
  });
  let placementMode: 'walls' | 'edges' = 'walls';
  let centeringResult: ReturnType<typeof estimateHallwayCenter> | null = null;
  let reportPlacement = (_text: string) => {};
  let reportWallMeasurement = (_text: string) => {};
  let primaryWallMeasurement: {
    center: number[]; pivot: number[]; centerDistances: ReturnType<typeof measureWallDistances>;
    pivotDistances: ReturnType<typeof measureWallDistances>; edgeClearances: { left: number; right: number };
    centerMatchesPivot: boolean; wallFitResidual: number;
  } | null = null;
  const refreshWallMeasurement = () => {
    primaryWallMeasurement = null;
    if (!centeringResult?.ok) {
      reportWallMeasurement('Wall distances not independently verified. Show box fits both walls; picked-edge midpoints alone do not verify them.');
      return;
    }
    const box = scene.getObjectByName('installation-box');
    if (!box) return;
    box.updateWorldMatrix(true, false);
    const center = box.getWorldPosition(new THREE.Vector3());
    const config = installation.snapshot().config;
    const pivot = new THREE.Vector3(config.centerX, config.floorY, config.centerZ);
    const walls = centeringResult.wallPlanes;
    const centerDistances = measureWallDistances(walls, center.toArray() as [number, number, number]);
    const pivotDistances = measureWallDistances(walls, pivot.toArray() as [number, number, number]);
    const m = box.matrixWorld.elements;
    const support = (normal: readonly [number, number, number]) => .5 * (
      Math.abs(normal[0] * m[0] + normal[1] * m[1] + normal[2] * m[2]) +
      Math.abs(normal[0] * m[4] + normal[1] * m[5] + normal[2] * m[6]) +
      Math.abs(normal[0] * m[8] + normal[1] * m[9] + normal[2] * m[10]));
    const centerMatchesPivot = Math.hypot(center.x - pivot.x, center.z - pivot.z) < 1e-9;
    primaryWallMeasurement = { center: center.toArray(), pivot: pivot.toArray(), centerDistances, pivotDistances,
      edgeClearances: { left: centerDistances.left - support(walls.left.normal), right: centerDistances.right - support(walls.right.normal) },
      centerMatchesPivot, wallFitResidual: centeringResult.residual };
    reportWallMeasurement(`Measured centre-to-wall: ${centerDistances.left.toFixed(4)} / ${centerDistances.right.toFixed(4)} m. ` +
      `Difference ${(centerDistances.imbalance * 1000).toFixed(3)} mm; ${centerMatchesPivot ? 'pivot directly beneath box centre' : 'PIVOT MISMATCH'}. ` +
      `Wall-fit RMS ≈ ${(centeringResult.residual * 1000).toFixed(0)} mm. Cyan marker follows the pivot.`);
  };
  let reportSecondPlacement = (_text: string) => {};
  let floorLineRaw: readonly [number, number, number] = SECOND_FLOOR_LINE_RAW;
  let secondPlacementResult: ReturnType<typeof placeWallAdjacentBox> | null = null;
  let secondPlacementRaw: [number, number, number] | null = null;
  const placementPicker = setupPlacementPicker(renderer, camera, scanRoot, installation, text => {
    reportPlacement(text);
    const output = document.getElementById('experience-error');
    if (output) output.textContent = text;
  }, { floorY: FLOOR_Y, onPicked: () => { placementMode = 'edges'; centeringResult = null; refreshWallMeasurement(); } });
  const centerPlacement = (): boolean => {
    if (placementPicker.isPicking() || floorLinePicker.isPicking()) { reportPlacement('Finish the current floor selection, or Reset baseline to cancel.'); return false; }
    const state = installation.snapshot();
    if (placementMode === 'edges' && state.placementSource === 'picked-scan') {
      return placementPicker.applyFromScan();
    }
    placementMode = 'walls';
    placementPicker.clearSelection();
    const centers = getSourceCenters(scanRoot);
    if (!centers) { reportPlacement('Wait for the scan before showing the box.'); return false; }
    scanRoot.updateWorldMatrix(true, false);
    // Keep an already shown box at its chosen longitudinal station. Re-fitting
    // the walls for Rotate must not jump back to the default raw seed.
    const seed = state.placementSource === 'manual-world' || (state.phase === 'box' && centeringResult?.ok)
      ? scanRoot.worldToLocal(new THREE.Vector3(state.config.centerX, FLOOR_Y, state.config.centerZ)).toArray() as [number, number, number]
      : BOX_STATION_RAW;
    centeringResult = estimateHallwayCenter({ centers, modelMatrix: scanRoot.matrixWorld.elements, seedRaw: seed,
      floorY: FLOOR_Y, corridorDirectionRaw: [0, 1, 0] });
    if (!centeringResult.ok) {
      reportPlacement(`${centeringResult.reason} Use Pick two floor edges to choose opposite walls at this station.`);
      return false;
    }
    const point = centeringResult.centerWorld;
    installation.applyScanPlacement({ ...state.config, centerX: point[0], centerZ: point[2], floorY: FLOOR_Y,
      hallwayWidth: centeringResult.width }, centeringResult.directionWorld);
    reportPlacement(`Centred between fitted scan walls: width ${centeringResult.width.toFixed(2)} m; ` +
      `centre-to-wall ${centeringResult.clearanceLeft.toFixed(2)} / ${centeringResult.clearanceRight.toFixed(2)} m. ` +
      'Floor uses local-floor Y=0. Check against the real hallway.');
    return true;
  };
  const prepareSecondPlacement = (): boolean => {
    const state = installation.snapshot();
    if (!['idle', 'ready', 'box'].includes(state.phase) || state.yaw !== 0) return false;
    installation.discardSecondBoxPlacement();
    secondPlacementResult = null;
    secondPlacementRaw = null;
    const centers = getSourceCenters(scanRoot);
    if (!centers) { reportSecondPlacement('Wait for the original scan before placing the second box.'); return false; }
    scanRoot.updateWorldMatrix(true, false);
    const wallFit = estimateHallwayCenter({ centers, modelMatrix: scanRoot.matrixWorld.elements,
      seedRaw: [2, floorLineRaw[1], -1.45], floorY: FLOOR_Y, corridorDirectionRaw: [0, 1, 0] });
    if (!wallFit.ok) { reportSecondPlacement(`Second box: ${wallFit.reason}`); return false; }
    const guide = scanRoot.localToWorld(new THREE.Vector3(...SECOND_BOX_GUIDE_RAW)).toArray() as [number, number, number];
    const line = scanRoot.localToWorld(new THREE.Vector3(...floorLineRaw)).toArray() as [number, number, number];
    secondPlacementResult = placeWallAdjacentBox({ wallFit, guideWorld: guide, guideMode: 'center',
      floorLineWorld: line, tangentSign: 1, floorY: FLOOR_Y,
      boxWidth: .36, boxDepth: .36, boxHeight: .43 });
    if (!secondPlacementResult.ok) { reportSecondPlacement(secondPlacementResult.reason); return false; }
    installation.setSecondBoxPlacement(secondPlacementResult.baseWorld, secondPlacementResult.directionWorld);
    secondPlacementRaw = scanRoot.worldToLocal(new THREE.Vector3(...secondPlacementResult.baseWorld)).toArray() as [number, number, number];
    reportSecondPlacement(`Second box: 36 × 36 × 43 cm, base raw [${secondPlacementRaw.map(n => n.toFixed(3)).join(', ')}]. ` +
      'An edge meets the fitted wall; another meets the floor-line guide. Prepared in the original view; reveal after the turn.');
    return true;
  };
  const floorLinePicker = setupFloorLinePicker(renderer, camera, scanRoot, FLOOR_Y, rawPoint => {
    floorLineRaw = rawPoint;
    prepareSecondPlacement();
  });
  // Timed and manual actions use the same placement and live-tracking guards.
  const mayAct = (): boolean => options.isScanReady?.() !== false &&
    !placementPicker.isPicking() && !floorLinePicker.isPicking() &&
    (!renderer.xr.isPresenting || (installation.snapshot().calibrated && !calibrationActive && !interrupted && viewerReady));
  const showBox = (): boolean => {
    if (!mayAct()) { reportPlacement('Wait for the scan, finish selections and complete fresh calibration with visible headset tracking.'); return false; }
    if (!centerPlacement()) return false;
    const shown = installation.showBox(!renderer.xr.isPresenting);
    const prepared = prepareSecondPlacement();
    return shown && prepared;
  };
  const rotate = (testTurn = false): boolean => {
    if (!mayAct()) { reportPlacement('Restore tracking and finish calibration or floor selection before rotating.'); return false; }
    if (!centerPlacement() || !prepareSecondPlacement()) return false;
    if (testTurn && installation.snapshot().config.rotationSeconds !== 4) {
      installation.configure({ ...installation.snapshot().config, rotationSeconds: 4 });
    }
    return installation.rotateHallway();
  };
  const showSecondBox = (): boolean => {
    if (!mayAct()) { reportSecondPlacement('Restore tracking and recalibrate before showing the second box in VR.'); return false; }
    // No scan query: reveal the frozen pre-turn placement.
    return installation.showSecondBox();
  };
  const scenario = createTestScenario({
    onCue(cue) { void voices.play(cue); },
    onAction(action) {
      if (action === 'showBox') return showBox();
      if (action === 'rotate') return rotate(true);
      return showSecondBox();
    },
    onChange() { reportScenario(scenario.snapshot().status); refreshPanel(); },
  });
  const cancelScenario = (reason: string) => {
    scenarioEpoch++;
    scenario.cancel(reason);
    voices.stop();
  };
  const startTestScenarioPreview = (): boolean => {
    if (renderer.xr.isPresenting || options.isScanReady?.() === false || scenario.snapshot().running) return false;
    cancelScenario('Starting a fresh desktop preview.');
    options.onDisarm?.();
    placementPicker.cancel(); floorLinePicker.cancel();
    installation.prepareForCalibration();
    calibrationActive = false;
    centeringResult = null;
    interrupted = false;
    scenario.start(scenarioTime);
    return true;
  };
  const unlockAudio = () => { void voices.unlock().then(ready => { if (ready) void voices.preload(SCENARIO_VOICE_CUES); }); };
  const audioGesture = new AbortController();
  // Enter VR is a browser gesture; prime audio there before the XR-only trigger.
  const primeAudio = () => {
    void voices.unlock().then(ready => {
      if (ready) { audioGesture.abort(); void voices.preload(SCENARIO_VOICE_CUES); }
    });
  };
  document.addEventListener('pointerdown', primeAudio, { signal: audioGesture.signal, capture: true });
  document.addEventListener('keydown', primeAudio, { signal: audioGesture.signal, capture: true });
  const panel = bindExperiencePanel(installation, {
    isPresenting: () => renderer.xr.isPresenting,
    isScanReady: options.isScanReady,
    isPlacementPending: () => placementPicker.isPicking() || floorLinePicker.isPicking(),
    isScenarioEnabled: () => scenarioEnabled,
    isScenarioRunning: () => scenario.snapshot().running,
    onScenarioEnabled: enabled => { scenarioEnabled = enabled; if (!enabled) cancelScenario('Narrated test disabled. Manual controls are available.'); },
    onPreviewScenario: () => {
      const request = ++scenarioEpoch;
      void voices.unlock().then(() => {
        if (request !== scenarioEpoch) return;
        void voices.preload(SCENARIO_VOICE_CUES);
        startTestScenarioPreview();
      });
    },
    onShowBox: () => { if (!scenario.snapshot().running) showBox(); },
    onRotate: () => { if (!scenario.snapshot().running) rotate(); },
    onShowSecondBox: () => { if (!scenario.snapshot().running) showSecondBox(); },
    onPickSecondFloorLine: () => {
      if (renderer.xr.isPresenting || !['idle', 'ready', 'box'].includes(installation.snapshot().phase)) return;
      placementPicker.cancel(); floorLinePicker.start();
      reportSecondPlacement('Click the visible floor line beside the marked wall. The second box will sit on its side away from the door.');
      installation.confirmPlacement(false); // publish the pending-selection UI state
    },
    onReset: () => {
      cancelScenario('Narrated test cancelled by Reset. Calibrate again or start a desktop preview.');
      options.onDisarm?.();
      placementPicker.cancel();
      floorLinePicker.cancel();
      if (!placementPicker.hasSelection()) { placementPicker.clearSelection(); placementMode = 'walls'; }
      installation.reset();
    },
    onPickCenter: () => { floorLinePicker.cancel(); placementPicker.start(); },
    onStop: () => interrupt('STOPPED. Stay still; press CALIBRATE when ready to realign.'),
  });
  refreshPanel = () => panel.refresh();
  reportScenario = text => panel.setScenarioStatus(text);
  reportPlacement = text => panel.setPlacementStatus(text);
  reportWallMeasurement = text => panel.setWallMeasurementStatus(text);
  reportSecondPlacement = text => panel.setSecondPlacementStatus(text);
  reportSecondPlacement('The second 36 × 36 × 43 cm box is prepared before the turn and stays hidden until Show second box.');
  reportPlacement('Show box fits both scan walls near raw [2, 21.1, -1.45] and uses the existing floor Y=0.');
  const voicePanel = bindVoicePanel({
    onUnlock: unlockAudio,
    onMute: value => voices.setMuted(value),
    onPreview: () => {
      if (renderer.xr.isPresenting || scenario.snapshot().running) return;
      const request = scenarioEpoch;
      void voices.unlock().then(ready => {
        if (ready && request === scenarioEpoch && !renderer.xr.isPresenting && !scenario.snapshot().running) void voices.play('purpose');
      });
    },
  });
  reportAudio = text => { panel.setAudioStatus(text); voicePanel.setStatus(text); };
  reportCaption = text => voicePanel.setCaption(text);
  reportHands = text => panel.setHandStatus(text);
  const hands = setupTrackedHands(renderer, scene, { onStatus: text => reportHands(text), meshPath: '/hands/' });

  let sessionEnded = false;
  let viewerReady = false;
  const unsubscribe = installation.subscribe(snapshot => {
    if (snapshot.phase === 'stopped' && scenario.snapshot().running) cancelScenario('Narrated test cancelled: installation stopped.');
    refreshWallMeasurement();
    if (snapshot.preview) sessionEnded = false;
    if (sessionEnded && !renderer.xr.isPresenting) {
      hud.clear();
      return;
    }
    hud.setStopped(snapshot.phase === 'stopped', snapshot.status, viewerReady);
    if (snapshot.phase === 'idle' || snapshot.phase === 'ready') hud.clear();
  });
  let observedReference: XRReferenceSpace | null = null;
  let observedSession: XRSession | null = null;
  let interrupted = false;
  const hasProtectedWork = () => installation.snapshot().calibrated || captureInProgress();
  const interrupt = (reason: string) => {
    cancelScenario(`Narrated test cancelled. ${reason}`);
    if (interrupted && installation.snapshot().phase === 'stopped') return;
    options.onDisarm?.();
    interrupted = true;
    viewerReady = false;
    centeringResult = null;
    logger.warn('experience', reason);
    placementPicker.cancel();
    floorLinePicker.cancel();
    installation.invalidate(reason);
    hands.clear();
    invalidateCalibration(reason);
  };
  const reset = () => interrupt('TRACKING ORIGIN CHANGED. Saved controller points were cleared.');
  const visibility = () => {
    if (observedSession?.visibilityState !== 'visible') {
      viewerReady = false;
      // READY has no accepted fit or active capture to lose. A menu during
      // entry should wait, rather than trapping the wearer in a STOP state.
      if (hasProtectedWork()) interrupt(observedSession?.visibilityState === 'visible-blurred'
        ? 'ANOTHER VR PANEL HAS FOCUS\nDismiss SteamVR with LEFT menu (≡).\nDismiss Quest menu with RIGHT Meta.\nReported state: visible-blurred.'
        : 'THE APP VIEW IS HIDDEN\nKeep the headset on and return to Steam Link.\nDismiss Quest / SteamVR menus.\nReported state: hidden.');
    }
  };
  const detach = () => {
    observedReference?.removeEventListener('reset', reset);
    observedSession?.removeEventListener('visibilitychange', visibility);
    observedReference = null;
    observedSession = null;
  };
  const observeReference = () => {
    const reference = renderer.xr.getReferenceSpace();
    if (reference === observedReference) return;
    if (observedReference) interrupt('TRACKING SPACE CHANGED. Saved controller points were cleared.');
    observedReference?.removeEventListener('reset', reset);
    observedReference = reference;
    reference?.addEventListener('reset', reset);
  };
  const onSessionStart = () => {
    cancelScenario('Waiting for a fresh calibration to start the narrated test.');
    options.onDisarm?.();
    detach();
    sessionEnded = false;
    centeringResult = null;
    installation.prepareForCalibration(); // restores any desktop preview before XR
    placementPicker.cancel();
    floorLinePicker.cancel();
    interrupted = false;
    viewerReady = false;
    observedSession = renderer.xr.getSession();
    observedSession?.addEventListener('visibilitychange', visibility);
    observeReference();
  };
  const onSessionEnd = () => {
    cancelScenario('Narrated test cancelled: VR session ended.');
    options.onDisarm?.();
    sessionEnded = true;
    centeringResult = null;
    floorLinePicker.cancel();
    installation.invalidate('VR CONNECTION ENDED. Reconnect Steam Link; open its Desktop view and click Resume VR. Then press CALIBRATE.');
    hands.clear();
    detach();
    interrupted = true;
    viewerReady = false;
    calibrationActive = false;
  };
  renderer.xr.addEventListener('sessionstart', onSessionStart);
  renderer.xr.addEventListener('sessionend', onSessionEnd);

  return {
    installation,
    scenario,
    startTestScenarioPreview,
    placementSnapshot: () => centeringResult,
    primaryWallMeasurement: () => primaryWallMeasurement,
    secondPlacementSnapshot: () => ({ result: secondPlacementResult, rawBase: secondPlacementRaw, floorLineRaw: [...floorLineRaw] }),
    hands,
    voices,
    bindCalibrationInvalidator(callback: (reason: string) => void) { invalidateCalibration = callback; },
    bindCalibrationCaptureState(callback: () => boolean) { captureInProgress = callback; },
    setCalibrationActive(active: boolean) { calibrationActive = active; if (active) { cancelScenario('Narrated test cancelled for calibration.'); options.onDisarm?.(); hands.clear(); } },
    calibrationBlockReason(): string | null {
      if (observedSession?.visibilityState === 'visible-blurred') return (
        'STEAMVR / QUEST MENU IS IN FRONT\nPress LEFT menu (≡) to dismiss SteamVR.\nUse RIGHT Meta to dismiss the Quest menu.\nThen pull a front trigger to calibrate.\nReported state: visible-blurred.');
      if (observedSession?.visibilityState === 'hidden') return (
        'RETURN TO THE VR APP\nKeep the headset on; return to Steam Link.\nDismiss any system menus.\nReported state: hidden.');
      return viewerReady && observedSession?.visibilityState === 'visible' ? null :
        'WAITING FOR HEADSET POSITION\nKeep the headset on and look around a lit area.\nWhen the title returns, pull a front trigger.';
    },
    prepareForCalibration() {
      cancelScenario('Waiting for calibration to finish before the narrated test.');
      options.onDisarm?.();
      calibrationActive = true;
      centeringResult = null;
      placementPicker.cancel();
      floorLinePicker.cancel();
      installation.prepareForCalibration();
      hud.clear();
      interrupted = false;
    },
    scanTransformChanged() {
      cancelScenario('Narrated test cancelled: scan placement changed.');
      centeringResult = null;
      if (placementMode === 'edges') placementPicker.applyFromScan();
      else if (installation.snapshot().placementSource === 'picked-scan') centerPlacement();
    },
    calibrated() {
      calibrationActive = false;
      centeringResult = null;
      installation.setCalibrated();
      if (placementMode === 'edges') placementPicker.applyFromScan();
      else if (installation.snapshot().placementSource === 'picked-scan') centerPlacement();
      interrupted = false;
      if (renderer.xr.isPresenting && scenarioEnabled) scenario.start(scenarioTime);
    },
    update(deltaSeconds: number, frame?: XRFrame) {
      let contacts: ReturnType<typeof hands.update> = [];
      if (renderer.xr.isPresenting) {
        const previouslyReady = viewerReady;
        observeReference();
        let viewerValid = false;
        try {
          const pose = frame && observedReference ? frame.getViewerPose(observedReference) : null;
          viewerValid = !!pose && !pose.emulatedPosition &&
            [pose.transform.position.x, pose.transform.position.y, pose.transform.position.z].every(Number.isFinite);
        } catch { /* a failed current-frame pose has no tracking authority */ }
        viewerReady = viewerValid && observedSession?.visibilityState === 'visible';
        // A visible-but-blurred session suppresses input poses by design.
        // Diagnose focus before interpreting null poses as tracking loss.
        if (observedSession?.visibilityState !== 'visible') visibility();
        else if (!viewerValid && hasProtectedWork()) interrupt('HEADSET POSITION LOST\nKeep it on; look around a lit area.\nCalibration points have been cleared.');
        else if (installation.snapshot().calibrated && deltaSeconds > 0.5) {
          interrupt('VR FRAMES PAUSED\nStay still; check the Steam Link connection.');
        }
        if (previouslyReady !== viewerReady && installation.snapshot().phase === 'stopped') {
          hud.setStopped(true, installation.snapshot().status, viewerReady);
        }
        if (viewerReady && !interrupted && !calibrationActive) contacts = hands.update(frame, observedReference);
        else hands.clear();
      }
      const now = performance.now();
      installation.update(deltaSeconds, contacts.map(contact => ({ position: contact.position, tracked: true, timestampMs: now })), now);
      // Update the turn before dispatching this frame's next timed action. A
      // turn started at +15 s therefore gets its first animation step next frame.
      if (Number.isFinite(deltaSeconds) && deltaSeconds >= 0) scenarioTime += deltaSeconds;
      if (scenario.snapshot().running) {
        scenario.update(Number.isFinite(deltaSeconds) && deltaSeconds >= 0 ? scenarioTime : Number.NaN);
        if (!scenario.snapshot().running && scenario.snapshot().stage === 'cancelled') voices.stop();
      }
    },
    invalidate: interrupt,
    dispose() {
      cancelScenario('Narrated test disposed.');
      audioGesture.abort();
      options.onDisarm?.();
      detach(); unsubscribe(); placementPicker.dispose(); floorLinePicker.dispose(); hands.dispose();
      installation.dispose(); voices.dispose(); hud.dispose(); panel.dispose(); voicePanel.dispose();
      renderer.xr.removeEventListener('sessionstart', onSessionStart);
      renderer.xr.removeEventListener('sessionend', onSessionEnd);
    },
  };
}
