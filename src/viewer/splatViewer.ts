// src/viewer — Load/dispose splats, shared content root, desktop inspection camera.
// (Module boundary per docs/PROJECT_PLAN.md)

import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import * as THREE from 'three';

export const MODEL_URL = '/models/hallway.ply'; // gitignored scan binary in public/models/

/**
 * Global splat opacity (0–1). 0.70 makes the scan see-through so the real
 * room (AR passthrough) is visible through the splats during calibration.
 * Implemented as a shader patch: the fragment shader's final alpha is
 * multiplied by a uGlobalOpacity uniform.
 */
export const SCAN_OPACITY = 0.70;

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
export const START_POINT: [number, number, number] = [-6.5, -1.6, -3];

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
  // alpha:true — required for immersive-ar passthrough (the compositor's
  // camera feed shows through where nothing is drawn)
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0); // transparent clear for AR passthrough
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 500,
  );
  camera.position.set(0, 1.6, 10); // desktop inspection: eye height, some distance back
  scene.add(camera); // the XR HUD (calibration panel/button) parents to the camera

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
 * Load the hallway scan ONCE with an identity transform, then apply the
 * scan-root transform to the viewer group (the scan root). Keeping the
 * transform on the group (instead of baking it into the load) lets the
 * start point be repositioned live without reloading the 17 MB scan.
 */
export async function loadScene(splats: GaussianSplats3D.DropInViewer): Promise<void> {
  await splats.addSplatScenes([{
    path: MODEL_URL,
    rotation: [0, 0, 0, 1],
    position: [0, 0, 0],
    scale: [1, 1, 1] as [number, number, number],
  }]);
  splats.quaternion.set(...SCAN_ROOT_ROTATION);
  applyStartPoint(splats, START_POINT);
  const patched = patchSplatOpacity(splats, SCAN_OPACITY);
  if (!patched) console.warn('scan opacity patch failed (shader string not found)');
}

/**
 * Multiply the splat fragment alpha by a global opacity uniform. The
 * library's material is patched in place; returns false when the shader
 * signature changed and the patch no longer applies.
 */
function patchSplatOpacity(splats: GaussianSplats3D.DropInViewer, opacity: number): boolean {
  const material = splats.viewer.splatMesh.material as unknown as THREE.ShaderMaterial | undefined;
  if (!material || typeof material.fragmentShader !== 'string') return false;
  const target = 'gl_FragColor = vec4(color.rgb, opacity);';
  if (!material.fragmentShader.includes(target)) return false;
  material.fragmentShader =
    'uniform float uGlobalOpacity;\n' +
    material.fragmentShader.replace(
      target, 'gl_FragColor = vec4(color.rgb, opacity * uGlobalOpacity);',
    );
  material.uniforms.uGlobalOpacity = { value: opacity };
  material.needsUpdate = true;
  return true;
}

/**
 * Change the scan's global opacity at RUNTIME (e.g. fade the scan out during
 * the real-world calibration steps so the camera feed is visible, and back in
 * for the scan-picking steps). No-op if the shader patch is not applied.
 */
export function setScanOpacity(splats: GaussianSplats3D.DropInViewer, opacity: number): void {
  const material = splats.viewer.splatMesh.material as unknown as THREE.ShaderMaterial | undefined;
  if (material && material.uniforms && material.uniforms.uGlobalOpacity) {
    material.uniforms.uGlobalOpacity.value = opacity;
  }
}

/**
 * Shift the map so that the given point (in rotated world metres) lands on
 * the XR origin — where the user will physically stand. The player/rig is
 * never moved; only the scan root is.
 */
export function applyStartPoint(
  splats: GaussianSplats3D.DropInViewer,
  startPoint: [number, number, number],
): void {
  splats.position.set(
    SCAN_ROOT_POSITION[0] - startPoint[0],
    SCAN_ROOT_POSITION[1] - startPoint[1],
    SCAN_ROOT_POSITION[2] - startPoint[2],
  );
}

/**
 * Cyan marker at the XR origin: a ring on the floor + a vertical line.
 * Shows in the flat preview exactly where you will stand in VR. Hidden
 * during immersive sessions.
 */
export function createSpawnMarker(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: 0x00e5ff });
  const vertical = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 2, 0),
  ]);
  group.add(new THREE.Line(vertical, material));
  const ringPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    ringPoints.push(new THREE.Vector3(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5));
  }
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPoints), material));
  return group;
}