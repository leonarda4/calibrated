import { Matrix4, Vector2, Vector3, Vector4, type ShaderMaterial } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { createHallwaySections } from '../experience/hallwaySection.ts';
import type { HallwayWallPlanes } from '../experience/hallwayCenter.ts';
import { WALL_SECTION } from './wallSectionConfig.ts';
import { createHallwayPlacementFrame, type HallwayPlacementFrame } from './wallRouteFrame.ts';

/** Lay the wall's face flat, with its near edge at the requested world Z. */
export const FLOOR_HOLE = {
  width: WALL_SECTION.width,
  length: WALL_SECTION.height,
  startZ: 3,
  floorY: 0,
  // Include the noisy floor surface and below-floor splats, preserving walls.
  surfaceAllowance: 0.15,
} as const;

/** Clip fragments, rather than centres, so overlapping Gaussians leave sharp edges. */
function prepareFloorShader(material: ShaderMaterial): void {
  if (material.uniforms.uFloorHoleOpen) return;
  const projection = 'gl_Position = quadPos;';
  const fragmentMain = 'void main () {';
  if (!material.vertexShader.includes(projection) || !material.fragmentShader.includes(fragmentMain)) {
    throw new Error('The installed splat shader cannot create the floor opening.');
  }
  material.vertexShader = `
    uniform float uFloorHoleOpen;
    uniform float uFloorHoleY;
    uniform float uFloorHoleSurfaceAllowance;
    uniform mat4 uFloorHoleWorldToRoute;
    varying float vFloorHoleCandidate;
    varying vec3 vFloorHoleNear;
    varying vec3 vFloorHoleFar;
  ` + material.vertexShader.replace(projection, `${projection}
    vFloorHoleCandidate = 0.0;
    vFloorHoleNear = vec3(0.0);
    vFloorHoleFar = vec3(0.0);
    if (uFloorHoleOpen > 0.5 && int(sceneIndex) == 0) {
      mat4 viewToRoute = uFloorHoleWorldToRoute * inverse(viewMatrix);
      vec3 worldCenter = (viewToRoute * viewCenter).xyz;
      if (worldCenter.y <= uFloorHoleY + uFloorHoleSurfaceAllowance) {
        vFloorHoleCandidate = 1.0;
        mat4 clipToWorld = viewToRoute * inverse(projectionMatrix);
        vec4 nearPoint = clipToWorld * vec4(quadPos.xy, -1.0, 1.0);
        vec4 farPoint = clipToWorld * vec4(quadPos.xy, 1.0, 1.0);
        vFloorHoleNear = nearPoint.xyz / nearPoint.w;
        vFloorHoleFar = farPoint.xyz / farPoint.w;
      }
    }
  `);
  material.fragmentShader = `
    uniform float uFloorHoleY;
    uniform vec4 uFloorHoleBounds;
    uniform vec2 uFloorHoleFarBounds;
    varying float vFloorHoleCandidate;
    varying vec3 vFloorHoleNear;
    varying vec3 vFloorHoleFar;
  ` + material.fragmentShader.replace(fragmentMain, `${fragmentMain}
    if (vFloorHoleCandidate > 0.5) {
      vec3 ray = vFloorHoleFar - vFloorHoleNear;
      if (abs(ray.y) > 0.000001) {
        float t = (uFloorHoleY - vFloorHoleNear.y) / ray.y;
        vec3 floorPoint = vFloorHoleNear + t * ray;
        float along = (floorPoint.z - uFloorHoleBounds.z) / (uFloorHoleBounds.w - uFloorHoleBounds.z);
        vec2 edges = mix(uFloorHoleBounds.xy, uFloorHoleFarBounds, along);
        if (t >= 0.0 && along >= 0.0 && along <= 1.0 &&
            floorPoint.x >= edges.x && floorPoint.x <= edges.y) discard;
      }
    }
  `);
  material.uniforms.uFloorHoleOpen = { value: 0 };
  material.uniforms.uFloorHoleY = { value: FLOOR_HOLE.floorY };
  material.uniforms.uFloorHoleSurfaceAllowance = { value: FLOOR_HOLE.surfaceAllowance };
  material.uniforms.uFloorHoleBounds = { value: new Vector4() };
  material.uniforms.uFloorHoleFarBounds = { value: new Vector2() };
  material.uniforms.uFloorHoleWorldToRoute = { value: new Matrix4() };
  material.needsUpdate = true;
}

export type FloorHole = ReturnType<typeof createFloorHole>;

