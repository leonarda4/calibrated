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
  gameplayCue: 'waitingTurn' | 'delay' | 'waitingPlayer' | null;
  revealInSeconds: number | null;
  alignmentQueries: number;
  trajectoryLocked: boolean;
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
  placementFrame?: HallwayPlacementFrame;
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
  const sections = createHallwaySections({ scanRoot: routeRoot, getCenters: () => getSourceCenters(scanRoot) });
  let phase: WallBlockerSnapshot['phase'] = 'loading';
  let status = 'Loading the hallway and wall…';
  let error: string | null = null;
  let sceneIndex: number | null = null;
  let disposed = false;
  let pose: ReturnType<typeof placement> | null = null;
  let configuredRaw: THREE.Vector3 | null = null;
  let worldPath: WallWorldPath | null = null;
  let pendingEntry: { pose: ReturnType<typeof placement>; path: WallWorldPath } | null = null;
  let gameplayOwned = false;
  let gameplayCue: WallBlockerSnapshot['gameplayCue'] = null;
  let revealInSeconds = 0;
  let firstDelayFrame = false;
  let entryWaiting = false;
  let alignmentQueries = 0;
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
      gameplayCue, revealInSeconds: gameplayCue === 'delay' ? revealInSeconds : null,
      alignmentQueries, trajectoryLocked: worldPath !== null,
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
  const preparePath = (nextPose: NonNullable<typeof pose>): WallWorldPath => {
    const fits = [0, .25, .5, .75, 1].map(t => {
      const z = WALL_SECTION.startWorldZ + (WALL_SECTION.targetWorldZ - WALL_SECTION.startWorldZ) * t;
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
    scene.visible = state.motion !== 'hidden';
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
  const reset = (reason = 'Wall hidden.') => {
    slide.reset();
    travel.reset();
    approach.cancel(); worldPath = null; gameplayOwned = false;
    gameplayCue = null; revealInSeconds = 0; firstDelayFrame = false; entryWaiting = false;
    pendingEntry = null;
    const scene = wallScene();
    if (scene) scene.visible = false;
    pose = null;
    if (phase === 'ready') status = reason;
    publish();
  };
  const holdApproach = () => {
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
  const show = (gameplay = false): boolean => {
    if (disposed) return false;
    if (phase !== 'ready') return fail('Wait for the hallway and wall to finish loading.');
    if (slide.snapshot().motion !== 'hidden') return false;
    const blocked = options.canShow?.();
    if (blocked) return fail(blocked);
    error = null;
    try {
      if (!gameplay) { gameplayOwned = false; gameplayCue = null; pendingEntry = null; }
      // Hide never turns an automatic route position into an authored override.
      // Buttons and scheduled cues use exactly the same reveal planner.
      worldPath = null;
      // Waiting for the player must not refit millions of hallway splats on
      // every frame. This candidate is discarded on all recovery/override paths.
      const cached = gameplay ? pendingEntry : null;
      pose = cached?.pose ?? placement();
      {
        const authored = configuredRaw ? routeRoot.localToWorld(pose.position.clone()) : null;
        const path: WallWorldPath = cached ? cached.path : authored ? {
          position: authored, rotation: pose.worldRotation.clone(),
          slideRight: new THREE.Vector3(new THREE.Vector3(1, 0, 0).applyQuaternion(pose.worldRotation).x < 0 ? -1 : 1, 0, 0),
          trajectory: { xAt: () => authored.x },
        } : preparePath(pose);
        if (entryBlocked(path, pose.fittedWidth + WALL_SECTION.slideMargin)) {
          status = 'Wall waiting for the player to clear its entry path.';
          if (gameplay) { gameplayCue = 'waitingPlayer'; pendingEntry = { pose, path }; }
          publish(); return false;
        }
        worldPath = path;
        pendingEntry = null;
        approach.start(path.position.z, authored ? path.position.z : WALL_SECTION.targetWorldZ, WALL_SECTION.approachSpeed);
      }
      slide.show(pose.fittedWidth + WALL_SECTION.slideMargin);
      syncPose();
      status = 'Wall sliding in from the left…';
      publish();
      return true;
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return fail(`Wall unavailable: ${message}`);
    }
  };
  const hide = (): boolean => {
    if (disposed || !slide.hide()) return false;
    holdApproach();
    commitTravel();
    status = 'Wall sliding out to the right…';
    publish();
    return true;
  };
  return {
    show, hide, reset, snapshot,
    /** Set only at calibration/desktop preview boundaries, before arming. */
    setRouteFrame(matrix?: THREE.Matrix4): void {
      reset();
      frame.set(matrix);
      sections.clear();
      publish();
    },
    startGameplay(): boolean {
      reset();
      if (disposed || phase !== 'ready') return false;
      gameplayOwned = true; gameplayCue = 'waitingTurn';
      status = 'Wall waits until two seconds after the hallway turn finishes.'; publish(); return true;
    },
    turnCompleted(): void {
      if (!gameplayOwned || gameplayCue !== 'waitingTurn') return;
      gameplayCue = 'delay'; revealInSeconds = WALL_SECTION.afterTurnSeconds; firstDelayFrame = true; publish();
    },
    cancelGameplay(): void { if (gameplayOwned) reset(); },
    /** Explicit authored bottom-centre, expressed in the current world frame. */
    setPosition(world: readonly [number, number, number]): boolean {
      if (disposed || phase !== 'ready') return fail('Wait for the wall to finish loading.');
      if (slide.snapshot().animating) return fail('Wait for the side slide to finish before positioning the wall.');
      const blocked = options.canShow?.();
      if (blocked) return fail(blocked);
      try {
        if (world.length !== 3 || !world.every(Number.isFinite)) throw new Error('Wall coordinates must be finite X, Y and Z metres.');
        const next = placement(false, frame.routePoint(new THREE.Vector3(...world)).z);
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
        approach.cancel(); worldPath = null; gameplayOwned = false;
        gameplayCue = null;
        pendingEntry = null;
        configuredRaw = null; pose = next; travel.reset(); error = null;
        syncPose(); status = 'Wall restored to its fitted hallway position.'; publish();
        return true;
      } catch (cause) { return fail(cause instanceof Error ? cause.message : String(cause)); }
    },
    startTravel(mode: Exclude<WallTravelMode, 'stopped'>, distance: number, speed: number): boolean {
      if (disposed || phase !== 'ready' || slide.snapshot().motion !== 'visible') return fail('Show the wall and wait for its side slide before moving it.');
      const blocked = options.canShow?.();
      if (blocked) return fail(blocked);
      try {
        validateWallTravel(distance, speed);
        if (!['forward', 'backward', 'loop'].includes(mode)) throw new Error('Unknown wall motion.');
        commitApproach(); commitTravel(); travel.start(mode, distance, speed); error = null;
        status = mode === 'loop' ? 'Wall moving back and forth.' : `Wall moving ${mode}.`;
        publish(); return true;
      } catch (cause) { return fail(cause instanceof Error ? cause.message : String(cause)); }
    },
    stopTravel(): void {
      if (worldPath && pose) { syncPose(); configuredRaw = pose.position.clone(); }
      holdApproach(); commitTravel(); syncPose();
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
      phase = 'ready';
      error = null;
      status = 'Wall ready. Show wall slides it in from the left.';
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
      restoreScanOpacity(scanRoot);
      if (phase === 'ready' && sceneIndex !== null) {
        clipWallRectangle(scanRoot.viewer.splatMesh.material as unknown as THREE.ShaderMaterial, sceneIndex);
      }
      const previous = slide.snapshot().motion;
      const wasTravelling = travel.snapshot().moving;
      const wasApproaching = approach.snapshot().active;
      const wasWaitingFor = approach.snapshot().waitingFor;
      if (gameplayOwned && (gameplayCue === 'delay' || gameplayCue === 'waitingPlayer')) {
        if (firstDelayFrame) firstDelayFrame = false;
        else if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
          revealInSeconds = Math.max(0, revealInSeconds - deltaSeconds);
          if (revealInSeconds <= 1e-9) {
            if (show(true)) { gameplayCue = null; gameplayOwned = true; }
            else if (gameplayCue !== 'waitingPlayer') { gameplayCue = null; gameplayOwned = false; pendingEntry = null; }
          }
        }
      }
      const wasEntryWaiting = entryWaiting;
      const enteringBlocked = previous === 'entering' && worldPath && pose && entryBlocked(worldPath,
        pose.fittedWidth + WALL_SECTION.slideMargin);
      if (enteringBlocked) status = 'Wall entry paused: waiting for the player to move away.';
      else if (previous === 'entering' && wasEntryWaiting) status = 'Wall sliding in from the left…';
      // A newly revealed wall begins its side slide next frame, at the route start.
      if (!enteringBlocked && previous !== 'hidden') slide.update(deltaSeconds);
      if (previous === 'visible' && slide.snapshot().motion === 'visible' && worldPath) {
        const bounds = footprint(worldPath.rotation);
        let sweptCenterX = worldPath.position.x, sweptHalfWidth = bounds.halfWidth, sweptHalfDepth = bounds.halfDepth;
        if (Number.isFinite(deltaSeconds) && deltaSeconds > 0 && approach.snapshot().active) {
          const route = approach.snapshot(), direction = Math.sign(route.targetZ - route.startZ);
          const nextZ = direction * Math.min(direction * route.targetZ, direction * route.z + route.speed * deltaSeconds);
          const nextX = worldPath.trajectory.xAt(nextZ);
          sweptCenterX = (worldPath.position.x + nextX) / 2;
          sweptHalfWidth = bounds.halfWidth + Math.abs(nextX - worldPath.position.x) / 2;
        }
        approach.update(deltaSeconds, { player: playerInRoute(), centerX: sweptCenterX,
          halfWidth: sweptHalfWidth, halfDepth: sweptHalfDepth,
          clearance: WALL_SECTION.playerClearance, resumeExtra: WALL_SECTION.resumeExtra });
        if (approach.snapshot().waitingFor) status = approach.snapshot().waitingFor === 'player'
          ? 'Wall paused: waiting for the player to move away.' : 'Wall paused: waiting for current player tracking.';
        else if (wasWaitingFor) status = `Wall continuing toward hallway Z = ${WALL_SECTION.targetWorldZ}.`;
      }
      if (slide.snapshot().motion === 'visible') travel.update(deltaSeconds);
      if (wasTravelling && !travel.snapshot().moving) {
        commitTravel(); status = 'Wall reached its target position.';
      }
      syncPose();
      const current = slide.snapshot().motion;
      if (wasApproaching && !approach.snapshot().active && worldPath) status = `Wall reached hallway Z = ${WALL_SECTION.targetWorldZ}.`;
      if (current !== previous) {
        status = current === 'visible'
          ? `Wall shown: ${((pose?.fittedWidth ?? WALL_SECTION.width) * 100).toFixed(0)} cm wide × ${(WALL_SECTION.height * 100).toFixed(0)} cm high.`
          : current === 'entering' ? 'Wall sliding in from the left…'
          : current === 'exiting' ? 'Wall sliding out to the right…'
          : 'Wall hidden. Show wall slides it in from the left.';
        publish();
      } else if ((wasTravelling && !travel.snapshot().moving) || (wasApproaching && !approach.snapshot().active) || wasWaitingFor !== approach.snapshot().waitingFor) {
        publish();
      }
    },
    toggle(): boolean {
      return slide.snapshot().motion === 'visible' ? hide() : show();
    },
    subscribe(listener: (state: WallBlockerSnapshot) => void) {
      listeners.add(listener); listener(snapshot());
      return () => { listeners.delete(listener); };
    },
    dispose() { reset(); disposed = true; listeners.clear(); },
  };
}
