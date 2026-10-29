// src/xr: guided landmark calibration using the controllers as probes and,
// after calibration, as fixed physical reference anchors.
//
// Wizard (user-specified order — real spot first, then scan):
//   1/4  A_PHYS — hold a controller tip on REAL spot A, trigger
//                  (camera/passthrough visible, scan faded out)
//   2/4  A_SCAN — aim the ray at SCAN spot A, trigger
//                  (scan visible at 70%, sticks move the scan:
//                   LEFT stick = forward/back, RIGHT stick = left/right + up/down)
//   3/4  B_PHYS — same for REAL spot B
//   4/4  B_SCAN — same for SCAN spot B → solve + apply immediately
//
// After the fit: 10-second countdown — user places the LEFT remote on real
// spot A and the RIGHT remote on spot B. From then on the remotes are the
// physical reference: if the tracking origin is ever redefined (guardian /
// passthrough takeover), the transform is re-solved automatically from the
// remotes' current tracked positions. The scan never drifts to a random spot.
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
 * Offset from the controller GRIP ORIGIN to the physical probe tip that is
 * pressed against the landmark, in controller-local metres [x, y, z].
 * Measure yours and fill this in — zero means "the grip origin is the tip".
 */
export const PROBE_TIP_OFFSET: Vec3 = [0, 0, 0];

const STORAGE_KEY = 'calibrated.scanRoot.v1';
const REF_PLACEMENT_SECONDS = 10;   // countdown to place the remotes
const DOLLY_Z_SPEED = 3.0;         // m/s, left stick forward/back
const DOLLY_X_SPEED = 2.0;         // m/s, right stick left/right
const DOLLY_Y_SPEED = 1.5;         // m/s, right stick up/down
const STICK_DEADZONE = 0.15;
const REF_MATCH_GOOD = 0.15;       // m — remotes sit on their spots
const REF_MATCH_WARN = 0.50;       // m — suspicious but accepted with warning

type Step =
  | 'A_PHYS' | 'A_SCAN' | 'B_PHYS' | 'B_SCAN'
  | 'PLACE_REFS' | 'ARMED' | 'INVALID';

interface Pair {
  scanLocal: THREE.Vector3 | null;  // landmark in the scan root's local frame
  measured: THREE.Vector3 | null;   // physical position in true XR space
}

