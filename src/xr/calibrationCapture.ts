// src/xr: placement-only calibration with predefined landmarks.
//
//   ENTER VR → markers show where points A and B are on the scan →
//   put the LEFT remote on real spot A and the RIGHT remote on spot B →
//   pull the trigger → solved and applied. That is the entire flow.
//
// If the world shifts (e.g. after leaving the boundary box), aim at the
// green ⟲ CALIBRATE button and pull the trigger, then re-place the remotes.
// There is NO automatic re-arrangement of the scan — per user decision that
// machinery was removed; the boundary restriction is accepted.
//
// The instruction HUD is parented to the camera, so it sticks rigidly to
// the user's view. The XR rig itself is never moved — only the scan root.

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
const PANEL_HOLD_MS = 4000;        // final message stays this long
const PLACE_SECONDS = 10;          // countdown to place the remotes
// Guided-experience protocol (user-specified): during calibration the person
// sees ONLY the real world (camera passthrough) + GUI — the scan is fully
// hidden, so first-time users can see where to place the remotes. The PLY
// fades in only after a successful fit.
const CALIBRATION_OPACITY = 0.0;
const OPAQUE_CALIBRATION_OPACITY = 0.5; // opaque (SteamVR) route: no passthrough → keep the scan visible
const EXPERIENCE_OPACITY = 1.0;     // full quality once calibrated
const FADE_IN_SPEED = 0.8;          // opacity per second when the PLY appears
const MIN_REMOTE_SEPARATION = 0.3; // m — A and B must be distinguishable
const MAX_FIT_RMS = 1;             // m — refuse nonsense fits

interface SplatMeshWithCenters {
  splatDataTextures?: { baseData?: { centers?: Float32Array } };
}

interface ControllerEntry {
  ctrl: THREE.Group;
  grip: THREE.Group;
  source: XRInputSource | null;
  /** true for hand-tracking inputs (Steam Link passes Quest hands through) —
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
  // are classified and IGNORED — only physical remotes drive the calibration.
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
      logger.info('calib', `input #${i} connected — ` +
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
  // remote was live is its true placement spot — so we buffer every frame
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

  // ---- HUD: parented to the camera → sticks rigidly to the view ----------
  const { sprite: panel, setText } = makeTextPanel();
  const button = makeButtonSprite();
  panel.visible = button.visible = false;
  panel.renderOrder = 1000;
  button.renderOrder = 1000;
  panel.position.set(0, 0.22, -HUD_DISTANCE);
  // button sits far below the forward line of sight: invisible when looking
  // straight ahead — look down to find it (like a toolbar at your feet)
  button.position.set(0, -1.4, -HUD_DISTANCE);
  camera.add(panel, button);

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
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let secondsLeft = 0;

  const showPanel = (text: string): void => {
    panel.visible = true;
    setText(text);
    onStatus?.(text); // mirror to the PC operator panel
    logger.debug('calib', `panel: ${text.split('\n')[0]}`);
  };

  const clearTimers = (): void => {
    if (holdTimer) clearTimeout(holdTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    holdTimer = countdownTimer = null;
  };

  /** READY screen text including the live remote count (hands excluded). */
  const readyText = (): string => {
    const pool = remotes();
    const left = pool.some((c) => c.source?.handedness === 'left');
    const right = pool.some((c) => c.source?.handedness === 'right');
    const hands = controllers.filter((c) => c.isHand).length;
    const countLine = pool.length === 0
      ? 'Remotes found: NONE\n(press a button on each remote)'
      : `Remotes found: ${pool.length}${left && right ? ' (L+R)' : ''}` +
        `${hands ? ` — hands ignored: ${hands}` : ''}`;
    return `CALIBRATE\n${countLine}\nTrigger the green button below.\nThen: LEFT remote = spot A,\nRIGHT = spot B, ≥1 m apart on floor`;
  };

