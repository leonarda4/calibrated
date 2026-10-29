// Entry point: wire the viewer rig, the XR gate, the HUD and desktop
// inspection controls. Keep this thin — logic lives in src/viewer, src/xr,
// and src/ui.

import { createViewerRig, loadScene } from './viewer/splatViewer';
import { attachEnterVr } from './xr/session';
import { makeHud } from './ui/hud';

const hud = makeHud();

const { renderer, scene, camera, splats } = createViewerRig();
attachEnterVr(renderer);

hud.setStatus('loading hallway scan …');
loadScene(splats)
  .then(() => { hud.setStatus('loaded ✓ (hallway.ply)'); })
  .catch((err: unknown) => { hud.setStatus(`load error: ${String(err)}`); });

// Render loop — works on desktop and inside XR (three switches cameras).
// DropInViewer updates its shader uniforms (focal/viewport) via a hidden
// callback mesh's onBeforeRender; that can lag or miss frames, leaving the
// splats degenerate (black screen). Call viewer.update explicitly with the
// active camera each frame so the projection uniforms are always current.
let lastHead: [number, number, number] | null = null;
renderer.setAnimationLoop(() => {
  const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  splats.viewer.update(renderer, activeCamera);
  renderer.render(scene, camera);
  hud.tickFrame(renderer.xr.isPresenting);
  if (renderer.xr.isPresenting) {
    // remember where the user's head is, so they can pick a start point
    const p = activeCamera.position;
    lastHead = [p.x, p.y, p.z];
  }
});

// After leaving VR: print the last head position so it can be copied into
// START_POINT in src/viewer/splatViewer.ts.
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
  __debug: { renderer, scene, camera, splats },
});

// Desktop inspection controls (never active in calibrated VR mode).
window.addEventListener('keydown', (e) => {
  const s = 0.3;
  if (e.key === 'w' || e.key === 'ArrowUp') camera.position.z -= s;
  if (e.key === 's' || e.key === 'ArrowDown') camera.position.z += s;
  if (e.key === 'a' || e.key === 'ArrowLeft') camera.position.x -= s;
  if (e.key === 'd' || e.key === 'ArrowRight') camera.position.x += s;
  camera.lookAt(0, 0, 0);
});