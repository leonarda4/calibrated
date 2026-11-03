import * as THREE from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { estimateHallwayCenter } from '../experience/hallwayCenter.ts';
import { getSourceCenters, restoreScanOpacity } from './splatViewer.ts';
import { WALL_SECTION } from './wallSectionConfig.ts';

export interface WallBlockerSnapshot {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  visible: boolean;
  requested: boolean;
  error: string | null;
  status: string;
  sceneIndex: number | null;
  width: number;
  height: number;
  baseRaw: [number, number, number] | null;
  yaw: number | null;
}

/**
 * Cut the projected wall Gaussians at its authored rectangle. Reconstructing
 * the fragment ray in the wall frame keeps the cut correct in both XR eyes;
 * it does not introduce an opaque backing or affect the original hallway.
 */
function clipWallRectangle(material: THREE.ShaderMaterial, index: number): void {
  if (material.uniforms.uWallSceneIndex) return;
  const projection = 'gl_Position = quadPos;';
  const fragmentMain = 'void main () {';
  if (!material.vertexShader.includes(projection) || !material.fragmentShader.includes(fragmentMain)) {
    throw new Error('The installed splat shader cannot clip the extracted wall.');
  }
  material.vertexShader = `
    uniform int uWallSceneIndex;
    varying float vWallClip;
    varying vec3 vWallRayNear;
    varying vec3 vWallRayFar;
  ` + material.vertexShader.replace(projection, `${projection}
    vWallClip = int(sceneIndex) == uWallSceneIndex ? 1.0 : 0.0;
    vWallRayNear = vec3(0.0);
    vWallRayFar = vec3(0.0);
    if (vWallClip > 0.5) {
      mat4 clipToWall = inverse(transformModelViewMatrix) * inverse(projectionMatrix);
      vec4 rayNear = clipToWall * vec4(quadPos.xy, -1.0, 1.0);
      vec4 rayFar = clipToWall * vec4(quadPos.xy, 1.0, 1.0);
      vWallRayNear = rayNear.xyz / rayNear.w;
      vWallRayFar = rayFar.xyz / rayFar.w;
    }
  `);
  material.fragmentShader = `
    uniform vec2 uWallDimensions;
    varying float vWallClip;
    varying vec3 vWallRayNear;
    varying vec3 vWallRayFar;
  ` + material.fragmentShader.replace(fragmentMain, `${fragmentMain}
    if (vWallClip > 0.5) {
      vec3 ray = vWallRayFar - vWallRayNear;
      if (abs(ray.z) < 0.000001) discard;
      vec3 wallPoint = vWallRayNear - ray * (vWallRayNear.z / ray.z);
      if (abs(wallPoint.x) > uWallDimensions.x * 0.5 ||
          wallPoint.y < 0.0 || wallPoint.y > uWallDimensions.y) discard;
    }
  `);
  material.uniforms.uWallSceneIndex = { value: index };
  material.uniforms.uWallDimensions = { value: new THREE.Vector2(WALL_SECTION.width, WALL_SECTION.height) };
  material.needsUpdate = true;
}

export type WallBlocker = ReturnType<typeof createWallBlocker>;

