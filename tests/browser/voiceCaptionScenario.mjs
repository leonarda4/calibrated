/** Real supplied-speech/HUD wiring with local stubs; no immersive session. */
export async function runVoiceCaptionScenario(page) {
  const isolated = await page.context().newPage();
  isolated.setDefaultTimeout(15000);
  try {
    await isolated.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await isolated.goto(new URL('/', page.url()).href, { waitUntil: 'domcontentloaded' });
    return await isolated.evaluate(async () => {
      const [THREE, { setupExperience }, { GAMEPLAY_SPEECH }] = await Promise.all([
        import('/node_modules/.vite/deps/three.js'),
        import('/src/experience/setupExperience.ts'),
        import('/src/audio/gameplayAudioConfig.ts'),
      ]);
      const ensure = (condition, message) => {
        if (!condition) throw new Error(`Headset caption regression: ${message}`);
      };
      const waitFor = async (condition, message) => {
        for (let attempt = 0; attempt < 40; attempt++) {
          if (condition()) return;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        ensure(false, message);
      };
      const cueSpeech = { purpose: 'findBox', badge: 'stepOnBox', congratulations: 'turned', reversed: 'turned',
        scenarioWelcome: 'welcome', scenarioBox: 'stepOnBox' };
      const sources = [];
      class AudioNode {
        gain = { value: 0, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} };
        pan = { value: 0 };
        playbackRate = { value: 1 };
        stopped = false;
        ended = false;
        connect(next) { return next; }
        disconnect() {}
        start() { sources.push(this); }
        stop() { this.stopped = true; }
        finish() { this.ended = true; this.onended?.(); }
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
        ensure(/^\/audio\/SoundFX\/[a-zA-Z0-9 ]+\.wav$/.test(String(path)), 'attempted a generated/external audio request');
        requests++;
        return String(path).endsWith('/TryToStepOnTheBox.wav')
          ? new Response('<html>clip missing</html>', { headers: { 'content-type': 'text/html' } })
          : new Response(new Uint8Array(100), { headers: { 'content-type': 'audio/wav' } });
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
      const expectSpeechTranscriptOnly = speech => {
        ensure(transcript() === GAMEPLAY_SPEECH[speech].caption, `${speech}: PC supplied-speech transcript missing`);
        ensure(!camera.getObjectByName('experience-captions'), `${speech}: old narrative HUD still exists`);
        ensure(!camera.children.some(child => child.visible), `${speech}: visible text/HUD attached to the headset camera`);
      };
      const expectTranscriptOnly = cue => expectSpeechTranscriptOnly(cueSpeech[cue]);
      try {
        experience.voices.setMuted(true);
        for (const cue of Object.keys(cueSpeech)) {
          await experience.voices.play(cue);
          expectTranscriptOnly(cue);
        }
        for (const speech of ['sitOnBox', 'cleanRoom']) {
          experience.gameplayAudio.speech(speech);
          expectSpeechTranscriptOnly(speech);
        }
        const beforeSeatRequest = transcript();
        await experience.voices.play('scenarioSeat');
        const seatRequest = experience.secondBoxPrompts.snapshot();
        ensure(seatRequest.waitingForSeat && !seatRequest.seatSent && seatRequest.classroomAt === null,
          'seat cue did not defer its instruction until the actual settled appearance');
        ensure(transcript() === beforeSeatRequest && sources.length === 0 && requests === 0,
          'requesting the seat cue immediately narrated before the second box settled');
        experience.secondBoxPrompts.reset();
        ensure(requests === 0 && sources.length === 0, 'muted cues attempted audio');
        experience.voices.setMuted(false);
        await experience.voices.play('purpose');
        expectTranscriptOnly('purpose');
        await waitFor(() => /unavailable/i.test(status()), 'unsupported audio was not reported on PC');
        for (const speech of ['sitOnBox', 'cleanRoom']) {
          experience.gameplayAudio.speech(speech);
          await waitFor(() => transcript() === GAMEPLAY_SPEECH[speech].caption && /unavailable/i.test(status()),
            `${speech}: unavailable audio lost its PC transcript/status`);
          expectSpeechTranscriptOnly(speech);
        }
        ensure(requests === 0 && sources.length === 0, 'unavailable supplied speech attempted playback');

        Object.defineProperty(globalThis, 'AudioContext', { value: AudioContextStub, configurable: true });
        await experience.voices.play('badge');
        await waitFor(() => /ENABLE AUDIO/.test(status()), 'blocked audio was not held for a user gesture');
        expectTranscriptOnly('badge');
        ensure(requests === 0, 'locked audio attempted clip downloads before a user gesture');

        await experience.voices.unlock();
        ensure(audio.state === 'running', 'stub audio did not unlock');
        await experience.voices.play('badge');
        expectTranscriptOnly('badge');
        await waitFor(() => /file unavailable/i.test(status()), 'missing supplied speech was not reported on PC');
        ensure(sources.length === 0, 'missing supplied speech scheduled a fallback or generated layer');

        await experience.voices.play('purpose');
        await waitFor(() => sources.length === 1, 'first supplied speech did not schedule');
        expectTranscriptOnly('purpose');
        await experience.voices.play('congratulations');
        await experience.voices.play('reversed');
        ensure(sources.length === 1, 'later supplied speech cut off the current line instead of queuing');
        expectTranscriptOnly('purpose');
        sources[0].finish();
        await waitFor(() => sources.length === 2, 'second queued speech did not schedule after the first ended');
        expectTranscriptOnly('congratulations');
        sources[1].finish();
        await waitFor(() => sources.length === 3, 'third queued speech did not schedule after the second ended');
        expectTranscriptOnly('reversed');
        const captionBeforeTurn = transcript();
        await experience.voices.play('scenarioTurn');
        ensure(transcript() === captionBeforeTurn && sources.length === 3,
          'the turn-start identity incorrectly narrated before actual turn completion');
        ensure(/playing/i.test(status()), 'successful audio was not reported on PC');

        experience.invalidate('Explicit test interruption.');
        ensure(camera.getObjectByName('experience-stop')?.visible, 'explicit interruption lost its headset recovery cue');
        ensure(transcript() === '' && sources.every(source => source.stopped || source.ended), 'STOP retained a narrative transcript or scheduled audio');
        experience.prepareForCalibration();
        ensure(!camera.children.some(child => child.visible), 'recovery restored narrative text');
        await experience.voices.play('reversed');
        await waitFor(() => sources.length === 4, 'fresh recovery speech did not schedule');
        expectTranscriptOnly('reversed');
        experience.voices.stop();
        ensure(transcript() === '' && !camera.children.some(child => child.visible), 'audio stop revived a headset caption');
        return {
          passed: true,
          evidence: 'Actual setupExperience/createGameplayAudio, synthetic presenting flag and stubbed supplied WAV audio; no headset result',
          checks: ['all supplied-speech transcripts stay on PC', 'muted audio', 'unsupported audio', 'gesture-blocked audio',
            'sit and clean-room transcripts remain PC-only while muted/unavailable',
            'seat cue requests an instruction without narrating before the settled appearance',
            'missing supplied file has no generated/fallback speech', 'single-layer supplied speech queues to actual source end',
            'turn-start cue waits for actual completion narration',
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
