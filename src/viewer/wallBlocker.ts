import * as THREE from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { createHallwaySections } from '../experience/hallwaySection.ts';
import { getSourceCenters, restoreScanOpacity } from './splatViewer.ts';
import { WALL_SECTION } from './wallSectionConfig.ts';
import { WallSlide, type WallMotion } from './wallSlide.ts';
import { WallTravel, validateWallTravel, type WallTravelMode } from './wallTravel.ts';
import { WallApproach, wallEntryBlocked, type PlayerPosition } from './wallApproach.ts';
import { createWallRouteFrame, type HallwayPlacementFrame } from './wallRouteFrame.ts';
import { lockWallTrajectory } from './wallTrajectory.ts';
import { WallGlitch } from './wallGlitch.ts';
import { prepareWallGlitchShader, setWallGlitch } from './wallGlitchShader.ts';
import { WallGaze, lookingAtWall } from './wallGaze.ts';
import { WallRevealGate } from './wallReveal.ts';
import { WallPassage } from './wallPassage.ts';
import { wallConcealsHole } from './wallConcealment.ts';

export interface WallArrivalPlacement {
  positionRoute: [number, number, number];
  direction: 1 | -1;
  halfDepth: number;
  crossing?: { playerRoute: readonly [number, number, number]; direction: 1 | -1 };
}

export interface WallBlockerSnapshot {
  phase: 'loading' | 'ready' | 'error';
  visible: boolean;
  motion: WallMotion;
  animating: boolean;
  offset: number;
  progress: number;
  error: string | null;
  status: string;
  sceneIndex: number | null;
  width: number;
  height: number;
  baseRaw: [number, number, number] | null;
  yaw: number | null;
  baseWorld: [number, number, number] | null;
  positionWorld: [number, number, number] | null;
  routeToWorld: number[];
  placementSource: 'fitted' | 'manual';
  travel: ReturnType<WallTravel['snapshot']>;
  approach: ReturnType<WallApproach['snapshot']>;
  gameplayCue: 'waitingSecondBox' | 'waitingLookAway' | 'waitingPlayer' | null;
  revealInSeconds: number | null;
  alignmentQueries: number;
  trajectoryLocked: boolean;
  routeEndpoints: { start: number[]; end: number[] } | null;
  arrival: ReturnType<WallGlitch['snapshot']>;
  inspectionEndpoint: 'start' | 'end' | null;
  gaze: ReturnType<WallGaze['snapshot']>;
  moving: boolean;
}

