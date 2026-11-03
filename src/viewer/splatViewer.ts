// src/viewer — Load/dispose splats, shared content root, desktop inspection camera.
// (Module boundary per docs/PROJECT_PLAN.md)

import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import * as THREE from 'three';
import { resolveLayerPath, withHiddenXrWebGlBinding } from '../xr/enterVR';
import { parseRenderQuality } from './quality';
import { ACTIVE_SCAN } from './scanAsset';
import { scanOriginForStart } from './scanPlacement';
export type { ScanVariant } from './quality';

/** Resolve the active original hallway3 PLY; no compressed derivative is used. */
export function getScanUrl(): string {
  return parseRenderQuality(window.location.search).modelUrl;
}

/** Global experience opacity. Calibration controls its own fade independently. */
export const SCAN_OPACITY = 1;

// ---------------------------------------------------------------------------
// Scan-root transform — the ONLY thing allowed to move the world.
// Per docs/PROJECT_PLAN.md the tracked XR rig (camera/controllers) stays at
// identity; alignment is applied to the scan root instead.
//
// The asset profile supplies the requested Y/Z rotation. The raw floor start
// maps to the XR origin; physical registration still requires matching A/B.
// ---------------------------------------------------------------------------
export const SCAN_ROOT_ROTATION = ACTIVE_SCAN.rotation;

