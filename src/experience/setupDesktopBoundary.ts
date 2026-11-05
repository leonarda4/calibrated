import type * as THREE from 'three';
import { manualRectangle, type ManualRectangleConfig, type Point3 } from '../boundary/geometry.ts';
import { setupMovementBoundary } from '../xr/movementBoundary.ts';
import { createMovementBounds } from '../viewer/movementBounds.ts';
import { bindBoundaryPanel, type BoundaryBoxMarker } from '../ui/boundaryPanel.ts';
import { createBoundaryApproachWarning } from '../boundary/approachWarning.ts';

export function setupDesktopBoundary(
  renderer: Pick<THREE.WebGLRenderer, 'xr'>,
  scene: THREE.Scene,
  options: { getBox?(): BoundaryBoxMarker | undefined; showWorldGuides?: boolean;
    onWarning?(): boolean; onWarningCancelled?(): void; isWarningEnabled?(): boolean } = {},
) {
  const warning = createBoundaryApproachWarning({ onWarning: () => options.onWarning?.() ?? false,
    onCancel: () => options.onWarningCancelled?.() });
  const boundary = setupMovementBoundary(renderer, { onChange: state => { if (!state.live) warning.reset(); } });
  const outline = createMovementBounds(scene, options.showWorldGuides);
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
    resetWarning: () => warning.reset(),
    snapshot() { return { runtime: boundary.snapshot(), manual: { config: { ...manualConfig }, visible: manualVisible, points: manualPoints.map(point => [...point] as Point3) }, head: liveHead ? [...liveHead] : null,
      warning: warning.snapshot() }; },
    update(frame?: XRFrame, nowSeconds = performance.now() / 1000) {
      const runtime = boundary.update(frame);
      warning.update(nowSeconds, runtime, renderer.xr.isPresenting && options.isWarningEnabled?.() !== false);
      const voice = warning.snapshot();
      panel.setVoiceStatus(voice.status === 'unavailable' ? 'Boundary voice: no live headset outline available.'
        : voice.status === 'paused' ? 'Boundary voice paused.'
        : `Boundary voice: ${voice.distanceMetres!.toFixed(2)} m from edge${voice.latched ? ' · warning delivered' : ''}. Trigger: 0.50 m while approaching.`);
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
    dispose() { warning.reset(); boundary.dispose(); outline.dispose(); panel.dispose(); },
  };
}
