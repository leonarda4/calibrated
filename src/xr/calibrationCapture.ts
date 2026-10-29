// src/xr: guided landmark calibration — the two remotes ARE the physical
// landmarks (user-specified protocol).
//
//   1/4  A_SCAN — aim the ray at scan point A in the PLY (left remote will
//                  represent its real-world spot). Sticks move the scan:
//                  LEFT stick = forward/back, RIGHT stick = left/right + up/down.
//   2/4  B_SCAN — aim at scan point B in the PLY (right remote represents it).
//   3/4  PLACE  — 10-second countdown: put the LEFT remote on real spot A
//                  and the RIGHT remote on real spot B (scan faded out so
//                  the camera feed shows the room).
//   4/4  DONE   — the remotes' tracked positions are read as the measured
//                  physical points; yaw+translation is solved and applied.
//                  The remotes remain REFERENCE ANCHORS: a tracking reset
//                  (guardian/passthrough takeover) re-solves automatically
//                  from wherever the remotes currently are.
//
// Invariants (docs/PROJECT_PLAN.md): the XR rig is never moved — the scan
// root is the only transformed object. Scan picks are stored in the root's
// LOCAL frame so stick moves between picks cannot corrupt the fit.

import * as THREE from 'three';
import type * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { raycastSplatCenters } from '../viewer/splatRaycast';
import { setScanOpacity, SCAN_OPACITY } from '../viewer/splatViewer';
import {
  solveYawTranslation, composeCalibration,
  type YawTranslationSolution, type Vec3, type Quat,
} from '../calibration/yawTranslationSolver';

/**
 * Offset from the controller GRIP ORIGIN to the physical point that is
 * placed on the landmark, in controller-local metres [x, y, z] — e.g. the
 * top edge of the tracking ring or the tip you rest against a corner.
 * Zero means the grip origin is treated as the placed point.
 */
export const PROBE_TIP_OFFSET: Vec3 = [0, 0, 0];

const STORAGE_KEY = 'calibrated.scanRoot.v1';
const PLACE_SECONDS = 10;          // countdown to place both remotes
const DOLLY_Z_SPEED = 3.0;         // m/s, left stick forward/back
const DOLLY_X_SPEED = 2.0;         // m/s, right stick left/right
const DOLLY_Y_SPEED = 1.5;         // m/s, right stick up/down
const STICK_DEADZONE = 0.15;
const RECAL_RMS_LIMIT = 1;         // m — above this the remotes must have moved
const WATCH_INTERVAL = 1.5;        // s — watchdog cadence while armed
const PREFIT_TRIGGER = 0.10;       // m — min scan↔remote drift before recal
const CONSISTENT_AGAIN = 0.05;     // m — drift below which references are OK again

// Tour mode (immersive walkthrough of a ~30 m scan from inside a small
// boundary): virtual locomotion by moving the MAP — the rig is never moved.
const TOUR_WALK_SPEED = 2.2;       // m/s, left stick
const TOUR_TURN_SPEED = 45;        // deg/s, right stick left/right
const TOUR_ELEVATE_SPEED = 1.2;    // m/s, right stick up/down
const TOUR_AUTOWALK_SPEED = 1.2;   // m/s, hold trigger

type Step = 'A_SCAN' | 'B_SCAN' | 'PLACE_REFS' | 'ARMED' | 'INVALID';

interface SplatMeshWithCenters {
  splatDataTextures?: { baseData?: { centers?: Float32Array } };
}

interface ControllerEntry {
  ctrl: THREE.Group;  // target-ray space
  grip: THREE.Group;  // grip space
  source: XRInputSource | null;
}

export interface CalibrationCapture {
  /** Call once per frame with the active camera and the frame delta time. */
  update(activeCamera: THREE.Camera, deltaSeconds: number): void;
}

