// src/viewer — Load/dispose splats, shared content root, desktop inspection camera.
// (Module boundary per docs/PROJECT_PLAN.md)

import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import * as THREE from 'three';

export const MODEL_URL = '/models/hallway.ply'; // gitignored scan binary in public/models/
export const STACK_SPACING = 6;                // vertical distance between stack copies [m]

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
    gpuAcceleratedSort: true,        // sorting on GPU — leaves the CPU free for XR
    antialiased: false,
    dynamicScene: false,
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
 * Load the hallway scan STACK_LEN times, stacked vertically — current test
 * configuration for the 3×-duplicate stack request. Each copy gets its own
 * position offset; the transform contract is the scan root only.
 */
export async function loadStack(splats: GaussianSplats3D.DropInViewer, copies = 3): Promise<void> {
  const levels = Array.from({ length: copies }, (_, i) => (i - (copies - 1) / 2) * STACK_SPACING);
  const sceneSpecs = levels.map((y) => ({
    path: MODEL_URL,
    position: [0, y, 0] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  }));
  await splats.addSplatScenes(sceneSpecs);
}