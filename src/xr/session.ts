// src/xr — Session lifecycle, reference space, enter-VR gate.
// (Module boundary per docs/PROJECT_PLAN.md)

import * as THREE from 'three';
import { logger } from '../debug/logger';

const TAG = 'xr-session';
const statusEl = document.getElementById('status')!;
const appEl = document.getElementById('app')!;

export async function checkXrSupport(): Promise<'immersive-ar' | 'immersive-vr' | null> {
  const xrNav = navigator as Navigator & {
    xr?: { isSessionSupported(mode: string): Promise<boolean> };
  };
  if (!xrNav.xr) {
    logger.warn(TAG, 'navigator.xr missing — WebXR not available in this browser');
    statusEl.innerHTML += '<br/>WebXR: not available';
    return null;
  }
  // Prefer passthrough (immersive-ar): the real room stays visible, which the
  // physical-landmark steps of the calibration need. Fall back to pure VR.
  const arSupported = await xrNav.xr.isSessionSupported('immersive-ar').catch((e) => {
    logger.warn(TAG, 'isSessionSupported(immersive-ar) rejected:', e);
    return false;
  });
  logger.info(TAG, `isSessionSupported immersive-ar=${arSupported}`);
  if (arSupported) {
    statusEl.innerHTML += '<br/>WebXR: passthrough (immersive-ar) ✓';
    return 'immersive-ar';
  }
  const vrSupported = await xrNav.xr.isSessionSupported('immersive-vr').catch((e) => {
    logger.warn(TAG, 'isSessionSupported(immersive-vr) rejected:', e);
    return false;
  });
  logger.info(TAG, `isSessionSupported immersive-vr=${vrSupported}`);
  statusEl.innerHTML += `<br/>WebXR immersive-vr: ${vrSupported ? 'supported ✓' : 'not supported'}`;
  return vrSupported ? 'immersive-vr' : null;
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

  renderer.xr.addEventListener('sessionstart', () => {
    const session = renderer.xr.getSession() as XRSession | null;
    logger.info(TAG, `SESSION STARTED — ` +
      `blend=${session?.environmentBlendMode ?? '?'}, ` +
      `features=${session?.enabledFeatures?.join(',') ?? 'n/a'}`);
  });
  renderer.xr.addEventListener('sessionend', () => {
    logger.info(TAG, 'SESSION ENDED');
  });

  btn.addEventListener('click', async () => {
    if (renderer.xr.isPresenting) {
      // second click while a session is alive — Chrome would throw
      // "There is already an active, immersive XRSession" (known Link trap)
      logger.warn(TAG, 'Enter VR clicked while a session is already presenting — ignored');
      return;
    }
    logger.info(TAG, 'Enter VR clicked — requesting session…');
    const t0 = performance.now();
    try {
      const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
      if (!xr) throw new Error('WebXR not available on this device');
      const mode = (await checkXrSupport()) ?? 'immersive-vr';
      logger.info(TAG, `requestSession mode=${mode} ` +
        `optionalFeatures=local-floor,hand-tracking`);
      const xrSession: XRSession = await xr.requestSession(mode, {
        optionalFeatures: ['local-floor', 'hand-tracking'],
      });
      logger.info(TAG, `requestSession RESOLVED in ` +
        `${((performance.now() - t0) / 1000).toFixed(2)}s ` +
        `(blend=${xrSession.environmentBlendMode})`);
      await renderer.xr.setSession(xrSession);
      logger.info(TAG, 'three.js attached the session — presenting now');
      btn.style.display = 'none';
      appEl.style.display = 'none';
    } catch (e) {
      logger.error(TAG, `SESSION FAILED after ` +
        `${((performance.now() - t0) / 1000).toFixed(2)}s:`, e);
      statusEl.innerHTML += `<br/>XR session error: ${String(e)}`;
    }
  });

  checkXrSupport().then((mode) => {
    if (mode) btn.style.display = 'block';
  });
}