// Entry point: wire the viewer rig, the XR gate, the HUD and desktop
// inspection controls. Keep this thin — logic lives in src/viewer and src/xr.

import { createViewerRig, loadStack } from './viewer/splatViewer';
import { attachEnterVr } from './xr/session';

const statusEl = document.getElementById('status')!;
const hudEl = document.getElementById('hud')!;

const { renderer, scene, camera, splats } = createViewerRig();
attachEnterVr(renderer);

statusEl.innerHTML = 'loading splat scene × 3 …';
loadStack(splats)
  .then(() => { statusEl.innerHTML = 'loaded ✓ (3 × hallway.ply)'; })
  .catch((err: unknown) => { statusEl.innerHTML = `load error: ${String(err)}`; });

// Render loop — works on desktop and inside XR (three switches cameras).
let frames = 0;
let last = performance.now();
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  if (!renderer.xr.isPresenting) {
    frames++;
    const now = performance.now();
    if (now - last >= 1000) {
      hudEl.textContent = `${frames} fps`;
      frames = 0;
      last = now;
    }
  } else {
    hudEl.textContent = '';
  }
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