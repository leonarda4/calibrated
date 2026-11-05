import { Group, Matrix4, Quaternion, Vector3, type Scene, type ShaderMaterial } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { BROOM_WORLD_Z, createBroomPlacement } from './broomPlacement.ts';
import { BROOM } from './broomConfig.ts';
import { createHallwaySections } from '../experience/hallwaySection.ts';
import { createHallwayPlacementFrame, type HallwayPlacementFrame } from './wallRouteFrame.ts';
import { prepareBroomGlitch } from './broomGlitch.ts';

export type Broom = ReturnType<typeof createBroom>;

/** Upright splat object centred in the current hallway at the authored world Z. */
export function createBroom(options: {
  scene: Scene;
  scanRoot: DropInViewer;
  getPivot(): { centerX: number; floorY: number };
  getSourceCenters(): Float32Array | undefined;
  getRotationState?(): { phase: string; offsetWorld: readonly [number, number, number] };
  blockReason(): string | null;
  placementFrame?: HallwayPlacementFrame;
  /** Successful hidden-to-visible presentation, shared by manual/gameplay reveals. */
  onReveal?(): void;
}) {
  const { scanRoot } = options;
  const frame = options.placementFrame ?? createHallwayPlacementFrame(scanRoot);
  const offsetInRoute = () => frame.routeVector(new Vector3(...(options.getRotationState?.().offsetWorld ?? [0, 0, 0]))).toArray();
  const anchor = new Group();
  anchor.name = 'broom-world-anchor';
  options.scene.add(anchor);
  let phase: 'loading' | 'ready' | 'error' = 'loading';
  let error: string | null = null;
  let placementError: string | null = null;
  let fittedCenterX = 0;
  let fittedYaw = 0;
  let sections: ReturnType<typeof createHallwaySections> | null = null;
  let sectionFloor = NaN;
  let previousOffset: readonly [number, number, number] = [0, 0, 0];
  let encounter: { matrix: Matrix4; visible: boolean; glitch: number; status: string } | null = null;
  const material = () => scanRoot.viewer?.splatMesh?.material as ShaderMaterial | undefined;
  const fitCurrentSection = (): string | null => {
    const floorY = options.getPivot().floorY;
    if (!Number.isFinite(floorY)) return 'Broom placement needs a finite floor.';
    if (!sections || sectionFloor !== floorY) {
      sectionFloor = floorY;
      sections = createHallwaySections({ scanRoot: frame.root, floorY,
        getCenters: options.getSourceCenters });
    }
    const fit = sections.at(BROOM_WORLD_Z);
    if (!fit.ok) return `Broom placement: ${fit.reason}`;
    fittedCenterX = fit.centerWorld[0];
    fittedYaw = Math.atan2(fit.directionWorld[0], fit.directionWorld[2]);
    previousOffset = offsetInRoute();
    placementError = null;
    return null;
  };
  const sourceToObject = new Matrix4().makeRotationFromQuaternion(new Quaternion(...BROOM.sourceRotation))
    .multiply(new Matrix4().makeTranslation(-BROOM.sourceBase[0], -BROOM.sourceBase[1], -BROOM.sourceBase[2]));
  const local = new Matrix4();
  const scale = new Vector3();
  const splatScene = () => scanRoot.getSceneCount() > BROOM.sceneIndex ? scanRoot.getSplatScene(BROOM.sceneIndex) : null;
  const placement = createBroomPlacement({ object: anchor,
    toWorld: frame.worldPoint,
    getPivot: () => ({ centerX: fittedCenterX, floorY: options.getPivot().floorY }),
    blockReason() {
      if (phase !== 'ready') return error ?? 'Wait for the broom to finish loading.';
      const reason = options.blockReason();
      if (reason) return reason;
      scanRoot.updateWorldMatrix(true, false);
      if (scanRoot.getWorldScale(scale).toArray().some(value => Math.abs(value - 1) > 1e-6)) {
        return 'Broom placement requires the metric scan scale.';
      }
      return fitCurrentSection();
    },
  });
  const update = () => {
    const object = splatScene();
    if (!object) return;
    const wasVisible = object.visible;
    if (encounter) {
      encounter.matrix.decompose(anchor.position, anchor.quaternion, anchor.scale);
      anchor.visible = encounter.visible;
    }
    object.visible = anchor.visible;
    if (!anchor.visible) return;
    const rotation = options.getRotationState?.();
    if (rotation?.phase === 'stopped') { placement.reset(); object.visible = false; return; }
    // A captured cutout pose never refits the original hallway's Z6 section.
    if (!encounter && rotation?.phase === 'rotating') {
      // The changing scan can be transverse to world Z mid-turn. Keep the
      // authored station and follow the eased lateral correction cheaply.
      const offset = offsetInRoute();
      const dx = offset[0] - previousOffset[0], dz = offset[2] - previousOffset[2];
      const point = frame.routePoint(anchor.position.clone());
      point.x += dx - Math.tan(fittedYaw) * dz;
      anchor.position.copy(frame.worldPoint(point));
      previousOffset = offset;
    } else if (!encounter) {
      const reason = fitCurrentSection();
      if (reason) { placementError = reason; placement.reset(); object.visible = false; return; }
      anchor.position.copy(frame.worldPoint(new Vector3(fittedCenterX, sectionFloor, BROOM_WORLD_Z)));
      anchor.quaternion.setFromRotationMatrix(new Matrix4().fromArray(frame.matrix()))
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), fittedYaw));
    }
    // Object pose is in current world metres; cancel the root only when
    // translating it into the shared renderer's scene-local transform.
    scanRoot.updateWorldMatrix(true, false);
    anchor.updateWorldMatrix(true, false);
    local.copy(scanRoot.matrixWorld).invert().multiply(anchor.matrixWorld).multiply(sourceToObject);
    local.decompose(object.position, object.quaternion, object.scale);
    object.updateTransform(true);
    if (!wasVisible && object.visible) options.onReveal?.();
  };
  const reset = () => {
    encounter = null; placementError = null; placement.reset();
    const glitch = material()?.uniforms?.uBroomGlitch;
    if (glitch) glitch.value = 0;
    update();
  };
  const show = () => {
    const shown = placement.show();
    if (shown) { encounter = null; material()!.uniforms.uBroomGlitch.value = 0; }
    update(); return shown;
  };
  return {
    show, reset, update,
    presentEncounter(state: { canonicalMatrix: readonly number[] | null; visible: boolean; glitch: number; status: string }): boolean {
      const shared = material();
      if (phase !== 'ready' || !shared?.uniforms?.uBroomGlitch || !state.canonicalMatrix || state.canonicalMatrix.length !== 16 ||
        ![...state.canonicalMatrix, state.glitch].every(Number.isFinite) || state.glitch < 0 || state.glitch > 1) return false;
      scanRoot.updateWorldMatrix(true, false);
      if (scanRoot.getWorldScale(scale).toArray().some(value => Math.abs(value - 1) > 1e-6)) return false;
      placementError = null;
      encounter = { matrix: new Matrix4().fromArray(state.canonicalMatrix), visible: state.visible, glitch: state.glitch,
        status: state.status };
      shared.uniforms.uBroomGlitch.value = state.glitch;
      update(); return true;
    },
    toggle() { if (anchor.visible) { reset(); return true; } return show(); },
    snapshot() {
      const state = placement.snapshot();
      const status = state.baseWorld ? `Broom centred at [${state.baseWorld.map(v => v.toFixed(3)).join(', ')}] m.` : state.status;
      return { ...state, phase, status: error ?? placementError ?? encounter?.status ?? status, height: BROOM.height,
        mode: encounter ? 'cutout' : 'manual', glitch: encounter?.glitch ?? 0,
        baseRoute: state.baseWorld ? frame.routePoint(new Vector3(...state.baseWorld)).toArray() : null,
        routeToWorld: frame.matrix() };
    },
    initialize() {
      const object = splatScene();
      if (!object) throw new Error('The preloaded broom scene is missing.');
      object.name = 'hallway-broom'; object.visible = false;
      const shared = material();
      if (!shared) throw new Error('The preloaded broom material is missing.');
      prepareBroomGlitch(shared);
      phase = 'ready'; error = null;
    },
    loadingFailed(cause: unknown) {
      reset(); phase = 'error';
      error = `Broom unavailable: ${cause instanceof Error ? cause.message : String(cause)}`;
    },
  };
}
