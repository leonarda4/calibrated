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
import { SCAN_POINT_A, SCAN_POINT_B } from '../calibration/landmarks';
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

interface SplatMeshWithCenters {
  splatDataTextures?: { baseData?: { centers?: Float32Array } };
}

interface ControllerEntry {
  ctrl: THREE.Group;
  grip: THREE.Group;
  source: XRInputSource | null;
  /** true for hand-tracking inputs (Steam Link passes Quest hands through) â€”
   *  these are NOT remotes and are ignored by the calibration. */
  isHand: boolean;
}

/** Input source classification: hands (tracked via hand tracking) vs remotes. */
function isHandInput(source: XRInputSource): boolean {
  const s = source as unknown as { hand?: unknown; profiles?: readonly string[] };
  return s.hand != null || (s.profiles ?? []).some((p) => String(p).includes('hand'));
}

export type LandmarkPickCallback = (which: 'A' | 'B', point: Vec3) => void;

export function setupCalibrationCapture(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  splats: GaussianSplats3D.DropInViewer,
  onCalibrated?: (solution: YawTranslationSolution) => void,
  onLandmarkPicked?: LandmarkPickCallback,
  onStatus?: (text: string) => void,
  onLandmarkEdit?: (active: boolean) => void,
): { startCalibration(): void; setLandmarkEdit(on: boolean): void; sample(deltaSeconds?: number): void; dispose(): void } {
  // ---- input sources: up to 4 slots (2 remotes + 2 hands) ------------------
  // Steam Link passes Quest hand tracking through as input sources; hands
  // are classified and IGNORED â€” only physical remotes drive the calibration.
  const controllers: ControllerEntry[] = [];
  for (let i = 0; i < 4; i++) {
    const ctrl = renderer.xr.getController(i);
    const grip = renderer.xr.getControllerGrip(i);
    const entry: ControllerEntry = { ctrl, grip, source: null, isHand: false };
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -6),
      ]),
      new THREE.LineBasicMaterial({ color: 0x00e5ff }),
    );
    ctrl.add(ray);
    ctrl.visible = grip.visible = false;
    ctrl.addEventListener('connected', (e) => {
      entry.source = (e as unknown as { data: XRInputSource }).data;
      entry.isHand = entry.source ? isHandInput(entry.source) : false;
      // hands get no ray and stay invisible; they must not look like remotes
      const show = !entry.isHand;
      ctrl.visible = grip.visible = show;
      ray.visible = show;
      const gp = entry.source?.gamepad;
      const s = entry.source as unknown as { profiles?: readonly string[] };
      logger.info('calib', `input #${i} connected â€” ` +
        `hand=${entry.source?.handedness ?? '?'}, ` +
        `type=${entry.isHand ? 'HAND (ignored)' : 'remote'}, ` +
        `profiles=${(s?.profiles ?? []).join('|') || 'none'}, ` +
        `gamepad=${gp ? `yes (${gp.axes.length} axes, ${gp.buttons.length} buttons)` : 'NO'}`);
      if (step === 'READY') showPanel(readyText()); // live remote count
    });
    ctrl.addEventListener('disconnected', () => {
      entry.source = null;
      entry.isHand = false;
      ctrl.visible = grip.visible = false;
      ray.visible = false;
      logger.warn('calib', `input #${i} disconnected`);
      if (step === 'READY') showPanel(readyText()); // live remote count
    });
    ctrl.addEventListener('selectstart', () => onSelect(entry));
    scene.add(ctrl, grip);
    controllers.push(entry);
  }
  /** Physical remotes only (hands excluded). */
  const remotes = (): ControllerEntry[] =>
    controllers.filter((c) => c.source && !c.isHand && c.source.gamepad);
  const byHand = (hand: string): ControllerEntry | undefined => {
    const pool = remotes();
    return pool.find((c) => c.source?.handedness === hand)
      ?? pool[hand === 'left' ? 0 : pool.length - 1];
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
  const sampleRemotePositions = (): void => {
    for (const entry of remotes()) {
      const hand = entry.source?.handedness;
      if (hand !== 'left' && hand !== 'right') continue;
      lastRemotePos[hand] = remotePoint(entry);
    }
  };
  const left0 = (): ControllerEntry | undefined => byHand('left');
  const right0 = (): ControllerEntry | undefined => byHand('right');

  // ---- HUD: parented to the camera â†’ sticks rigidly to the view ----------
  const { sprite: panel, setText } = makeTextPanel();
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

  // Session-active landmark points: start from the committed constants and
  // can only be changed through the EDIT A/B button (never by idle clicks).
  const activeA = new THREE.Vector3(...SCAN_POINT_A);
  const activeB = new THREE.Vector3(...SCAN_POINT_B);

  // ---- markers at the predefined landmark points ------------------------
  const markerA = makeMarker(0x00e5ff, 'A');   // cyan = point A (left remote)
  const markerB = makeMarker(0xffa500, 'B');  // orange = point B (right remote)
  const physA = makeMarker(0x00e5ff, null);
  const physB = makeMarker(0xffa500, null);
  physA.visible = physB.visible = false;
  markerA.position.copy(activeA);
  markerB.position.copy(activeB);
  // scan markers live inside the splats group; measured markers in world space
  splats.add(markerA, markerB);
  scene.add(physA, physB);

  let step: 'READY' | 'COUNTDOWN' | 'CONFIRM' | 'DONE' = 'READY';
  let pickToggle: 'A' | 'B' = 'A';
  let landmarkEdit = false; // gate: idle state must NOT modify landmarks
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let secondsLeft = 0;

  const showPanel = (text: string): void => {
    panel.visible = true;
    setText(text);
    onStatus?.(text); // mirror to the PC operator panel
    logger.debug('calib', `panel: ${text.split('\n')[0]}`);
  };

  const clearTimers = (): void => {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
  };

  /** READY screen: title + live remote count (hands excluded). */
  const readyText = (): string => {
    const pool = remotes();
    const left = pool.some((c) => c.source?.handedness === 'left');
    const right = pool.some((c) => c.source?.handedness === 'right');
    const hands = controllers.filter((c) => c.isHand).length;
    const countLine = pool.length === 0
      ? 'Remotes: none found yet\n(press a button on each remote)'
      : `Remotes: ${pool.length}${left && right ? ' (L+R)' : ''}` +
        `${hands ? ` â€” hands ignored: ${hands}` : ''}`;
    return `HALLWAY PROJECT\nPress TRIGGER on a remote\nto start calibration.\n${countLine}`;
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
  const enterReady = (): void => {
    step = 'READY';
    physA.visible = physB.visible = false;
    markerA.visible = markerB.visible = false;
    lastRemotePos.left = lastRemotePos.right = null; // fresh attempt
    resetGui();
    setScanOpacity(splats, calibrationOpacity());
    clearTimers();
    showPanel(readyText());
  };

  /** Remote trigger starts the placement countdown. */
  const startCountdown = (): void => {
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
    `PLACE REMOTES\nPut the remotes on the FLOOR:\nLEFT = spot A, RIGHT = spot B\n(any spots 1 m or more apart â€”\nthe hallway aligns TO them)\n${secondsLeft}s left`;

  renderer.xr.addEventListener('sessionstart', enterReady);
  renderer.xr.addEventListener('sessionend', () => {
    clearTimers();
    panel.visible = false;
    grid.visible = false;
  });

  // ---- solve from the remotes' current positions --------------------------
  const remotePoint = (entry: ControllerEntry): THREE.Vector3 => {
    const gripPos = entry.grip.getWorldPosition(new THREE.Vector3());
    const offset = new THREE.Vector3(...PROBE_TIP_OFFSET)
      .applyQuaternion(entry.grip.getWorldQuaternion(new THREE.Quaternion()));
    return gripPos.add(offset);
  };

  const tryCalibrate = (): void => {
    // Prefer the BUFFERED remote positions: they were streamed while the
    // remotes were live. If hands took over after the remotes were placed
    // down, the buffer still holds their true floor spots. Fall back to a
    // live read only when there is no buffer (remotes never streamed).
    sampleRemotePositions(); // last frame sample before deciding
    const leftPos = lastRemotePos.left ?? (left0() ? remotePoint(left0()!) : null);
    const rightPos = lastRemotePos.right ?? (right0() ? remotePoint(right0()!) : null);
    if (!leftPos || !rightPos) {
      // SteamVR hands take over the inputs the moment the remotes are put
      // down â€” the buffer may be empty if no remote streamed during the
      // countdown. Instead of aborting: wait for a CONFIRM trigger.
      logger.warn('calib', 'no buffered remote positions at countdown end â€” entering CONFIRM state (pinch or trigger to read)');
      step = 'CONFIRM';
      showPanel('WAITING FOR REMOTES\nHold BOTH remotes up briefly\nso they register, place them on\nthe floor, then PINCH (hand) or\nPULL A TRIGGER to confirm');
      return;
    }
    logger.info('calib', `remotes read â€” ` +
      `LEFT(buffered=${!!lastRemotePos.left})=[${leftPos.toArray().map(n => n.toFixed(2)).join(', ')}] ` +
      `RIGHT(buffered=${!!lastRemotePos.right})=[${rightPos.toArray().map(n => n.toFixed(2)).join(', ')}] ` +
      `distance=${leftPos.distanceTo(rightPos).toFixed(2)} m`);
    if (leftPos.length() < 0.05 || rightPos.length() < 0.05) {
      logger.error('calib', 'fit aborted: remote positions untracked (near origin)');
      showPanel('Remotes not tracked yet\nMove them a little, then use\nthe button to restart');
      enterReady();
      return;
    }
    if (leftPos.distanceTo(rightPos) < MIN_REMOTE_SEPARATION) {
      logger.error('calib', `fit aborted: remotes only ` +
        `${leftPos.distanceTo(rightPos).toFixed(2)} m apart (min ${MIN_REMOTE_SEPARATION} m). ` +
        `Place the remotes â‰¥1 m apart on the floor.`);
      showPanel(`Remotes only ${leftPos.distanceTo(rightPos).toFixed(2)} m apart.\nPlace them at least 1 m apart\non the floor â€” widely separated\nspots give a precise fit`);
      enterReady();
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
    if (solution.rmsResidual > MAX_FIT_RMS) {
      logger.error('calib', `fit REJECTED â€” rms=${solution.rmsResidual.toFixed(3)} m ` +
        `(limit ${MAX_FIT_RMS}); remotes do not match the two-point geometry`);
      showPanel('Fit rejected â€” remotes inconsistent\nCheck that LEFT is on A and\nRIGHT is on B, then restart');
      enterReady();
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
    // The reveal: PLY fades in, GUI + grid fade out (1 s, user-specified)
    startFade();
    showPanel(`CALIBRATED âœ“\nA: ${a} cm | B: ${b} cm\nTrigger again to recalibrate`);
    onCalibrated?.(solution);
  };

  const onSelect = (entry: ControllerEntry) => {
    if (!renderer.xr.isPresenting) return;
    // Hands may CONFIRM the reading (SteamVR hands take over when the
    // remotes are placed down) but never drive the wizard or measure.
    if (entry.isHand && step !== 'CONFIRM') return;
    if (step === 'COUNTDOWN') return; // nothing during the countdown
    if (step === 'CONFIRM') {
      sampleRemotePositions(); // freshest buffered positions
      if (lastRemotePos.left && lastRemotePos.right) {
        logger.info('calib', 'confirm trigger â€” reading buffered remote positions');
        tryCalibrate();
      } else {
        showPanel('Remotes not seen yet.\nHold BOTH remotes up briefly\n(they must register), place them,\nthen pinch / trigger again');
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
    landmarkEdit = on;
    onLandmarkEdit?.(on);
    logger.info('calib', `landmark edit ${on ? 'ON' : 'OFF'}`);
    if (on) {
      pickToggle = 'A';
      onStatus?.(`landmark edit ON\nClick the scan: 1st click = A, 2nd = B\nAuto-off after B`);
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
      markerA.position.copy(hit);
      markerA.visible = true;
      pickToggle = 'B';
    } else {
      activeB.copy(hit);
      markerB.position.copy(hit);
      markerB.visible = true;
      pickToggle = 'A';
    }
    onLandmarkPicked?.(which, hit.toArray() as Vec3);
    if (which === 'B') setLandmarkEdit(false); // both points set â†’ leave edit mode
  };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  return {
    /** PC operator entry point (Link route): start the placement countdown. */
    startCalibration() {
      if (renderer.xr.isPresenting) {
        startCountdown();
      } else {
        showPanel('No VR session running\nStart the session first (Enter VR),\nthen press CALIBRATE');
        onStatus?.('no VR session running');
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
    sample(deltaSeconds = 1 / 60) {
      if (!renderer.xr.isPresenting) return;
      sampleRemotePositions();
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