interface SavedScanRoot {
  quaternion: Quat;
  position: Vec3;
  savedAt: number;
}

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
    ctrl.addEventListener('squeezestart', onSqueeze);
    scene.add(ctrl, grip);
    controllers.push(entry);
  }
  const byHand = (hand: string): ControllerEntry | undefined =>
    controllers.find((c) => c.source?.handedness === hand)
    ?? controllers[hand === 'left' ? 0 : 1];

  // ---- instruction panel -------------------------------------------------
  const { sprite, setText } = makeTextPanel();
  sprite.visible = false;
  scene.add(sprite);

  // markers: scan marker lives INSIDE the splats group so stick moves keep it
  // glued to its landmark; the physical marker lives in true world space.
  const scanMarker = makeMarker(0x00e5ff);
  const physMarker = makeMarker(0xffa500);
  scanMarker.visible = physMarker.visible = false;
  splats.add(scanMarker);
  scene.add(physMarker);

  const pairA: Pair = { scanLocal: null, measured: null };
  const pairB: Pair = { scanLocal: null, measured: null };
  let step: Step = 'A_PHYS';
  let vrMode = false;            // opaque blend → no passthrough available
  let placeTimer = 0;             // countdown for remote placement
  let placeTextTick = 0;          // throttle for countdown redraws

  const instructions: Record<Exclude<Step, 'PLACE_REFS' | 'ARMED' | 'INVALID'>, string> = {
    A_PHYS: '1/4 REAL SPOT A\nHold a controller tip on real spot A\nTrigger to capture',
    A_SCAN: '2/4 SCAN SPOT A\nAim ray at scan spot A, trigger\nSticks move scan: L=fwd/back R=X/Y',
    B_PHYS: '3/4 REAL SPOT B\nHold controller tip on real spot B\nTrigger to capture',
    B_SCAN: '4/4 SCAN SPOT B\nAim ray at scan spot B, trigger\nSticks: L=fwd/back R=X/Y',
  };

  const setStep = (next: Step, extra = '') => {
    step = next;
    // opacity per phase: real-world steps fade the scan so the camera feed
    // (AR) dominates; scan steps bring it back.
    const isPhysStep = next === 'A_PHYS' || next === 'B_PHYS';
    setScanOpacity(splats, isPhysStep ? (vrMode ? 0.25 : 0.04) : SCAN_OPACITY);

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
      setText(`CALIBRATED ✓\nPlace LEFT remote on spot A\nRIGHT remote on spot B\n${extra}${modeLine}`);
    } else if (next === 'ARMED') {
      setText(`REMOTES = REFERENCE ✓\nTracking resets auto-realign now\nSqueeze = recalibrate manually${extra ? `\n${extra}` : ''}${modeLine}`);
    } else if (next === 'INVALID') {
      setText(`REFERENCES LOST\nSqueeze to recalibrate manually${modeLine}`);
    } else {
      setText(instructions[next as keyof typeof instructions] + (extra ? `\n${extra}` : '') + modeLine);
    }
  };

  const resetWizard = () => {
    pairA.scanLocal = pairA.measured = null;
    pairB.scanLocal = pairB.measured = null;
    scanMarker.visible = physMarker.visible = false;
    placeTimer = 0;
    setStep('A_PHYS');
  };

  // ---- persistence: saved transform is a candidate, never proof ---------
  const saveScanRoot = () => {
    try {
      const saved: SavedScanRoot = {
        quaternion: splats.quaternion.toArray() as Quat,
        position: splats.position.toArray() as Vec3,
        savedAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch { /* storage unavailable — session-only calibration */ }
  };

  const restoreScanRoot = (): boolean => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw) as SavedScanRoot;
      splats.quaternion.set(...saved.quaternion);
      splats.position.set(...saved.position);
      splats.updateMatrixWorld(true);
      return true;
    } catch { return false; }
  };

  // ---- session lifecycle -------------------------------------------------
  let refSpace: XRReferenceSpace | null = null;

  const solveFrom = (scanLocalA: THREE.Vector3, scanLocalB: THREE.Vector3,
    measuredA: THREE.Vector3, measuredB: THREE.Vector3): YawTranslationSolution => {
    const scanWorldA = splats.localToWorld(scanLocalA.clone());
    const scanWorldB = splats.localToWorld(scanLocalB.clone());
    return solveYawTranslation([
      { scan: scanWorldA.toArray() as Vec3, measured: measuredA.toArray() as Vec3 },
      { scan: scanWorldB.toArray() as Vec3, measured: measuredB.toArray() as Vec3 },
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

  /** remotes-as-anchors: re-read tracked remote positions and re-align. */
  const autoRecalibrate = (): boolean => {
    const left = byHand('left');
    const right = byHand('right');
    if (!pairA.scanLocal || !pairB.scanLocal || !left || !right) return false;
    try {
      const leftPos = left.grip.getWorldPosition(new THREE.Vector3());
      const rightPos = right.grip.getWorldPosition(new THREE.Vector3());
      const solution = solveFrom(pairA.scanLocal, pairB.scanLocal, leftPos, rightPos);
      if (solution.rmsResidual > 1) return false; // remotes moved — nonsense
      applySolution(solution);
      const a = (solution.residuals[0] * 100).toFixed(0);
      const b = (solution.residuals[1] * 100).toFixed(0);
      setStep('ARMED', `AUTO-RECALIBRATED (A:${a}cm B:${b}cm)`);
      return true;
    } catch { return false; }
  };

  const onRefSpaceReset = () => {
    if (step === 'ARMED') {
      if (!autoRecalibrate()) setStep('INVALID');
      return;
    }
    if (step === 'PLACE_REFS') {
      placeTimer = REF_PLACEMENT_SECONDS; // tracking moved mid-placement: restart countdown
      return;
    }
    // wizard in progress: pairs captured in a stale frame would corrupt the
    // fit — restart cleanly.
    resetWizard();
    setStep('A_PHYS', 'tracking re-centered — RESTARTED');
  };

  renderer.xr.addEventListener('sessionstart', () => {
    sprite.visible = true;
    try {
      const session = renderer.xr.getSession() as XRSession | null;
      vrMode = session?.environmentBlendMode === 'opaque';
    } catch { vrMode = false; }
    if (restoreScanRoot()) {
      // restored transform is a candidate: user verifies visually, squeeze
      // starts a fresh wizard if it is wrong.
      setStep('A_PHYS', 'saved calibration restored — verify, or squeeze');
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

  // ---- picking -----------------------------------------------------------
  const pickScanPoint = (entry: ControllerEntry, pair: Pair): boolean => {
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
    pair.scanLocal = hitLocal; // LOCAL frame: immune to stick moves afterwards
    scanMarker.position.copy(hitLocal);
    scanMarker.visible = true;
    return true;
  };

  const pickPhysicalPoint = (entry: ControllerEntry, pair: Pair): void => {
    const gripPos = entry.grip.getWorldPosition(new THREE.Vector3());
    const offset = new THREE.Vector3(...PROBE_TIP_OFFSET)
      .applyQuaternion(entry.grip.getWorldQuaternion(new THREE.Quaternion()));
    pair.measured = gripPos.add(offset); // true XR space
    physMarker.position.copy(pair.measured);
    physMarker.visible = true;
  };

  const finishWizard = () => {
    if (!pairA.scanLocal || !pairB.scanLocal) return;
    const solution = solveFrom(pairA.scanLocal, pairB.scanLocal,
      pairA.measured!, pairB.measured!);
    applySolution(solution);
    onCalibrated?.(solution);
    placeTimer = REF_PLACEMENT_SECONDS;
    setStep('PLACE_REFS');
  };

  const onSelect = (entry: ControllerEntry) => {
    if (!renderer.xr.isPresenting) return;
    if (step === 'A_PHYS') { pickPhysicalPoint(entry, pairA); setStep('A_SCAN'); }
    else if (step === 'A_SCAN') { if (pickScanPoint(entry, pairA)) setStep('B_PHYS'); }
    else if (step === 'B_PHYS') { pickPhysicalPoint(entry, pairB); setStep('B_SCAN'); }
    else if (step === 'B_SCAN') {
      if (pickScanPoint(entry, pairB)) finishWizard();
    }
    // PLACE_REFS / ARMED: squeeze is the only way back to the wizard
  };

  function onSqueeze() {
    if (!renderer.xr.isPresenting) return;
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
    splats.position.z += left.y * DOLLY_Z_SPEED * dt;   // L stick up/down = world Z
    splats.position.x += right.x * DOLLY_X_SPEED * dt;  // R stick left/right = world X
    splats.position.y += -right.y * DOLLY_Y_SPEED * dt; // R stick up/down = world Y
    splats.updateMatrixWorld(true);
  };

  // ---- countdown: place both remotes on their spots ----------------------
  const captureReferences = (): void => {
    const left = byHand('left');
    const right = byHand('right');
    if (!left || !right || !pairA.scanLocal || !pairB.scanLocal) {
      setStep('ARMED', 'auto-recal unavailable (missing remote)');
      return;
    }
    const leftPos = left.grip.getWorldPosition(new THREE.Vector3());
    const rightPos = right.grip.getWorldPosition(new THREE.Vector3());
    const scanWorldA = splats.localToWorld(pairA.scanLocal.clone());
    const scanWorldB = splats.localToWorld(pairB.scanLocal.clone());
    const errA = leftPos.distanceTo(scanWorldA);
    const errB = rightPos.distanceTo(scanWorldB);
    const worst = Math.max(errA, errB);
    const msg = `refs A:${(errA * 100).toFixed(0)}cm B:${(errB * 100).toFixed(0)}cm`;
    if (worst > REF_MATCH_WARN) {
      setStep('ARMED', `PLACE MISMATCH ${msg} — check remotes!`);
    } else if (worst > REF_MATCH_GOOD) {
      setStep('ARMED', `refs rough ${msg}`);
    } else {
      setStep('ARMED', msg);
    }
  };

  // per-frame: sticks, countdown, panel in front of the face
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  return {
    update(activeCamera: THREE.Camera, deltaSeconds: number) {
      if (!sprite.visible) return;
      moveScanWithSticks(deltaSeconds);
      if (step === 'PLACE_REFS') {
        placeTimer -= deltaSeconds;
        placeTextTick -= deltaSeconds;
        if (placeTextTick <= 0) {
          placeTextTick = 0.25;
          setStep('PLACE_REFS', `${Math.max(0, placeTimer).toFixed(0)}s left`);
        }
        if (placeTimer <= 0) captureReferences();
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
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  sprite.scale.set(1.7, 0.53, 1);
  const setText = (text: string) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 10, 14, 0.82)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#444';
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    ctx.fillStyle = '#6fd08c';
    ctx.font = 'bold 34px monospace';
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