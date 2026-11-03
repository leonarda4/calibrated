import * as THREE from 'three';
import { InstallationFlow, validateInstallationConfig, type ExperienceSnapshot, type FingertipContact, type InstallationConfig, type Position3, type VoiceCue } from './flow.ts';
import { rotateContentAroundPivot, type ContentTransform } from './rotation.ts';
import { ACTIVE_SCAN } from '../viewer/scanAsset.ts';

export type { ExperienceSnapshot, FingertipContact, InstallationConfig, VoiceCue } from './flow.ts';

export type PlacementSource = 'unplaced' | 'default-ply' | 'manual-world' | 'picked-scan';
export interface InstallationSnapshot extends ExperienceSnapshot {
  placementSource: PlacementSource;
  /** Authored mesh centre for this scan only; exclusive with the base anchor. */
  defaultPlyCenter: Position3 | null;
  /** Authored floor contact / bottom centre for this scan only. */
  defaultPlyBase: Position3 | null;
}

export interface InstallationOptions {
  scene: THREE.Scene;
  camera?: THREE.Camera;
  scanRoot: THREE.Object3D;
  /** Explicit mesh-centre override; null suppresses all active-profile anchors. */
  defaultPlyCenter?: Position3 | null;
  /** Explicit bottom-centre override; null suppresses active-profile anchors. */
  defaultPlyBase?: Position3 | null;
  onCue?(cue: VoiceCue): void;
  onStopAudio?(): void;
  onStatus?(status: string): void;
}

export type Installation = ReturnType<typeof createInstallation>;

