import test from 'node:test';
import assert from 'node:assert/strict';
import { withOpaqueXrLayer } from '../src/xr/opaqueLayer.ts';

const scope = globalThis as unknown as { XRWebGLLayer: typeof XRWebGLLayer };
async function fixture(action: (session: XRSession, context: WebGL2RenderingContext, Layer: typeof XRWebGLLayer,
  calls: { session: unknown; context: unknown; options: XRWebGLLayerInit }[]) => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(scope, 'XRWebGLLayer');
  const calls: { session: unknown; context: unknown; options: XRWebGLLayerInit }[] = [];
  class Layer {
    constructor(session: unknown, context: unknown, options: XRWebGLLayerInit) {
      calls.push({session, context, options});
      if (options.stencil) throw new Error('synthetic constructor failure');
    }
  }
  Object.defineProperty(scope, 'XRWebGLLayer', {configurable:true, writable:true, enumerable:false, value:Layer});
  try { await action({} as XRSession, {} as WebGL2RenderingContext, Layer as unknown as typeof XRWebGLLayer, calls); }
  finally { if (original) Object.defineProperty(scope,'XRWebGLLayer',original); else Reflect.deleteProperty(scope,'XRWebGLLayer'); }
}

test('an asynchronous classic attachment disables alpha only for its exact session/context and restores the constructor', async () => fixture(async (session, context, Native, calls) => {
  const options = {alpha:true, antialias:false, depth:true, framebufferScaleFactor:1};
  const otherSession = {} as XRSession, otherContext = {} as WebGL2RenderingContext;
  await withOpaqueXrLayer(session,context,async () => {
    await Promise.resolve();
    new scope.XRWebGLLayer(otherSession,context,options);
    new scope.XRWebGLLayer(session,otherContext,options);
    new scope.XRWebGLLayer(session,context,options);
    assert.equal(scope.XRWebGLLayer,Native);
  });
  assert.equal(calls[0].options,options); assert.equal(calls[1].options,options);
  assert.deepEqual(calls[2].options,{...options,alpha:false}); assert.equal(options.alpha,true);
  assert.equal(scope.XRWebGLLayer,Native);
  assert.deepEqual(Object.getOwnPropertyDescriptor(scope,'XRWebGLLayer'),{configurable:true,writable:true,enumerable:false,value:Native});
}));

test('attachment and native construction failures restore the exact constructor without changing prototypes', async () => fixture(async (session,context,Native) => {
  const prototype = Native.prototype;
  await assert.rejects(withOpaqueXrLayer(session,context,async () => { throw new Error('attachment failed'); }),/attachment failed/);
  assert.equal(scope.XRWebGLLayer,Native);
  await assert.rejects(withOpaqueXrLayer(session,context,async () => {
    new scope.XRWebGLLayer(session,context,{alpha:true,stencil:true});
  }),/synthetic constructor failure/);
  assert.equal(scope.XRWebGLLayer,Native); assert.equal(Native.prototype,prototype);
}));

test('an attachment which never creates its own classic layer cannot report opaque success', async () => fixture(async (session,context,Native) => {
  await assert.rejects(withOpaqueXrLayer(session,context,async () => {}),/did not create/);
  assert.equal(scope.XRWebGLLayer,Native);
}));
