import { fileURLToPath } from 'node:url';

/** Actual session-launch orchestration with a detached renderer and a fake XRSystem.
 * No immersive request reaches the browser/runtime; this is synthetic regression evidence.
 */
export async function runSessionStartScenario(page) {
  const isolated = await page.context().newPage();
  isolated.setDefaultTimeout(15000);
  try {
    await isolated.route('**/src/main.ts', route => route.fulfill({
      status: 200, contentType: 'text/javascript', body: '',
    }));
    await isolated.goto(new URL('/?xrLayers=0', page.url()).href, { waitUntil: 'domcontentloaded' });
    const result = await isolated.evaluate(async () => {
      const [THREE, { setupEnterVr }] = await Promise.all([
        import('/node_modules/.vite/deps/three.js'), import('/src/xr/enterVR.ts'),
      ]);
      const ensure = (condition, message) => {
        if (!condition) throw new Error(`Session-start regression: ${message}`);
      };
      const xrDescriptor = Object.getOwnPropertyDescriptor(navigator, 'xr');
      const sessionDescriptor = Object.getOwnPropertyDescriptor(window, 'XRSession');
      const xr = new THREE.EventDispatcher();
      const head = new THREE.PerspectiveCamera();
      head.position.y = 1.65;
      let activeSession = null;
      let pendingRequest = null;
      let startReturned = false;
      let requests = 0;
      let failAttachment = false;
      const settings = [];
      const statuses = [];
      const attached = [];
      class FakeSession extends THREE.EventDispatcher {
        constructor() {
          super();
          this.environmentBlendMode = 'opaque';
          this.enabledFeatures = ['local-floor', 'hand-tracking'];
          this.state = { layers: ['synthetic-projection-layer'], baseLayer: null };
          this.ended = false;
        }
        get renderState() { return this.state; }
        async end() {
          if (this.ended) return;
          this.ended = true;
          if (activeSession === this) {
            activeSession = null;
            xr.isPresenting = false;
            xr.dispatchEvent({ type: 'sessionend' });
          }
        }
      }
      const fakeXrSystem = {
        async isSessionSupported(mode) {
          ensure(mode === 'immersive-vr', 'availability checked the wrong session mode');
          return true;
        },
        requestSession(mode, options) {
          ensure(!startReturned, 'requestSession ran after start() returned; user activation may have expired');
          ensure(mode === 'immersive-vr', 'start requested a different session mode');
          ensure(!pendingRequest, 'another immersive request was already pending');
          requests++;
          settings.push(structuredClone(options));
          return new Promise((resolve, reject) => { pendingRequest = { resolve, reject }; });
        },
      };
      Object.assign(xr, {
        isPresenting: false,
        getSession: () => activeSession,
        getCamera: () => head,
        getBaseLayer: () => ({ constructor: { name: 'XRWebGLLayer' } }),
        setReferenceSpaceType: type => ensure(type === 'local-floor', 'floor reference contract changed'),
        setFramebufferScaleFactor: value => attached.push({ type: 'scale', value }),
        async setSession(session) {
          ensure(attached.at(-1)?.type === 'scale', 'framebuffer scale was not set before session attachment');
          if (failAttachment) throw new Error('Synthetic renderer attachment refusal');
          attached.push({ type: 'session' });
          ensure(session.renderState.layers === undefined, 'classic session still exposed projection layers');
          activeSession = session;
          xr.isPresenting = true;
          xr.dispatchEvent({ type: 'sessionstart' });
        },
      });
      Object.defineProperty(navigator, 'xr', { configurable: true, value: fakeXrSystem });
      Object.defineProperty(window, 'XRSession', { configurable: true, value: FakeSession });
      let enterVr;
      try {
        const scanStatus = document.getElementById('status');
        scanStatus.textContent = 'loaded: synthetic hallway.ply';
        const originalScanLine = scanStatus.innerHTML;
        enterVr = setupEnterVr({ xr }, text => statuses.push(text));
        await Promise.resolve();
        const vrButton = [...document.querySelectorAll('button')].find(button => button.textContent === 'Enter VR (WebXR)');
        const setupButton = document.getElementById('calib-start');
        ensure(vrButton && setupButton, 'session/setup controls were not available');
        const xrStatus = document.getElementById('xr-session-status');
        ensure(xrStatus?.parentElement === document.getElementById('app') && xrStatus.getAttribute('aria-live') === 'polite',
          'XR errors did not have a dedicated accessible status surface');
        ensure(vrButton.style.display === 'block', 'supported headset did not expose the VR button');
        const begin = () => {
          startReturned = false;
          const result = enterVr.start();
          startReturned = true;
          ensure(xrStatus.hidden && xrStatus.textContent === 'Technical details',
            'new start retained the previous request error');
          return result;
        };
        const resolveSession = () => {
          ensure(pendingRequest, 'no queued request to resolve');
          const session = new FakeSession();
          const request = pendingRequest; pendingRequest = null;
          request.resolve(session);
          return session;
        };
        const rejectSession = name => {
          ensure(pendingRequest, 'no queued request to reject');
          const request = pendingRequest; pendingRequest = null;
          request.reject(new DOMException('Synthetic runtime refusal', name));
        };
        const expectReleasedControls = () => {
          ensure(!enterVr.stats().pending && !vrButton.disabled && !setupButton.disabled,
            'completed request retained pending state or disabled controls');
        };

        const firstStart = begin();
        ensure(requests === 1 && enterVr.stats().pending, 'start did not synchronously request XR and set pending');
        ensure(vrButton.disabled && setupButton.disabled, 'pending start allowed duplicate PC actions');
        ensure(await enterVr.start() === false && requests === 1, 'concurrent start requested a second session');
        ensure(settings[0].optionalFeatures.includes('hand-tracking'), 'VR session disabled later hand tracking');
        ensure(!settings[0].optionalFeatures.includes('layers'), 'classic mode requested projection layers');
        ensure(statuses.at(-1)?.includes('keep the headset on') && statuses.at(-1)?.includes('CALIBRATE'),
          'VR startup did not explain the separate headset-on calibration action');
        const firstSession = resolveSession();
        ensure(await firstStart === true && enterVr.stats().presenting, 'resolved session did not present');
        ensure(xrStatus.hidden, 'successful start left an XR error visible');
        enterVr.noteXrFrame();
        ensure(enterVr.stats().frames === 1 && enterVr.stats().firstFrameSeconds !== null,
          'first-frame accounting failed after setup launch');
        expectReleasedControls();
        ensure(await enterVr.start() === true && requests === 1, 'start during an active session created another request');
        await firstSession.end();
        ensure(!enterVr.stats().presenting && vrButton.textContent === 'Resume VR',
          'session end failed to expose explicit re-entry');

        const secondStart = begin();
        ensure(requests === 2, 'an ended session prevented a fresh manual start');
        const secondSession = resolveSession();
        ensure(await secondStart === true, 'fresh manual re-entry failed');
        enterVr.noteXrFrame();
        ensure(enterVr.stats().frames === 1, 're-entry retained previous-session frame count');
        await secondSession.end();

        for (const errorName of ['NotSupportedError', 'NotSupportedError', 'SecurityError']) {
          const failedStart = begin();
          ensure(vrButton.disabled && setupButton.disabled, `${errorName}: controls were not disabled while pending`);
          rejectSession(errorName);
          ensure(await failedStart === false, `${errorName}: failed session reported success`);
          expectReleasedControls();
          const recovery = statuses.at(-1);
          ensure(recovery.includes('Resume VR') && recovery.includes(errorName),
            `${errorName}: recovery omitted its action or technical detail`);
          ensure(errorName === 'NotSupportedError' ? recovery.includes('Steam Link') : recovery.includes('SteamVR Desktop'),
            `${errorName}: recovery did not name the relevant connection/click action`);
          ensure(!xrStatus.hidden && xrStatus.querySelector('details')?.textContent.includes(`requestSession: ${errorName}: Synthetic runtime refusal`),
            `${errorName}: exact browser error and request stage were not accessible`);
          ensure((xrStatus.textContent.match(new RegExp(errorName, 'g')) ?? []).length === 1,
            `${errorName}: repeated errors accumulated in the XR status`);
          ensure(document.querySelectorAll('#xr-session-status').length === 1 && scanStatus.innerHTML === originalScanLine,
            'XR retry duplicated the status surface or changed the scan-loading line');
          ensure(xrStatus.style.maxHeight === '170px' && xrStatus.style.overflow === 'auto',
            'XR error display was not vertically bounded');
          ensure(vrButton.textContent === 'Resume VR', `${errorName}: VR button did not offer retry`);
        }

        failAttachment = true;
        const failedAttach = begin();
        const unattachedSession = resolveSession();
        ensure(await failedAttach === false && unattachedSession.ended,
          'renderer failure did not close the session it had opened');
        ensure(statuses.at(-1).includes('could not attach its renderer') &&
          xrStatus.querySelector('details').textContent.includes('renderer attachment: Error: Synthetic renderer attachment refusal'),
          'renderer failure was reported as a headset connection/request failure');
        expectReleasedControls();
        ensure(scanStatus.innerHTML === originalScanLine, 'renderer failure changed the scan-loading status');
        failAttachment = false;
        const recoveredStart = begin();
        const recoveredSession = resolveSession();
        ensure(await recoveredStart === true && xrStatus.hidden, 'successful retry did not clear the previous renderer error');
        enterVr.noteXrFrame();
        await recoveredSession.end();
        ensure(settings.every(options => options.optionalFeatures.includes('hand-tracking') &&
          !options.optionalFeatures.includes('layers')), 'a retry changed the active runtime/hand feature contract');
        // Leave one expected, synthetic error for a bounded visual artifact.
        const previewFailure = begin();
        rejectSession('NotSupportedError');
        await previewFailure;
        return {
          passed: true,
          evidence: 'Actual setupEnterVr with fake XRSystem/session and detached renderer; no browser immersive request or hardware claim',
          checks: ['PC start requests immersive VR synchronously', 'pending start blocks duplicate launch',
            'hand tracking retained with classic layer path', 'successful attach clears pending and counts frames',
            'explicit re-entry after end', 'unsupported request has precise Chrome/SteamVR recovery',
            'activation failure has SteamVR Desktop recovery', 'failure reenables both controls',
            'repeated failures replace one bounded message and preserve scan status',
            'exact error remains accessible in technical details', 'renderer attachment errors are distinguished and cleaned up',
            'new start and successful retry clear the previous error'],
          requests, syntheticSessions: attached.filter(item => item.type === 'session').length,
          screenshot: '.check/xr-error-synthetic.png',
        };
      } finally {
        if (activeSession) await activeSession.end();
        if (xrDescriptor) Object.defineProperty(navigator, 'xr', xrDescriptor);
        else delete navigator.xr;
        if (sessionDescriptor) Object.defineProperty(window, 'XRSession', sessionDescriptor);
        else delete window.XRSession;
      }
    });
    await isolated.screenshot({ path: fileURLToPath(new URL('../../.check/xr-error-synthetic.png', import.meta.url)), fullPage: true });
    return result;
  } finally { await isolated.close(); }
}