/** Props are deliberately outside the scan root: the physical box stays still. */
export function createInstallation(options: InstallationOptions) {
  const { scene, scanRoot } = options;
  const anchorOverride = options.defaultPlyCenter !== undefined || options.defaultPlyBase !== undefined;
  const authoredCentre = anchorOverride ? options.defaultPlyCenter ?? null : ACTIVE_SCAN.boxPlyCenter;
  const authoredBase = anchorOverride ? options.defaultPlyBase ?? null : ACTIVE_SCAN.boxPlyBase;
  for (const anchor of [authoredCentre, authoredBase]) {
    if (anchor !== null && (anchor.length !== 3 || !anchor.every(Number.isFinite))) {
      throw new Error('A scan-local box anchor must contain three finite coordinates.');
    }
  }
  if (authoredCentre !== null && authoredBase !== null) {
    throw new Error('Specify the box bottom centre or mesh centre, not both.');
  }
  const defaultPlyCenter: Position3 | null = authoredCentre ? [...authoredCentre] : null;
  const defaultPlyBase: Position3 | null = authoredBase ? [...authoredBase] : null;
  const flow = new InstallationFlow();
  const listeners = new Set<(snapshot: InstallationSnapshot) => void>();
  let placementSource: PlacementSource = defaultPlyCenter === null && defaultPlyBase === null ? 'unplaced' : 'default-ply';
  const snapshot = (): InstallationSnapshot => {
    const state = flow.snapshot();
    if (placementSource === 'unplaced') {
      if (state.preview && state.phase !== 'stopped') state.status = 'DESKTOP PREVIEW: box location is unset. Draft coordinates only.';
      else if (state.phase === 'idle' || state.phase === 'ready') {
        state.status = 'New scan: box placement unset. Apply placement or pick two floor edges, then check the real box.';
      }
    }
    return {
      ...state, placementSource,
      defaultPlyCenter: defaultPlyCenter ? [...defaultPlyCenter] : null,
      defaultPlyBase: defaultPlyBase ? [...defaultPlyBase] : null,
    };
  };
  const props = new THREE.Group();
  props.name = 'installation-fixed-props';
  props.visible = false;
  scene.add(props);

  const boxMaterial = new THREE.MeshBasicMaterial({
    color: 0x788ca2, transparent: true, opacity: 1, depthTest: false,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), boxMaterial);
  box.name = 'installation-box';
  box.renderOrder = 40;
  props.add(box);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(box.geometry),
    new THREE.LineBasicMaterial({ color: 0xdce7ef, transparent: true, opacity: 0.8, depthTest: false }),
  );
  edges.renderOrder = 41;
  box.add(edges);

  let baseline: ContentTransform | null = null;
  let lastPhase = flow.snapshot().phase;
  let previousStatus = '';
  let publishClock = 0;

  const readTransform = (): ContentTransform => ({
    position: scanRoot.position.toArray() as [number, number, number],
    quaternion: scanRoot.quaternion.toArray() as [number, number, number, number],
  });
  const applyTransform = (transform: ContentTransform): void => {
    scanRoot.position.set(...transform.position);
    scanRoot.quaternion.set(...transform.quaternion);
    scanRoot.updateMatrixWorld(true);
  };
  const restoreBaseline = (): void => { if (baseline) applyTransform(baseline); };
  const layout = (): void => {
    const config = flow.snapshot().config;
    box.position.set(config.centerX, config.floorY + config.boxHeight / 2, config.centerZ);
    box.scale.set(config.boxWidth, config.boxHeight, config.boxDepth);
  };
  const positionChanged = (a: InstallationConfig, b: InstallationConfig): boolean =>
    (['centerX', 'centerZ', 'floorY'] as const).some(key => Math.abs(a[key] - b[key]) > 1e-9);
  const projectDefaultAnchor = (config: InstallationConfig): InstallationConfig => {
    const anchor = defaultPlyBase ?? defaultPlyCenter;
    if (!anchor) return config;
    scanRoot.updateWorldMatrix(true, false);
    const point = scanRoot.localToWorld(new THREE.Vector3(...anchor));
    return {
      ...config, centerX: point.x, centerZ: point.z,
      floorY: defaultPlyBase ? point.y : point.y - config.boxHeight / 2,
    };
  };
  const syncDefaultAnchor = (): boolean => {
    const state = flow.snapshot();
    // An artistic turn must never drag the real box along with the scan. The
    // coordinator explicitly prepares an idle baseline before a new real fit.
    if (placementSource !== 'default-ply' || !['idle', 'ready'].includes(state.phase) || state.yaw !== 0) return false;
    const projected = projectDefaultAnchor(state.config);
    validateInstallationConfig(projected);
    if (!positionChanged(projected, state.config)) return false;
    flow.configure(projected);
    layout();
    return true;
  };
  const publish = (): void => {
    const state = snapshot();
    props.visible = ['box', 'rotating', 'reversed'].includes(state.phase);
    if (state.status !== previousStatus) {
      previousStatus = state.status;
      options.onStatus?.(state.status);
    }
    for (const listener of listeners) listener(state);
    for (const cue of flow.drainCues()) options.onCue?.(cue);
    lastPhase = state.phase;
  };
  const haltAudio = (): void => options.onStopAudio?.();
  const showBox = (preview = false): boolean => {
    syncDefaultAnchor();
    if (placementSource === 'unplaced') { publish(); return false; }
    const alreadyShown = flow.snapshot().phase === 'box';
    const shown = flow.showBox(preview);
    // A second Show click must not move the stored baseline or accumulate a
    // transform. Static placement edits can still choose a new rotation pivot.
    if (shown && !alreadyShown) baseline = readTransform();
    publish();
    return shown;
  };
  syncDefaultAnchor();
  layout();

  return {
    snapshot,
    subscribe(listener: (snapshot: InstallationSnapshot) => void) {
      listeners.add(listener);
      listener(snapshot());
      return () => { listeners.delete(listener); };
    },
    setCalibrated() {
      if (flow.snapshot().yaw !== 0) throw new Error('Prepare for calibration before recording a new baseline.');
      haltAudio();
      syncDefaultAnchor();
      baseline = readTransform();
      flow.setCalibrated();
      publish();
    },
    prepareForCalibration() {
      haltAudio();
      restoreBaseline();
      baseline = null;
      flow.invalidate('Calibration preparation. Experience disarmed.');
      flow.reset();
      publish();
    },
    configure(config: InstallationConfig) {
      validateInstallationConfig(config);
      const manualPosition = positionChanged(config, flow.snapshot().config);
      // Editing a duration or box dimensions does not turn a PLY landmark into
      // a world-space override. Height edits preserve the authored base/centre.
      const next = placementSource === 'default-ply' && !manualPosition ? projectDefaultAnchor(config) : config;
      flow.configure(next);
      // Applying even unchanged draft fields is an explicit placement action.
      // A fit, refresh or checkbox alone cannot set a new scan's box source.
      if (manualPosition || placementSource === 'unplaced') placementSource = 'manual-world';
      haltAudio();
      layout();
      publish();
    },
    /** Picker-owned scan landmarks are reprojected by the picker after a fit. */
    applyScanPlacement(config: InstallationConfig) {
      flow.configure(config);
      placementSource = 'picked-scan';
      haltAudio();
      layout();
      publish();
    },
    /** Call after real scan/load/start-point changes, never as a render update. */
    syncPlacementFromScan() {
      if (!syncDefaultAnchor()) return;
      haltAudio();
      publish();
    },
    confirmPlacement(confirmed: boolean) {
      const accepted = confirmed && placementSource !== 'unplaced';
      flow.confirmPlacement(accepted);
      if (!accepted) haltAudio();
      publish();
    },
    confirmStationary(confirmed: boolean) {
      flow.confirmStationary(confirmed);
      if (!confirmed && flow.snapshot().phase === 'stopped') haltAudio();
      publish();
    },
    showBox,
    start: showBox,
    rotateHallway(): boolean {
      const rotated = flow.rotateHallway();
      publish();
      return rotated;
    },
    previewAdvance() {
      flow.previewAdvance();
      publish();
    },
    simulateCollection(): boolean {
      const collected = flow.simulateCollection();
      publish();
      return collected;
    },
    update(deltaSeconds: number, contacts: readonly FingertipContact[] = [], nowMs = performance.now()) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
      flow.update(deltaSeconds, contacts, nowMs);
      const snapshot = flow.snapshot();
      if (snapshot.phase === 'rotating' || snapshot.phase === 'reversed') {
        if (baseline) applyTransform(rotateContentAroundPivot(baseline,
          [snapshot.config.centerX, snapshot.config.floorY, snapshot.config.centerZ], snapshot.yaw));
      }
      publishClock += deltaSeconds;
      if (snapshot.phase !== lastPhase || publishClock >= 0.2) {
        publishClock = 0;
        publish();
      }
    },
    stop(reason?: string) {
      flow.stop(reason);
      haltAudio();
      publish();
    },
    invalidate(reason: string) {
      // Do not move a world after tracking loss. Explicit reset restores it.
      flow.invalidate(reason);
      haltAudio();
      publish();
    },
    reset() {
      restoreBaseline();
      flow.reset();
      haltAudio();
      publish();
    },
    dispose() {
      haltAudio();
      scene.remove(props);
      props.traverse(child => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach(material => material.dispose());
        }
      });
      listeners.clear();
    },
  };
}
