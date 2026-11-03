// src/xr: guided placement-only calibration (user-specified flow).
//
//   ENTER VR -> title screen 'HALLWAY PROJECT' - the person sees NO PLY,
//   only the GUI and a floor grid (Steam Link has no camera input).
//   Press TRIGGER on a remote -> 7 s countdown -> place the remotes on the
//   floor (LEFT = spot A, RIGHT = spot B, >= 1 m apart) -> the hallway is
//   read from the buffered remote positions and the PLY FADES IN while
//   the GUI + grid fade out (1 s). Trigger again to recalibrate.
//
// There is NO automatic re-arrangement of the scan - per user decision
// that machinery was removed; the boundary restriction is accepted.
//
// The instruction HUD is parented to the camera, so it sticks rigidly to
// the user's view. The XR rig itself is never moved - only the scan root.

import * as THREE from 'three';
import type * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { raycastSplatCenters } from '../viewer/splatRaycast';
import { setScanOpacity } from '../viewer/splatViewer';
import { logger } from '../debug/logger';
import { SCAN_LANDMARKS, type ScanLandmarkPair } from '../calibration/landmarks';
import { classifyCalibrationInput, type CalibrationInputKind } from './calibrationInput';
import {
  solveYawTranslation, composeCalibration,
  type YawTranslationSolution, type Vec3, type Quat,
} from '../calibration/yawTranslationSolver';

/**
 * Offset from the controller GRIP ORIGIN to the physical point placed on
 * the landmark, in controller-local metres [x, y, z]. Zero = grip origin.
 */
export const PROBE_TIP_OFFSET: Vec3 = [0, 0, 0];

const HUD_DISTANCE = 1.3;          // m in front of the eyes
const PLACE_SECONDS = 7;           // countdown to place the remotes (user-specified)
// Guided flow (user-specified): the person sees NO PLY during calibration â€”
// only the title, instructions and a floor grid (Steam Link has no camera).
const CALIBRATION_OPACITY = 0.0;    // scan hidden while calibrating
const OPAQUE_CALIBRATION_OPACITY = 0.0; // opaque (SteamVR) route: same â€” nothing but GUI
const EXPERIENCE_OPACITY = 1.0;     // full quality once calibrated
const FADE_SECONDS = 1.0;          // PLY fade-in + GUI fade-out after the fit
const GRID_SIZE = 10;              // floor grid extent [m]
const GRID_OPACITY = 0.35;         // floor grid base opacity
const MIN_REMOTE_SEPARATION = 0.3; // m â€” A and B must be distinguishable
const MAX_FIT_RMS = 1;             // m â€” refuse nonsense fits
const CONFIRM_MAX_ATTEMPTS = 3;
const CONFIRM_TIMEOUT_MS = 30_000;

interface SplatMeshWithCenters {
  splatDataTextures?: { baseData?: { centers?: Float32Array } };
}

interface ControllerEntry {
  slot: number;
  ctrl: THREE.Group;
  grip: THREE.Group;
  ray: THREE.Line;
  source: XRInputSource | null;
  /** Current role; a controller can also expose joint data. */
  kind: CalibrationInputKind;
}

export type LandmarkPickCallback = (which: 'A' | 'B', point: Vec3) => void;

export interface CalibrationCaptureOptions {
  /** Explicit scan annotation metadata; never measured poses or fit acceptance. */
  landmarks?: ScanLandmarkPair | null;
}