/** Current-hallway visual cutout at explicit world-Z stations. */
export function createFloorHole(options: {
  scanRoot: DropInViewer;
  getSourceCenters(): Float32Array | undefined;
  blockReason(): string | null;
  getRotationState?(): { phase: string; offsetWorld: readonly [number, number, number] };
  placementFrame?: HallwayPlacementFrame;
}) {
  const { scanRoot } = options;
  const frame = options.placementFrame ?? createHallwayPlacementFrame(scanRoot);
  const offsetInRoute = () => frame.routeVector(new Vector3(...(options.getRotationState?.().offsetWorld ?? [0, 0, 0]))).toArray();
  let phase: 'loading' | 'ready' | 'error' = 'loading';
  let open = false;
  let status = 'Loading floor opening…';
  let centerX: number | null = null;
  let width: number = FLOOR_HOLE.width;
  let nearBounds: [number, number] | null = null;
  let farBounds: [number, number] | null = null;
  let previousOffset: readonly [number, number, number] = [0, 0, 0];
  const sections = createHallwaySections({ scanRoot: frame.root, getCenters: options.getSourceCenters, floorY: FLOOR_HOLE.floorY });
  const material = () => scanRoot.viewer.splatMesh.material as ShaderMaterial;
  const close = () => {
    open = false; centerX = null; nearBounds = null; farBounds = null;
    const uniform = material()?.uniforms?.uFloorHoleOpen;
    if (uniform) uniform.value = 0;
    if (phase === 'ready') status = 'Floor closed.';
  };
  const writeBounds = () => {
    if (!nearBounds || !farBounds) return;
    material().uniforms.uFloorHoleBounds.value.set(nearBounds[0], nearBounds[1], FLOOR_HOLE.startZ,
      FLOOR_HOLE.startZ + FLOOR_HOLE.length);
    material().uniforms.uFloorHoleFarBounds.value.set(...farBounds);
    material().uniforms.uFloorHoleWorldToRoute.value.fromArray(frame.matrix()).invert();
  };
  const wallEdges = (walls: HallwayWallPlanes, z: number): [number, number] => {
    const values = [walls.left, walls.right].map(wall => {
      if (Math.abs(wall.normal[0]) < .1) throw new Error('Floor opening needs walls running along world Z.');
      return (wall.normal[0] * wall.point[0] + wall.normal[2] * wall.point[2]
        - wall.normal[2] * z) / wall.normal[0];
    }).sort((a, b) => a - b);
    return [values[0], values[1]];
  };
  const fitCurrentSection = () => {
    const near = sections.at(FLOOR_HOLE.startZ);
    const far = sections.at(FLOOR_HOLE.startZ + FLOOR_HOLE.length);
    const middle = sections.at(FLOOR_HOLE.startZ + FLOOR_HOLE.length / 2);
    if (!near.ok) throw new Error(`Floor opening: ${near.reason}`);
    if (!far.ok) throw new Error(`Floor opening: ${far.reason}`);
    if (!middle.ok) throw new Error(`Floor opening: ${middle.reason}`);
    nearBounds = wallEdges(near.wallPlanes, FLOOR_HOLE.startZ);
    farBounds = wallEdges(far.wallPlanes, FLOOR_HOLE.startZ + FLOOR_HOLE.length);
    centerX = middle.centerWorld[0]; width = middle.width;
    previousOffset = offsetInRoute();
    writeBounds();
    status = `Floor open · hallway width ${width.toFixed(2)} m × ${FLOOR_HOLE.length.toFixed(2)} m · hallway Z = 3–5.6 m`;
  };
  const update = () => {
    if (!open) return;
    const rotation = options.getRotationState?.();
    if (rotation?.phase === 'stopped') { close(); return; }
    try {
      if (rotation?.phase === 'rotating' && nearBounds && farBounds) {
        // Avoid refitting a transverse scan during the artistic turn. The
        // authored world-Z interval stays put while its lateral offset eases.
        const offset = offsetInRoute();
        const dx = offset[0] - previousOffset[0], dz = offset[2] - previousOffset[2];
        const shift = nearBounds.map((_, side) => dx - (farBounds![side] - nearBounds![side]) / FLOOR_HOLE.length * dz);
        nearBounds = nearBounds.map((x, side) => x + shift[side]) as [number, number];
        farBounds = farBounds.map((x, side) => x + shift[side]) as [number, number];
        if (centerX !== null) centerX += (shift[0] + shift[1]) / 2;
        previousOffset = offset;
        writeBounds();
      } else fitCurrentSection();
    } catch (cause) {
      close(); status = cause instanceof Error ? cause.message : String(cause);
    }
  };
  const show = (): boolean => {
    if (open) { update(); return open; }
    const reason = phase !== 'ready' ? status : options.blockReason();
    if (reason) { status = reason; return false; }
    try {
      fitCurrentSection();
      material().uniforms.uFloorHoleOpen.value = 1;
      open = true;
      return true;
    } catch (cause) {
      close(); status = cause instanceof Error ? cause.message : String(cause); return false;
    }
  };
  return {
    reset: close,
    close,
    show,
    update,
    initialize() {
      prepareFloorShader(material());
      phase = 'ready'; close();
    },
    loadingFailed(cause: unknown) {
      close(); phase = 'error';
      status = `Floor opening unavailable: ${cause instanceof Error ? cause.message : String(cause)}`;
    },
    toggle(): boolean { if (open) { close(); return true; } return show(); },
    snapshot() { return { phase, open, status, centerX, ...FLOOR_HOLE, width,
      nearBounds: nearBounds ? [...nearBounds] : null, farBounds: farBounds ? [...farBounds] : null,
      endZ: FLOOR_HOLE.startZ + FLOOR_HOLE.length, routeToWorld: frame.matrix(),
      worldCorners: nearBounds && farBounds ? [
        [nearBounds[0], FLOOR_HOLE.floorY, FLOOR_HOLE.startZ],
        [nearBounds[1], FLOOR_HOLE.floorY, FLOOR_HOLE.startZ],
        [farBounds[0], FLOOR_HOLE.floorY, FLOOR_HOLE.startZ + FLOOR_HOLE.length],
        [farBounds[1], FLOOR_HOLE.floorY, FLOOR_HOLE.startZ + FLOOR_HOLE.length],
      ].map(p => frame.worldPoint(new Vector3(...p)).toArray()) : null }; },
  };
}
