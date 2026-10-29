// src/viewer — Load/dispose splats, shared content root, desktop inspection camera.
// (Module boundary per docs/PROJECT_PLAN.md)

import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import * as THREE from 'three';

export const MODEL_URL = '/models/hallway.ply'; // gitignored scan binary in public/models/

// ---------------------------------------------------------------------------
// Scan-root transform — the ONLY thing allowed to move the world.
// Per docs/PROJECT_PLAN.md the tracked XR rig (camera/controllers) stays at
// identity; alignment is applied to the scan root instead.
//
// The scan's own axes (from the .ply header): long axis = Y (≈58 m, that's
// why the hallway stood vertical in VR), thin axis = Z (≈4.7 m ≈ corridor
// height), spread axis = X (≈30 m). We rotate -90° about X so that:
//   scan Y (length)  -> world -Z (running away from you, horizontal)
//   scan Z (height)  -> world +Y (up)
//   scan X (width)    -> world +X
//
// Rotation is a quaternion [x, y, z, w]; -90° about X = [-√½, 0, 0, √½].
// Position is an offset in metres applied AFTER the rotation.
// Header bounds: x −26.6…3.0, y −45.9…12.8, z −2.03…2.69
// ---------------------------------------------------------------------------
export const SCAN_ROOT_ROTATION: [number, number, number, number] = [
  -0.70710678, 0, 0, 0.70710678, // -90° about X
];
export const SCAN_ROOT_POSITION: [number, number, number] = [
  11.8,   // -center of scan X  (−(−26.6+3.0)/2): hallway centered left/right
  -0.33,  // -center of scan Z (−(−2.03+2.69)/2): you stand mid-corridor height
  -16.55, // -center of scan Y after rotation (−((−45.9+12.8)/2)): hallway centered front/back
];

// ---------------------------------------------------------------------------
// Start point: the point of the map (in the ROTATED world frame) that ends up
// at the XR origin — i.e. exactly where you physically stand when you enter VR.
// The map is shifted so this point lands on you; the player is never moved.
// All three values are metres. Leave [0,0,0] to keep the current centered view.
//
// How to find the numbers: enter VR, walk to where you want to spawn, exit —
// the page then prints your last head position. Copy it into START_POINT.
// ---------------------------------------------------------------------------
export const START_POINT: [number, number, number] = [0, 0, 0];

export interface ViewerRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  splats: GaussianSplats3D.DropInViewer;
}

/**
 * Create the desktop-inspection rig: renderer, scene, camera and the splat
 * group. In calibrated mode the scan root (this group) is the only thing a
 * calibration transform may touch — the tracked XR rig stays at identity.
 */
export function createViewerRig(): ViewerRig {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 500,
  );
  camera.position.set(0, 0, 8);

  const splats = new GaussianSplats3D.DropInViewer({
    gpuAcceleratedSort: false,       // CPU sort — more compatible across browsers
    antialiased: false,
    dynamicScene: true,              // re-sort every frame (test; off again if slow)
    sphericalHarmonicsDegree: 0,
    sharedMemoryForWorkers: false,    // avoids SharedArrayBuffer (needs COOP/COEP otherwise)
  });
  scene.add(splats as unknown as THREE.Object3D);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, splats };
}

/**
 * Load the hallway scan ONCE, with the scan-root transform applied.
 * Change the world by editing SCAN_ROOT_ROTATION / SCAN_ROOT_POSITION /
 * START_POINT above — never by moving the XR rig.
 */
export async function loadScene(splats: GaussianSplats3D.DropInViewer): Promise<void> {
  // Shift the map so that START_POINT lands on the XR origin (your spawn).
  const position = [
    SCAN_ROOT_POSITION[0] - START_POINT[0],
    SCAN_ROOT_POSITION[1] - START_POINT[1],
    SCAN_ROOT_POSITION[2] - START_POINT[2],
  ] as [number, number, number];
  await splats.addSplatScenes([{
    path: MODEL_URL,
    rotation: SCAN_ROOT_ROTATION,
    position,
    scale: [1, 1, 1] as [number, number, number],
  }]);
}