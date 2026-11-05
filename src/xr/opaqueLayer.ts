/** Three.js r180 hardcodes alpha:true when creating its classic XR layer.
 * Intercept only this session/context's construction, then restore the native
 * constructor before calling it. No prototype or installed dependency changes.
 */
export async function withOpaqueXrLayer(
  session: XRSession,
  context: WebGLRenderingContext | WebGL2RenderingContext,
  attach: () => Promise<void>,
): Promise<void> {
  const scope = globalThis as unknown as { XRWebGLLayer?: typeof XRWebGLLayer };
  const NativeLayer = scope.XRWebGLLayer;
  if (!NativeLayer) throw new Error('The opaque XRWebGLLayer API is unavailable.');
  const descriptor = Object.getOwnPropertyDescriptor(scope, 'XRWebGLLayer');
  let constructed = false;
  const restore = () => {
    if (scope.XRWebGLLayer !== scopedLayer) return;
    if (descriptor) Object.defineProperty(scope, 'XRWebGLLayer', descriptor);
    else delete scope.XRWebGLLayer;
  };
  const scopedLayer = new Proxy(NativeLayer, {
    construct(target, args, newTarget) {
      if (args[0] !== session || args[1] !== context) return Reflect.construct(target, args, newTarget);
      restore();
      const options: XRWebGLLayerInit = { ...args[2], alpha: false };
      const layer = Reflect.construct(target, [session, context, options], target);
      constructed = true;
      return layer;
    },
  });
  try {
    if (!Reflect.set(scope, 'XRWebGLLayer', scopedLayer)) throw new Error('Cannot configure an opaque XR layer.');
    // setSession may await makeXRCompatible before constructing the layer.
    await attach();
    if (!constructed) throw new Error('The renderer did not create the required opaque classic XR layer.');
  } finally {
    restore();
  }
}
