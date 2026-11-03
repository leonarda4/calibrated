import * as THREE from 'three';
import { createInstallation } from './installation.ts';
import { setupPlacementPicker } from './placementPicker.ts';
import { bindExperiencePanel } from '../ui/experiencePanel.ts';
import { createExperienceHud } from '../ui/experienceHud.ts';
import { bindVoicePanel } from '../ui/voicePanel.ts';
import { createVoiceGuide } from '../audio/voiceGuide.ts';
import { setupTrackedHands } from '../xr/hands.ts';
import { logger } from '../debug/logger.ts';
import { estimateHallwayCenter } from './hallwayCenter.ts';

type ScanRoot = THREE.Object3D & { viewer: { splatMesh: unknown } };

// Approximate raw floor station visible in the supplied desktop screenshot.
const BOX_STATION_RAW = [2, 21.1, -1.45] as const;
// Same local-floor plane as the calibration grid and cyan origin marker.
const FLOOR_Y = 0;

/** Keep device/lifecycle orchestration out of both sequence math and main.ts. */
export function setupExperience(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, scanRoot: ScanRoot, options: { isScanReady?(): boolean } = {}) {
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
  const installation = createInstallation({
    scene, camera, scanRoot, defaultPlyCenter: null,
    onCue(cue) { void voices.play(cue); },
    onStopAudio() { voices.stop(); },
  });
  let placementMode: 'walls' | 'edges' = 'walls';
  let centeringResult: ReturnType<typeof estimateHallwayCenter> | null = null;
  let reportPlacement = (_text: string) => {};
  const placementPicker = setupPlacementPicker(renderer, camera, scanRoot, installation, text => {
    reportPlacement(text);
    const output = document.getElementById('experience-error');
    if (output) output.textContent = text;
  }, { floorY: FLOOR_Y, onPicked: () => { placementMode = 'edges'; centeringResult = null; } });
  const centerPlacement = (): boolean => {
    if (placementPicker.isPicking()) { reportPlacement('Finish both new floor-edge picks, or Reset baseline to cancel.'); return false; }
    const state = installation.snapshot();
    if (placementMode === 'edges' && state.placementSource === 'picked-scan') {
      return placementPicker.applyFromScan();
    }
    placementMode = 'walls';
    placementPicker.clearSelection();
    const mesh = scanRoot.viewer.splatMesh as { splatDataTextures?: { baseData?: { centers?: Float32Array } } };
    const centers = mesh.splatDataTextures?.baseData?.centers;
    if (!centers) { reportPlacement('Wait for the scan before showing the box.'); return false; }
    scanRoot.updateWorldMatrix(true, false);
    const seed = state.placementSource === 'manual-world'
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
      hallwayWidth: centeringResult.width });
    reportPlacement(`Centred between fitted scan walls: width ${centeringResult.width.toFixed(2)} m; ` +
      `centre-to-wall ${centeringResult.clearanceLeft.toFixed(2)} / ${centeringResult.clearanceRight.toFixed(2)} m. ` +
      'Floor uses local-floor Y=0. Check against the real hallway.');
    return true;
  };
  const unlockAudio = () => { void voices.unlock().then(ready => { if (ready) void voices.preload(); }); };
  const panel = bindExperiencePanel(installation, {
    isPresenting: () => renderer.xr.isPresenting,
    isScanReady: options.isScanReady,
    isPlacementPending: () => placementPicker.isPicking(),
    onShowBox: () => {
      if (options.isScanReady?.() === false) return;
      if (renderer.xr.isPresenting && (!installation.snapshot().calibrated || calibrationActive || interrupted || !viewerReady)) {
        reportPlacement('Complete a fresh A/B calibration with visible headset tracking before showing the box in VR.');
        return;
      }
      if (centerPlacement()) installation.showBox(!renderer.xr.isPresenting);
    },
    onRotate: () => {
      if (placementPicker.isPicking()) { reportPlacement('Finish both floor-edge picks before rotating.'); return; }
      if (renderer.xr.isPresenting && (!installation.snapshot().calibrated || calibrationActive || interrupted || !viewerReady)) {
        reportPlacement('Restore tracking and recalibrate before rotating the hallway in VR.'); return;
      }
      installation.rotateHallway();
    },
    onReset: () => {
      placementPicker.cancel();
      if (!placementPicker.hasSelection()) { placementPicker.clearSelection(); placementMode = 'walls'; }
      installation.reset();
    },
    onPickCenter: () => placementPicker.start(),
    onStop: () => interrupt('STOPPED. Stay still; press CALIBRATE when ready to realign.'),
  });
  reportPlacement = text => panel.setPlacementStatus(text);
  reportPlacement('Show box fits both scan walls near raw [2, 21.1, -1.45] and uses the existing floor Y=0.');
  const voicePanel = bindVoicePanel({
    onUnlock: unlockAudio,
    onMute: value => voices.setMuted(value),
    onPreview: () => {
      if (renderer.xr.isPresenting) return;
      void voices.unlock().then(ready => { if (ready) void voices.play('purpose'); });
    },
  });
  reportAudio = text => { panel.setAudioStatus(text); voicePanel.setStatus(text); };
  reportCaption = text => voicePanel.setCaption(text);
  reportHands = text => panel.setHandStatus(text);
  const hands = setupTrackedHands(renderer, scene, { onStatus: text => reportHands(text), meshPath: '/hands/' });

  let sessionEnded = false;
  let viewerReady = false;
  const unsubscribe = installation.subscribe(snapshot => {
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
    if (interrupted && installation.snapshot().phase === 'stopped') return;
    interrupted = true;
    viewerReady = false;
    logger.warn('experience', reason);
    placementPicker.cancel();
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
    detach();
    sessionEnded = false;
    installation.prepareForCalibration(); // restores any desktop preview before XR
    placementPicker.cancel();
    interrupted = false;
    viewerReady = false;
    observedSession = renderer.xr.getSession();
    observedSession?.addEventListener('visibilitychange', visibility);
    observeReference();
  };
  const onSessionEnd = () => {
    sessionEnded = true;
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
    placementSnapshot: () => centeringResult,
    hands,
    voices,
    bindCalibrationInvalidator(callback: (reason: string) => void) { invalidateCalibration = callback; },
    bindCalibrationCaptureState(callback: () => boolean) { captureInProgress = callback; },
    setCalibrationActive(active: boolean) { calibrationActive = active; if (active) hands.clear(); },
    calibrationBlockReason(): string | null {
      if (observedSession?.visibilityState === 'visible-blurred') return (
        'STEAMVR / QUEST MENU IS IN FRONT\nPress LEFT menu (≡) to dismiss SteamVR.\nUse RIGHT Meta to dismiss the Quest menu.\nThen pull a front trigger to calibrate.\nReported state: visible-blurred.');
      if (observedSession?.visibilityState === 'hidden') return (
        'RETURN TO THE VR APP\nKeep the headset on; return to Steam Link.\nDismiss any system menus.\nReported state: hidden.');
      return viewerReady && observedSession?.visibilityState === 'visible' ? null :
        'WAITING FOR HEADSET POSITION\nKeep the headset on and look around a lit area.\nWhen the title returns, pull a front trigger.';
    },
    prepareForCalibration() {
      calibrationActive = true;
      placementPicker.cancel();
      installation.prepareForCalibration();
      hud.clear();
      interrupted = false;
    },
    scanTransformChanged() {
      if (placementMode === 'edges') placementPicker.applyFromScan();
      else if (installation.snapshot().placementSource === 'picked-scan') centerPlacement();
    },
    calibrated() {
      calibrationActive = false;
      installation.setCalibrated();
      if (placementMode === 'edges') placementPicker.applyFromScan();
      else if (installation.snapshot().placementSource === 'picked-scan') centerPlacement();
      interrupted = false;
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
    },
    invalidate: interrupt,
    dispose() {
      detach(); unsubscribe(); placementPicker.dispose(); hands.dispose();
      installation.dispose(); voices.dispose(); hud.dispose(); panel.dispose(); voicePanel.dispose();
      renderer.xr.removeEventListener('sessionstart', onSessionStart);
      renderer.xr.removeEventListener('sessionend', onSessionEnd);
    },
  };
}