/** One reusable splat object in the hallway's shared depth-sort and scan frame. */
export function createWallBlocker(options: {
  scanRoot: DropInViewer;
  canShow?(): string | null;
}) {
  const { scanRoot } = options;
  const listeners = new Set<(state: WallBlockerSnapshot) => void>();
  let phase: WallBlockerSnapshot['phase'] = 'idle';
  let status = 'A 210 cm wall section is ready to load. Show wall places it across the hallway.';
  let error: string | null = null;
  let sceneIndex: number | null = null;
  let requested = false;
  let epoch = 0;
  let disposed = false;
  let pending: Promise<void> | null = null;
  let baseRaw: WallBlockerSnapshot['baseRaw'] = null;
  let yaw: number | null = null;
  const wallScene = () => sceneIndex === null ? null : scanRoot.getSplatScene(sceneIndex);
  const snapshot = (): WallBlockerSnapshot => ({
    phase, visible: wallScene()?.visible ?? false, requested, error, status, sceneIndex,
    width: WALL_SECTION.width, height: WALL_SECTION.height,
    baseRaw: baseRaw ? [...baseRaw] : null, yaw,
  });
  const publish = () => { for (const listener of listeners) listener(snapshot()); };
  const fail = (message: string) => {
    requested = false;
    error = message;
    status = message;
    publish();
    return false;
  };
  const placement = () => {
    const centers = getSourceCenters(scanRoot);
    if (!centers) throw new Error('Wait for the hallway scan before showing the wall.');
    scanRoot.updateWorldMatrix(true, false);
    const scale = scanRoot.getWorldScale(new THREE.Vector3());
    if ([scale.x, scale.y, scale.z].some(value => Math.abs(value - 1) > 1e-6)) {
      throw new Error('Wall placement requires the metric scan scale.');
    }
    const fit = estimateHallwayCenter({ centers, modelMatrix: scanRoot.matrixWorld.elements,
      seedRaw: WALL_SECTION.placementRawStation, floorY: 0, corridorDirectionRaw: [0, 1, 0] });
    if (!fit.ok) throw new Error(`Wall placement: ${fit.reason}`);
    // The source wall was captured from its positive local-Z side. Face that
    // side toward the start (lower raw Y), preserving readable graffiti and
    // the original front-surface Gaussian ordering.
    const normal = new THREE.Vector3(...fit.directionWorld).normalize().negate();
    const up = new THREE.Vector3(0, 1, 0);
    const across = up.clone().cross(normal).normalize();
    const worldRotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, normal));
    const rotation = scanRoot.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldRotation);
    return {
      position: scanRoot.worldToLocal(new THREE.Vector3(...fit.centerWorld)), rotation,
      heading: Math.atan2(normal.x, normal.z), fittedWidth: fit.width,
    };
  };
  const load = (): Promise<void> => {
    if (pending) return pending;
    if (phase === 'ready') return Promise.resolve();
    phase = 'loading';
    status = 'Loading the original-resolution wall section…';
    error = null;
    publish();
    // The plural pinned API preserves visible:false; the single-scene helper
    // drops that option. Both scenes share the same sorter and draw call.
    pending = Promise.resolve().then(async () => {
      // A shader setup failure must retry the existing hidden scene rather
      // than append another copy of the same private wall.
      if (sceneIndex === null) {
        const index = scanRoot.getSceneCount();
        await scanRoot.addSplatScenes([{
          path: WALL_SECTION.modelUrl, visible: false, showLoadingUI: false,
          splatAlphaRemovalThreshold: 1, scale: [1, 1, 1],
        }], false);
        sceneIndex = index;
      }
      const scene = wallScene()!;
      scene.name = 'hallway-wall-blocker';
      scene.visible = false;
      restoreScanOpacity(scanRoot);
      const material = scanRoot.viewer.splatMesh.material as unknown as THREE.ShaderMaterial;
      clipWallRectangle(material, sceneIndex);
      phase = 'ready';
      status = 'Wall loaded and hidden. Press Show wall to place it across the hallway.';
    }).catch((cause: unknown) => {
      const scene = wallScene();
      if (scene) scene.visible = false;
      phase = 'error';
      throw cause;
    }).finally(() => { pending = null; publish(); });
    return pending;
  };
  const hide = (reason = 'Wall hidden.') => {
    epoch++;
    requested = false;
    const scene = wallScene();
    if (scene) scene.visible = false;
    baseRaw = null;
    yaw = null;
    status = reason;
    publish();
  };
  const show = async (): Promise<boolean> => {
    if (disposed) return false;
    const blocked = options.canShow?.();
    if (blocked) return fail(blocked);
    if (requested) return false;
    const attempt = ++epoch;
    requested = true;
    error = null;
    try {
      placement(); // Reject weak source geometry before building the object.
      await load();
      if (disposed || attempt !== epoch || !requested) return false;
      const blockedAfterLoad = options.canShow?.();
      if (blockedAfterLoad) return fail(blockedAfterLoad);
      const pose = placement();
      const scene = wallScene()!;
      scene.position.copy(pose.position);
      scene.quaternion.copy(pose.rotation);
      scene.scale.set(1, 1, 1);
      // The sorter reads the library's transform, not THREE.matrixWorld.
      // Viewer.update sorts before refreshing it, so publish the new pose
      // before the first visible frame as well as before a paused capture.
      scene.updateTransform(true);
      baseRaw = pose.position.toArray();
      yaw = pose.heading;
      scene.visible = true;
      requested = false;
      status = `Wall shown: ${(WALL_SECTION.width * 100).toFixed(0)} cm wide × ` +
        `${(WALL_SECTION.height * 100).toFixed(0)} cm high; across the fitted ${pose.fittedWidth.toFixed(2)} m hallway.`;
      publish();
      return true;
    } catch (cause: unknown) {
      if (disposed || attempt !== epoch) return false;
      const message = cause instanceof Error ? cause.message : String(cause);
      return fail(`Wall unavailable: ${message}`);
    }
  };
  return {
    show, hide, snapshot,
    // The shared material is rebuilt before the load promise resolves. Keep
    // the current calibration fade patched on every render during that gap.
    update() {
      restoreScanOpacity(scanRoot);
      if (phase === 'ready' && sceneIndex !== null) {
        clipWallRectangle(scanRoot.viewer.splatMesh.material as unknown as THREE.ShaderMaterial, sceneIndex);
      }
    },
    async toggle(): Promise<boolean> {
      if (requested || wallScene()?.visible) { hide(); return false; }
      return show();
    },
    subscribe(listener: (state: WallBlockerSnapshot) => void) {
      listeners.add(listener); listener(snapshot());
      return () => { listeners.delete(listener); };
    },
    dispose() { hide(); disposed = true; listeners.clear(); },
  };
}
