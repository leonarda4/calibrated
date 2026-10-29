// src/xr: guided landmark calibration using the controller as a probe.
// Flow (two fit pairs, A and B):
//   A_SCAN  — aim at a landmark on the hallway scan, pull trigger
//   A_PHYS  — touch the SAME real-world spot with the controller, pull trigger
//   B_SCAN / B_PHYS — repeat with a second, well-separated landmark
//   DONE    — yaw+translation solved and applied to the scan root
//
// Rules honoured here (docs/PROJECT_PLAN.md + AGENTS.md invariants):
// - The XR rig (camera/controllers) is NEVER moved. The thumbstick dollies
//   the SCAN ROOT instead ("you" never move artificially; the map does).
// - Scan points are stored in the scan root's LOCAL frame, so dolly moves
//   between picks cannot corrupt the fit; they are converted to world
//   coordinates only at solve time.
// - Physical points are captured from the controller grip (+ measured
//   PROBE_TIP_OFFSET), in true XR space.
// - A solved calibration is persisted locally and re-applied on the next
//   session as a CANDIDATE — never silently as verified alignment. A
//   reference-space reset (guardian recenter) invalidates it explicitly.

import * as THREE from 'three';
import type * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { raycastSplatCenters } from '../viewer/splatRaycast';
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
const DOLLY_SPEED = 2.5; // m/s while aiming at the scan with the thumbstick

