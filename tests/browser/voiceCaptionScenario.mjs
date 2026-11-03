/** Real voice/HUD wiring with local audio stubs; no immersive session or synthesis. */
export async function runVoiceCaptionScenario(page) {
  const isolated = await page.context().newPage();
  isolated.setDefaultTimeout(15000);
  try {
    await isolated.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await isolated.goto(new URL('/', page.url()).href, { waitUntil: 'domcontentloaded' });
    return await isolated.evaluate(async () => {
      const [THREE, { setupExperience }, { VOICE_CUES }] = await Promise.all([
        import('/node_modules/.vite/deps/three.js'),
        import('/src/experience/setupExperience.ts'),
        import('/src/audio/voiceCues.ts'),
      ]);
      const ensure = (condition, message) => {
        if (!condition) throw new Error(`Headset caption regression: ${message}`);
      };
      const sources = [];
      class AudioNode {
        gain = { value: 0, setValueAtTime() {} };
        pan = { value: 0 };
        playbackRate = { value: 1 };
        stopped = false;
        connect(next) { return next; }
        disconnect() {}
        start() { sources.push(this); }
        stop() { this.stopped = true; }
      }
      let audio;
      class AudioContextStub {
        state = 'suspended';
        currentTime = 10;
        destination = new AudioNode();
        constructor() { audio = this; }
        createGain() { return new AudioNode(); }
        createStereoPanner() { return new AudioNode(); }
        createBufferSource() { return new AudioNode(); }
        async decodeAudioData() { return { duration: 2 }; }
        async resume() { this.state = 'running'; }
        async close() {}
      }
      const savedContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
      const savedFetch = globalThis.fetch;
      let requests = 0;
      globalThis.fetch = async path => {
        ensure(/^\/audio\/generated\/[a-z-]+\.mp3$/.test(String(path)), 'attempted a non-local audio request');
        requests++;
        return String(path).endsWith('/badge-lead.mp3')
          ? new Response('<html>clip missing</html>', { headers: { 'content-type': 'text/html' } })
          : new Response(new Uint8Array(100), { headers: { 'content-type': 'audio/mpeg' } });
      };
      Object.defineProperty(globalThis, 'AudioContext', { value: undefined, configurable: true });
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      const scan = new THREE.Group();
      scene.add(camera, scan);
      const material = new THREE.ShaderMaterial({ uniforms: { uGlobalOpacity: { value: 1 } } });
      scan.viewer = { splatMesh: { material } };
      const xr = new THREE.EventDispatcher();
      Object.assign(xr, { isPresenting: true, getSession: () => null, getReferenceSpace: () => null });
      const experience = setupExperience({ xr, domElement: document.createElement('canvas') }, scene, camera, scan);
      const transcript = () => document.querySelector('#voice-panel [data-role="caption"]').textContent;
      const status = () => document.querySelector('#voice-panel [data-role="status"]').textContent;
      const expectTranscriptOnly = cue => {
        ensure(transcript() === VOICE_CUES[cue].caption, `${cue}: PC transcript missing`);
        ensure(!camera.getObjectByName('experience-captions'), `${cue}: old narrative HUD still exists`);
        ensure(!camera.children.some(child => child.visible), `${cue}: visible text/HUD attached to the headset camera`);
      };
      try {
        experience.voices.setMuted(true);
        for (const cue of Object.keys(VOICE_CUES)) {
          await experience.voices.play(cue);
          expectTranscriptOnly(cue);
        }
        ensure(requests === 0 && sources.length === 0, 'muted cues attempted audio');
        experience.voices.setMuted(false);
        await experience.voices.play('purpose');
        expectTranscriptOnly('purpose');
        ensure(/unavailable/i.test(status()), 'unsupported audio was not reported on PC');

        Object.defineProperty(globalThis, 'AudioContext', { value: AudioContextStub, configurable: true });
        await experience.voices.play('badge');
        expectTranscriptOnly('badge');
        ensure(/ENABLE VOICES/.test(status()) && requests === 0, 'blocked audio was not held for a user gesture');

        await experience.voices.unlock();
        ensure(audio.state === 'running', 'stub audio did not unlock');
        await experience.voices.play('badge');
        expectTranscriptOnly('badge');
        ensure(/missing/i.test(status()) && sources.length === 0, 'missing lead allowed whisper-only playback');

        for (const cue of ['purpose', 'congratulations', 'reversed']) {
          await experience.voices.play(cue);
          expectTranscriptOnly(cue);
        }
        ensure(sources.length === 9, 'successful local cues did not schedule all three voice layers');
        ensure(/playing/i.test(status()), 'successful audio was not reported on PC');

        experience.invalidate('Explicit test interruption.');
        ensure(camera.getObjectByName('experience-stop')?.visible, 'explicit interruption lost its headset recovery cue');
        ensure(transcript() === '' && sources.every(source => source.stopped), 'STOP retained a narrative transcript or scheduled audio');
        experience.prepareForCalibration();
        ensure(!camera.children.some(child => child.visible), 'recovery restored narrative text');
        await experience.voices.play('reversed');
        expectTranscriptOnly('reversed');
        experience.voices.stop();
        ensure(transcript() === '' && !camera.children.some(child => child.visible), 'audio stop revived a headset caption');
        return {
          passed: true,
          evidence: 'Actual setupExperience/createVoiceGuide, synthetic presenting flag and stubbed local audio; no headset result',
          checks: ['all four narrative transcripts stay on PC', 'muted audio', 'unsupported audio', 'gesture-blocked audio',
            'missing lead suppresses whisper-only playback', 'successful three-layer playback',
            'STOP retains headset recovery cue and cancels audio', 'recovery never restores narrative captions'],
          localClipRequests: requests,
          externalRequests: 0,
        };
      } finally {
        experience.dispose();
        material.dispose();
        globalThis.fetch = savedFetch;
        if (savedContext) Object.defineProperty(globalThis, 'AudioContext', savedContext);
        else Reflect.deleteProperty(globalThis, 'AudioContext');
      }
    });
  } finally { await isolated.close(); }
}
