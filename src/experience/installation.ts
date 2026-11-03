import * as THREE from 'three';
import { InstallationFlow, type ExperienceSnapshot, type FingertipContact, type InstallationConfig, type VoiceCue } from './flow.ts';
import { rotateContentAroundPivot, type ContentTransform } from './rotation.ts';

export type { ExperienceSnapshot, FingertipContact, InstallationConfig, VoiceCue } from './flow.ts';

export interface InstallationOptions {
  scene: THREE.Scene;
  camera?: THREE.Camera;
  scanRoot: THREE.Object3D;
  onCue?(cue: VoiceCue): void;
  onStopAudio?(): void;
  onStatus?(status: string): void;
}

export type Installation = ReturnType<typeof createInstallation>;

/** Props are deliberately outside the scan root: the physical box stays still. */
export function createInstallation(options: InstallationOptions) {
  const { scene, scanRoot } = options;
  const flow = new InstallationFlow();
  const listeners = new Set<(snapshot: ExperienceSnapshot) => void>();
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

  const orb = new THREE.Group();
  orb.name = 'installation-badge';
  props.add(orb);
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffeab3, transparent: true, depthTest: false }),
  );
  sphere.renderOrder = 50;
  orb.add(sphere);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 24, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffce66, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    }),
  );
  halo.renderOrder = 51;
  orb.add(halo);

  let baseline: ContentTransform | null = null;
  let lastPhase = flow.snapshot().phase;
  let previousStatus = '';
  let publishClock = 0;
  let glowClock = 0;

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
    orb.position.set(config.centerX, config.floorY + config.orbHeight, config.centerZ);
    orb.scale.setScalar(config.orbRadius);
  };
  const publish = (): void => {
    const snapshot = flow.snapshot();
    props.visible = ['badge', 'rotating', 'reversed'].includes(snapshot.phase);
    orb.visible = snapshot.phase === 'badge';
    if (snapshot.status !== previousStatus) {
      previousStatus = snapshot.status;
      options.onStatus?.(snapshot.status);
    }
    for (const listener of listeners) listener(snapshot);
    for (const cue of flow.drainCues()) options.onCue?.(cue);
    lastPhase = snapshot.phase;
  };
  const haltAudio = (): void => options.onStopAudio?.();
  layout();

  return {
    snapshot: () => flow.snapshot(),
    subscribe(listener: (snapshot: ExperienceSnapshot) => void) {
      listeners.add(listener);
      listener(flow.snapshot());
      return () => { listeners.delete(listener); };
    },
    setCalibrated() {
      if (flow.snapshot().yaw !== 0) throw new Error('Prepare for calibration before recording a new baseline.');
      haltAudio();
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
      flow.configure(config);
      haltAudio();
      layout();
      publish();
    },
    confirmPlacement(confirmed: boolean) {
      flow.confirmPlacement(confirmed);
      if (!confirmed) haltAudio();
      publish();
    },
    confirmStationary(confirmed: boolean) {
      flow.confirmStationary(confirmed);
      if (!confirmed && flow.snapshot().phase === 'stopped') haltAudio();
      publish();
    },
    start(preview = false): boolean {
      // Preview captures a temporary baseline but never grants XR authority.
      if (preview && !baseline) baseline = readTransform();
      const started = flow.start(preview);
      publish();
      return started;
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
      glowClock += Math.max(0, deltaSeconds);
      halo.scale.setScalar(1 + Math.sin(glowClock * 2) * 0.08);
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