// ---------------------------------------------------------------------------
// Raw PLY floor point that lands at the XR origin before calibration.
// Changes move the scan only; a new A/B fit determines physical registration.
// ---------------------------------------------------------------------------
export const START_POINT = ACTIVE_SCAN.startPoint;

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
  const quality = parseRenderQuality(window.location.search);
  // Task spec: create the WebGL2 context ourselves — XR-compatible and on
  // the discrete GPU — and hand it to the renderer.
  const WEBGL_ANTIALIAS = false; // splat rendering: fill-rate beats MSAA
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', {
    xrCompatible: true,
    antialias: WEBGL_ANTIALIAS,
    alpha: true, // required for immersive-ar passthrough
    powerPreference: 'high-performance',
  });
  if (!context) throw new Error('WebGL2 not available in this browser');

  // PCVR fix (see src/xr/enterVR.ts header): in classic mode hide
  // XRWebGLBinding while the renderer is constructed so three.js wires the
  // proven XRWebGLLayer path instead of the frame-less projection layers.
  const rendererOptions = {
    canvas, context, antialias: WEBGL_ANTIALIAS, alpha: true,
  } as THREE.WebGLRendererParameters;
  const renderer = resolveLayerPath() === 'classic'
    ? withHiddenXrWebGlBinding(() => new THREE.WebGLRenderer(rendererOptions))
    : new THREE.WebGLRenderer(rendererOptions);

  // Desktop only: XR owns its framebuffer after session entry.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.desktopPixelRatioLimit));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0); // transparent clear for AR passthrough
  renderer.xr.enabled = true;
  renderer.xr.setFoveation(0); // 0 = no fixed foveation → sharp peripheral vision
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 500,
  );
  camera.position.set(...ACTIVE_SCAN.desktopCamera); // overview of the new export
  scene.add(camera); // the XR HUD (calibration panel/button) parents to the camera

  const splats = new GaussianSplats3D.DropInViewer({
    gpuAcceleratedSort: false,       // CPU sort — more compatible across browsers
    antialiased: quality.antialiased, // opt-in for compensation-trained exports
    dynamicScene: true,               // re-sort every frame
    enableOptionalEffects: true,      // independently hide the extracted wall scene
    sphericalHarmonicsDegree: quality.sphericalHarmonicsDegree,
    halfPrecisionCovariancesOnGPU: false,
    integerBasedSort: false,          // avoid large-scene integer overflow
    optimizeSplatData: true,
    // Calibration already owns the reveal. The library's raw-origin radial
    // reveal otherwise masks off-centre scans long after loading completes.
    sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
    inMemoryCompressionLevel: 0,      // avoid an additional lossy compression pass
    sharedMemoryForWorkers: false,    // avoids SharedArrayBuffer (needs COOP/COEP otherwise)
  });
  scene.add(splats as unknown as THREE.Object3D);

  window.addEventListener('resize', () => {
    // never resize while presenting — the XR session owns the framebuffer
    if (renderer.xr.isPresenting) return;
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
 * start point be repositioned live without reloading the scan.
 */
export async function loadScene(
  splats: GaussianSplats3D.DropInViewer,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const quality = parseRenderQuality(window.location.search);
  const modelUrl = quality.modelUrl;
  await splats.addSplatScenes([{
    path: modelUrl,
    rotation: [0, 0, 0, 1],
    position: [0, 0, 0],
    scale: [1, 1, 1] as [number, number, number],
    splatAlphaRemovalThreshold: quality.alphaRemovalThreshold,
    onProgress: (percent: number) => onProgress?.(percent),
  }]);
  applyStartPoint(splats, START_POINT);
  const patched = patchSplatOpacity(splats, SCAN_OPACITY);
  if (!patched) console.warn('scan opacity patch failed (shader string not found)');
  return modelUrl;
}

/**
 * Multiply the splat fragment alpha by a global opacity uniform. The
 * library's material is patched in place; returns false when the shader
 * signature changed and the patch no longer applies.
 */
export function patchSplatOpacity(splats: GaussianSplats3D.DropInViewer, opacity: number): boolean {
  const material = splats.viewer.splatMesh.material as unknown as THREE.ShaderMaterial | undefined;
  if (!material || typeof material.fragmentShader !== 'string') return false;
  if (material.uniforms.uGlobalOpacity) {
    material.uniforms.uGlobalOpacity.value = opacity;
    return true;
  }
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
  scanOpacity.set(splats, opacity);
  const material = splats.viewer.splatMesh.material as unknown as THREE.ShaderMaterial | undefined;
  if (material && material.uniforms && material.uniforms.uGlobalOpacity) {
    material.uniforms.uGlobalOpacity.value = opacity;
  }
}

// Adding a splat object rebuilds the shared material. Keep the latest requested
// calibration fade independently so a completed async load cannot reveal it.
const scanOpacity = new WeakMap<object, number>();
export function restoreScanOpacity(splats: GaussianSplats3D.DropInViewer): void {
  patchSplatOpacity(splats, scanOpacity.get(splats) ?? SCAN_OPACITY);
}

/** Original hallway centres only; props never become calibration landmarks. */
export function getSourceCenters(scanRoot: { viewer: { splatMesh: unknown } }): Float32Array | undefined {
  const mesh = scanRoot.viewer.splatMesh as {
    splatDataTextures?: { baseData?: { centers?: Float32Array } };
    getScene?(index: number): { splatBuffer?: { getSplatCount(): number } } | undefined;
  };
  const centers = mesh.splatDataTextures?.baseData?.centers;
  if (!centers?.length) return undefined;
  const count = mesh.getScene?.(0)?.splatBuffer?.getSplatCount();
  return count !== undefined ? centers.subarray(0, count * 3) : centers;
}

/**
 * Shift the map so that the raw PLY floor point lands on the XR origin.
 * Reset to the asset's orientation before a new calibration. The tracked
 * player/rig is never moved; only the scan root is.
 */
export function applyStartPoint(
  splats: GaussianSplats3D.DropInViewer,
  startPoint: [number, number, number],
): void {
  splats.quaternion.set(...SCAN_ROOT_ROTATION).normalize();
  splats.position.set(...scanOriginForStart(startPoint, SCAN_ROOT_ROTATION));
}

/**
 * Cyan marker at the XR origin: a ring on the floor + a vertical line.
 * Shows in the flat preview exactly where you will stand in VR. Hidden
 * during immersive sessions.
 */
export function createSpawnMarker(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, depthWrite: false });
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
  // Draw after splats, while depth testing keeps the axis hidden inside the box.
  for (const line of group.children) line.renderOrder = 999;
  return group;
}
