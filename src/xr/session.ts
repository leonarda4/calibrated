// src/xr — Session lifecycle, reference space, enter-VR gate.
// (Module boundary per docs/PROJECT_PLAN.md)

import * as THREE from 'three';

const statusEl = document.getElementById('status')!;
const appEl = document.getElementById('app')!;

export async function checkXrSupport(): Promise<boolean> {
  const xrNav = navigator as Navigator & {
    xr?: { isSessionSupported(mode: string): Promise<boolean> };
  };
  if (!xrNav.xr) {
    statusEl.innerHTML += '<br/>WebXR: not available';
    return false;
  }
  const supported = await xrNav.xr.isSessionSupported('immersive-vr').catch(() => false);
  statusEl.innerHTML += `<br/>WebXR immersive-vr: ${supported ? 'supported ✓' : 'not supported'}`;
  return supported;
}

/**
 * Attach the "Enter VR" button. Requests immersive-vr with local-floor
 * reference space (one XR unit = one metre in calibrated mode) and hands the
 * session to three.js. No locomotion, no artificial turning, no scale
 * changes — physical movement only.
 */
export function attachEnterVr(renderer: THREE.WebGLRenderer): void {
  const btn = document.createElement('button');
  btn.textContent = 'Enter VR (WebXR)';
  Object.assign(btn.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    padding: '12px 24px', fontSize: '16px', zIndex: '20', cursor: 'pointer',
    background: '#6fd08c', color: '#101014', border: 'none', borderRadius: '8px',
    fontWeight: 'bold', display: 'none',
  });
  document.body.appendChild(btn);

  renderer.xr.setReferenceSpaceType('local-floor');

  btn.addEventListener('click', async () => {
    try {
      const xrSession: XRSession = await (window as unknown as { xr: XRSystem })
        .xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'hand-tracking'],
        });
      await renderer.xr.setSession(xrSession);
      btn.style.display = 'none';
      appEl.style.display = 'none';
    } catch (e) {
      statusEl.innerHTML += `<br/>XR session error: ${String(e)}`;
    }
  });

  checkXrSupport().then((supported) => {
    if (supported) btn.style.display = 'block';
  });
}