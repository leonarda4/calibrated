// src/xr: guided landmark calibration — the two remotes ARE the physical
// landmarks (user-specified protocol).
//
//   1/4  A_SCAN — aim the ray at scan point A in the PLY (left remote will
//                  represent its real-world spot). Sticks move the scan:
//                  LEFT stick = X/Y, RIGHT stick = forward/back (Z).
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
const DOLLY_Z_SPEED = 3.0;         // m/s, right stick forward/back
const DOLLY_X_SPEED = 2.0;         // m/s, left stick left/right
const DOLLY_Y_SPEED = 1.5;         // m/s, left stick up/down
const STICK_DEADZONE = 0.15;
const RECAL_RMS_LIMIT = 1;         // m — above this the remotes must have moved
// Watchdog polling is DISABLED for now: the user observed random recalibrations.
// Likely cause: remote pose jitter / remotes in hands producing drift readings.
// Re-enable only after that is investigated (tracking quality log).
const WATCHDOG_POLLING = false;
const WATCH_INTERVAL = 1.5;        // s — steady-state watchdog cadence
const FAST_WATCH = 0.5;            // s — fast cadence right after (re)entering
const FAST_WATCH_WINDOW = 10;      // s — how long the fast cadence lasts
const PREFIT_TRIGGER = 0.10;       // m — min scan↔remote drift before recal
const RECAL_COOLDOWN = 5;          // s — min time between auto-recals (loop guard)
const RECAL_MAX_TRANSLATION = 3;   // m — sanity: a re-anchor is never bigger
const RECAL_MAX_YAW = 45 * Math.PI / 180; // rad — sanity limit
const POSE_STABLE_TIME = 0.5;      // s — remotes must be still before solving
const POSE_STABLE_EPS = 0.03;      // m — allowed jitter while "still"
const SMOOTH_TIME = 0.5;          // s — correction glide duration
const PANEL_HOLD_SECONDS = 4;      // s the final message stays after calibrating

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
    scene.add(ctrl, grip);
    controllers.push(entry);
  }
  const byHand = (hand: string): ControllerEntry | undefined =>
    controllers.find((c) => c.source?.handedness === hand)
    ?? controllers[hand === 'left' ? 0 : 1];

  // ---- instruction panel + return-to-calibration button -------------------
  const { sprite, setText } = makeTextPanel();
  sprite.visible = false;
  sprite.renderOrder = 1000; // draw AFTER the splats: UI always on top
  scene.add(sprite);
  const button = makeButtonSprite();
  button.visible = false;
  button.renderOrder = 1000;
  scene.add(button);

  // scan markers live INSIDE the splats group (stick moves keep them glued);
  // the "measured" markers show where the remotes were read in real space.
  const scanMarkerA = makeMarker(0x00e5ff);
  const scanMarkerB = makeMarker(0x00e5ff);
  const physMarkerA = makeMarker(0xffa500);
  const physMarkerB = makeMarker(0xffa500);
  for (const m of [scanMarkerA, scanMarkerB, physMarkerA, physMarkerB]) {
    m.visible = false;
    m.renderOrder = 999; // markers stay visible through the splats too
  }
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
  let uiActive = false;          // XR UI running (session in progress)
  let panelHoldUntil = -1e9;     // show the panel briefly after a message

  const instructions: Record<'A_SCAN' | 'B_SCAN', string> = {
    A_SCAN: '1/4 SCAN POINT A\nAim ray at scan point A, trigger\n(LEFT remote will mark its real spot)\nSticks move scan: L-stick = X/Y, R-stick = fwd/back',
    B_SCAN: '2/4 SCAN POINT B\nAim ray at scan point B, trigger\n(RIGHT remote will mark its real spot)\nSticks: L-stick = X/Y, R-stick = fwd/back',
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
      // final message — the panel then disappears; only the
      // "return to calibration" button remains (aim + trigger).
      panelHoldUntil = elapsed + PANEL_HOLD_SECONDS;
      setText(`4/4 CALIBRATED ✓\nLeft remote = A, right = B\nTrigger on the button to recalibrate${extra ? `\n${extra}` : ''}${modeLine}`);
    } else if (next === 'INVALID') {
      setText(`REFERENCES LOST\nRemotes moved? Re-place them, or\ntrigger the button to recalibrate${modeLine}`);
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

  // ---- persistence: record only — never restored -------------------------
  // User requirement: every session starts from the default transform and
  // runs the calibration wizard from the beginning. The last calibration is
  // still written to localStorage as a debugging/reporting record.
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

  // ---- guarded auto-recalibration ----------------------------------------
  // Loop-proof by design: one-shot closed-form solve against stationary
  // remotes, plus explicit guards — cooldown (no repeat within 5 s), pose
  // stability (remotes still for ≥ 0.5 s), sanity limits (a re-anchor is
  // never > 3 m / > 45°), smoothed application (~0.5 s) and a convergence
  // re-check that must confirm the fix before success is declared.
  let elapsed = 0;                  // s since session start (monotonic clock)
  let lastRecalAt = -1e9;
  let stableFor = 0;
  let prevSampleAt = -1e9;
  const prevLeft = new THREE.Vector3();
  const prevRight = new THREE.Vector3();
  let smoothActive = false;
  let smoothStart = 0;
  let smoothSolution: YawTranslationSolution | null = null;
  const smoothFromQ = new THREE.Quaternion();
  const smoothToQ = new THREE.Quaternion();
  const smoothFromP = new THREE.Vector3();
  const smoothToP = new THREE.Vector3();

  /** Read the remotes, verify plausibility, sample stability, solve. */
  const readReferences = ():
    | { maxPrefit: number; solution: YawTranslationSolution }
    | null => {
    const left = byHand('left');
    const right = byHand('right');
    if (!left || !right || !haveA || !haveB) return null;
    const leftPos = remotePoint(left);
    const rightPos = remotePoint(right);
    if (leftPos.length() < 0.05 || rightPos.length() < 0.05) return null; // untracked
    if (leftPos.distanceTo(rightPos) < 0.1) return null;                  // implausible
    const solution = solveFromRemotes();
    if (!solution) return null;
    const scanWorldA = splats.localToWorld(scanLocalA.clone());
    const scanWorldB = splats.localToWorld(scanLocalB.clone());
    const maxPrefit = Math.max(
      scanWorldA.distanceTo(leftPos),
      scanWorldB.distanceTo(rightPos),
    );
    // stability sampling across calls
    if (prevSampleAt >= 0) {
      const disp = Math.max(leftPos.distanceTo(prevLeft), rightPos.distanceTo(prevRight));
      stableFor = disp < POSE_STABLE_EPS ? stableFor + (elapsed - prevSampleAt) : 0;
    }
    prevLeft.copy(leftPos);
    prevRight.copy(rightPos);
    prevSampleAt = elapsed;
    return { maxPrefit, solution };
  };

  const beginSmoothedRecal = (solution: YawTranslationSolution): void => {
    const composed = composeCalibration(
      {
        quaternion: splats.quaternion.toArray() as Quat,
        position: splats.position.toArray() as Vec3,
      },
      solution,
    );
    smoothFromQ.copy(splats.quaternion);
    smoothFromP.copy(splats.position);
    smoothToQ.set(composed.quaternion[0], composed.quaternion[1], composed.quaternion[2], composed.quaternion[3]);
    smoothToP.set(composed.position[0], composed.position[1], composed.position[2]);
    smoothSolution = solution;
    smoothActive = true;
    smoothStart = elapsed;
    lastRecalAt = elapsed; // cooldown starts at correction start, not end
    setStep('ARMED', 'REALIGNING…');
  };

  /** Full guard pipeline. Returns true when a correction was started. */
  const attemptRecal = (): boolean => {
    if (smoothActive) return false;
    if (elapsed - lastRecalAt < RECAL_COOLDOWN) return false; // rate limit
    const refs = readReferences();
    if (!refs) return false;
    if (refs.maxPrefit < PREFIT_TRIGGER) return false;  // nothing to fix
    if (stableFor < POSE_STABLE_TIME) return false;     // wait for still remotes
    if (refs.solution.rmsResidual > RECAL_RMS_LIMIT) {
      // remotes moved (not a rigid origin shift) — refuse to apply
      if (step !== 'INVALID') {
        setStep('INVALID', 'remotes moved? — re-place LEFT on A, RIGHT on B');
      }
      return false;
    }
    const t = refs.solution.translation;
    const tLen = Math.hypot(t[0], t[1], t[2]);
    if (tLen > RECAL_MAX_TRANSLATION || Math.abs(refs.solution.yaw) > RECAL_MAX_YAW) {
      if (step !== 'INVALID') {
        setStep('INVALID', 'correction too large — remotes moved?');
      }
      return false;
    }
    beginSmoothedRecal(refs.solution);
    return true;
  };

  /** Called by the render loop once the glide is finished: verify + report. */
  const finishSmoothedRecal = (): void => {
    smoothActive = false;
    splats.quaternion.copy(smoothToQ);
    splats.position.copy(smoothToP);
    splats.updateMatrixWorld(true);
    saveScanRoot();
    // convergence check: the correction must have removed the drift
    const refs = readReferences();
    if (refs && refs.maxPrefit < PREFIT_TRIGGER + 0.05 && smoothSolution) {
      const a = (smoothSolution.residuals[0] * 100).toFixed(0);
      const b = (smoothSolution.residuals[1] * 100).toFixed(0);
      setStep('ARMED', `AUTO-RECALIBRATED (A:${a}cm B:${b}cm)`);
    } else {
      setStep('INVALID', 'recheck failed — re-place remotes or squeeze');
    }
    smoothSolution = null;
  };

  /**
   * Watchdog: the Quest rarely fires the reference-space 'reset' event, so
   * the remotes are polled instead (fast right after entering a session,
   * slower in steady state, fast again while references are invalid).
   */
  const watchdog = (): void => {
    if (step !== 'ARMED' && step !== 'INVALID') return;
    const refs = readReferences();
    if (!refs) return;
    if (refs.maxPrefit < PREFIT_TRIGGER) {
      if (step === 'INVALID') setStep('ARMED', 'references consistent again ✓');
      return;
    }
    attemptRecal();
  };

  // ---- session lifecycle -------------------------------------------------
  let refSpace: XRReferenceSpace | null = null;

  const onRefSpaceReset = () => {
    if (step === 'ARMED') {
      // guarded pipeline (cooldown / stability / sanity / smoothing); the
      // watchdog re-checks on the next tick if no correction was started.
      attemptRecal();
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
    uiActive = true;
    sprite.visible = false;
    button.visible = false;
    elapsed = 0;
    lastRecalAt = -1e9;
    stableFor = 0;
    prevSampleAt = -1e9;
    smoothActive = false;
    smoothSolution = null;
    try {
      const session = renderer.xr.getSession() as XRSession | null;
      vrMode = session?.environmentBlendMode === 'opaque';
    } catch { vrMode = false; }
    // User requirement: every VR session starts the calibration wizard from
    // the beginning — nothing is restored from a previous session.
    resetWizard();
    try {
      refSpace = renderer.xr.getReferenceSpace() as XRReferenceSpace | null;
      refSpace?.addEventListener('reset', onRefSpaceReset);
    } catch { refSpace = null; }
  });

  renderer.xr.addEventListener('sessionend', () => {
    uiActive = false;
    sprite.visible = false;
    button.visible = false;
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
    } else if (step === 'ARMED' || step === 'INVALID') {
      // return-to-calibration button: does this controller's ray hit it?
      const origin = entry.ctrl.getWorldPosition(new THREE.Vector3());
      const dir = entry.ctrl.getWorldDirection(new THREE.Vector3()).negate();
      const toButton = button.getWorldPosition(new THREE.Vector3()).sub(origin);
      const t = toButton.dot(dir);
      const perpendicular = toButton.clone().addScaledVector(dir, -t).length();
      if (t > 0.2 && t < 5 && perpendicular < 0.2) resetWizard();
    }
    // PLACE_REFS: trigger does nothing during the countdown
  };

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
    // direct-manipulation feel: push the stick where the scan should go
    splats.position.x += left.x * DOLLY_X_SPEED * dt;    // L stick left/right = world X
    splats.position.y += -left.y * DOLLY_Y_SPEED * dt;  // L stick up/down = world Y
    splats.position.z += right.y * DOLLY_Z_SPEED * dt;  // R stick up/down = world Z (corridor)
    splats.updateMatrixWorld(true);
  };

  // per-frame: sticks, countdown, watchdog, smoothing, panel position
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  let watchTimer = 0;
  return {
    update(activeCamera: THREE.Camera, deltaSeconds: number) {
      if (!uiActive) return;
      elapsed += deltaSeconds;

      // apply the smoothed correction glide
      if (smoothActive) {
        const t = Math.min(1, (elapsed - smoothStart) / SMOOTH_TIME);
        splats.quaternion.slerpQuaternions(smoothFromQ, smoothToQ, t);
        splats.position.lerpVectors(smoothFromP, smoothToP, t);
        splats.updateMatrixWorld(true);
        if (t >= 1) finishSmoothedRecal();
      }

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
      // watchdog: poll the remotes for silent tracking-origin changes.
      // DISABLED (WATCHDOG_POLLING = false) — was producing random
      // recalibrations. The reference-space 'reset' event path remains,
      // and manual recalibration (the ⟲ button) always works.
      const interval = (elapsed < FAST_WATCH_WINDOW || step === 'INVALID')
        ? FAST_WATCH : WATCH_INTERVAL;
      watchTimer += deltaSeconds;
      if (WATCHDOG_POLLING && watchTimer >= interval) {
        watchTimer = 0;
        watchdog();
      }
      activeCamera.getWorldPosition(camPos);
      activeCamera.getWorldDirection(camDir);
      // info panel: visible during the wizard, while invalid, or briefly
      // after a final message — hidden otherwise (after calibration).
      const wizardish = step === 'A_SCAN' || step === 'B_SCAN'
        || step === 'PLACE_REFS' || step === 'INVALID';
      sprite.visible = wizardish || (step === 'ARMED' && elapsed < panelHoldUntil);
      if (sprite.visible) {
        sprite.position.copy(camPos).addScaledVector(camDir, 1.6);
        sprite.position.y -= 0.35;
      }
      // return-to-calibration button: shown once calibration is done
      button.visible = step === 'ARMED' || step === 'INVALID';
      if (button.visible) {
        button.position.copy(camPos).addScaledVector(camDir, 1.6);
        button.position.y -= 0.7;
      }
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
  sprite.scale.set(0.5, 0.125, 1);
  return sprite;
}