export function setupCalibrationCapture(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  splats: GaussianSplats3D.DropInViewer,
  onCalibrated?: (solution: YawTranslationSolution) => void,
): CalibrationCapture {
  // ---- both controllers --------------------------------------------------
  const controllers: ControllerEntry[] = [];
  for (let i = 0; i < 2; i++) {
    const ctrl = renderer.xr.getController(i);
    const grip = renderer.xr.getControllerGrip(i);
    const entry: ControllerEntry = { ctrl, grip, source: null };
    ctrl.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -6),
      ]),
      new THREE.LineBasicMaterial({ color: 0x00e5ff }),
    ));
    ctrl.visible = grip.visible = false;
    ctrl.addEventListener('connected', (e) => {
      entry.source = (e as unknown as { data: XRInputSource }).data;
      ctrl.visible = grip.visible = true;
    });
    ctrl.addEventListener('disconnected', () => {
      entry.source = null;
      ctrl.visible = grip.visible = false;
    });
    ctrl.addEventListener('selectstart', () => onSelect(entry));
    ctrl.addEventListener('selectend', () => { triggerHeld = false; });
    ctrl.addEventListener('squeezestart', onSqueeze);
    scene.add(ctrl, grip);
    controllers.push(entry);
  }
  const byHand = (hand: string): ControllerEntry | undefined =>
    controllers.find((c) => c.source?.handedness === hand)
    ?? controllers[hand === 'left' ? 0 : 1];

  // ---- mode: wizard (calibration) vs tour (immersive walkthrough) --------
  let mode: 'wiz' | 'tour' = 'wiz';
  let triggerHeld = false;
  const tourButtonWas = [false, false]; // A/X edge detection per controller

  const modeLineText = (): string => {
    try {
      const session = renderer.xr.getSession() as XRSession | null;
      const blend = session?.environmentBlendMode;
      if (blend === 'opaque') return '\nmode: opaque (VR — no passthrough!)';
      if (blend) return '\nmode: passthrough ✓';
    } catch { /* session not queryable here */ }
    return '';
  };

  const enterTour = () => {
    mode = 'tour';
    triggerHeld = false;
    setScanOpacity(splats, SCAN_OPACITY);
    setText(
      'TOUR MODE\nL stick: walk fwd/back + strafe\nR stick: turn + up/down\nHold trigger: auto-walk\nA/X: back to calibration\nSqueeze: back to calibration' +
      modeLineText(),
    );
  };

  const exitTour = () => {
    mode = 'wiz';
    setStep(step); // refresh the wizard panel for the current step
  };

  // ---- instruction panel -------------------------------------------------
  const { sprite, setText } = makeTextPanel();
  sprite.visible = false;
  scene.add(sprite);

  // scan markers live INSIDE the splats group (stick moves keep them glued);
  // the "measured" markers show where the remotes were read in real space.
  const scanMarkerA = makeMarker(0x00e5ff);
  const scanMarkerB = makeMarker(0x00e5ff);
  const physMarkerA = makeMarker(0xffa500);
  const physMarkerB = makeMarker(0xffa500);
  for (const m of [scanMarkerA, scanMarkerB, physMarkerA, physMarkerB]) m.visible = false;
  splats.add(scanMarkerA, scanMarkerB);
  scene.add(physMarkerA, physMarkerB);

  const scanLocalA = new THREE.Vector3();
  const scanLocalB = new THREE.Vector3();
  let haveA = false;
  let haveB = false;
  let step: Step = 'A_SCAN';
  let vrMode = false;            // opaque blend → no passthrough available
  let placeTimer = 0;
  let placeTextTick = 0;

  const instructions: Record<'A_SCAN' | 'B_SCAN', string> = {
    A_SCAN: '1/4 SCAN POINT A\nAim ray at scan point A, trigger\n(LEFT remote will mark its real spot)\nSticks move scan: L=fwd/back R=X/Y',
    B_SCAN: '2/4 SCAN POINT B\nAim ray at scan point B, trigger\n(RIGHT remote will mark its real spot)\nSticks: L=fwd/back R=X/Y',
  };

  const setStep = (next: Step, extra = '') => {
    step = next;
    // opacity per phase: placing the remotes needs to see the room, so the
    // scan fades out during the countdown; picking needs the scan visible.
    const faded = vrMode ? 0.25 : 0.04;
    setScanOpacity(splats, next === 'PLACE_REFS' ? faded : SCAN_OPACITY);

    let modeLine = '';
    try {
      const session = renderer.xr.getSession() as XRSession | null;
      const blend = session?.environmentBlendMode;
      if (blend) {
        modeLine = blend === 'opaque'
          ? '\nmode: opaque (VR — no passthrough!)'
          : '\nmode: passthrough ✓';
      }
    } catch { /* session not queryable here */ }

    if (next === 'PLACE_REFS') {
      setText(`3/4 PLACE REMOTES\nLEFT remote on real spot A\nRIGHT remote on spot B\n${extra}${modeLine}`);
    } else if (next === 'ARMED') {
      setText(`4/4 CALIBRATED ✓\nLeft remote = A, right = B\nTracking resets auto-realign now\nSqueeze = recalibrate${extra ? `\n${extra}` : ''}${modeLine}`);
    } else if (next === 'INVALID') {
      setText(`REFERENCES LOST\nRemotes moved? Re-place & squeeze,\nor recalibrate manually${modeLine}`);
    } else {
      setText(instructions[next as 'A_SCAN' | 'B_SCAN'] + (extra ? `\n${extra}` : '') + modeLine);
    }
  };

  const resetWizard = () => {
    haveA = haveB = false;
    for (const m of [scanMarkerA, scanMarkerB, physMarkerA, physMarkerB]) m.visible = false;
    placeTimer = 0;
    setStep('A_SCAN');
  };

  // ---- persistence: saved transform is a candidate, never proof ---------
  const saveScanRoot = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        quaternion: splats.quaternion.toArray() as Quat,
        position: splats.position.toArray() as Vec3,
        scanA: scanLocalA.toArray() as Vec3,
        scanB: scanLocalB.toArray() as Vec3,
        savedAt: Date.now(),
      }));
    } catch { /* storage unavailable — session-only calibration */ }
  };

  /** Restore transform AND the landmark pairs (needed for auto-recal). */
  const restoreScanRoot = (): boolean => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw) as {
        quaternion: Quat; position: Vec3; scanA?: Vec3; scanB?: Vec3;
      };
      splats.quaternion.set(...saved.quaternion);
      splats.position.set(...saved.position);
      splats.updateMatrixWorld(true);
      if (saved.scanA && saved.scanB) {
        scanLocalA.fromArray(saved.scanA);
        scanLocalB.fromArray(saved.scanB);
        haveA = haveB = true;
        scanMarkerA.position.copy(scanLocalA);
        scanMarkerB.position.copy(scanLocalB);
        scanMarkerA.visible = scanMarkerB.visible = true;
      }
      return true;
    } catch { return false; }
  };

  // ---- solving -----------------------------------------------------------
  const remotePoint = (entry: ControllerEntry): THREE.Vector3 => {
    const gripPos = entry.grip.getWorldPosition(new THREE.Vector3());
    const offset = new THREE.Vector3(...PROBE_TIP_OFFSET)
      .applyQuaternion(entry.grip.getWorldQuaternion(new THREE.Quaternion()));
    return gripPos.add(offset); // true XR space
  };

  /** Solve yaw+translation from the stored scan points vs the remotes now. */
  const solveFromRemotes = (): YawTranslationSolution | null => {
    const left = byHand('left');
    const right = byHand('right');
    if (!left || !right) return null;
    const scanWorldA = splats.localToWorld(scanLocalA.clone());
    const scanWorldB = splats.localToWorld(scanLocalB.clone());
    return solveYawTranslation([
      { scan: scanWorldA.toArray() as Vec3, measured: remotePoint(left).toArray() as Vec3 },
      { scan: scanWorldB.toArray() as Vec3, measured: remotePoint(right).toArray() as Vec3 },
    ]);
  };

  const applySolution = (solution: YawTranslationSolution): void => {
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
    saveScanRoot();
  };

  // 4/4 — countdown ended: read both remotes as the measured points.
  const finishCalibration = (): void => {
    const solution = solveFromRemotes();
    if (!solution) {
      setText('need BOTH remotes for calibration\nre-placing…');
      placeTimer = PLACE_SECONDS; // restart the countdown
      return;
    }
    physMarkerA.position.copy(remotePoint(byHand('left')!));
    physMarkerB.position.copy(remotePoint(byHand('right')!));
    physMarkerA.visible = physMarkerB.visible = true;
    applySolution(solution);
    onCalibrated?.(solution);
    const a = (solution.residuals[0] * 100).toFixed(1);
    const b = (solution.residuals[1] * 100).toFixed(1);
    setStep('ARMED', `fit error A: ${a}cm | B: ${b}cm`);
  };

  /** remotes-as-anchors: after a tracking reset, re-align from the remotes. */
  const autoRecalibrate = (): boolean => {
    const solution = solveFromRemotes();
    if (!solution) return false;
    if (solution.rmsResidual > RECAL_RMS_LIMIT) return false; // remotes moved
    applySolution(solution);
    const a = (solution.residuals[0] * 100).toFixed(0);
    const b = (solution.residuals[1] * 100).toFixed(0);
    setStep('ARMED', `AUTO-RECALIBRATED (A:${a}cm B:${b}cm)`);
    return true;
  };

  /**
   * Watchdog: the Quest rarely fires the reference-space 'reset' event, so
   * the remotes are polled instead. If the scan points drift away from the
   * remotes' tracked positions by a rigid transform (small post-fit
   * residual), the tracking origin was redefined → re-solve and re-apply.
   * If the remotes themselves were moved (large post-fit residual), mark
   * the references invalid and wait for them to be re-placed.
   */
  const watchdog = (): void => {
    if (step !== 'ARMED' && step !== 'INVALID') return;
    const left = byHand('left');
    const right = byHand('right');
    if (!left || !right || !haveA || !haveB) return;
    const leftPos = remotePoint(left);
    const rightPos = remotePoint(right);
    // plausibility: both poses tracked and distinct
    if (leftPos.length() < 0.05 || rightPos.length() < 0.05) return;
    if (leftPos.distanceTo(rightPos) < 0.1) return;

    const solution = solveFromRemotes();
    if (!solution) return;
    const scanWorldA = splats.localToWorld(scanLocalA.clone());
    const scanWorldB = splats.localToWorld(scanLocalB.clone());
    const maxPrefit = Math.max(
      scanWorldA.distanceTo(leftPos),
      scanWorldB.distanceTo(rightPos),
    );

    if (maxPrefit < PREFIT_TRIGGER) {
      if (step === 'INVALID') setStep('ARMED', 'references consistent again ✓');
      return;
    }
    if (solution.rmsResidual > RECAL_RMS_LIMIT) {
      // remotes moved (not a rigid origin shift) — refuse to apply
      if (step !== 'INVALID') {
        setStep('INVALID', `remotes moved? (A/B mismatch) — re-place them\nLEFT on spot A, RIGHT on spot B`);
      }
      return;
    }
    // consistent rigid shift → the tracking origin was redefined
    applySolution(solution);
    const a = (solution.residuals[0] * 100).toFixed(0);
    const b = (solution.residuals[1] * 100).toFixed(0);
    setStep('ARMED', `AUTO-RECALIBRATED (A:${a}cm B:${b}cm)`);
  };

  // ---- session lifecycle -------------------------------------------------
  let refSpace: XRReferenceSpace | null = null;

  const onRefSpaceReset = () => {
    if (step === 'ARMED') {
      if (!autoRecalibrate()) setStep('INVALID');
      return;
    }
    if (step === 'PLACE_REFS') {
      placeTimer = PLACE_SECONDS; // tracking moved mid-placement: restart countdown
      return;
    }
    // wizard in progress: a stale-frame pick would corrupt the fit.
    resetWizard();
    setStep('A_SCAN', 'tracking re-centered — RESTARTED');
  };

  renderer.xr.addEventListener('sessionstart', () => {
    sprite.visible = true;
    try {
      const session = renderer.xr.getSession() as XRSession | null;
      vrMode = session?.environmentBlendMode === 'opaque';
    } catch { vrMode = false; }
    if (restoreScanRoot()) {
      if (haveA && haveB) {
        // transform AND landmark pairs restored: go straight to armed —
        // the watchdog verifies/corrects from the remotes within seconds.
        setStep('ARMED', 'restored — checking remotes…');
      } else {
        // transform only (older save): user verifies visually, squeeze if wrong.
        setStep('A_SCAN', 'saved calibration restored — verify, or squeeze');
      }
    } else {
      resetWizard();
    }
    try {
      refSpace = renderer.xr.getReferenceSpace() as XRReferenceSpace | null;
      refSpace?.addEventListener('reset', onRefSpaceReset);
    } catch { refSpace = null; }
  });

  renderer.xr.addEventListener('sessionend', () => {
    sprite.visible = false;
    try { refSpace?.removeEventListener('reset', onRefSpaceReset); } catch { /* noop */ }
    refSpace = null;
  });

  // ---- scan-point picking (steps 1 & 2) ----------------------------------
  const pickScanPoint = (entry: ControllerEntry, into: THREE.Vector3): boolean => {
    const sm = splats.viewer.splatMesh as unknown as SplatMeshWithCenters;
    const centers = sm.splatDataTextures?.baseData?.centers;
    if (!centers) {
      setText('scan not loaded yet');
      return false;
    }
    splats.updateMatrixWorld(true);
    const inv = splats.matrixWorld.clone().invert();
    const originWorld = entry.ctrl.getWorldPosition(new THREE.Vector3());
    const dirWorld = entry.ctrl.getWorldDirection(new THREE.Vector3()).negate();
    const originLocal = originWorld.clone().applyMatrix4(inv);
    const dirLocal = dirWorld.clone().transformDirection(inv);
    const hitLocal = raycastSplatCenters(centers, originLocal, dirLocal);
    if (!hitLocal) {
      setText('no splat hit — aim closer at the scan\nSticks move scan: L=fwd/back R=X/Y');
      return false;
    }
    into.copy(hitLocal); // LOCAL frame: immune to stick moves afterwards
    return true;
  };

  const onSelect = (entry: ControllerEntry) => {
    if (!renderer.xr.isPresenting) return;
    if (mode === 'tour') { triggerHeld = true; return; } // trigger = auto-walk
    if (step === 'A_SCAN') {
      if (pickScanPoint(entry, scanLocalA)) {
        haveA = true;
        scanMarkerA.position.copy(scanLocalA);
        scanMarkerA.visible = true;
        setStep('B_SCAN');
      }
    } else if (step === 'B_SCAN' && haveA) {
      if (pickScanPoint(entry, scanLocalB)) {
        haveB = true;
        scanMarkerB.position.copy(scanLocalB);
        scanMarkerB.visible = true;
        placeTimer = PLACE_SECONDS;
        placeTextTick = 0;
        setStep('PLACE_REFS', `${PLACE_SECONDS}s left`);
      }
    }
    // PLACE_REFS / ARMED: squeeze is the only way back to the wizard
  };

  function onSqueeze() {
    if (!renderer.xr.isPresenting) return;
    if (mode === 'tour') { exitTour(); return; }
    resetWizard();
  }

  // ---- scan movement (world axes; the rig is never touched) -------------
  const stick = (hand: string): { x: number; y: number } => {
    const gamepad = byHand(hand)?.source?.gamepad;
    if (!gamepad || !gamepad.axes || gamepad.axes.length < 4) return { x: 0, y: 0 };
    const raw = { x: gamepad.axes[2] ?? 0, y: gamepad.axes[3] ?? 0 };
    return {
      x: Math.abs(raw.x) > STICK_DEADZONE ? raw.x : 0,
      y: Math.abs(raw.y) > STICK_DEADZONE ? raw.y : 0,
    };
  };

  const moveScanWithSticks = (dt: number): void => {
    if (step !== 'A_SCAN' && step !== 'B_SCAN') return;
    const left = stick('left');
    const right = stick('right');
    // direct-manipulation feel: push stick up → scan slides forward/away
    splats.position.z += left.y * DOLLY_Z_SPEED * dt;    // L stick up/down = world Z
    splats.position.x += right.x * DOLLY_X_SPEED * dt;   // R stick left/right = world X
    splats.position.y += -right.y * DOLLY_Y_SPEED * dt; // R stick up/down = world Y
    splats.updateMatrixWorld(true);
  };

  // ---- tour mode: virtual locomotion (map moves, rig untouched) ----------
  const tourFwd = new THREE.Vector3();
  const tourRight = new THREE.Vector3();
  const tourPivot = new THREE.Vector3();
  const tourYaw = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  const tourUpdate = (activeCamera: THREE.Camera, dt: number): void => {
    const left = stick('left');
    const right = stick('right');

    activeCamera.getWorldDirection(tourFwd);
    tourFwd.y = 0;
    if (tourFwd.lengthSq() < 1e-6) return;
    tourFwd.normalize();
    tourRight.set(tourFwd.z, 0, -tourFwd.x);

    // walk: pushing forward moves the MAP backward → you advance into it
    let speed = -left.y * TOUR_WALK_SPEED;           // fwd/back
    if (triggerHeld) speed -= TOUR_AUTOWALK_SPEED;   // guided auto-walk
    splats.position.addScaledVector(tourFwd, speed * dt);
    splats.position.addScaledVector(tourRight, -left.x * TOUR_WALK_SPEED * dt); // strafe

    // elevation: right stick up/down
    splats.position.y += -right.y * TOUR_ELEVATE_SPEED * dt;

    // turn: rotate the map about the user's head (XZ pivot) — the user's
    // tracking never changes, so the boundary stays where it is.
    if (right.x !== 0) {
      const angle = -right.x * TOUR_TURN_SPEED * Math.PI / 180 * dt;
      activeCamera.getWorldPosition(tourPivot);
      const dx = splats.position.x - tourPivot.x;
      const dz = splats.position.z - tourPivot.z;
      const c = Math.cos(angle), s = Math.sin(angle);
      splats.position.x = tourPivot.x + c * dx + s * dz;
      splats.position.z = tourPivot.z - s * dx + c * dz;
      tourYaw.setFromAxisAngle(UP, angle);
      splats.quaternion.premultiply(tourYaw);
    }
    splats.updateMatrixWorld(true);

    // A/X button toggles back to calibration (edge-detected)
    for (let i = 0; i < controllers.length; i++) {
      const pressed = controllers[i].source?.gamepad?.buttons?.[4]?.pressed ?? false;
      if (pressed && !tourButtonWas[i]) exitTour();
      tourButtonWas[i] = pressed;
    }
  };

  // per-frame: sticks, countdown, watchdog, tour, panel in front of the face
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  let watchTimer = 0;
  return {
    update(activeCamera: THREE.Camera, deltaSeconds: number) {
      if (!sprite.visible) return;
      if (mode === 'tour') {
        tourUpdate(activeCamera, deltaSeconds);
      } else {
        moveScanWithSticks(deltaSeconds);
        if (step === 'PLACE_REFS') {
          placeTimer -= deltaSeconds;
          placeTextTick -= deltaSeconds;
          if (placeTextTick <= 0) {
            placeTextTick = 0.25;
            setStep('PLACE_REFS', `${Math.max(0, placeTimer).toFixed(0)}s left`);
          }
          if (placeTimer <= 0) finishCalibration();
        }
        // watchdog: poll the remotes for silent tracking-origin changes
        watchTimer += deltaSeconds;
        if (watchTimer >= WATCH_INTERVAL) {
          watchTimer = 0;
          watchdog();
        }
        // A/X button enters tour mode (edge-detected)
        for (let i = 0; i < controllers.length; i++) {
          const pressed = controllers[i].source?.gamepad?.buttons?.[4]?.pressed ?? false;
          if (pressed && !tourButtonWas[i]) enterTour();
          tourButtonWas[i] = pressed;
        }
      }
      activeCamera.getWorldPosition(camPos);
      activeCamera.getWorldDirection(camDir);
      sprite.position.copy(camPos).addScaledVector(camDir, 1.6);
      sprite.position.y -= 0.35;
    },
  };
}

function makeMarker(color: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 12, 12),
    new THREE.MeshBasicMaterial({ color, depthTest: false }),
  );
}

function makeTextPanel(): { sprite: THREE.Sprite; setText(text: string): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 360;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  sprite.scale.set(1.7, 0.6, 1);
  const setText = (text: string) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 10, 14, 0.82)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#444';
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    ctx.fillStyle = '#6fd08c';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    const lineH = 44;
    const startY = canvas.height / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineH));
    texture.needsUpdate = true;
  };
  return { sprite, setText };
}