/**
 * Cut both full-thickness wall copies at their own authored rectangles.
 * Cull the inward copy per eye so its poor reverse appearance cannot bleed
 * through the good outward face. Both faces still share one scene transform.
 * Reconstructing the fragment ray in the wall frame keeps both XR eyes correct;
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
    uniform float uWallFaceOffset;
    varying float vWallClip;
    varying float vWallFaceDepth;
    varying vec3 vWallRayNear;
    varying vec3 vWallRayFar;
  ` + material.vertexShader.replace(projection, `${projection}
    vWallClip = int(sceneIndex) == uWallSceneIndex ? 1.0 : 0.0;
    vWallFaceDepth = 0.0;
    vWallRayNear = vec3(0.0);
    vWallRayFar = vec3(0.0);
    if (vWallClip > 0.5) {
      mat4 viewToWall = inverse(transformModelViewMatrix);
      vec3 eyeInWall = (viewToWall * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float faceSign = splatCenter.z >= 0.0 ? 1.0 : -1.0;
      vWallFaceDepth = faceSign * uWallFaceOffset;
      if (faceSign * (eyeInWall.z - vWallFaceDepth) <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      mat4 clipToWall = viewToWall * inverse(projectionMatrix);
      vec4 rayNear = clipToWall * vec4(quadPos.xy, -1.0, 1.0);
      vec4 rayFar = clipToWall * vec4(quadPos.xy, 1.0, 1.0);
      vWallRayNear = rayNear.xyz / rayNear.w;
      vWallRayFar = rayFar.xyz / rayFar.w;
    }
  `);
  material.fragmentShader = `
    uniform vec2 uWallDimensions;
    varying float vWallClip;
    varying float vWallFaceDepth;
    varying vec3 vWallRayNear;
    varying vec3 vWallRayFar;
  ` + material.fragmentShader.replace(fragmentMain, `${fragmentMain}
    if (vWallClip > 0.5) {
      vec3 ray = vWallRayFar - vWallRayNear;
      if (abs(ray.z) < 0.000001) discard;
      vec3 wallPoint = vWallRayNear + ray * ((vWallFaceDepth - vWallRayNear.z) / ray.z);
      if (abs(wallPoint.x) > uWallDimensions.x * 0.5 ||
          wallPoint.y < 0.0 || wallPoint.y > uWallDimensions.y) discard;
    }
  `);
  material.uniforms.uWallSceneIndex = { value: index };
  material.uniforms.uWallFaceOffset = { value: WALL_SECTION.faceOffset };
  material.uniforms.uWallDimensions = { value: new THREE.Vector2(WALL_SECTION.width, WALL_SECTION.height) };
  material.needsUpdate = true;
}

export type WallBlocker = ReturnType<typeof createWallBlocker>;
interface WallWorldPath {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  slideRight: THREE.Vector3;
  trajectory: Pick<ReturnType<typeof lockWallTrajectory>, 'xAt'>;
}

/** One reusable splat object in the hallway's shared depth-sort and scan frame. */
export function createWallBlocker(options: {
  scanRoot: DropInViewer;
  canShow?(): string | null;
  getPlayerPosition?(): PlayerPosition;
  getPlayerForward?(): PlayerPosition;
  getRevealReady?(): boolean;
  getTargetPosition?(): PlayerPosition;
  placementFrame?: HallwayPlacementFrame;
  onArrived?(placement: WallArrivalPlacement): boolean;
  onPrepareHole?(placement: WallArrivalPlacement): boolean;
  getPreparedHole?(): { cornersRoute: readonly (readonly [number, number, number])[] } | null;
  onRevealHole?(): boolean;
  /** Natural successful reveal only; arming and endpoint inspections are silent. */
  onAppeared?(): void;
  onSequenceCancelled?(): void;
}) {
  const { scanRoot } = options;
  const frame = options.placementFrame ?? createWallRouteFrame(scanRoot);
  const routeRoot = frame.root;
  const playerInRoute = (): PlayerPosition => {
    const player = options.getPlayerPosition?.();
    return player ? frame.routePoint(new THREE.Vector3(...player)).toArray() : null;
  };
  const listeners = new Set<(state: WallBlockerSnapshot) => void>();
  const slide = new WallSlide(WALL_SECTION.slideSeconds);
  const travel = new WallTravel();
  const approach = new WallApproach();
  const arrival = new WallGlitch({ holdSeconds: 0 });
  const gaze = new WallGaze();
  const revealGate = new WallRevealGate();
  const passage = new WallPassage();
  let moving = false;
  let arrivalAttempted = false;
  let holePrepareAttempted = false;
  let holePrepared = false;
  let holeRevealed = false;
  const sections = createHallwaySections({ scanRoot: routeRoot, getCenters: () => getSourceCenters(scanRoot) });
  let phase: WallBlockerSnapshot['phase'] = 'loading';
  let status = 'Loading the hallway and wall…';
  let error: string | null = null;
  let sceneIndex: number | null = null;
  let disposed = false;
  let pose: ReturnType<typeof placement> | null = null;
  let configuredRaw: THREE.Vector3 | null = null;
  let worldPath: WallWorldPath | null = null;
  let pendingEntry: { pose: ReturnType<typeof placement>; path: WallWorldPath; startZ: number; endZ: number } | null = null;
  let gameplayOwned = false;
  let gameplayCue: WallBlockerSnapshot['gameplayCue'] = null;
  let entryWaiting = false;
  let alignmentQueries = 0;
  let plannedRoute: { pose: ReturnType<typeof placement>; path: WallWorldPath; startZ: number; endZ: number } | null = null;
  let inspectionEndpoint: 'start' | 'end' | null = null;
  const sectionAt = (z: number) => { alignmentQueries++; return sections.at(z); };
  const wallScene = () => sceneIndex === null ? null : scanRoot.getSplatScene(sceneIndex);
  const currentBaseRaw = () => {
    if (worldPath) {
      return routeRoot.worldToLocal(worldPath.position.clone().setZ(approach.snapshot().z));
    }
    return pose ? pose.position.clone().addScaledVector(pose.forwardLocal, travel.snapshot().offset)
      : configuredRaw?.clone() ?? null;
  };
  const snapshot = (): WallBlockerSnapshot => {
    const raw = currentBaseRaw();
    scanRoot.updateWorldMatrix(true, false);
    const scene = wallScene();
    return {
      phase, visible: scene?.visible ?? false, ...slide.snapshot(), error, status, sceneIndex,
      width: pose?.fittedWidth ?? WALL_SECTION.width, height: WALL_SECTION.height,
      baseRaw: raw?.toArray() ?? null, yaw: pose?.heading ?? null,
      baseWorld: raw ? scanRoot.localToWorld(raw).toArray() : null,
      positionWorld: scene?.visible ? worldPath
        ? frame.worldPoint(worldPath.position.clone().setZ(approach.snapshot().z).addScaledVector(
          worldPath.slideRight, slide.snapshot().offset)).toArray()
        : scene.getWorldPosition(new THREE.Vector3()).toArray() : null,
      routeToWorld: frame.matrix(),
      placementSource: configuredRaw ? 'manual' : 'fitted', travel: travel.snapshot(), approach: approach.snapshot(),
      gameplayCue, revealInSeconds: gameplayCue === 'waitingLookAway' ? revealGate.remainingSeconds() : null,
      alignmentQueries, trajectoryLocked: worldPath !== null,
      routeEndpoints: plannedRoute ? {
        start: frame.worldPoint(new THREE.Vector3(plannedRoute.path.trajectory.xAt(plannedRoute.startZ), plannedRoute.path.position.y, plannedRoute.startZ)).toArray(),
        end: frame.worldPoint(new THREE.Vector3(plannedRoute.path.trajectory.xAt(plannedRoute.endZ), plannedRoute.path.position.y, plannedRoute.endZ)).toArray(),
      } : null,
      arrival: arrival.snapshot(), inspectionEndpoint, gaze: gaze.snapshot(), moving,
    };
  };
  const publish = () => { for (const listener of listeners) listener(snapshot()); };
  const fail = (message: string) => {
    error = message;
    status = message;
    publish();
    return false;
  };
  const placement = (useFitted = false, requestedZ?: number) => {
    const centers = getSourceCenters(scanRoot);
    if (!centers) throw new Error('Wait for the hallway scan before showing the wall.');
    routeRoot.updateWorldMatrix(true, false);
    const scale = routeRoot.getWorldScale(new THREE.Vector3());
    if ([scale.x, scale.y, scale.z].some(value => Math.abs(value - 1) > 1e-6)) {
      throw new Error('Wall placement requires the metric scan scale.');
    }
    const manualWorld = !useFitted && configuredRaw ? routeRoot.localToWorld(configuredRaw.clone()) : null;
    const stationZ = requestedZ ?? manualWorld?.z ?? WALL_SECTION.startWorldZ;
    const fit = sectionAt(stationZ);
    if (!fit.ok) throw new Error(`Wall placement: ${fit.reason}`);
    // The source wall was captured from its positive local-Z side. Face that
    // side toward the start (lower raw Y), preserving readable graffiti and
    // the original front-surface Gaussian ordering.
    const normal = new THREE.Vector3(...fit.directionWorld).normalize().negate();
    const up = new THREE.Vector3(0, 1, 0);
    const across = up.clone().cross(normal).normalize();
    const requiredHalfSpan = (values: readonly number[], distance: number) =>
      (distance + Math.abs(values[0] * normal.x + values[2] * normal.z) * WALL_SECTION.depth / 2) /
      Math.abs(values[0] * across.x + values[2] * across.z);
    // Cover the whole double-faced slab, including slightly nonparallel walls.
    const span = 2 * Math.max(requiredHalfSpan(fit.wallPlanes.left.normal, fit.clearanceLeft),
      requiredHalfSpan(fit.wallPlanes.right.normal, fit.clearanceRight));
    const worldRotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, normal));
    const rotation = routeRoot.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldRotation);
    const fittedWorld = new THREE.Vector3(...fit.centerWorld);
    return {
      position: !useFitted && configuredRaw ? configuredRaw.clone() : routeRoot.worldToLocal(fittedWorld), rotation,
      rightLocal: new THREE.Vector3(1, 0, 0).applyQuaternion(rotation),
      forwardLocal: new THREE.Vector3(...fit.directionWorld).transformDirection(routeRoot.matrixWorld.clone().invert()),
      heading: Math.atan2(normal.x, normal.z), fittedWidth: span,
      directionWorld: new THREE.Vector3(...fit.directionWorld), worldRotation,
    };
  };
  const preparePath = (nextPose: NonNullable<typeof pose>, endZ: number): WallWorldPath => {
    const fits = [0, .25, .5, .75, 1].map(t => {
      const z = WALL_SECTION.startWorldZ + (endZ - WALL_SECTION.startWorldZ) * t;
      const fit = sectionAt(z);
      if (!fit.ok) throw new Error(`Wall route at Z=${z}: ${fit.reason}`);
      return fit;
    });
    const trajectory = lockWallTrajectory(fits, WALL_SECTION.depth);
    const normal = new THREE.Vector3(...trajectory.normal), across = new THREE.Vector3(...trajectory.across);
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, new THREE.Vector3(0, 1, 0), normal));
    nextPose.fittedWidth = trajectory.width;
    nextPose.heading = Math.atan2(normal.x, normal.z);
    nextPose.worldRotation.copy(rotation);
    nextPose.directionWorld.copy(normal).negate();
    nextPose.forwardLocal.copy(nextPose.directionWorld).transformDirection(routeRoot.matrixWorld.clone().invert());
    return { position: new THREE.Vector3(trajectory.xAt(WALL_SECTION.startWorldZ), 0, WALL_SECTION.startWorldZ),
      rotation, slideRight: new THREE.Vector3(across.x < 0 ? -1 : 1, 0, 0), trajectory };
  };
  const syncPose = () => {
    const scene = wallScene();
    if (!scene) return;
    const state = slide.snapshot();
    if (pose) {
      if (worldPath) {
        routeRoot.updateWorldMatrix(true, false);
        worldPath.position.z = approach.snapshot().z;
        worldPath.position.x = worldPath.trajectory.xAt(worldPath.position.z);
        pose.position.copy(routeRoot.worldToLocal(worldPath.position.clone()));
        pose.rotation.copy(routeRoot.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldPath.rotation));
        // Side entry/exit must not slip behind the hard world-Z start when
        // calibration yaw makes the face oblique to the world axes.
        pose.rightLocal.copy(worldPath.slideRight).transformDirection(routeRoot.matrixWorld.clone().invert());
      }
      scene.position.copy(pose.position).addScaledVector(pose.rightLocal, state.offset)
        .addScaledVector(pose.forwardLocal, travel.snapshot().offset);
      scene.quaternion.copy(pose.rotation);
      scene.scale.set(pose.fittedWidth / WALL_SECTION.width, 1, 1);
      // The sorter reads the library transform before Viewer.update refreshes
      // it. Publish each animated pose before sorting this frame.
      scene.updateTransform(true);
    }
    scene.visible = state.motion !== 'hidden' && arrival.snapshot().phase !== 'hidden';
  };
  const footprint = (rotation: THREE.Quaternion, width = pose?.fittedWidth ?? WALL_SECTION.width) => {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
    return { right, halfWidth: Math.abs(right.x) * width / 2 + Math.abs(normal.x) * WALL_SECTION.depth / 2,
      halfDepth: Math.abs(right.z) * width / 2 + Math.abs(normal.z) * WALL_SECTION.depth / 2 };
  };
  const entryBlocked = (path: WallWorldPath, distance: number) => {
    const { halfWidth, halfDepth } = footprint(path.rotation);
    const start = path.position.clone().addScaledVector(path.slideRight, -distance);
    entryWaiting = wallEntryBlocked(playerInRoute(), {
      minX: Math.min(start.x, path.position.x) - halfWidth, maxX: Math.max(start.x, path.position.x) + halfWidth,
      minZ: Math.min(start.z, path.position.z) - halfDepth, maxZ: Math.max(start.z, path.position.z) + halfDepth,
    }, WALL_SECTION.playerClearance + (entryWaiting ? WALL_SECTION.resumeExtra : 0));
    return entryWaiting;
  };
  const cancelArrival = () => {
    arrival.reset();
    gaze.reset(); passage.reset(); moving = false; arrivalAttempted = false;
    holePrepareAttempted = holePrepared = holeRevealed = false;
    const material = scanRoot.viewer.splatMesh.material as unknown as THREE.ShaderMaterial;
    if (material?.uniforms?.uWallGlitch) setWallGlitch(material, 0);
    options.onSequenceCancelled?.();
  };
  const plan = () => {
    const nextPose = placement();
    const authored = configuredRaw ? routeRoot.localToWorld(nextPose.position.clone()) : null;
    const target = options.getTargetPosition?.();
    const endZ = target?.every(Number.isFinite) ? frame.routePoint(new THREE.Vector3(...target)).z : WALL_SECTION.targetWorldZ;
    if (endZ < WALL_SECTION.startWorldZ) throw new Error('The first-box station is behind the wall start.');
    const path: WallWorldPath = authored ? {
      position: authored, rotation: nextPose.worldRotation.clone(),
      slideRight: new THREE.Vector3(new THREE.Vector3(1, 0, 0).applyQuaternion(nextPose.worldRotation).x < 0 ? -1 : 1, 0, 0),
      trajectory: { xAt: () => authored.x },
    } : preparePath(nextPose, endZ);
    return { pose: nextPose, path, startZ: path.position.z, endZ: authored ? path.position.z : endZ };
  };
  const arrivalPlacement = (): WallArrivalPlacement => {
    plannedRoute ??= plan();
    return { positionRoute: [plannedRoute.path.trajectory.xAt(plannedRoute.endZ), plannedRoute.path.position.y, plannedRoute.endZ],
      direction: plannedRoute.endZ < plannedRoute.startZ ? -1 : 1,
      halfDepth: footprint(plannedRoute.path.rotation, plannedRoute.pose.fittedWidth).halfDepth };
  };
  const reset = (reason = 'Wall hidden.') => {
    revealGate.reset();
    cancelArrival(); plannedRoute = null; inspectionEndpoint = null;
    slide.reset();
    travel.reset();
    approach.cancel(); worldPath = null; gameplayOwned = false;
    gameplayCue = null; entryWaiting = false;
    pendingEntry = null;
    const scene = wallScene();
    if (scene) scene.visible = false;
    pose = null;
    if (phase === 'ready') status = reason;
    publish();
  };
  const holdApproach = () => {
    revealGate.reset();
    if (worldPath && pose) syncPose();
    approach.cancel(); gameplayOwned = false;
    gameplayCue = null;
    pendingEntry = null;
  };
  const commitApproach = () => {
    if (worldPath && pose) { syncPose(); configuredRaw = pose.position.clone(); }
    holdApproach(); worldPath = null;
  };
  const commitTravel = () => {
    if (pose && travel.snapshot().offset !== 0) {
      pose.position.addScaledVector(pose.forwardLocal, travel.snapshot().offset);
      configuredRaw = pose.position.clone();
    }
    travel.reset();
  };
  const show = (gameplay = false, retry = false, deltaSeconds = 0): boolean => {
    if (disposed) return false;
    if (phase !== 'ready') return fail('Wait for the hallway and wall to finish loading.');
    if (slide.snapshot().motion !== 'hidden') return false;
    const blocked = options.canShow?.();
    if (blocked) { revealGate.reset(); return fail(blocked); }
    error = null;
    try {
      cancelArrival();
      if (!retry) revealGate.reset();
      if (!gameplay && !retry) { gameplayOwned = false; gameplayCue = null; pendingEntry = null; }
      // Hide never turns an automatic route position into an authored override.
      // Buttons and scheduled cues use exactly the same reveal planner.
      worldPath = null;
      // Waiting for the player must not refit millions of hallway splats on
      // every frame. This candidate is discarded on all recovery/override paths.
      const cached = pendingEntry;
      const inspected = inspectionEndpoint && plannedRoute ? plannedRoute : null;
      const prepared = cached ? null : inspected ?? plan();
      pose = cached?.pose ?? prepared!.pose;
      {
        const path = cached ? cached.path : prepared!.path;
        const startZ = cached?.startZ ?? prepared!.startZ;
        const endZ = cached?.endZ ?? prepared!.endZ;
        path.position.z = startZ; path.position.x = path.trajectory.xAt(startZ);
        plannedRoute = { pose, path, startZ, endZ }; inspectionEndpoint = null;
        const player = playerInRoute(), worldForward = options.getPlayerForward?.();
        const forward = worldForward ? frame.routeVector(new THREE.Vector3(...worldForward)).toArray() : null;
        const looking = lookingAtWall(player, forward, [path.position.x, path.position.y + WALL_SECTION.height / 2, startZ], 50);
        if (!revealGate.update(deltaSeconds, looking)) {
          status = `Wall armed. Look away, or keep watching for ${revealGate.remainingSeconds().toFixed(1)} s.`;
          gameplayCue = 'waitingLookAway'; pendingEntry = { pose, path, startZ, endZ };
          publish(); return false;
        }
        if (entryBlocked(path, 0)) {
          status = 'Wall waiting for the player to clear its entry path.';
          gameplayCue = 'waitingPlayer'; pendingEntry = { pose, path, startZ, endZ };
          publish(); return false;
        }
        worldPath = path;
        pendingEntry = null;
        approach.start(startZ, endZ, WALL_SECTION.approachSpeed);
        gaze.start(startZ, endZ);
      }
      slide.show(pose.fittedWidth + WALL_SECTION.slideMargin);
      slide.update(WALL_SECTION.slideSeconds);
      gameplayCue = null;
      syncPose();
      status = revealGate.remainingSeconds() <= 1e-9 ? 'Wall appeared after five seconds of watching.' : 'Wall appeared out of sight.';
      revealGate.reset();
      options.onAppeared?.();
      publish();
      return true;
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return fail(`Wall unavailable: ${message}`);
    }
  };
  const hide = (): boolean => {
    if (disposed || slide.snapshot().motion !== 'visible') return false;
    slide.reset();
    cancelArrival(); inspectionEndpoint = null;
    holdApproach();
    commitTravel();
    syncPose();
    status = 'Wall hidden.';
    publish();
    return true;
  };
  return {
    show, hide, reset, snapshot, arrivalPlacement,
    runSequence(): boolean {
      if (disposed || phase !== 'ready') return false;
      const blocked = options.canShow?.();
      if (blocked) return fail(blocked);
      const inspected = plannedRoute;
      reset(); plannedRoute = inspected; inspectionEndpoint = inspected ? 'start' : null;
      return show() || gameplayCue === 'waitingLookAway' || gameplayCue === 'waitingPlayer';
    },
    inspectEndpoint(endpoint: 'start' | 'end'): boolean {
      if (disposed || phase !== 'ready') return false;
      const blocked = options.canShow?.();
      if (blocked) return fail(blocked);
      if (endpoint !== 'start' && endpoint !== 'end') return fail('Choose the wall start or end position.');
      try {
        const candidate = plannedRoute ?? plan();
        const z = endpoint === 'start' ? candidate.startZ : candidate.endZ;
        const point = new THREE.Vector3(candidate.path.trajectory.xAt(z), candidate.path.position.y, z);
        const bounds = footprint(candidate.path.rotation, candidate.pose.fittedWidth);
        if (wallEntryBlocked(playerInRoute(), { minX: point.x - bounds.halfWidth, maxX: point.x + bounds.halfWidth,
          minZ: z - bounds.halfDepth, maxZ: z + bounds.halfDepth }, WALL_SECTION.playerClearance)) {
          return fail('Move clear of the wall inspection position first.');
        }
        cancelArrival(); travel.reset(); gameplayOwned = false; gameplayCue = null; pendingEntry = null;
        plannedRoute = candidate; pose = candidate.pose; worldPath = candidate.path;
        worldPath.position.copy(point); approach.start(z, z, WALL_SECTION.approachSpeed);
        slide.reset(); slide.show(pose.fittedWidth + WALL_SECTION.slideMargin); slide.update(WALL_SECTION.slideSeconds);
        inspectionEndpoint = endpoint; error = null; syncPose();
        status = `Inspecting wall ${endpoint}: hallway Z = ${z.toFixed(2)} m. Motion paused.`; publish(); return true;
      } catch (cause) { return fail(cause instanceof Error ? cause.message : String(cause)); }
    },
    /** Set only at calibration/desktop preview boundaries, before arming. */
    setRouteFrame(matrix?: THREE.Matrix4): void {
      reset();
      frame.set(matrix);
      sections.clear();
      publish();
    },
    startGameplay(options: { resetPlacement?: boolean } = {}): boolean {
      reset();
      // A prior game's manual Stop must not turn the next full game into a
      // stationary custom wall instead of its authored approach.
      if (options.resetPlacement) configuredRaw = null;
      if (disposed || phase !== 'ready') return false;
      gameplayOwned = true; gameplayCue = 'waitingSecondBox';
      status = 'Wall waits for entry into the hallway section around the second box.'; publish(); return true;
    },
    turnCompleted(): void { /* The second-box hallway section supplies the reveal trigger. */ },
    triggerSecondBox(): boolean {
      if (!gameplayOwned || gameplayCue !== 'waitingSecondBox') return false;
      revealGate.reset();
      gameplayCue = 'waitingLookAway';
      status = 'Hallway section entered. Look away, or watch for five seconds for the wall to appear.'; publish(); return true;
    },
    cancelGameplay(): void { if (gameplayOwned) reset(); },
    /** Explicit authored bottom-centre, expressed in the current world frame. */
    setPosition(world: readonly [number, number, number]): boolean {
      if (disposed || phase !== 'ready') return fail('Wait for the wall to finish loading.');
      if (slide.snapshot().animating) return fail('Wait for the wall transition before positioning it.');
      const blocked = options.canShow?.();
      if (blocked) return fail(blocked);
      try {
        if (world.length !== 3 || !world.every(Number.isFinite)) throw new Error('Wall coordinates must be finite X, Y and Z metres.');
        const next = placement(false, frame.routePoint(new THREE.Vector3(...world)).z);
        cancelArrival(); plannedRoute = null; inspectionEndpoint = null;
        next.position.copy(scanRoot.worldToLocal(new THREE.Vector3(...world)));
        approach.cancel(); worldPath = null; gameplayOwned = false;
        gameplayCue = null;
        pendingEntry = null;
        configuredRaw = next.position.clone(); pose = next; travel.reset();
        error = null; syncPose(); status = 'Wall position applied.'; publish();
        return true;
      } catch (cause) { return fail(cause instanceof Error ? cause.message : String(cause)); }
    },
    useFittedPosition(): boolean {
      if (disposed || phase !== 'ready' || slide.snapshot().animating) return false;
      const blocked = options.canShow?.();
      if (blocked) return fail(blocked);
      try {
        const next = placement(true);
        cancelArrival(); plannedRoute = null; inspectionEndpoint = null;
        approach.cancel(); worldPath = null; gameplayOwned = false;
        gameplayCue = null;
        pendingEntry = null;
        configuredRaw = null; pose = next; travel.reset(); error = null;
        syncPose(); status = 'Wall restored to its fitted hallway position.'; publish();
        return true;
      } catch (cause) { return fail(cause instanceof Error ? cause.message : String(cause)); }
    },
    startTravel(mode: Exclude<WallTravelMode, 'stopped'>, distance: number, speed: number): boolean {
      if (disposed || phase !== 'ready' || slide.snapshot().motion !== 'visible') return fail('Reveal the wall before moving it.');
      const blocked = options.canShow?.();
      if (blocked) return fail(blocked);
      try {
        validateWallTravel(distance, speed);
        if (!['forward', 'backward', 'loop'].includes(mode)) throw new Error('Unknown wall motion.');
        cancelArrival(); plannedRoute = null; inspectionEndpoint = null;
        commitApproach(); commitTravel(); travel.start(mode, distance, speed); error = null;
        status = mode === 'loop' ? 'Wall moving back and forth.' : `Wall moving ${mode}.`;
        publish(); return true;
      } catch (cause) { return fail(cause instanceof Error ? cause.message : String(cause)); }
    },
    stopTravel(): void {
      cancelArrival(); inspectionEndpoint = null;
      if (worldPath && pose) { syncPose(); configuredRaw = pose.position.clone(); }
      holdApproach(); commitTravel(); syncPose();
      plannedRoute = null;
      status = 'Wall motion stopped at its current position.'; publish();
    },
    /** Attach the hidden scene built together with the hallway at startup. */
    initialize() {
      if (disposed || phase === 'ready') return;
      if (scanRoot.getSceneCount() <= WALL_SECTION.sceneIndex) throw new Error('The preloaded wall scene is missing.');
      sceneIndex = WALL_SECTION.sceneIndex;
      wallScene()!.name = 'hallway-wall-blocker';
      wallScene()!.visible = false;
      restoreScanOpacity(scanRoot);
      clipWallRectangle(scanRoot.viewer.splatMesh.material as unknown as THREE.ShaderMaterial, sceneIndex);
      prepareWallGlitchShader(scanRoot.viewer.splatMesh.material as unknown as THREE.ShaderMaterial);
      phase = 'ready';
      error = null;
      status = 'Wall ready. Show wall arms its out-of-sight appearance.';
      // Make its standing coordinate available before the first reveal.
      try { pose = placement(); } catch { pose = null; }
      publish();
    },
    loadingFailed(cause: unknown) {
      reset();
      phase = 'error';
      fail(`Wall unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    },
    update(deltaSeconds = 0) {
      const beforePosition = snapshot().positionWorld;
      restoreScanOpacity(scanRoot);
      if (phase === 'ready' && sceneIndex !== null) {
        clipWallRectangle(scanRoot.viewer.splatMesh.material as unknown as THREE.ShaderMaterial, sceneIndex);
      }
      const previous = slide.snapshot().motion;
      const wasTravelling = travel.snapshot().moving;
      const wasApproaching = approach.snapshot().active;
      const wasWaitingFor = approach.snapshot().waitingFor;
      const previousArrival = arrival.snapshot().phase;
      const previousGaze = gaze.snapshot().stage;
      if (gameplayCue === 'waitingPlayer' || gameplayCue === 'waitingLookAway') {
        const ready = !gameplayOwned || options.getRevealReady?.() !== false;
        if (Number.isFinite(deltaSeconds) && deltaSeconds > 0 && deltaSeconds <= .5 && ready) {
          const owner = gameplayOwned;
          if (show(owner, true, deltaSeconds)) { gameplayCue = null; gameplayOwned = owner; }
        } else if (deltaSeconds !== 0 || !ready) revealGate.reset();
      }
      let crossing: ReturnType<WallPassage['update']> = null;
      if (previous === 'visible' && slide.snapshot().motion === 'visible' && worldPath && previousArrival === 'idle' &&
          !arrivalAttempted && approach.snapshot().state !== 'idle') {
        if (inspectionEndpoint === null && !holePrepareAttempted) {
          holePrepareAttempted = true;
          holePrepared = options.onPrepareHole?.(arrivalPlacement()) !== false;
        }
        const route = approach.snapshot();
        const player = playerInRoute();
        const worldForward = options.getPlayerForward?.();
        const forward = worldForward ? frame.routeVector(new THREE.Vector3(...worldForward)).toArray() : null;
        const target: [number, number, number] = [worldPath.trajectory.xAt(route.z), worldPath.position.y + WALL_SECTION.height / 2, route.z];
        const looking = lookingAtWall(player, forward, target, gaze.snapshot().looking === true ? 50 : 45);
        const validForward = forward?.every(Number.isFinite) && Math.hypot(...forward) > 1e-9;
        if (inspectionEndpoint === null && validForward) crossing = passage.update(player, deltaSeconds, {
          position: [worldPath.trajectory.xAt(route.z), worldPath.position.y, route.z],
          normal: new THREE.Vector3(0, 0, 1).applyQuaternion(worldPath.rotation).toArray(),
          right: new THREE.Vector3(1, 0, 0).applyQuaternion(worldPath.rotation).toArray(),
          width: pose!.fittedWidth, height: WALL_SECTION.height, halfDepth: WALL_SECTION.depth / 2,
        });
        else passage.reset();
        const gate = inspectionEndpoint === null ? gaze.update(deltaSeconds, {
          looking, z: route.z, arrived: route.state === 'complete',
        }) : gaze.snapshot();
        const allowedSeconds = crossing ? 0 : Math.min(gate.allowedSeconds, gate.maxTravel / route.speed);
        const bounds = footprint(worldPath.rotation);
        let sweptCenterX = worldPath.position.x, sweptHalfWidth = bounds.halfWidth, sweptHalfDepth = bounds.halfDepth;
        if (allowedSeconds > 0 && approach.snapshot().active) {
          const direction = Math.sign(route.targetZ - route.startZ);
          const nextZ = direction * Math.min(direction * route.targetZ, direction * route.z + route.speed * allowedSeconds);
          const nextX = worldPath.trajectory.xAt(nextZ);
          sweptCenterX = (worldPath.position.x + nextX) / 2;
          sweptHalfWidth = bounds.halfWidth + Math.abs(nextX - worldPath.position.x) / 2;
        }
        if (allowedSeconds > 0) approach.update(allowedSeconds, { player, centerX: sweptCenterX,
          halfWidth: sweptHalfWidth, halfDepth: sweptHalfDepth,
          clearance: WALL_SECTION.playerClearance, resumeExtra: WALL_SECTION.resumeExtra });
        if (approach.snapshot().waitingFor) status = approach.snapshot().waitingFor === 'player'
          ? 'Wall paused: waiting for the player to move away.' : 'Wall paused: waiting for current player tracking.';
        else if (gate.looking === null && inspectionEndpoint === null) status = 'Wall paused: waiting for current viewing direction.';
        else if (gate.stage === 'stealth' && allowedSeconds === 0 && route.active) status = 'Wall paused while the player is looking.';
        else if (gate.stage === 'arrival' && gate.looking && !arrivalAttempted) status = `Look at the final wall for 5 seconds (${gate.lookSeconds.toFixed(1)} s), or walk through it.`;
        else if (wasWaitingFor || previousGaze !== gate.stage) status = `Wall moving toward hallway Z = ${route.targetZ.toFixed(2)}.`;
      }
      if (slide.snapshot().motion === 'visible') travel.update(deltaSeconds);
      if (wasTravelling && !travel.snapshot().moving) {
        commitTravel(); status = 'Wall reached its target position.';
      }
      syncPose();
      const current = slide.snapshot().motion;
      if (current === 'visible' && worldPath && pose && inspectionEndpoint === null && holePrepared && !holeRevealed &&
          !arrivalAttempted && approach.snapshot().state !== 'idle' &&
          Number.isFinite(deltaSeconds) && deltaSeconds > 0 && deltaSeconds <= .5) {
        const prepared = options.getPreparedHole?.();
        const forward = options.getPlayerForward?.();
        const validForward = forward?.every(Number.isFinite) && Math.hypot(...forward) > 1e-9;
        if (prepared && validForward && wallConcealsHole(playerInRoute(), {
          position: [worldPath.position.x, worldPath.position.y, worldPath.position.z],
          normal: new THREE.Vector3(0, 0, 1).applyQuaternion(worldPath.rotation).toArray(),
          right: new THREE.Vector3(1, 0, 0).applyQuaternion(worldPath.rotation).toArray(),
          width: pose.fittedWidth, height: WALL_SECTION.height, halfDepth: WALL_SECTION.depth / 2,
        }, prepared.cornersRoute)) holeRevealed = options.onRevealHole?.() !== false;
      }
      if (current === 'visible' && worldPath && inspectionEndpoint === null && approach.snapshot().state !== 'idle') {
        gaze.observePosition(approach.snapshot().z, approach.snapshot().state === 'complete');
      }
      if (current === 'visible' && (crossing || gaze.snapshot().arrivalReady) && !arrivalAttempted && worldPath && inspectionEndpoint === null) {
        arrivalAttempted = true;
        approach.cancel(); travel.reset();
        const placement: WallArrivalPlacement = {
          positionRoute: [worldPath.position.x, worldPath.position.y, worldPath.position.z],
          direction: plannedRoute && plannedRoute.endZ < plannedRoute.startZ ? -1 : 1,
          halfDepth: footprint(worldPath.rotation).halfDepth,
          ...(crossing ? { crossing } : {}),
        };
        // Freeze the current wall and hole before the first disappearance frame.
        if (options.onArrived?.(placement) !== false) {
          arrival.arm(); status = 'Wall encounter complete. Hole ready beyond it.';
        } else status = 'Wall stopped. Floor opening unavailable; wall retained.';
      } else if (previousArrival !== 'idle') arrival.update(deltaSeconds);
      if (worldPath && phase === 'ready') {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(worldPath.rotation)
          .transformDirection(new THREE.Matrix4().fromArray(frame.matrix()));
        setWallGlitch(scanRoot.viewer.splatMesh.material as unknown as THREE.ShaderMaterial, arrival.snapshot().progress, right);
      }
      if (arrival.snapshot().phase === 'hidden') {
        slide.reset(); syncPose();
        status = 'Wall glitched away. Floor opening revealed.';
      } else if (arrival.snapshot().phase === 'glitching') status = 'Wall glitching away…';
      const afterPosition = snapshot().positionWorld;
      moving = Number.isFinite(deltaSeconds) && deltaSeconds > 0 && beforePosition !== null && afterPosition !== null &&
        beforePosition.some((value, axis) => Math.abs(value - afterPosition[axis]) > 1e-7);
      if (current !== previous) {
        status = current === 'visible'
          ? `Wall shown: ${((pose?.fittedWidth ?? WALL_SECTION.width) * 100).toFixed(0)} cm wide × ${(WALL_SECTION.height * 100).toFixed(0)} cm high.`
          : current === 'entering' ? 'Wall appeared out of sight.'
          : current === 'exiting' ? 'Wall hidden.'
          : 'Wall hidden. Show wall arms its out-of-sight appearance.';
        publish();
      } else if ((wasTravelling && !travel.snapshot().moving) || (wasApproaching && !approach.snapshot().active) || wasWaitingFor !== approach.snapshot().waitingFor || previousArrival !== arrival.snapshot().phase || previousGaze !== gaze.snapshot().stage) {
        publish();
      }
    },
    toggle(): boolean {
      if (gameplayCue === 'waitingPlayer' || gameplayCue === 'waitingLookAway') { reset('Wall reveal cancelled.'); return true; }
      return slide.snapshot().motion === 'visible' ? hide() : show();
    },
    subscribe(listener: (state: WallBlockerSnapshot) => void) {
      listeners.add(listener); listener(snapshot());
      return () => { listeners.delete(listener); };
    },
    dispose() { reset(); disposed = true; listeners.clear(); },
  };
}