  /** Calibration opacity depends on the route: passthrough routes keep the
   *  scan faint (camera visible); opaque routes (SteamVR) have no camera —
   *  the scan stays clearly visible instead. */
  const calibrationOpacity = (): number => {
    try {
      return renderer.xr.getSession()?.environmentBlendMode === 'opaque'
        ? OPAQUE_CALIBRATION_OPACITY : CALIBRATION_OPACITY;
    } catch { return CALIBRATION_OPACITY; }
  };

  // Smooth opacity target — lerped every frame in sample() so the PLY can
  // FADE IN after a successful fit instead of popping.
  let targetOpacity: number | null = null; // null = no fade running

  /** "CALIBRATE" start screen: camera + GUI only, scan fully hidden. */
  const enterReady = (): void => {
    step = 'READY';
    physA.visible = physB.visible = false;
    markerA.visible = markerB.visible = false; // no floating markers while guiding
    button.visible = true;
    lastRemotePos.left = lastRemotePos.right = null; // fresh attempt
    targetOpacity = null;
    setScanOpacity(splats, calibrationOpacity());
    clearTimers();
    showPanel(readyText());
  };

  /** Trigger on the button starts the placement countdown. */
  const startCountdown = (): void => {
    logger.info('calib', `countdown started — ${PLACE_SECONDS}s to place the remotes`);
    step = 'COUNTDOWN';
    button.visible = false;
    setScanOpacity(splats, calibrationOpacity());
    clearTimers();
    secondsLeft = PLACE_SECONDS;
    showPanel(
      `PLACE REMOTES\nPut the remotes on the FLOOR:\nLEFT = spot A, RIGHT = spot B\n(any spots ≥1 m apart —\nthe SCAN aligns TO the remotes)\n${secondsLeft}s left`,
    );
    countdownTimer = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft > 0) {
        showPanel(
          `PLACE REMOTES\nPut the remotes on the FLOOR:\nLEFT = spot A, RIGHT = spot B\n(any spots ≥1 m apart —\nthe SCAN aligns TO the remotes)\n${secondsLeft}s left`,
        );
      } else {
        clearInterval(countdownTimer!);
        countdownTimer = null;
        logger.info('calib', 'countdown ended — reading remotes now');
        tryCalibrate();
      }
    }, 1000);
  };

  renderer.xr.addEventListener('sessionstart', enterReady);
  renderer.xr.addEventListener('sessionend', () => {
    clearTimers();
    panel.visible = button.visible = false;
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
      // down — the buffer may be empty if no remote streamed during the
      // countdown. Instead of aborting: wait for a CONFIRM trigger.
      logger.warn('calib', 'no buffered remote positions at countdown end — entering CONFIRM state (pinch or trigger to read)');
      step = 'CONFIRM';
      showPanel('WAITING FOR REMOTES\nHold BOTH remotes up briefly\nso they register, place them on\nthe floor, then PINCH (hand) or\nPULL A TRIGGER to confirm');
      return;
    }
    logger.info('calib', `remotes read — ` +
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
        `Place the remotes ≥1 m apart on the floor.`);
      showPanel(`Remotes only ${leftPos.distanceTo(rightPos).toFixed(2)} m apart.\nPlace them at least 1 m apart\non the floor — widely separated\nspots give a precise fit`);
      enterReady();
      return;
    }
    const solution = solveYawTranslation([
      { scan: splats.localToWorld(activeA.clone()).toArray() as Vec3, measured: leftPos.toArray() as Vec3 },
      { scan: splats.localToWorld(activeB.clone()).toArray() as Vec3, measured: rightPos.toArray() as Vec3 },
    ]);
    logger.info('calib', 'solving — ' +
      `scanA=[${splats.localToWorld(activeA.clone()).toArray().map(n => n.toFixed(2))}] ` +
      `left=[${leftPos.toArray().map(n => n.toFixed(2))}] | ` +
      `scanB=[${splats.localToWorld(activeB.clone()).toArray().map(n => n.toFixed(2))}] ` +
      `right=[${rightPos.toArray().map(n => n.toFixed(2))}] ` +
      `rms=${solution.rmsResidual.toFixed(3)}m`);
    if (solution.rmsResidual > MAX_FIT_RMS) {
      logger.error('calib', `fit REJECTED — rms=${solution.rmsResidual.toFixed(3)} m ` +
        `(limit ${MAX_FIT_RMS}); remotes do not match the two-point geometry`);
      showPanel('Fit rejected — remotes inconsistent\nCheck that LEFT is on A and\nRIGHT is on B, then restart');
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
    markerA.visible = markerB.visible = true; // verification: markers sit on the remotes

    const a = (solution.residuals[0] * 100).toFixed(1);
    const b = (solution.residuals[1] * 100).toFixed(1);
    logger.info('calib', `fit applied — yaw=${(solution.yaw * 180 / Math.PI).toFixed(2)}°, ` +
      `translation=[${solution.translation.map(v => v.toFixed(2)).join(', ')}]m, ` +
      `fit error A=${a}cm B=${b}cm`);
    step = 'DONE';
    button.visible = true;
    // The PLY fades in over the camera: the guided-experience moment
    targetOpacity = EXPERIENCE_OPACITY;
    showPanel(`CALIBRATED ✓\nThe scan moved TO your remotes.\nCheck: markers now sit\non LEFT (A) and RIGHT (B).\nA: ${a} cm | B: ${b} cm`);
    onCalibrated?.(solution);
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { panel.visible = false; }, PANEL_HOLD_MS);
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
        logger.info('calib', 'confirm trigger — reading buffered remote positions');
        tryCalibrate();
      } else {
        showPanel('Remotes not seen yet.\nHold BOTH remotes up briefly\n(they must register), place them,\nthen pinch / trigger again');
      }
      return;
    }
    // READY / DONE: does this controller's ray hit the ⟲ button?
    const origin = entry.ctrl.getWorldPosition(new THREE.Vector3());
    const dir = entry.ctrl.getWorldDirection(new THREE.Vector3()).negate();
    const toButton = button.getWorldPosition(new THREE.Vector3()).sub(origin);
    const t = toButton.dot(dir);
    const perpendicular = toButton.clone().addScaledVector(dir, -t).length();
    const hit = t > 0.2 && t < 5 && perpendicular < 0.25;
    logger.debug('calib', `selectstart (${entry.source?.handedness ?? '?'}) — ` +
      `step=${step}, buttonRayDist=${t.toFixed(2)}m, off=${perpendicular.toFixed(2)}m → ` +
      `${hit ? 'HIT' : 'MISS'}`);
    if (hit) startCountdown();
    else if (step === 'READY') {
      showPanel('Trigger registered, but the ray\nMISSED the button.\nLook DOWN — the green button\nsits below your view.');
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
    if (which === 'B') setLandmarkEdit(false); // both points set → leave edit mode
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
     * the PLY fade-in after a successful fit.
     */
    sample(deltaSeconds = 1 / 60) {
      if (!renderer.xr.isPresenting) return;
      sampleRemotePositions();
      if (targetOpacity !== null) {
        const material = splats.viewer.splatMesh.material as unknown as
          { uniforms?: { uGlobalOpacity?: { value: number } } };
        const current = material?.uniforms?.uGlobalOpacity?.value ?? 0;
        const next = Math.min(targetOpacity, current + FADE_IN_SPEED * deltaSeconds);
        setScanOpacity(splats, next);
        if (next >= targetOpacity - 1e-4) targetOpacity = null; // fade complete
      }
    },
    dispose() {
      clearTimers();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      camera.remove(panel, button);
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

/** Small green "⟲ CALIBRATE" button the user aims at with the ray. */
function makeButtonSprite(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#6fd08c';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(6, 6, canvas.width - 12, canvas.height - 12, 28);
  } else {
    ctx.rect(6, 6, canvas.width - 12, canvas.height - 12);
  }
  ctx.fill();
  ctx.fillStyle = '#101014';
  ctx.font = 'bold 44px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⟲ CALIBRATE', canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  sprite.scale.set(0.42, 0.105, 1);
  return sprite;
}