// Entry point: wire the viewer rig, the XR gate, the spawn picker and the
// desktop inspection controls. Keep this thin — logic lives in src/viewer,
// src/xr and src/ui.

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  createViewerRig, loadScene, applyStartPoint, createSpawnMarker,
} from './viewer/splatViewer';
import { attachEnterVr } from './xr/session';
import { setupCalibrationCapture } from './xr/calibrationCapture';
import { makeHud } from './ui/hud';
import { bindSpawnPanel } from './ui/spawnPanel';

const hud = makeHud();

const { renderer, scene, camera, splats } = createViewerRig();
attachEnterVr(renderer);

// Desktop inspection: orbit around the spawn point with the mouse
// (left-drag rotate, wheel zoom, right-drag pan). Disabled while in XR.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;
controls.update();

// Cyan marker at the XR origin = where you will physically stand in VR.
const spawnMarker = createSpawnMarker();
scene.add(spawnMarker);

hud.setStatus('loading hallway scan …');
loadScene(splats)
  .then(() => { hud.setStatus('loaded ✓ (hallway.ply)'); })
  .catch((err: unknown) => { hud.setStatus(`load error: ${String(err)}`); });

// Operator panel: shift the map around the player, live, before entering VR.
bindSpawnPanel((point) => applyStartPoint(splats, point));

// Controller-based landmark calibration (in VR). On success, report the
// solution on the flat page and retire the manual spawn panel.
const calibration = setupCalibrationCapture(renderer, scene, splats, (solution) => {
  const cm = solution.residuals.map((r) => `${(r * 100).toFixed(1)} cm`).join(', ');
  const t = solution.translation.map((v) => v.toFixed(3)).join(', ');
  hud.appendStatus(
    `calibrated ✓ yaw ${(solution.yaw * 180 / Math.PI).toFixed(2)}°, ` +
    `translation [${t}], fit error ${cm}`,
  );
  const panel = document.getElementById('spawn-panel');
  if (panel) panel.style.display = 'none';
});

// Render loop — works on desktop and inside XR (three switches cameras).
// Explicit splats.viewer.update() keeps the projection uniforms current
// (the library's callback-mesh path missed frames → black screen).
let lastHead: [number, number, number] | null = null;
renderer.setAnimationLoop(() => {
  const presenting = renderer.xr.isPresenting;
  const activeCamera = presenting ? renderer.xr.getCamera() : camera;
  controls.enabled = !presenting;
  splats.viewer.update(renderer, activeCamera);
  controls.update();
  calibration.update(activeCamera);
  renderer.render(scene, camera);
  hud.tickFrame(presenting);
  spawnMarker.visible = !presenting;
  if (presenting) {
    const p = activeCamera.position;
    lastHead = [p.x, p.y, p.z]; // still recorded: useful when there IS room to walk
  }
});

// After leaving VR: print the last head position so it can be copied into
// START_POINT in src/viewer/splatViewer.ts (persist across sessions).
renderer.xr.addEventListener('sessionend', () => {
  if (lastHead) {
    hud.appendStatus(
      `last head position in VR: [${lastHead.map((n) => n.toFixed(2)).join(', ')}]` +
      ' — copy into START_POINT to spawn here',
    );
    lastHead = null;
  }
  hud.showOverlay();
});

// Debug hook for automated visual checks (readPixels etc.)
Object.assign(window as unknown as Record<string, unknown>, {
  __debug: { renderer, scene, camera, splats, controls, spawnMarker },
});