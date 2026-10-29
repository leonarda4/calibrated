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
import { setScanOpacity, SCAN_OPACITY } from '../viewer/splatViewer';
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
const CALIBRATION_OPACITY = 0.20;   // scan visibility while calibrating (camera visible)
const MIN_REMOTE_SEPARATION = 0.3; // m — A and B must be distinguishable
const MAX_FIT_RMS = 1;             // m — refuse nonsense fits

interface SplatMeshWithCenters {
  splatDataTextures?: { baseData?: { centers?: Float32Array } };
}

interface ControllerEntry {
  ctrl: THREE.Group;
  grip: THREE.Group;
  source: XRInputSource | null;
}

export type LandmarkPickCallback = (which: 'A' | 'B', point: Vec3) => void;

export function setupCalibrationCapture(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  splats: GaussianSplats3D.DropInViewer,
  onCalibrated?: (solution: YawTranslationSolution) => void,
  onLandmarkPicked?: LandmarkPickCallback,
): { dispose(): void } {
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

  // ---- markers at the predefined landmark points ------------------------
  const markerA = makeMarker(0x00e5ff, 'A');   // cyan = point A (left remote)
  const markerB = makeMarker(0xffa500, 'B');  // orange = point B (right remote)
  const physA = makeMarker(0x00e5ff, null);
  const physB = makeMarker(0xffa500, null);
  physA.visible = physB.visible = false;
  markerA.position.fromArray(SCAN_POINT_A);
  markerB.position.fromArray(SCAN_POINT_B);
  // scan markers live inside the splats group; measured markers in world space
  splats.add(markerA, markerB);
  scene.add(physA, physB);

  let step: 'READY' | 'COUNTDOWN' | 'DONE' = 'READY';
  let pickToggle: 'A' | 'B' = 'A';
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let secondsLeft = 0;

  const showPanel = (text: string): void => {
    panel.visible = true;
    setText(text);
  };

  const clearTimers = (): void => {
    if (holdTimer) clearTimeout(holdTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    holdTimer = countdownTimer = null;
  };

  /** "CALIBRATE" start screen: button + instructions, scan at 50%. */
  const enterReady = (): void => {
    step = 'READY';
    physA.visible = physB.visible = false;
    button.visible = true;
    setScanOpacity(splats, CALIBRATION_OPACITY); // see the room through the scan
    clearTimers();
    showPanel(
      'CALIBRATE\nAim at the button and pull the trigger.\nThen place the remotes:\nLEFT on marker A, RIGHT on marker B',
    );
  };

  /** Trigger on the button starts the placement countdown. */
  const startCountdown = (): void => {
    step = 'COUNTDOWN';
    button.visible = false;
    setScanOpacity(splats, CALIBRATION_OPACITY);
    clearTimers();
    secondsLeft = PLACE_SECONDS;
    showPanel(
      `PLACE REMOTES\nLEFT remote on marker A (cyan)\nRIGHT remote on marker B (orange)\n${secondsLeft}s left`,
    );
    countdownTimer = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft > 0) {
        showPanel(
          `PLACE REMOTES\nLEFT remote on marker A (cyan)\nRIGHT remote on marker B (orange)\n${secondsLeft}s left`,
        );
      } else {
        clearInterval(countdownTimer!);
        countdownTimer = null;
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
    const left = byHand('left');
    const right = byHand('right');
    if (!left || !right) {
      showPanel('BOTH remotes are needed\nWake both controllers, then use\nthe button to restart');
      enterReady();
      return;
    }
    const leftPos = remotePoint(left);
    const rightPos = remotePoint(right);
    if (leftPos.length() < 0.05 || rightPos.length() < 0.05) {
      showPanel('Remotes not tracked yet\nMove them a little, then use\nthe button to restart');
      enterReady();
      return;
    }
    if (leftPos.distanceTo(rightPos) < MIN_REMOTE_SEPARATION) {
      showPanel('Remotes too close together\nPlace them on A and B separately');
      enterReady();
      return;
    }
    const solution = solveYawTranslation([
      { scan: splats.localToWorld(new THREE.Vector3(...SCAN_POINT_A)).toArray() as Vec3, measured: leftPos.toArray() as Vec3 },
      { scan: splats.localToWorld(new THREE.Vector3(...SCAN_POINT_B)).toArray() as Vec3, measured: rightPos.toArray() as Vec3 },
    ]);
    if (solution.rmsResidual > MAX_FIT_RMS) {
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

    const a = (solution.residuals[0] * 100).toFixed(1);
    const b = (solution.residuals[1] * 100).toFixed(1);
    step = 'DONE';
    button.visible = true;
    setScanOpacity(splats, SCAN_OPACITY); // back to normal visibility
    showPanel(`CALIBRATED ✓\nLeft remote = A, right = B\nfit error A: ${a} cm | B: ${b} cm\nButton = recalibrate`);
    onCalibrated?.(solution);
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { panel.visible = false; }, PANEL_HOLD_MS);
  };

  const onSelect = (entry: ControllerEntry) => {
    if (!renderer.xr.isPresenting) return;
    if (step === 'COUNTDOWN') return; // nothing during the countdown
    // READY / DONE: does this controller's ray hit the ⟲ button?
    const origin = entry.ctrl.getWorldPosition(new THREE.Vector3());
    const dir = entry.ctrl.getWorldDirection(new THREE.Vector3()).negate();
    const toButton = button.getWorldPosition(new THREE.Vector3()).sub(origin);
    const t = toButton.dot(dir);
    const perpendicular = toButton.clone().addScaledVector(dir, -t).length();
    if (t > 0.2 && t < 5 && perpendicular < 0.25) startCountdown();
  };

  // ---- desktop picker: click the scan to define landmark points ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const onPointerDown = (e: PointerEvent): void => {
    if (renderer.xr.isPresenting) return;
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
    if (pickToggle === 'A') {
      markerA.position.copy(hit);
      markerA.visible = true;
      pickToggle = 'B';
    } else {
      markerB.position.copy(hit);
      markerB.visible = true;
      pickToggle = 'A';
    }
    onLandmarkPicked?.(pickToggle === 'B' ? 'A' : 'B', hit.toArray() as Vec3);
  };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  return {
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