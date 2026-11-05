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
import { withOpaqueXrLayer } from './opaqueLayer';

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
  pending: boolean;
}

export interface EnterVr {
  /** Call directly from a PC/SteamVR Desktop click; retains user activation. */
  start(): Promise<boolean>;
  /** Call every animation-loop iteration while presenting (frame counting). */
  noteXrFrame(): void;
  stats(): EnterVrStats;
}

const NO_XR_FRAME_WARNING_SECONDS = 5;
const tmpVec = new THREE.Vector3();

export function setupEnterVr(renderer: THREE.WebGLRenderer, onStatus: (text: string) => void = () => {}): EnterVr {
  const appEl = document.getElementById('app');
  const path = resolveLayerPath();

  // Scan loading owns #status. XR retries replace this separate, bounded
  // message instead of appending another error to that scan-loading line.
  const xrStatus = document.createElement('div');
  xrStatus.id = 'xr-session-status';
  xrStatus.setAttribute('role', 'status');
  xrStatus.setAttribute('aria-live', 'polite');
  Object.assign(xrStatus.style, {
    maxWidth: 'min(620px, calc(100vw - 24px))', maxHeight: '170px', overflow: 'auto',
    boxSizing: 'border-box', padding: '8px 12px', background: 'rgba(45,18,23,.94)',
    color: '#ffd1d5', borderRadius: '6px', whiteSpace: 'normal', overflowWrap: 'anywhere',
    fontSize: '13px', lineHeight: '1.4', textAlign: 'left', pointerEvents: 'auto',
  });
  const xrMessage = document.createElement('p');
  Object.assign(xrMessage.style, { margin: '0', color: 'inherit' });
  const xrDetails = document.createElement('details');
  const xrDetailsTitle = document.createElement('summary');
  xrDetailsTitle.textContent = 'Technical details';
  xrDetailsTitle.style.cursor = 'pointer';
  const xrDetailText = document.createElement('pre');
  Object.assign(xrDetailText.style, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '6px 0 0' });
  xrDetails.append(xrDetailsTitle, xrDetailText);
  xrStatus.append(xrMessage, xrDetails);
  (appEl ?? document.body).append(xrStatus);
  const showXrStatus = (message = '', details = '') => {
    xrMessage.textContent = message;
    xrDetailText.textContent = details;
    xrDetails.hidden = !details;
    xrDetails.open = false;
    xrStatus.hidden = !message;
  };
  showXrStatus();

  let frames = 0;
  let firstFrameSeconds: number | null = null;
  let watchdogFired = false;
  let sessionStartAt = 0;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const stats = (): EnterVrStats => ({
    path, presenting: renderer.xr.isPresenting, frames, firstFrameSeconds, watchdogFired, pending,
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
    showXrStatus();
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
        logger.warn(TAG, `waiting for headset: no XR frame yet after ` +
          `${NO_XR_FRAME_WARNING_SECONDS}s — put it on and check Steam Link is connected`);
      }
    }, NO_XR_FRAME_WARNING_SECONDS * 1000);
  });

  renderer.xr.addEventListener('sessionend', () => {
    logger.info(TAG, 'SESSION ENDED');
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = null;
    btn.textContent = 'Resume VR';
    if (appEl) appEl.style.display = '';
  });

  // ---- click handler ------------------------------------------------------
  const start = async (): Promise<boolean> => {
    if (renderer.xr.getSession()) return true;
    if (pending) return false;
    pending = true;
    showXrStatus();
    btn.style.display = 'block';
    btn.textContent = 'Opening VR…';
    btn.disabled = true;
    const setupButton = document.getElementById('calib-start') as HTMLButtonElement | null;
    if (setupButton) setupButton.disabled = true;
    onStatus('OPENING VR — keep the headset on and wake both controllers. Once VR opens, press CALIBRATE or a controller trigger.');
    const t0 = performance.now();
    let requestedSession: XRSession | null = null;
    let failureStage = 'requestSession';
    try {
      const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
      if (!xr) throw new Error('WebXR not available on this device');
      // classic path: NO 'layers' in optionalFeatures (spec).
      const optionalFeatures = path === 'layers'
        ? ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
        : ['local-floor', 'bounded-floor', 'hand-tracking'];
      logger.info(TAG, `requestSession path=${path} ` +
        `optionalFeatures=${optionalFeatures.join(',')}`);
      const session: XRSession = await xr.requestSession('immersive-vr', { optionalFeatures });
      requestedSession = session;
      failureStage = 'opaque VR validation';
      if (session.environmentBlendMode !== 'opaque') {
        throw new Error(`Opaque immersive VR is required; runtime returned ${session.environmentBlendMode}.`);
      }
      failureStage = 'renderer attachment';
      logger.info(TAG, `requestSession RESOLVED in ` +
        `${((performance.now() - t0) / 1000).toFixed(2)}s ` +
        `(blend=${session.environmentBlendMode}, ` +
        `renderState.layers exposed=${(session.renderState.layers !== undefined)})`);
      if (path === 'classic') hideRenderStateLayers(session);
      renderer.xr.setFramebufferScaleFactor(XR_FRAMEBUFFER_SCALE); // BEFORE setSession
      if (path === 'classic') {
        await withOpaqueXrLayer(session, renderer.getContext(), () => renderer.xr.setSession(session));
      } else {
        await renderer.xr.setSession(session);
        const layer = renderer.xr.getBaseLayer();
        if (!layer || !('blendTextureSourceAlpha' in layer)) throw new Error('The projection layer cannot disable source alpha.');
        layer.blendTextureSourceAlpha = false;
      }
      logger.info(TAG, 'XR layer source alpha disabled; uncovered world pixels are opaque white');
      logger.info(TAG, 'three.js attached the session — presenting now');
      showXrStatus();
      return true;
    } catch (e) {
      logger.error(TAG, `SESSION FAILED during ${failureStage} after ` +
        `${((performance.now() - t0) / 1000).toFixed(2)}s:`, e);
      const errorName = e instanceof Error ? e.name : 'Error';
      const instruction = failureStage === 'opaque VR validation'
        ? 'This experience requires opaque VR. Select SteamVR as the active OpenXR runtime, then click Resume VR.'
        : failureStage === 'renderer attachment'
        ? 'VR opened, but the page could not attach its renderer. Keep SteamVR ready; restart Chrome, reopen this page and click Resume VR.'
        : errorName === 'NotSupportedError'
          ? 'Chrome could not open VR. Steam Link may still be connected. Once SteamVR is ready, restart Chrome and click Resume VR.'
          : errorName === 'SecurityError'
            ? 'Chrome needs a fresh click to open VR. In SteamVR Desktop, open Chrome and click Resume VR while wearing the headset.'
            : 'Chrome could not open VR. Check SteamVR is ready; restart Chrome, reopen this page and click Resume VR.';
      const details = `${failureStage}: ${String(e)}`;
      if (requestedSession) await requestedSession.end().catch(() => {});
      showXrStatus(instruction, details);
      onStatus(`${instruction}\n${details}`);
      return false;
    } finally {
      pending = false; btn.disabled = false;
      if (!renderer.xr.isPresenting) btn.textContent = 'Resume VR';
      if (setupButton) setupButton.disabled = false;
    }
  };
  btn.addEventListener('click', () => {
    const activeSession = renderer.xr.getSession();
    if (activeSession) { void activeSession.end(); return; }
    void start();
  });

  // ---- availability -------------------------------------------------------
  const xrNav = navigator as Navigator & {
    xr?: { isSessionSupported(mode: string): Promise<boolean> };
  };
  if (!xrNav.xr) {
    logger.warn(TAG, 'navigator.xr missing — WebXR not available in this browser');
    showXrStatus('This browser window does not expose WebXR. Open this page in desktop Chrome to start VR.');
    return { start, noteXrFrame: () => undefined, stats };
  }
  xrNav.xr.isSessionSupported('immersive-vr').then((supported) => {
    logger.info(TAG, `isSessionSupported immersive-vr=${supported} ` +
      `(layer path: ${path})`);
    if (supported) btn.style.display = 'block';
  }).catch((e) => logger.warn(TAG, 'isSessionSupported rejected:', e));

  return {
    start,
    noteXrFrame() {
      if (!renderer.xr.isPresenting) return;
      if (firstFrameSeconds === null) {
        firstFrameSeconds = (performance.now() - sessionStartAt) / 1000;
        watchdogFired = false;
        logger.info(TAG, `first XR frame rendered after ` +
          `${firstFrameSeconds.toFixed(2)}s ✓`);
        if (watchdogTimer) clearTimeout(watchdogTimer);
      }
      frames++;
    },
    stats,
  };
}
