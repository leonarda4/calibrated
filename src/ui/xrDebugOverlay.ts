// src/ui: optional on-screen XR diagnostics, enabled with ?xrDebug=1.
// Shows the GPU, the active layer path, frame counts and the watchdog state
// on the flat page (PC operator view) — the DOM is not visible inside the
// immersive session, but the history persists after exiting.

export interface XrDebugOverlay {
  update(text: string): void;
}

export function createXrDebugOverlay(): XrDebugOverlay | null {
  const enabled = new URLSearchParams(window.location.search).get('xrDebug') === '1';
  if (!enabled) return null;
  const el = document.createElement('div');
  el.id = 'xr-debug';
  Object.assign(el.style, {
    position: 'fixed', top: '8px', right: '8px', zIndex: '30',
    background: 'rgba(16,16,20,0.85)', border: '1px solid #444', borderRadius: '8px',
    padding: '8px 10px', fontFamily: 'monospace', fontSize: '11px', color: '#6fd08c',
    whiteSpace: 'pre', pointerEvents: 'none',
  });
  document.body.appendChild(el);
  return {
    update(text: string) { el.textContent = text; },
  };
}

/** GPU renderer string from the WebGL context (unmasked when available). */
export function gpuRendererString(gl: WebGL2RenderingContext): string {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const value = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return String(value);
  } catch {
    return 'unknown GPU';
  }
}