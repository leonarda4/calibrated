// src/xr — our own Enter VR / Exit VR button and session handling.
//
// WHY THIS MODULE EXISTS (PCVR fix, verified on the target machine):
// three.js WebXRManager (r180 AND current r187) chooses the WebXR Layers
// path (XRWebGLBinding.createProjectionLayer) whenever the browser exposes
// `XRWebGLBinding` — the check runs at RENDERER CONSTRUCTION time
// (`supportsGlBinding && 'createProjectionLayer' in XRWebGLBinding.prototype`),
// regardless of whether the 'layers' feature was ever requested. Desktop
// Chrome always exposes XRWebGLBinding. On PCVR through SteamVR/Steam Link
// (OpenXR), the projection-layer path delivers NO FRAMES: the session
// starts, the headset spins, then "page not responding". The classic
// XRWebGLLayer path works (verified with three.js and raw WebGL).
//
// Two-layered, scoped workaround — NO global prototype patching:
// 1) CONSTRUCTION: in classic mode, `XRWebGLBinding` is hidden from the
//    global scope ONLY for the duration of `new THREE.WebGLRenderer()` and
//    restored immediately afterwards (try/finally). three.js then wires
//    that renderer to the classic XRWebGLLayer path permanently.
// 2) PER-SESSION: `renderState.layers` is hidden on that single session
//    instance via an own-property proxy (some three.js versions pick the
//    path from `session.renderState.layers !== undefined`).
//
// Path selection (task spec):
//   ?xrLayers=1  → force the projection-layer path
//   ?xrLayers=0  → force the classic path
//   default      → classic on desktop (PCVR), layers on the standalone Quest
//                  browser (detected via user agent), where layers work and
//                  are faster.

import * as THREE from 'three';
import { logger } from '../debug/logger';

const TAG = 'enter-vr';

/** Framebuffer scale for XR sessions (splat rendering is fill-rate heavy). */
export const XR_FRAMEBUFFER_SCALE = 1.0;

export type XrLayerPath = 'layers' | 'classic';

export const resolveLayerPath = (): XrLayerPath => {
  const forced = new URLSearchParams(window.location.search).get('xrLayers');
  if (forced === '1') return 'layers';
  if (forced === '0') return 'classic';
  // The standalone Quest browser renders via the compositor's layers path
  // efficiently — keep the standard behaviour there.
  return /OculusBrowser/i.test(navigator.userAgent) ? 'layers' : 'classic';
};

/**
 * Hide `XRWebGLBinding` from the global scope while `fn()` runs, restore it
 * afterwards. Used around renderer construction so three.js r180+ wires the
 * renderer to the classic XRWebGLLayer path (see header). Synchronous,
 * exception-safe, no prototype is touched.
 */
export function withHiddenXrWebGlBinding<T>(fn: () => T): T {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (typeof scope.XRWebGLBinding === 'undefined') return fn();
  const descriptor = Object.getOwnPropertyDescriptor(scope, 'XRWebGLBinding');
  const original = scope.XRWebGLBinding;
  try {
    scope.XRWebGLBinding = undefined; // typeof XRWebGLBinding → 'undefined'
    return fn();
  } finally {
    if (descriptor) Object.defineProperty(scope, 'XRWebGLBinding', descriptor);
    else scope.XRWebGLBinding = original;
  }
}

/**
 * Hide `renderState.layers` on THIS session instance only, so three.js
 * versions that check `session.renderState.layers !== undefined` fall back
 * to XRWebGLLayer. Never patches XRSession.prototype.
 */
function hideRenderStateLayers(session: XRSession): void {
  try {
    const proto = (globalThis as unknown as { XRSession?: { prototype: object } })
      .XRSession?.prototype;
    const getRenderState = proto
      ? (Object.getOwnPropertyDescriptor(proto, 'renderState') as
        { get?: (this: XRSession) => XRRenderState }).get
      : undefined;
    if (!getRenderState) {
      logger.warn(TAG, 'cannot install renderState proxy (getter not found)');
      return;
    }
    Object.defineProperty(session, 'renderState', {
      configurable: true,
      get(this: XRSession) {
        const rs = getRenderState.call(this);
        return new Proxy(rs, {
          get(target: XRRenderState, key: string | symbol) {
            if (key === 'layers') return undefined;
            const value = (target as unknown as Record<string | symbol, unknown>)[key];
            return typeof value === 'function'
              ? (value as (...args: unknown[]) => unknown).bind(target)
              : value;
          },
        });
      },
    });
    logger.info(TAG, 'renderState.layers hidden on this session instance');
  } catch (e) {
    logger.warn(TAG, 'renderState proxy failed:', e);
  }
}

export interface EnterVrStats {
  path: XrLayerPath;
  presenting: boolean;
  frames: number;
  firstFrameSeconds: number | null;
  watchdogFired: boolean;
}

export interface EnterVr {
  /** Call every animation-loop iteration while presenting (frame counting). */
  noteXrFrame(): void;
  stats(): EnterVrStats;
}

const NO_XR_FRAME_WARNING_SECONDS = 5;
const tmpVec = new THREE.Vector3();

