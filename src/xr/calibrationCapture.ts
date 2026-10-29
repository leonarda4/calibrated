// src/xr: guided landmark calibration using the controller as a probe.
// Flow (two fit pairs, A and B):
//   A_SCAN  — aim at a landmark on the hallway scan, pull trigger
//   A_PHYS  — touch the SAME real-world spot with the controller, pull trigger
//   B_SCAN / B_PHYS — repeat with a second, well-separated landmark
//   DONE    — yaw+translation solved and applied to the scan root;
//             residuals shown; squeeze (grip button) to recalibrate.
//
// Per the plan: only the scan root is transformed — the camera/controller
// rig is never moved. The controller GRIP pose is not the physical probe
// tip; PROBE_TIP_OFFSET below accounts for a measured tip offset.

import * as THREE from 'three';
import type * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { raycastSplatCenters } from '../viewer/splatRaycast';
import {
  solveYawTranslation, composeCalibration,
  type YawTranslationSolution, type Vec3,
} from '../calibration/yawTranslationSolver';

/**
 * Offset from the controller GRIP ORIGIN to the physical probe tip that is
 * pressed against the landmark, in controller-local metres [x, y, z].
 * Measure yours and fill this in — zero means "the grip origin is the tip".
 */
export const PROBE_TIP_OFFSET: Vec3 = [0, 0, 0];

type Step = 'A_SCAN' | 'A_PHYS' | 'B_SCAN' | 'B_PHYS' | 'DONE';

interface Pair {
  scan: THREE.Vector3 | null;     // world position of the scan landmark (current frame)
  measured: THREE.Vector3 | null; // physical position in XR space
}

// narrow interface for the library internals we need (not in ambient types)
interface SplatMeshWithCenters {
  splatDataTextures?: { baseData?: { centers?: Float32Array } };
}

export interface CalibrationCapture {
  /** Call once per frame with the active camera (XR camera while presenting). */
  update(activeCamera: THREE.Camera): void;
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
  controller.addEventListener('connected', () => { controller.visible = true; grip.visible = true; });
  controller.addEventListener('disconnected', () => { controller.visible = false; grip.visible = false; });

  // in-headset instruction panel (canvas sprite)
  const { sprite, setText } = makeTextPanel();
  sprite.visible = false;
  scene.add(sprite);

  // markers
  const scanMarker = makeMarker(0x00e5ff);   // cyan: picked scan point
  const physMarker = makeMarker(0xffa500);   // orange: measured physical point
  scanMarker.visible = physMarker.visible = false;
  scene.add(scanMarker, physMarker);

  const pairA: Pair = { scan: null, measured: null };
  const pairB: Pair = { scan: null, measured: null };
  let step: Step = 'A_SCAN';

  const instructions: Record<Step, string> = {
    A_SCAN: 'CALIBRATE 1/4\nAim the ray at landmark A on the HALLWAY\nPull trigger',
    A_PHYS: 'CALIBRATE 2/4\nTouch the real-world spot A\nwith the controller tip. Pull trigger',
    B_SCAN: 'CALIBRATE 3/4\nAim the ray at landmark B on the HALLWAY\n(well separated from A). Pull trigger',
    B_PHYS: 'CALIBRATE 4/4\nTouch the real-world spot B\nwith the controller tip. Pull trigger',
    DONE: 'CALIBRATED\nsqueeze grip button to recalibrate',
  };

  const setStep = (next: Step, extra = '') => {
    step = next;
    setText(instructions[next] + (extra ? `\n${extra}` : ''));
  };

  const reset = () => {
    pairA.scan = pairA.measured = pairB.scan = pairB.measured = null;
    scanMarker.visible = physMarker.visible = false;
    setStep('A_SCAN');
  };

  renderer.xr.addEventListener('sessionstart', () => {
    sprite.visible = true;
    reset();
  });
  renderer.xr.addEventListener('sessionend', () => { sprite.visible = false; });

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
      setText('no splat hit — aim closer at the hallway');
      return false;
    }
    pair.scan = hitLocal.applyMatrix4(splats.matrixWorld); // world (current scan-root frame)
    scanMarker.position.copy(pair.scan);
    scanMarker.visible = true;
    return true;
  };

  const pickPhysicalPoint = (pair: Pair): void => {
    const gripPos = grip.getWorldPosition(new THREE.Vector3());
    const offset = new THREE.Vector3(...PROBE_TIP_OFFSET)
      .applyQuaternion(grip.getWorldQuaternion(new THREE.Quaternion()));
    pair.measured = gripPos.add(offset);
    physMarker.position.copy(pair.measured);
    physMarker.visible = true;
  };

  const solveAndApply = () => {
    const pairs = [
      { scan: pairA.scan!.toArray() as Vec3, measured: pairA.measured!.toArray() as Vec3 },
      { scan: pairB.scan!.toArray() as Vec3, measured: pairB.measured!.toArray() as Vec3 },
    ];
    const solution = solveYawTranslation(pairs);
    const composed = composeCalibration(
      {
        quaternion: splats.quaternion.toArray() as [number, number, number, number],
        position: splats.position.toArray() as [number, number, number],
      },
      solution,
    );
    splats.quaternion.set(...composed.quaternion);
    splats.position.set(...composed.position);
    splats.updateMatrixWorld(true);

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
    // DONE: nothing until squeeze resets
  });

  controller.addEventListener('squeezestart', () => {
    if (!renderer.xr.isPresenting) return;
    reset();
  });

  // per-frame: keep the instruction panel in front of the user's face
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  return {
    update(activeCamera: THREE.Camera) {
      if (!sprite.visible) return;
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
    const lineH = 56;
    const startY = canvas.height / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineH));
    texture.needsUpdate = true;
  };
  return { sprite, setText };
}