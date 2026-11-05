import assert from 'node:assert/strict';
import path from 'node:path';

/** Native silent audio plus synthetic bounded-floor frames; never an immersive session. */
export async function runBoundaryVoiceScenario(parentPage, output) {
  const page = await parentPage.context().newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/src/main.ts', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(new URL('/', parentPage.url()).href, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const [THREE, { setupDesktopBoundary }, { createGameplayAudio }] = await Promise.all([
        import('/node_modules/.vite/deps/three.js'), import('/src/experience/setupDesktopBoundary.ts'), import('/src/audio/gameplayAudio.ts'),
      ]);
      document.body.replaceChildren();
      const originalContext = Object.getOwnPropertyDescriptor(window, 'AudioContext'), originalFetch = window.fetch;
      const NativeContext = window.AudioContext, inputPaths = new WeakMap(), bufferPaths = new WeakMap();
      const sources = [], contexts = [], requests = [], decoded = new Map();
      class SilentContext {
        constructor() {
          const audio = new NativeContext(), sink = audio.createGain();
          sink.gain.value = 0; sink.connect(audio.destination);
          Object.defineProperty(audio, 'destination', { configurable: true, value: sink });
          const decode = audio.decodeAudioData.bind(audio), create = audio.createBufferSource.bind(audio);
          audio.decodeAudioData = async bytes => {
            const buffer = await decode(bytes), file = inputPaths.get(bytes);
            bufferPaths.set(buffer, file); decoded.set(file, buffer.duration); return buffer;
          };
          audio.createBufferSource = () => {
            const source = create(), start = source.start.bind(source), stop = source.stop.bind(source);
            const record = { path: null, stopped: false };
            source.start = (...args) => { record.path = bufferPaths.get(source.buffer); sources.push(record); return start(...args); };
            source.stop = (...args) => { record.stopped = true; return stop(...args); };
            return source;
          };
          contexts.push({ audio, sink }); return audio;
        }
      }
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: SilentContext });
      window.fetch = async (input, init) => {
        const response = await originalFetch.call(window, input, init), read = response.arrayBuffer.bind(response);
        const url = new URL(typeof input === 'string' ? input : input.url, location.href), file = decodeURIComponent(url.pathname);
        requests.push(file);
        response.arrayBuffer = async () => { const bytes = await read(); inputPaths.set(bytes, file); return bytes; };
        return response;
      };
      const ensure = (condition, message) => { if (!condition) throw Error(`Boundary voice regression: ${message}`); };
      const reference = new THREE.EventDispatcher(), bounded = new THREE.EventDispatcher(), xr = new THREE.EventDispatcher();
      bounded.boundsGeometry = [[-2,-2],[2,-2],[2,2],[-2,2]].map(([x,z]) => ({ x,y:0,z,w:1 }));
      const session = new THREE.EventDispatcher(); session.visibilityState = 'visible';
      let available = true, poseValid = true, emulated = false, enabled = true, time = 0;
      session.requestReferenceSpace = async () => { if (!available) throw Error('unsupported'); return bounded; };
      Object.assign(xr, { isPresenting: true, getSession: () => session, getReferenceSpace: () => reference });
      const matrix = new THREE.Matrix4().makeRotationY(.63).setPosition(3,0,-4), head = new THREE.Vector3();
      const frame = { getViewerPose: () => poseValid ? { emulatedPosition: emulated, transform: { position: head } } : null,
        getPose: () => ({ transform: { matrix: matrix.toArray() }, emulatedPosition: false }) };
      const engine = createGameplayAudio(), scene = new THREE.Scene(), scan = new THREE.Group(); scene.add(scan);
      let accepted = 0;
      const boundary = setupDesktopBoundary({ xr }, scene, {
        onWarning: () => { const played = engine.warnDanger(); if (played) accepted++; return played; },
        onWarningCancelled: () => engine.cancelDangerWarning(), isWarningEnabled: () => enabled && !engine.snapshot().muted,
      });
      const step = (x, z = 0, dt = .1) => { time += dt; head.set(x,1.65,z).applyMatrix4(matrix); boundary.update(frame,time); };
      const button = document.createElement('button'); button.id = 'boundary-voice-enable'; button.textContent = 'Enable silent audio check';
      let ready = false;
      button.onclick = () => { void engine.unlock().then(async ok => { if (ok) { await engine.preload(); ready = true; } }); };
      document.body.append(button);
      window.__boundaryVoice = { engine, boundary, scene, scan, xr, reference, bounded, session, step, ensure,
        sources, contexts, requests, decoded, originalContext, originalFetch,
        ready: () => ready, accepted: () => accepted, time: () => time,
        pose: (valid, fake = false) => { poseValid = valid; emulated = fake; },
        available: value => { available = value; }, enabled: value => { enabled = value; } };
      await Promise.resolve(); await Promise.resolve(); step(1.4);
    });
    await page.locator('#boundary-voice-enable').click();
    await page.waitForFunction(() => window.__boundaryVoice.ready());
    await page.evaluate(() => { const s = window.__boundaryVoice; s.engine.start(0); s.engine.speech('welcome'); });
    await page.waitForFunction(() => window.__boundaryVoice.engine.snapshot().currentMusic?.endsWith('Ambience_1.wav'));
    await page.waitForFunction(() => window.__boundaryVoice.sources.some(s => s.path?.endsWith('Welcome To The Hallway.wav')));
    const opening = await page.evaluate(() => {
      const s = window.__boundaryVoice;
      s.engine.speech('cleanRoom');
      s.boundary.setRuntimeVisible(false);
      s.boundary.configureManual({ centerX: 99,centerZ: 99,width: 1,depth: 1,floorY: 0,yawDegrees: 45 });
      s.boundary.setManualVisible(true);
      s.step(1.45); s.ensure(s.accepted() === 0, 'Warning fired before half-metre threshold');
      s.step(1.5); s.ensure(s.accepted() === 1, 'Actual runtime-head approach failed at half a metre');
      s.ensure(Math.abs(s.boundary.snapshot().warning.distanceMetres - .5) < 1e-8, 'Calibrated yaw/origin changed physical clearance');
      for (let i = 0; i < 20; i++) s.step(1.5);
      s.scan.rotation.set(.8,Math.PI,0); s.scan.position.set(4,2,-8); s.scan.updateMatrixWorld(true); s.step(1.5);
      s.ensure(s.accepted() === 1, 'Stationary head or visual world transform replayed a boundary warning');
      s.ensure(!s.scene.getObjectByName('desktop-movement-boundaries').visible, 'Voice enabled a world outline');
      return { thresholdMetres: s.boundary.snapshot().warning.distanceMetres, runtimeOutlineHidden: true,
        worldTransformDoesNotAffectWarning: true, physicalFrameYaw: .63 };
    });
    await page.waitForFunction(() => window.__boundaryVoice.sources.some(s => s.path?.endsWith('DangerZone01.wav')));
    await page.evaluate(() => {
      const s = window.__boundaryVoice;
      s.ensure(s.sources.find(source => source.path.endsWith('Welcome To The Hallway.wav')).stopped, 'Warning waited behind ordinary speech');
      s.ensure(s.engine.snapshot().currentMusic?.endsWith('Ambience_1.wav'), 'Warning stopped the background');
      s.step(1.25);
      s.ensure(!s.engine.snapshot().dangerPlaying, 'Retreat retained boundary speech');
      s.step(1.4); s.step(1.5); s.ensure(s.accepted() === 1, 'Cooldown did not suppress fast re-entry');
      while (s.time() < 9) s.step(1.5,0,.25);
      s.ensure(s.accepted() === 1, 'Stationary cooldown expiry played a late warning');
      s.step(1.55); s.ensure(s.accepted() === 2, 'Fresh outward movement after cooldown failed');
    });
    await page.waitForFunction(() => window.__boundaryVoice.sources.some(s => s.path?.endsWith('DangerZone02.wav')));
    await page.evaluate(() => {
      const s = window.__boundaryVoice;
      s.pose(false); s.step(1.6);
      s.ensure(!s.engine.snapshot().dangerPlaying && !s.boundary.snapshot().runtime.live, 'Tracking loss retained live warning authority');
      s.pose(true,true); s.step(1.7); s.ensure(s.accepted() === 2, 'Emulated head pose warned');
      s.pose(true); s.step(1.4); s.step(1.5); s.ensure(s.accepted() === 3, 'Fresh tracked approach did not recover');
      s.reference.dispatchEvent({ type: 'reset' });
      s.ensure(!s.engine.snapshot().dangerPlaying, 'Reference reset failed to cancel pending warning synchronously');
      s.step(1.5); s.ensure(s.accepted() === 3, 'A reset jumped from an old motion baseline');
      s.engine.setMuted(true); s.step(1.6); s.ensure(s.accepted() === 3, 'Muted audio consumed a new prompt');
      s.engine.setMuted(false); s.step(1.6); s.step(1.65); s.ensure(s.accepted() === 4, 'New unmuted motion did not recover');
      s.xr.isPresenting = false; s.xr.dispatchEvent({ type: 'sessionend' }); s.step(1.7);
      s.ensure(!s.engine.snapshot().dangerPlaying, 'Session end retained warning playback');
      s.step(1.8); s.ensure(s.accepted() === 4, 'Desktop movement reused the last-session outline');
      s.xr.isPresenting = true; s.available(false); s.xr.dispatchEvent({ type: 'sessionstart' });
    });
    await page.evaluate(async () => {
      const s = window.__boundaryVoice;
      await Promise.resolve(); await Promise.resolve(); s.step(1.8);
      s.ensure(!s.boundary.snapshot().runtime.live && s.boundary.snapshot().manual.visible && s.accepted() === 4,
        'Unavailable headset outline used the enabled manual rectangle');
      s.ensure(document.getElementById('movement-boundary-voice-status').textContent.includes('no live headset outline'),
        'Unavailable boundary did not have truthful operator status');
    });
    // The map/status panel redraws at 10 Hz; capture its current unavailable
    // state rather than the last live label from the preceding synthetic frame.
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__boundaryVoice.step(1.8));
    await page.waitForFunction(() => document.getElementById('movement-boundary-status').textContent.includes('unavailable'));
    await page.screenshot({ path: path.join(output, 'boundary-voice-unavailable.png'), fullPage: true });
    const result = await page.evaluate(() => {
      const s = window.__boundaryVoice, files = [...s.decoded].filter(([file]) => /DangerZone/.test(file));
      s.ensure(files.length === 4 && s.contexts[0].sink.gain.value === 0, 'All real danger WAVs must decode into a silent native destination');
      s.ensure(s.sources.filter(source => /DangerZone/.test(source.path)).every(source => source.stopped), 'A cancelled danger source survived recovery');
      return { dangerFiles: files.map(([file,duration]) => ({ file,duration })), nativeDangerSources: s.sources.filter(source => /DangerZone/.test(source.path)).length,
        acceptedWarningRequests: s.accepted(), priorityInterruptsSpeech: true, musicContinues: true,
        cooldownAndRetreat: true, currentPhysicalPoseOnly: true, resetMuteSessionCancellation: true,
        noManualFallback: true, silentOutput: true, screenshot: 'boundary-voice-unavailable.png', syntheticXrOnly: true };
    });
    assert.deepEqual(errors, []); return { ...opening, ...result };
  } finally {
    await page.evaluate(async () => {
      const s = window.__boundaryVoice; if (!s) return;
      s.boundary.dispose(); s.engine.dispose();
      for (const { audio,sink } of s.contexts) { sink.disconnect(); if (audio.state !== 'closed') await audio.close().catch(() => {}); }
      window.fetch = s.originalFetch;
      if (s.originalContext) Object.defineProperty(window, 'AudioContext', s.originalContext);
      delete window.__boundaryVoice;
    }).catch(() => {});
    await page.close();
  }
}