export function setupCalibrationCapture(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  splats: GaussianSplats3D.DropInViewer,
  onCalibrated?: (solution: YawTranslationSolution) => void,
  onLandmarkPicked?: LandmarkPickCallback,
  onStatus?: (text: string) => void,
  onLandmarkEdit?: (active: boolean) => void,
  onBeforeCalibration?: () => void,
  canCalibrate: () => boolean = () => true,
  calibrationBlockReason: () => string | null = () => null,
  options: CalibrationCaptureOptions = {},
) {
  const initialPair = options.landmarks === undefined ? SCAN_LANDMARKS : options.landmarks;
  if (initialPair && ![initialPair.a, initialPair.b].every(point =>
    Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) {
    throw new Error('Scan landmark metadata must contain finite A/B coordinates.');
  }
  // ---- input sources: up to 4 slots (2 remotes + 2 hands) ------------------
  // Steam Link passes Quest hand tracking through as input sources; hands
  // are classified and IGNORED â€” only physical remotes drive the calibration.
  const controllers: ControllerEntry[] = [];
  const refreshInput = (entry: ControllerEntry, event?: string): void => {
    const previous = entry.kind;
    entry.kind = entry.source ? classifyCalibrationInput(entry.source) : 'unavailable';
    if (!event && previous === entry.kind) return;
    const visible = entry.kind === 'controller';
    entry.ctrl.visible = entry.grip.visible = entry.ray.visible = visible;
    const source = entry.source;
    const gp = source?.gamepad;
    const type = entry.kind === 'controller'
      ? 'controller' + (source?.hand ? ' + joint data' : '')
      : entry.kind === 'hand' ? 'HAND (not a landmark controller)' : 'unavailable (needs gamepad + grip)';
    logger.info('calib', 'input #' + entry.slot + ' ' + (event ?? 'classification changed') +
      ' - side=' + (source?.handedness ?? '?') + ', type=' + type +
      ', profiles=' + (source?.profiles.join('|') || 'none') +
      ', gamepad=' + (gp ? 'yes (' + gp.axes.length + ' axes, ' + gp.buttons.length + ' buttons)' : 'NO') +
      ', grip=' + (source?.gripSpace ? 'yes' : 'NO') +
      ', joints=' + (source?.hand ? source.hand.size ?? 'present' : 'none'));
  };
  for (let i = 0; i < 4; i++) {
    const ctrl = renderer.xr.getController(i);
    const grip = renderer.xr.getControllerGrip(i);
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -6),
      ]),
      new THREE.LineBasicMaterial({ color: 0x00e5ff }),
    );
    const entry: ControllerEntry = { slot: i, ctrl, grip, ray, source: null, kind: 'unavailable' };
    ctrl.add(ray);
    ctrl.visible = grip.visible = false;
    ctrl.addEventListener('connected', (e) => {
      entry.source = (e as unknown as { data: XRInputSource }).data;
      refreshInput(entry, 'connected');
      if (step === 'READY') showPanel(readyHint ?? readyText());
    });
    ctrl.addEventListener('disconnected', () => {
      entry.source = null;
      refreshInput(entry, 'disconnected');
      if (step === 'READY') showPanel(readyHint ?? readyText());
    });
    ctrl.addEventListener('selectstart', () => onSelect(entry));
    scene.add(ctrl, grip);
    controllers.push(entry);
  }
  /** Controller grip sources only; explicit hand profiles stay excluded. */
  const remotes = (): ControllerEntry[] => {
    controllers.forEach(entry => refreshInput(entry));
    return controllers.filter(entry => entry.source && entry.kind === 'controller');
  };
  // ---- hand-takeover guard (Steam Link) -----------------------------------
  // SteamVR switches inputs to the user's HANDS as soon as the remotes are
  // put down (hand tracking resumes). The grip position streamed while a
  // remote was live is its true placement spot â€” so we buffer every frame
  // and read the BUFFER at countdown end. If hands took over, the buffer
  // still holds where each remote was last seen (lying on the floor).
  const lastRemotePos: Record<'left' | 'right', THREE.Vector3 | null> = {
    left: null, right: null,
  };
  const sampleRemotePositions = (frame?: XRFrame): void => {
    const reference = renderer.xr.getReferenceSpace();
    for (const entry of remotes()) {
      const hand = entry.source?.handedness;
      if (hand !== 'left' && hand !== 'right') continue;
      // A disconnected remote retains its last placement for hand takeover.
      // A connected remote must have a real pose in this active XRFrame.
      lastRemotePos[hand] = null;
      if (!frame || !reference || !entry.source?.gripSpace) continue;
      const sources = renderer.xr.getSession()?.inputSources;
      if (sources && !Array.from(sources).includes(entry.source)) continue;
      try {
        const pose = frame.getPose(entry.source.gripSpace, reference);
        if (!pose || pose.emulatedPosition) continue;
        const p = pose.transform.position; const q = pose.transform.orientation;
        if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite)) continue;
        lastRemotePos[hand] = new THREE.Vector3(...PROBE_TIP_OFFSET)
          .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(new THREE.Vector3(p.x, p.y, p.z));
      } catch { /* no active current-frame pose, so no capture authority */ }
    }
  };

  // ---- HUD: parented to the camera â†’ sticks rigidly to the view ----------
  const { sprite: panel, setText } = makeTextPanel();
  panel.name = 'calibration-instructions';
  panel.visible = false;
  panel.renderOrder = 1000;
  panel.position.set(0, 0.22, -HUD_DISTANCE);
  camera.add(panel);

  // ---- floor grid: orientation in the camera-less calibration phase ------
  const grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, 0x3a4a5a, 0x232e3a);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = GRID_OPACITY;
  grid.visible = false;
  scene.add(grid);

  // Only complete asset annotation or both explicit desktop picks can define
  // the scan pair. A new export must never inherit an old A or B coordinate.
  const activeA = new THREE.Vector3(...(initialPair?.a ?? [0, 0, 0]));
  const activeB = new THREE.Vector3(...(initialPair?.b ?? [0, 0, 0]));
  let hasScanA = !!initialPair;
  let hasScanB = !!initialPair;
  const landmarksReady = () => hasScanA && hasScanB;
  const landmarkHint = () => `SCAN ${hasScanA ? 'B' : 'A/B'} NOT SET\nOn PC: exit VR, click EDIT A/B.\nPick scan A, then scan B.\nMatch LEFT/A and RIGHT/B floor marks.\nThen enter VR and press CALIBRATE.`;

  // ---- markers at the predefined landmark points ------------------------
  const markerA = makeMarker(0x00e5ff, 'A');   // cyan = point A (left remote)
  const markerB = makeMarker(0xffa500, 'B');  // orange = point B (right remote)
  const physA = makeMarker(0x00e5ff, null);
  const physB = makeMarker(0xffa500, null);
  physA.visible = physB.visible = false;
  markerA.position.copy(activeA);
  markerB.position.copy(activeB);
  markerA.visible = hasScanA;
  markerB.visible = hasScanB;
  // scan markers live inside the splats group; measured markers in world space
  splats.add(markerA, markerB);
  scene.add(physA, physB);

  let step: 'READY' | 'COUNTDOWN' | 'CONFIRM' | 'DONE' | 'INTERRUPTED' = 'READY';
  let pickToggle: 'A' | 'B' = 'A';
  let landmarkEdit = false; // gate: idle state must NOT modify landmarks
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let secondsLeft = 0;
  let readyWaiting = false;
  let lastPanelText = '';
  let readyHint: string | null = null;
  let confirmAttempts = 0;
  let confirmStartedAt = 0;

  const resetConfirm = (): void => { confirmAttempts = 0; confirmStartedAt = 0; };
  const confirmTimedOut = (): boolean => step === 'CONFIRM' && performance.now() - confirmStartedAt >= CONFIRM_TIMEOUT_MS;
  const confirmHint = (): string => {
    const remaining = CONFIRM_MAX_ATTEMPTS - confirmAttempts;
    return `WAITING FOR REMOTES\nWake BOTH remotes, then place\nLEFT on A and RIGHT on B.\nPINCH or PULL A TRIGGER.\n(${remaining} attempt${remaining === 1 ? '' : 's'} left)`;
  };

  const showPanel = (text: string): void => {
    panel.visible = true;
    if (lastPanelText === text) return;
    lastPanelText = text;
    setText(text);
    onStatus?.(text); // mirror to the PC operator panel
    logger.debug('calib', `panel: ${text.split('\n')[0]}`);
  };

  const clearTimers = (): void => {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
  };

  /** READY names each side instead of treating all joint-bearing inputs as hands. */
  const readyText = (): string => {
    if (!landmarksReady()) return landmarkHint();
    remotes(); // Refresh mutable source metadata before reporting input roles.
    const side = (which: 'left' | 'right'): string => {
      const entries = controllers.filter(entry => entry.source?.handedness === which);
      if (entries.some(entry => entry.kind === 'controller')) return 'controller connected';
      if (entries.some(entry => entry.kind === 'hand')) return 'hand active - pick up controller';
      return 'no controller - press its trigger';
    };
    return 'HALLWAY PROJECT\nLEFT: ' + side('left') + '\nRIGHT: ' + side('right') +
      '\nHold controllers in headset view.\nPress either FRONT trigger to start.';
  };
  /** Calibration opacity: PLY hidden entirely â€” the person sees only the
   *  GUI and the floor grid (Steam Link has no camera input). */
  const calibrationOpacity = (): number => CALIBRATION_OPACITY;

  // Fade timeline after the fit: 0 â†’ 1 over FADE_SECONDS. While it runs the
  // PLY fades IN and the GUI/grid fade OUT (user-specified experience).
  let fadeClock: number | null = null;
  const startFade = (): void => { fadeClock = 0; };
  const resetGui = (): void => {
    fadeClock = null;
    panel.visible = true;
    (panel.material as THREE.SpriteMaterial).opacity = 1;
    grid.visible = true;
    (grid.material as THREE.Material).opacity = GRID_OPACITY;
  };

  /** Title screen: no PLY, only the GUI and the floor grid. */
  const enterReady = (hint?: string): void => {
    onBeforeCalibration?.();
    step = 'READY';
    readyWaiting = false;
    readyHint = hint ?? null;
    resetConfirm();
    secondsLeft = 0;
    physA.visible = physB.visible = false;
    markerA.visible = markerB.visible = false;
    lastRemotePos.left = lastRemotePos.right = null; // fresh attempt
    resetGui();
    setScanOpacity(splats, calibrationOpacity());
    clearTimers();
    showPanel(readyHint ?? readyText());
  };

  const confirmGiveUp = (reason: string): void => {
    logger.warn('calib', `CONFIRM abandoned (${reason}) — back to title screen`);
    enterReady('HALLWAY PROJECT\nRemotes not seen.\nWake BOTH remotes (press a button\non each), then pull a trigger.');
    // A transient loading/focus instruction takes precedence, then the
    // preserved retry hint returns once READY is usable again.
    const blocked = !canCalibrate() ? 'SCAN LOADING\nWait for the title before pulling a trigger.' : calibrationBlockReason();
    if (blocked) { readyWaiting = true; showPanel(blocked); }
  };

  /** Remote trigger starts the placement countdown. */
  const startCountdown = (): void => {
    if (!canCalibrate()) {
      const hint = 'Scan is still loading.\nWait for loading, then press CALIBRATE.';
      if (step === 'READY') readyWaiting = true;
      if (step === 'INTERRUPTED') onStatus?.(hint); else showPanel(hint);
      return;
    }
    if (!landmarksReady()) {
      const hint = landmarkHint();
      if (step === 'INTERRUPTED') onStatus?.(hint);
      else { if (step === 'READY') readyWaiting = true; showPanel(hint); }
      return;
    }
    const blocked = calibrationBlockReason();
    if (blocked) {
      if (step === 'READY') readyWaiting = true;
      if (step === 'INTERRUPTED') onStatus?.(blocked);
      else showPanel(blocked);
      return;
    }
    onBeforeCalibration?.();
    resetGui();
    resetConfirm();
    readyHint = null;
    lastRemotePos.left = lastRemotePos.right = null;
    logger.info('calib', `countdown started â€” ${PLACE_SECONDS}s to place the remotes`);
    step = 'COUNTDOWN';
    setScanOpacity(splats, calibrationOpacity());
    clearTimers();
    secondsLeft = PLACE_SECONDS;
    showPanel(countdownText());
    countdownTimer = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft > 0) {
        showPanel(countdownText());
      } else {
        clearInterval(countdownTimer!);
        countdownTimer = null;
        logger.info('calib', 'countdown ended â€” reading remotes now');
        tryCalibrate();
      }
    }, 1000);
  };

  const countdownText = (): string =>
    `PLACE REMOTES\nPut the remotes on marked FLOOR spots:\nLEFT = A, RIGHT = B\nKeep them in view of the headset.\n${secondsLeft}s left`;

  const onSessionStart = () => enterReady();
  const onSessionEnd = () => {
    clearTimers();
    resetConfirm();
    readyHint = null;
    step = 'INTERRUPTED';
    lastRemotePos.left = lastRemotePos.right = null;
    fadeClock = null;
    panel.visible = false;
    grid.visible = false;
    setScanOpacity(splats, EXPERIENCE_OPACITY);
    onStatus?.('VR session ended. Enter VR again, then press CALIBRATE.');
  };
  renderer.xr.addEventListener('sessionstart', onSessionStart);
  renderer.xr.addEventListener('sessionend', onSessionEnd);

  // ---- solve from the per-attempt physical-controller buffers ------------
  const tryCalibrate = (): void => {
    if (step === 'INTERRUPTED' || !renderer.xr.isPresenting) return;
    if (confirmTimedOut()) { confirmGiveUp('timeout'); return; }
    if (!landmarksReady()) { enterReady(landmarkHint()); return; }
    const blocked = calibrationBlockReason();
    if (blocked) {
      enterReady();
      readyWaiting = true;
      showPanel(blocked);
      return;
    }
    // These positions were sampled while the physical remotes were live.
    // Hand takeover retains those buffers. Missing measurements enter
    // CONFIRM, where later active frames can supply the physical poses.
    // Timers/select events never read an XRFrame or a stale scene-node pose.
    const leftPos = lastRemotePos.left;
    const rightPos = lastRemotePos.right;
    if (!leftPos || !rightPos) {
      // SteamVR hands take over the inputs the moment the remotes are put
      // down â€” the buffer may be empty if no remote streamed during the
      // countdown. Instead of aborting: wait for a CONFIRM trigger.
      logger.warn('calib', 'no buffered remote positions at countdown end â€” entering CONFIRM state (pinch or trigger to read)');
      if (step !== 'CONFIRM') {
        resetConfirm();
        confirmStartedAt = performance.now();
        step = 'CONFIRM';
      }
      showPanel(confirmHint());
      return;
    }
    logger.info('calib', `remotes read â€” ` +
      `LEFT(buffered=${!!lastRemotePos.left})=[${leftPos.toArray().map(n => n.toFixed(2)).join(', ')}] ` +
      `RIGHT(buffered=${!!lastRemotePos.right})=[${rightPos.toArray().map(n => n.toFixed(2)).join(', ')}] ` +
      `distance=${leftPos.distanceTo(rightPos).toFixed(2)} m`);
    if (leftPos.distanceTo(rightPos) < MIN_REMOTE_SEPARATION) {
      logger.error('calib', `fit aborted: remotes only ` +
        `${leftPos.distanceTo(rightPos).toFixed(2)} m apart (min ${MIN_REMOTE_SEPARATION} m). ` +
        `Place the remotes â‰¥1 m apart on the floor.`);
      enterReady(`Controllers only ${leftPos.distanceTo(rightPos).toFixed(2)} m apart.\nPlace LEFT on marked A and RIGHT on B.\nPress a trigger or CALIBRATE to retry.`);
      return;
    }
    const solution = solveYawTranslation([
      { scan: splats.localToWorld(activeA.clone()).toArray() as Vec3, measured: leftPos.toArray() as Vec3 },
      { scan: splats.localToWorld(activeB.clone()).toArray() as Vec3, measured: rightPos.toArray() as Vec3 },
    ]);
    logger.info('calib', 'solving â€” ' +
      `scanA=[${splats.localToWorld(activeA.clone()).toArray().map(n => n.toFixed(2))}] ` +
      `left=[${leftPos.toArray().map(n => n.toFixed(2))}] | ` +
      `scanB=[${splats.localToWorld(activeB.clone()).toArray().map(n => n.toFixed(2))}] ` +
      `right=[${rightPos.toArray().map(n => n.toFixed(2))}] ` +
      `rms=${solution.rmsResidual.toFixed(3)}m`);
    if (!Number.isFinite(solution.rmsResidual) || solution.rmsResidual > MAX_FIT_RMS) {
      logger.error('calib', `fit REJECTED â€” rms=${solution.rmsResidual.toFixed(3)} m ` +
        `(limit ${MAX_FIT_RMS}); remotes do not match the two-point geometry`);
      enterReady('Fit rejected: controller points are inconsistent.\nCheck LEFT is on A and RIGHT on B.\nPress a trigger or CALIBRATE to retry.');
      return;
    }
    const composed = composeCalibration(
      {
        quaternion: splats.quaternion.toArray() as Quat,
        position: splats.position.toArray() as Vec3,
      },
      solution,
    );
    splats.quaternion.set(...composed.quaternion);
    splats.position.set(...composed.position);
    splats.updateMatrixWorld(true);

    physA.position.copy(leftPos);
    physB.position.copy(rightPos);
    physA.visible = physB.visible = true;
    markerA.visible = markerB.visible = true; // verification: on the remotes

    const a = (solution.residuals[0] * 100).toFixed(1);
    const b = (solution.residuals[1] * 100).toFixed(1);
    logger.info('calib', `fit applied â€” yaw=${(solution.yaw * 180 / Math.PI).toFixed(2)}Â°, ` +
      `translation=[${solution.translation.map(v => v.toFixed(2)).join(', ')}]m, ` +
      `fit error A=${a}cm B=${b}cm`);
    step = 'DONE';
    resetConfirm();
    // The reveal: PLY fades in, GUI + grid fade out (1 s, user-specified)
    startFade();
    showPanel(`CALIBRATED âœ“\nA: ${a} cm | B: ${b} cm\nTrigger again to recalibrate`);
    onCalibrated?.(solution);
  };

  const onSelect = (entry: ControllerEntry) => {
    if (!renderer.xr.isPresenting) return;
    if (!entry.source) return;
    const liveSources = renderer.xr.getSession()?.inputSources;
    if (liveSources && !Array.from(liveSources).includes(entry.source)) return;
    refreshInput(entry);
    if (entry.kind === 'unavailable') return;
    if (step === 'INTERRUPTED') {
      // An explicit physical trigger can restart the restored seven-second
      // flow once the current headset view is ready. Hands cannot restart it.
      if (entry.kind === 'controller') startCountdown();
      return;
    }
    // Hands may CONFIRM the reading (SteamVR hands take over when the
    // remotes are placed down) but never drive the wizard or measure.
    if (entry.kind === 'hand' && step !== 'CONFIRM') return;
    if (step === 'COUNTDOWN') return; // nothing during the countdown
    if (step === 'CONFIRM') {
      if (confirmTimedOut()) { confirmGiveUp('timeout'); return; }
      if (lastRemotePos.left && lastRemotePos.right) {
        logger.info('calib', 'confirm trigger â€” reading buffered remote positions');
        tryCalibrate();
      } else {
        confirmAttempts += 1;
        logger.warn('calib', `confirm attempt ${confirmAttempts} failed — remotes still not buffered`);
        if (confirmAttempts >= CONFIRM_MAX_ATTEMPTS) confirmGiveUp('too many failed confirms');
        else showPanel(confirmHint());
      }
      return;
    }
    if (step === 'READY') {
      logger.info('calib', 'trigger pressed â€” starting calibration countdown');
      startCountdown();
      return;
    }
    if (step === 'DONE') {
      logger.info('calib', 'trigger pressed in DONE â€” back to title screen');
      enterReady();
      return;
    }
  };

  // ---- desktop picker: ONLY active in landmark-edit mode (EDIT A/B button).
  // Idle clicks never modify the calibration points.
  const setLandmarkEdit = (on: boolean): void => {
    if (on && renderer.xr.isPresenting) return;
    if (on) onBeforeCalibration?.();
    landmarkEdit = on;
    onLandmarkEdit?.(on);
    logger.info('calib', `landmark edit ${on ? 'ON' : 'OFF'}`);
    if (on) {
      pickToggle = 'A';
      hasScanA = hasScanB = false;
      markerA.visible = markerB.visible = false;
      lastRemotePos.left = lastRemotePos.right = null;
      onStatus?.(`landmark edit ON — previous pair cleared\nClick the scan: 1st click = A, 2nd = B\nBoth picks required; auto-off after B`);
    } else {
      onStatus?.('landmark edit OFF\nIdle clicks do not modify A/B');
    }
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const onPointerDown = (e: PointerEvent): void => {
    if (!landmarkEdit || renderer.xr.isPresenting) return;
    const sm = splats.viewer.splatMesh as unknown as SplatMeshWithCenters;
    const centers = sm.splatDataTextures?.baseData?.centers;
    if (!centers) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    splats.updateMatrixWorld(true);
    const inv = splats.matrixWorld.clone().invert();
    const originLocal = raycaster.ray.origin.clone().applyMatrix4(inv);
    const dirLocal = raycaster.ray.direction.clone().transformDirection(inv);
    const hit = raycastSplatCenters(centers, originLocal, dirLocal);
    if (!hit) return;
    const which = pickToggle;
    if (which === 'A') {
      activeA.copy(hit);
      hasScanA = true;
      markerA.position.copy(hit);
      markerA.visible = true;
      pickToggle = 'B';
    } else {
      activeB.copy(hit);
      hasScanB = true;
      markerB.position.copy(hit);
      markerB.visible = true;
      pickToggle = 'A';
    }
    onLandmarkPicked?.(which, hit.toArray() as Vec3);
    if (which === 'B') setLandmarkEdit(false); // both points set â†’ leave edit mode
  };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  return {
    snapshot: () => ({ step, secondsLeft, hasLeft: !!lastRemotePos.left, hasRight: !!lastRemotePos.right,
      landmarksReady: landmarksReady(), hasScanA, hasScanB,
      scanPointA: hasScanA ? activeA.toArray() : null, scanPointB: hasScanB ? activeB.toArray() : null,
      confirmAttempts, confirmStartedAt, confirmRemainingAttempts: step === 'CONFIRM' ? CONFIRM_MAX_ATTEMPTS - confirmAttempts : 0 }),
    isCapturing: () => step === 'COUNTDOWN' || step === 'CONFIRM',
    invalidate(reason: string) {
      clearTimers();
      resetConfirm();
      readyHint = null;
      step = 'INTERRUPTED';
      lastRemotePos.left = lastRemotePos.right = null;
      fadeClock = null;
      panel.visible = false;
      physA.visible = physB.visible = markerA.visible = markerB.visible = false;
      onStatus?.(`${reason}\nOnce tracking returns, press CALIBRATE on the PC or SteamVR Desktop.`);
    },
    /** PC operator entry point (Link route): start the placement countdown. */
    startCalibration() {
      if (renderer.xr.isPresenting) {
        startCountdown();
      } else {
        showPanel('No VR session running\nStart the session first (Enter VR),\nthen press CALIBRATE');
        panel.visible = false;
      }
    },
    /** The ONLY way to enable landmark re-picking (idle clicks are ignored). */
    setLandmarkEdit(on: boolean) {
      setLandmarkEdit(on);
    },
    /**
     * Call once per rendered frame while presenting: continuously buffers
     * the remotes' streamed grip positions (hand-takeover guard) and runs
     * the post-fit reveal: PLY fades in while GUI + grid fade out.
     */
    sample(deltaSeconds = 1 / 60, frame?: XRFrame) {
      if (!renderer.xr.isPresenting) return;
      if (step === 'INTERRUPTED') return;
      if (confirmTimedOut()) { confirmGiveUp('timeout'); return; }
      if (step === 'READY') {
        const blocked = !canCalibrate() ? 'SCAN LOADING\nWait for the title before pulling a trigger.' :
          !landmarksReady() ? landmarkHint() : calibrationBlockReason();
        if (blocked) {
          readyWaiting = true;
          showPanel(blocked);
          return;
        }
        if (readyWaiting) { readyWaiting = false; showPanel(readyHint ?? readyText()); }
        else if (!readyHint) showPanel(readyText());
      }
      sampleRemotePositions(frame);
      if (fadeClock !== null) {
        fadeClock += deltaSeconds;
        const k = Math.min(1, fadeClock / FADE_SECONDS);
        setScanOpacity(splats, k * EXPERIENCE_OPACITY);
        (panel.material as THREE.SpriteMaterial).opacity = 1 - k;
        (grid.material as THREE.Material).opacity = GRID_OPACITY * (1 - k);
        if (k >= 1) {
          fadeClock = null;
          panel.visible = false;
          grid.visible = false;
          logger.info('calib', 'reveal complete â€” PLY fully visible, GUI hidden');
        }
      }
    },
    dispose() {
      clearTimers();
      resetConfirm();
      renderer.xr.removeEventListener('sessionstart', onSessionStart);
      renderer.xr.removeEventListener('sessionend', onSessionEnd);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      camera.remove(panel);
      scene.remove(grid);
      splats.remove(markerA, markerB);
      scene.remove(physA, physB);
    },
  };
}

function makeMarker(color: number, label: string | null): THREE.Group {
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 16),
    new THREE.MeshBasicMaterial({ color, depthTest: false }),
  );
  sphere.renderOrder = 999;
  group.add(sphere);
  if (label) {
    const text = makeLabel(label, color);
    text.position.y = 0.15;
    group.add(text);
  }
  return group;
}

function makeLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.font = 'bold 96px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 64);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    depthTest: false,
    transparent: true,
  }));
  sprite.scale.set(0.22, 0.22, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function makeTextPanel(): { sprite: THREE.Sprite; setText(text: string): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  sprite.scale.set(1.15, 0.36, 1);
  const setText = (text: string) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 10, 14, 0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#444';
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    ctx.fillStyle = '#6fd08c';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    const lineH = 46;
    const startY = canvas.height / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineH));
    texture.needsUpdate = true;
  };
  return { sprite, setText };
}
