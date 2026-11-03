import * as THREE from 'three';
import type { Installation } from './installation.ts';
import { raycastSplatCenters } from '../viewer/splatRaycast.ts';

type ScanRoot = THREE.Object3D & { viewer: { splatMesh: unknown } };

/** The chosen cross-section stays in scan space across a new calibration. */
export function setupPlacementPicker(
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  scanRoot: ScanRoot,
  installation: Installation,
  onStatus: (text: string) => void,
  options: { floorY?: number; onPicked?(): void } = {},
) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const picks: THREE.Vector3[] = [];
  const markers = new THREE.Group();
  markers.name = 'installation-cross-section';
  scanRoot.add(markers);
  const material = new THREE.MeshBasicMaterial({ color: 0xffdf85, depthTest: false });
  const geometry = new THREE.SphereGeometry(0.04, 12, 8);
  let picking = false;
  let selectionReady = false;
  let disposed = false;
  const clearMarkers = () => markers.clear();
  const applyFromScan = (newPick = false) => {
    if (picks.length !== 2 || (!newPick && !selectionReady)) return false;
    if (!newPick && installation.snapshot().placementSource !== 'picked-scan') return false;
    scanRoot.updateMatrixWorld(true);
    const a = scanRoot.localToWorld(picks[0].clone());
    const b = scanRoot.localToWorld(picks[1].clone());
    const width = Math.hypot(a.x - b.x, a.z - b.z);
    const config = installation.snapshot().config;
    installation.applyScanPlacement({ ...config, centerX: (a.x + b.x) / 2, centerZ: (a.z + b.z) / 2,
      floorY: options.floorY ?? 0, hallwayWidth: width });
    if (newPick) { selectionReady = true; options.onPicked?.(); }
    onStatus(`Centre from picked floor edges; scan width ${width.toFixed(2)} m versus provisional ${config.hallwayWidth.toFixed(2)} m. Check floor and choose the intended lengthwise midpoint. Placement remains unchecked.`);
    return true;
  };
  const onPointer = (event: PointerEvent) => {
    if (!picking || renderer.xr.isPresenting || event.button !== 0) return;
    const mesh = scanRoot.viewer.splatMesh as { splatDataTextures?: { baseData?: { centers?: Float32Array } } };
    const centers = mesh.splatDataTextures?.baseData?.centers;
    if (!centers) { onStatus('Wait for the scan to load before picking floor edges.'); return; }
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    scanRoot.updateMatrixWorld(true);
    const inverse = scanRoot.matrixWorld.clone().invert();
    const hit = raycastSplatCenters(centers, raycaster.ray.origin.clone().applyMatrix4(inverse), raycaster.ray.direction.clone().transformDirection(inverse));
    if (!hit) { onStatus('No scan point at this click. Pick a visible floor edge.'); return; }
    picks.push(hit.clone());
    const marker = new THREE.Mesh(geometry, material);
    marker.position.copy(hit);
    marker.renderOrder = 1002;
    markers.add(marker);
    if (picks.length === 1) { onStatus('Pick the opposite wall/floor edge at the same hallway cross-section.'); return; }
    try {
      picking = false;
      applyFromScan(true);
    } catch (cause) {
      picking = true; selectionReady = false; picks.length = 0; clearMarkers();
      onStatus(`${String(cause)} Pick a new pair of opposite edges.`);
    }
  };
  renderer.domElement.addEventListener('pointerdown', onPointer);
  return {
    start() {
      if (disposed || renderer.xr.isPresenting) return;
      if (!['idle', 'ready', 'box'].includes(installation.snapshot().phase)) {
        onStatus('Reset the sequence before picking placement.'); return;
      }
      picking = true; selectionReady = false; picks.length = 0; clearMarkers(); markers.visible = true;
      installation.confirmPlacement(false);
      onStatus('At the intended lengthwise midpoint, click one wall/floor edge, then its opposite edge.');
    },
    cancel() { picking = false; markers.visible = false; },
    isPicking: () => picking,
    hasSelection: () => selectionReady && picks.length === 2,
    clearSelection() { picking = false; selectionReady = false; picks.length = 0; clearMarkers(); markers.visible = false; },
    applyFromScan,
    dispose() { disposed = true; renderer.domElement.removeEventListener('pointerdown', onPointer); scanRoot.remove(markers); geometry.dispose(); material.dispose(); },
  };
}