export function setupEnterVr(renderer: THREE.WebGLRenderer): EnterVr {
  const statusEl = document.getElementById('status');
  const appEl = document.getElementById('app');
  const path = resolveLayerPath();

  let frames = 0;
  let firstFrameSeconds: number | null = null;
  let watchdogFired = false;
  let sessionStartAt = 0;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  const stats = (): EnterVrStats => ({
    path, presenting: renderer.xr.isPresenting, frames, firstFrameSeconds, watchdogFired,
  });

  // ---- button -------------------------------------------------------------
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

  // ---- session lifecycle --------------------------------------------------
  renderer.xr.addEventListener('sessionstart', () => {
    const session = renderer.xr.getSession();
    const baseLayer = renderer.xr.getBaseLayer();
    logger.info(TAG, `SESSION STARTED — path=${path}, ` +
      `blend=${session?.environmentBlendMode ?? '?'}, ` +
      `baseLayer=${baseLayer?.constructor?.name ?? '?'}, ` +
      `features=${session?.enabledFeatures?.join(',') ?? 'n/a'}`);
    sessionStartAt = performance.now();
    frames = 0;
    firstFrameSeconds = null;
    watchdogFired = false;
    // Floor-calibration check: with a correct 'local-floor' space the head
    // sits ~1.5–1.8 m above y=0. Near 0.0 → the runtime's floor is at eye
    // height (SteamVR Room Setup needed).
    renderer.xr.getCamera().getWorldPosition(tmpVec);
    logger.info(TAG, `reference head height at start: ` +
      `${tmpVec.y.toFixed(2)} m ${tmpVec.y < 0.8 ? '(LOW! runtime floor at eye height? run SteamVR Room Setup)' : '(ok)'}`);
    btn.textContent = 'Exit VR';
    if (appEl) appEl.style.display = 'none';
    watchdogTimer = setTimeout(() => {
      if (firstFrameSeconds === null) {
        watchdogFired = true;
        logger.error(TAG, `no XR frames delivered within ` +
          `${NO_XR_FRAME_WARNING_SECONDS}s — runtime is not presenting`);
      }
    }, NO_XR_FRAME_WARNING_SECONDS * 1000);
  });

  renderer.xr.addEventListener('sessionend', () => {
    logger.info(TAG, 'SESSION ENDED');
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = null;
    btn.textContent = 'Enter VR (WebXR)';
    if (appEl) appEl.style.display = '';
  });

  // ---- click handler ------------------------------------------------------
  btn.addEventListener('click', async () => {
    const activeSession = renderer.xr.getSession();
    if (activeSession) {
      logger.info(TAG, 'Exit VR clicked — ending session');
      activeSession.end();
      return;
    }
    const t0 = performance.now();
    try {
      const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
      if (!xr) throw new Error('WebXR not available on this device');
      // classic path: NO 'layers' in optionalFeatures (spec).
      const optionalFeatures = path === 'layers'
        ? ['local-floor', 'bounded-floor', 'layers']
        : ['local-floor', 'bounded-floor'];
      logger.info(TAG, `requestSession path=${path} ` +
        `optionalFeatures=${optionalFeatures.join(',')}`);
      const session: XRSession = await xr.requestSession('immersive-vr', { optionalFeatures });
      logger.info(TAG, `requestSession RESOLVED in ` +
        `${((performance.now() - t0) / 1000).toFixed(2)}s ` +
        `(blend=${session.environmentBlendMode}, ` +
        `renderState.layers exposed=${(session.renderState.layers !== undefined)})`);
      if (path === 'classic') hideRenderStateLayers(session);
      renderer.xr.setFramebufferScaleFactor(XR_FRAMEBUFFER_SCALE); // BEFORE setSession
      await renderer.xr.setSession(session);
      logger.info(TAG, 'three.js attached the session — presenting now');
    } catch (e) {
      logger.error(TAG, `SESSION FAILED after ` +
        `${((performance.now() - t0) / 1000).toFixed(2)}s:`, e);
      if (statusEl) statusEl.innerHTML += `<br/>XR session error: ${String(e)}`;
    }
  });

  // ---- availability -------------------------------------------------------
  const xrNav = navigator as Navigator & {
    xr?: { isSessionSupported(mode: string): Promise<boolean> };
  };
  if (!xrNav.xr) {
    logger.warn(TAG, 'navigator.xr missing — WebXR not available in this browser');
    if (statusEl) statusEl.innerHTML += '<br/>WebXR: not available';
    return { noteXrFrame: () => undefined, stats };
  }
  xrNav.xr.isSessionSupported('immersive-vr').then((supported) => {
    logger.info(TAG, `isSessionSupported immersive-vr=${supported} ` +
      `(layer path: ${path})`);
    if (supported) btn.style.display = 'block';
  }).catch((e) => logger.warn(TAG, 'isSessionSupported rejected:', e));

  return {
    noteXrFrame() {
      if (!renderer.xr.isPresenting) return;
      if (firstFrameSeconds === null) {
        firstFrameSeconds = (performance.now() - sessionStartAt) / 1000;
        logger.info(TAG, `first XR frame rendered after ` +
          `${firstFrameSeconds.toFixed(2)}s ✓`);
        if (watchdogTimer) clearTimeout(watchdogTimer);
      }
      frames++;
    },
    stats,
  };
}