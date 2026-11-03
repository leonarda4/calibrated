import type * as THREE from 'three';
import { manualRectangle, type ManualRectangleConfig, type Point3 } from '../boundary/geometry.ts';
import { setupMovementBoundary } from '../xr/movementBoundary.ts';
import { createMovementBounds } from '../viewer/movementBounds.ts';
import { bindBoundaryPanel, type BoundaryBoxMarker } from '../ui/boundaryPanel.ts';

export function setupDesktopBoundary(
  renderer: Pick<THREE.WebGLRenderer, 'xr'>,
  scene: THREE.Scene,
  options: { getBox?(): BoundaryBoxMarker } = {},
) {
  const boundary = setupMovementBoundary(renderer);
  const outline = createMovementBounds(scene);
  let manualConfig: ManualRectangleConfig = { centerX: 0, centerZ: 0, width: 2.1, depth: 2.1, floorY: 0, yawDegrees: 0 };
  let manualPoints = manualRectangle(manualConfig);
  let manualVisible = false;
  let runtimeVisible = true;
  let liveHead: Point3 | null = null;
  let lastDraw = -Infinity;
  const refresh = (force = false) => {
    const runtime = boundary.snapshot();
    const displayedManual = manualVisible ? manualPoints : [];
    outline.update(runtimeVisible ? runtime.points : [], displayedManual, renderer.xr.isPresenting);
    const now = performance.now();
    if (force || now - lastDraw >= 100) {
      lastDraw = now;
      panel.draw(runtime, displayedManual, runtimeVisible, options.getBox?.(), liveHead);
    }
  };
  const configureManual = (config: ManualRectangleConfig) => {
    const points = manualRectangle(config); // validate before replacing current data
    manualConfig = { ...config }; manualPoints = points;
    panel.setManual(manualConfig, manualVisible); refresh(true);
  };
  const setManualVisible = (visible: boolean) => {
    manualVisible = visible; panel.setManual(manualConfig, visible); refresh(true);
  };
  const setRuntimeVisible = (visible: boolean) => {
    runtimeVisible = visible; panel.setRuntimeVisible(visible); refresh(true);
  };
  const panel = bindBoundaryPanel(manualConfig, { onApply: configureManual, onManualVisibility: setManualVisible, onRuntimeVisibility: setRuntimeVisible });
  refresh(true);
  return {
    configureManual,
    setManualVisible,
    setRuntimeVisible,
    snapshot() { return { runtime: boundary.snapshot(), manual: { config: { ...manualConfig }, visible: manualVisible, points: manualPoints.map(point => [...point]) }, head: liveHead ? [...liveHead] : null }; },
    update(frame?: XRFrame) {
      boundary.update(frame);
      // A manual map remains useful when the runtime declines bounded-floor.
      // Its head marker still requires a real current local-floor viewer pose.
      liveHead = null;
      const reference = renderer.xr.getReferenceSpace();
      if (renderer.xr.isPresenting && frame && reference && renderer.xr.getSession()?.visibilityState === 'visible') {
        try {
          const pose = frame.getViewerPose(reference);
          const p = pose?.transform.position;
          if (pose && !pose.emulatedPosition && p && [p.x, p.y, p.z].every(Number.isFinite)) liveHead = [p.x, p.y, p.z];
        } catch { /* no stale head marker after tracking interruption */ }
      }
      refresh();
    },
    dispose() { boundary.dispose(); outline.dispose(); panel.dispose(); },
  };
}