type Step = 'RESTORED' | 'A_SCAN' | 'A_PHYS' | 'B_SCAN' | 'B_PHYS' | 'DONE' | 'INVALID';

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
  const controller = renderer.xr.getController(0); // target-ray space
  const grip = renderer.xr.getControllerGrip(0);
  scene.add(controller, grip);

  // controller ray (visual)
  const rayGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -6),
  ]);
  const rayLine = new THREE.Line(
    rayGeometry, new THREE.LineBasicMaterial({ color: 0x00e5ff }),
  );
  controller.add(rayLine);
  controller.visible = false;
  grip.visible = false;
  let inputSource: XRInputSource | null = null;
  controller.addEventListener('connected', (e) => {
    controller.visible = true;
    grip.visible = true;
    inputSource = (e as unknown as { data: XRInputSource }).data;
  });
  controller.addEventListener('disconnected', () => {
    controller.visible = false;
    grip.visible = false;
    inputSource = null;
  });

  // in-headset instruction panel (canvas sprite)
  const { sprite, setText } = makeTextPanel();
  sprite.visible = false;
  scene.add(sprite);

  // markers: scan marker lives INSIDE the splats group so dolly moves keep
  // it glued to its landmark; the physical marker lives in true world space.
  const scanMarker = makeMarker(0x00e5ff);   // cyan: picked scan landmark
  const physMarker = makeMarker(0xffa500);   // orange: measured physical point
  scanMarker.visible = physMarker.visible = false;
  splats.add(scanMarker);
  scene.add(physMarker);

  const pairA: Pair = { scanLocal: null, measured: null };
  const pairB: Pair = { scanLocal: null, measured: null };
  let step: Step = 'A_SCAN';

  const instructions: Record<Exclude<Step, 'INVALID' | 'RESTORED'>, string> = {
    A_SCAN: 'CALIBRATE 1/4\nAim the ray at landmark A on the HALLWAY\nTrigger = pick. Left stick = fly',
    A_PHYS: 'CALIBRATE 2/4\nTouch the real-world spot A\nwith the controller tip. Pull trigger',
    B_SCAN: 'CALIBRATE 3/4\nAim the ray at landmark B on the HALLWAY\nTrigger = pick. Left stick = fly',
    B_PHYS: 'CALIBRATE 4/4\nTouch the real-world spot B\nwith the controller tip. Pull trigger',
    DONE: 'CALIBRATED — verify landmarks\nSqueeze = recalibrate',
  };

  const setStep = (next: Step, extra = '') => {
    step = next;
    if (next === 'RESTORED') {
      setText(
        'SAVED CALIBRATION RESTORED\n' +
        'Stand where you calibrated, then verify\nthe landmarks. Squeeze = recalibrate',
      );
    } else if (next === 'INVALID') {
      setText(
        'TRACKING RE-CENTERED\nAlignment is invalid.\n' +
        'Return to your start spot & squeeze\nto recalibrate',
      );
    } else {
      setText(instructions[next] + (extra ? `\n${extra}` : ''));
    }
  };

  const resetWizard = () => {
    pairA.scanLocal = pairA.measured = null;
    pairB.scanLocal = pairB.measured = null;
    scanMarker.visible = physMarker.visible = false;
    setStep('A_SCAN');
  };

  // ---- persistence: saved calibration is a candidate, never proof -------
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

  // ---- session lifecycle ------------------------------------------------
  let refSpace: XRReferenceSpace | null = null;
  const onRefSpaceReset = () => setStep('INVALID');

  renderer.xr.addEventListener('sessionstart', () => {
    sprite.visible = true;
    if (restoreScanRoot()) {
      setStep('RESTORED');
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

  // ---- picking ----------------------------------------------------------
  const pickScanPoint = (pair: Pair): boolean => {
    const sm = splats.viewer.splatMesh as unknown as SplatMeshWithCenters;
    const centers = sm.splatDataTextures?.baseData?.centers;
    if (!centers) {
      setText('scan not loaded yet');
      return false;
    }
    splats.updateMatrixWorld(true);
    const inv = splats.matrixWorld.clone().invert();
    const originWorld = controller.getWorldPosition(new THREE.Vector3());
    const dirWorld = controller.getWorldDirection(new THREE.Vector3()).negate();
    const originLocal = originWorld.clone().applyMatrix4(inv);
    const dirLocal = dirWorld.clone().transformDirection(inv);
    const hitLocal = raycastSplatCenters(centers, originLocal, dirLocal);
    if (!hitLocal) {
      setText('no splat hit — aim closer at the hallway\nleft stick = fly');
      return false;
    }
    pair.scanLocal = hitLocal; // LOCAL frame: immune to later dolly moves
    scanMarker.position.copy(hitLocal);
    scanMarker.visible = true;
    return true;
  };

  const pickPhysicalPoint = (pair: Pair): void => {
    const gripPos = grip.getWorldPosition(new THREE.Vector3());
    const offset = new THREE.Vector3(...PROBE_TIP_OFFSET)
      .applyQuaternion(grip.getWorldQuaternion(new THREE.Quaternion()));
    pair.measured = gripPos.add(offset); // true XR space
    physMarker.position.copy(pair.measured);
    physMarker.visible = true;
  };

  const solveAndApply = () => {
    // convert stored local scan points to world NOW (after any dolly moves)
    const scanWorldA = splats.localToWorld(pairA.scanLocal!.clone());
    const scanWorldB = splats.localToWorld(pairB.scanLocal!.clone());
    const solution = solveYawTranslation([
      { scan: scanWorldA.toArray() as Vec3, measured: pairA.measured!.toArray() as Vec3 },
      { scan: scanWorldB.toArray() as Vec3, measured: pairB.measured!.toArray() as Vec3 },
    ]);
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

    const errA = (solution.residuals[0] * 100).toFixed(1);
    const errB = (solution.residuals[1] * 100).toFixed(1);
    setStep('DONE', `fit error A: ${errA} cm | B: ${errB} cm`);
    onCalibrated?.(solution);
  };

  controller.addEventListener('selectstart', () => {
    if (!renderer.xr.isPresenting) return;
    if (step === 'A_SCAN') { if (pickScanPoint(pairA)) setStep('A_PHYS'); }
    else if (step === 'A_PHYS') { pickPhysicalPoint(pairA); setStep('B_SCAN'); }
    else if (step === 'B_SCAN') { if (pickScanPoint(pairB)) setStep('B_PHYS'); }
    else if (step === 'B_PHYS') { pickPhysicalPoint(pairB); solveAndApply(); }
    // DONE / RESTORED: squeeze is the only way back to the wizard
  });

  controller.addEventListener('squeezestart', () => {
    if (!renderer.xr.isPresenting) return;
    resetWizard();
  });

  // ---- thumbstick dolly (map moves, never the player) -------------------
  const camForward = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const dolly = (activeCamera: THREE.Camera, dt: number) => {
    if (step !== 'A_SCAN' && step !== 'B_SCAN') return; // only while aiming at the scan
    const gamepad = inputSource?.gamepad;
    if (!gamepad || !gamepad.axes || gamepad.axes.length < 4) return;
    const stickX = gamepad.axes[2] ?? 0; // left/right
    const stickY = gamepad.axes[3] ?? 0; // forward/back
    if (Math.abs(stickX) < 0.15 && Math.abs(stickY) < 0.15) return;

    activeCamera.getWorldDirection(camForward);
    camForward.y = 0;
    if (camForward.lengthSq() < 1e-6) return;
    camForward.normalize();
    camRight.set(camForward.z, 0, -camForward.x); // horizontal right vector

    // world moves OPPOSITE the stick => you appear to fly through the map
    const v = DOLLY_SPEED * dt;
    splats.position.x -= (camRight.x * stickX + camForward.x * stickY) * v;
    splats.position.z -= (camRight.z * stickX + camForward.z * stickY) * v;
    splats.updateMatrixWorld(true);
  };

  // per-frame: dolly + keep the instruction panel in front of the face
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  return {
    update(activeCamera: THREE.Camera, deltaSeconds: number) {
      if (!sprite.visible) return;
      dolly(activeCamera, deltaSeconds);
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
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  sprite.scale.set(1.7, 0.42, 1);
  const setText = (text: string) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 10, 14, 0.82)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#444';
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    ctx.fillStyle = '#6fd08c';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    const lineH = 48;
    const startY = canvas.height / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineH));
    texture.needsUpdate = true;
  };
  return { sprite, setText };
}