/** Exercise the installed Three.js WebXRManager with fake XR objects only.
 * The real manager must pass alpha:false to its classic layer constructor.
 */
export async function runOpaqueLayerScenario(parentPage) {
  const page = await parentPage.context().newPage();
  try {
    await page.route('**/src/main.ts', route => route.fulfill({status:200, contentType:'text/javascript', body:''}));
    await page.goto(new URL('/?xrLayers=0', parentPage.url()).href, {waitUntil:'domcontentloaded'});
    return await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const ensure = (value, reason) => { if (!value) throw new Error(`Opaque XR layer: ${reason}`); };
      const saved = [['xr',navigator],['XRSession',window],['XRWebGLLayer',window]]
        .map(([key,scope]) => ({key,scope,descriptor:Object.getOwnPropertyDescriptor(scope,key)}));
      const layers = [], sessions = [], framebuffers = [];
      let frameId = 0, compatibilityCalls = 0, rig;
      class Session extends THREE.EventDispatcher {
        constructor() {
          super(); this.environmentBlendMode = 'opaque'; this.visibilityState = 'visible';
          this.enabledFeatures = ['local-floor','hand-tracking']; this.inputSources = [];
          this.state = {depthNear:.1,depthFar:500,layers:['must-use-classic']}; this.ended = false;
        }
        get renderState() { return this.state; }
        updateRenderState(update) { Object.assign(this.state,update); }
        async requestReferenceSpace(type) {
          ensure(type === 'local-floor','reference space changed'); return new THREE.EventDispatcher();
        }
        requestAnimationFrame() { return ++frameId; } // Never calls a native XR frame.
        cancelAnimationFrame() {}
        async end() { if (!this.ended) { this.ended = true; this.dispatchEvent({type:'end'}); } }
      }
      class Layer {
        constructor(session,context,options) {
          ensure(window.XRWebGLLayer === Layer,'constructor was not restored before native construction');
          this.framebufferWidth = 192; this.framebufferHeight = 128; this.fixedFoveation = 0;
          this.ignoreDepthValues = true; this.framebuffer = context.createFramebuffer();
          framebuffers.push(this.framebuffer); layers.push({options:{...options},session});
        }
        getViewport() { return {x:0,y:0,width:192,height:128}; }
      }
      const xrSystem = Object.assign(new EventTarget(), {
        isSessionSupported: async mode => mode === 'immersive-vr',
        requestSession: async mode => {
          ensure(mode === 'immersive-vr','wrong session mode');
          const session = new Session(); sessions.push(session); return session;
        },
      });
      Object.defineProperty(navigator,'xr',{configurable:true,value:xrSystem});
      Object.defineProperty(window,'XRSession',{configurable:true,value:Session});
      Object.defineProperty(window,'XRWebGLLayer',{configurable:true,writable:true,value:Layer});
      try {
        const [{createViewerRig},{setupEnterVr}] = await Promise.all([
          import('/src/viewer/splatViewer.ts'), import('/src/xr/enterVR.ts'),
        ]);
        rig = createViewerRig();
        // Keep any compatibility continuation local; never ask the real runtime.
        rig.renderer.getContext().makeXRCompatible = async () => { compatibilityCalls++; await Promise.resolve(); };
        const vr = setupEnterVr(rig.renderer);
        for (let i = 0; i < 2; i++) {
          ensure(await vr.start(),'real Three.js manager failed synthetic opaque attachment');
          ensure(rig.renderer.xr.isPresenting,'manager never entered its synthetic presenting state');
          ensure(rig.renderer.xr.getBaseLayer() instanceof Layer,'classic layer was not used');
          ensure(layers[i].options.alpha === false,'pinned manager created an alpha-capable layer');
          ensure(layers[i].options.framebufferScaleFactor === 1 && layers[i].options.antialias === false,
            'opaque construction changed the framebuffer quality contract');
          ensure(window.XRWebGLLayer === Layer,'global constructor leaked after attachment');
          vr.noteXrFrame(); await sessions[i].end();
          ensure(!rig.renderer.xr.isPresenting,'session end failed to release the real manager');
        }
        return {syntheticOnly:true, realThreeWebXrManager:true, sourceAlpha:false,
          classicLayerConstructions:layers.length, compatibilityCalls,
          reentryPassed:true, nativeConstructorRestored:true, hardwareSession:false};
      } finally {
        for (const session of sessions) await session.end();
        if (rig) {
          for (const framebuffer of framebuffers) rig.renderer.getContext().deleteFramebuffer(framebuffer);
          rig.renderer.dispose();
        }
        for (const {key,scope,descriptor} of saved) {
          if (descriptor) Object.defineProperty(scope,key,descriptor); else delete scope[key];
        }
      }
    });
  } finally { await page.close(); }
}
