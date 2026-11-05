import assert from 'node:assert/strict';

/** Decode/schedule the real cached MP3s through native Web Audio, at zero output gain. */
export async function runVoiceRestartScenario(parentPage) {
  const page = await parentPage.context().newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.goto(new URL('/', parentPage.url()).href, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const [{ createVoiceGuide }, { SCENARIO_VOICE_CUES }] = await Promise.all([
        import('/src/audio/voiceGuide.ts'), import('/src/audio/voiceCues.ts'),
      ]);
      const ensure = (condition, message) => { if (!condition) throw new Error(`Real voice restart regression: ${message}`); };
      const originalContext = Object.getOwnPropertyDescriptor(window, 'AudioContext'), originalFetch = window.fetch;
      const NativeAudioContext = window.AudioContext;
      ensure(typeof NativeAudioContext === 'function', 'Native Web Audio is unavailable');
      const requests = new Map(), realFiles = new Map(), decoded = new Map(), bufferPaths = new WeakMap(), inputPaths = new WeakMap();
      const sources = [], contexts = [], statuses = [];
      let injected = false, holdRetry = false, releaseFetch = null, fetchGateReached = null, resumeCalls = 0;
      const state = { ensure, originalContext, originalFetch, requests, realFiles, decoded, sources, contexts, statuses,
        cues: SCENARIO_VOICE_CUES, ready: false, resumeCalls: () => resumeCalls,
        retryGate() {
          holdRetry = true;
          return new Promise(resolve => { fetchGateReached = resolve; });
        },
        releaseFetch: () => { releaseFetch?.(); releaseFetch = null; },
      };
      // These are genuine contexts/nodes/decoders. Only the destination exposed
      // to voiceGuide is a zero-gain sink connected to the real destination.
      class SilentNativeContext {
        constructor() {
          const audio = new NativeAudioContext(), destination = audio.destination;
          const silent = audio.createGain(); silent.gain.value = 0; silent.connect(destination);
          Object.defineProperty(audio, 'destination', { configurable: true, value: silent });
          const nativeCreate = audio.createBufferSource.bind(audio), nativeDecode = audio.decodeAudioData.bind(audio);
          const nativeResume = audio.resume.bind(audio);
          audio.resume = () => { resumeCalls++; return nativeResume(); };
          audio.decodeAudioData = async data => {
            const path = inputPaths.get(data);
            const buffer = await nativeDecode(data);
            ensure(buffer.length > 0 && buffer.duration > 0 && buffer.numberOfChannels > 0, 'Native decoder returned an empty buffer');
            bufferPaths.set(buffer, path);
            decoded.set(path, { frames: buffer.length, duration: buffer.duration, channels: buffer.numberOfChannels,
              sampleRate: buffer.sampleRate });
            return buffer;
          };
          audio.createBufferSource = () => {
            const source = nativeCreate(), start = source.start.bind(source), stop = source.stop.bind(source);
            const record = { id: sources.length + 1, path: null, startCalls: 0, stopped: false, ended: false };
            source.addEventListener('ended', () => { record.ended = true; });
            source.start = (...args) => {
              ensure(record.startCalls === 0, `Source ${record.id} was scheduled more than once`);
              ensure(source.buffer?.length > 0, 'An empty/non-native buffer was scheduled');
              record.path = bufferPaths.get(source.buffer);
              record.startCalls++; record.at = args[0];
              start(...args);
            };
            source.stop = (...args) => { record.stopped = true; stop(...args); };
            sources.push(record);
            return source;
          };
          contexts.push({ audio, silent });
          return audio;
        }
      }
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: SilentNativeContext });
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        ensure(url.origin === location.origin, 'Attempted to load external audio');
        if (!url.pathname.startsWith('/audio/generated/')) return originalFetch.call(window, input, init);
        const path = url.pathname, count = (requests.get(path) ?? 0) + 1;
        requests.set(path, count);
        let response;
        if (!injected && path === '/audio/generated/scenarioWelcome-lead.mp3') {
          injected = true;
          response = new Response(new Uint8Array([0, 1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
        } else {
          response = await originalFetch.call(window, input, init);
          ensure(response.ok && response.headers.get('content-type')?.startsWith('audio/'), `Missing local cached MP3: ${path}`);
          if (holdRetry && path === '/audio/generated/scenarioWelcome-lead.mp3') {
            holdRetry = false;
            const gate = new Promise(resolve => { releaseFetch = resolve; });
            fetchGateReached?.(); fetchGateReached = null;
            await gate;
          }
        }
        const arrayBuffer = response.arrayBuffer.bind(response);
        response.arrayBuffer = async () => {
          const bytes = await arrayBuffer(); inputPaths.set(bytes, path);
          if (bytes.byteLength > 4) realFiles.set(path, bytes.byteLength);
          return bytes;
        };
        return response;
      };
      state.guide = createVoiceGuide({ onStatus: text => statuses.push(text) });
      state.bounded = async (promise, label) => {
        let timer;
        try {
          return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} exceeded10seconds`)), 10000);
          })]);
        } finally { clearTimeout(timer); }
      };
      const button = document.createElement('button');
      button.id = 'voice-restart-unlock'; button.textContent = 'Enable silent native voice check';
      button.addEventListener('click', () => {
        void state.bounded(state.guide.unlock(), 'Audio gesture unlock').then(ready => {
          state.ready = ready; button.textContent = ready ? 'Silent audio ready' : 'Audio unavailable';
        }).catch(error => { state.unlockError = error.message; });
      });
      document.body.replaceChildren(button);
      window.__voiceRestart = state;
    });
    await page.locator('#voice-restart-unlock').click();
    await page.waitForFunction(() => window.__voiceRestart.ready || window.__voiceRestart.unlockError);
    const result = await page.evaluate(async () => {
      const s = window.__voiceRestart, { ensure, guide, bounded } = s;
      ensure(s.ready, s.unlockError ?? 'Actual gesture did not unlock native audio');
      ensure(s.contexts.length === 1 && s.contexts[0].silent.gain.value === 0, 'Native audio was not routed through zero gain');
      await bounded(guide.play('scenarioWelcome'), 'Initial transient decode');
      ensure(s.sources.length === 0, 'Failed lead decoding played supporting whispers alone');
      ensure(s.statuses.some(text => /lead voice clip missing/i.test(text)), 'Transient decode failure was not reported');
      const reached = s.retryGate(), retry = guide.play('scenarioWelcome');
      await bounded(reached, 'Retry local fetch gate');
      guide.stop(); s.releaseFetch();
      await bounded(retry, 'Cancelled retry decoding');
      ensure(s.sources.length === 0, 'A cancelled in-flight real decode scheduled old audio');
      await bounded(guide.play('scenarioWelcome'), 'Recovered local welcome');
      ensure(s.sources.length === 3 && s.sources.every(record => record.startCalls === 1),
        'A transient failed lead remained poisoned in the cache');
      guide.stop();
      ensure(s.requests.get('/audio/generated/scenarioWelcome-lead.mp3') === 2, 'The failed lead was not retried once');
      const games = [];
      let firstRequests = null;
      for (let game = 0; game < 2; game++) {
        const scheduled = [];
        for (const cue of s.cues) {
          const before = s.sources.length;
          await bounded(guide.play(cue), `Game${game + 1} ${cue}`);
          const created = s.sources.slice(before);
          ensure(created.length === 3 && created.every(record => record.startCalls === 1), `${cue} did not schedule its real lead and two layers once`);
          ensure(created[0].path === `/audio/generated/${cue}-lead.mp3`, `${cue} scheduled the wrong lead buffer`);
          scheduled.push({ cue, leadSourceId: created[0].id, layers: created.length });
        }
        const startedAt = performance.now(); guide.stop();
        ensure(performance.now() - startedAt < 1000, 'Stopping scheduled sources was not bounded');
        ensure(s.sources.every(record => record.stopped || record.ended), 'Restart left an earlier scheduled source active');
        const counts = JSON.stringify([...s.requests.entries()].sort());
        if (firstRequests === null) firstRequests = counts;
        else ensure(counts === firstRequests, 'The second complete game re-fetched successfully decoded cached clips');
        games.push(scheduled);
      }
      const audio = s.contexts[0].audio, previousResumes = s.resumeCalls();
      await bounded(audio.suspend(), 'Suspend unlocked native context');
      ensure(audio.state === 'suspended', 'Native context did not suspend');
      const previousSources = s.sources.length;
      await bounded(guide.play('scenarioWelcome'), 'Resume previously unlocked native context');
      ensure(audio.state === 'running' && s.resumeCalls() > previousResumes, 'Previously unlocked context was not resumed');
      ensure(s.sources.length === previousSources + 3, 'Resumed native context lost the next cue');
      guide.stop();
      const stoppedCount = s.sources.length;
      await Promise.resolve(); await Promise.resolve();
      ensure(s.sources.length === stoppedCount && s.sources.every(record => record.startCalls === 1 && (record.stopped || record.ended)),
        'Stopped or duplicate sources appeared after a restart');
      const leads = s.cues.map(cue => {
        const path = `/audio/generated/${cue}-lead.mp3`, decoded = s.decoded.get(path), bytes = s.realFiles.get(path);
        ensure(bytes > 4 && decoded?.frames > 0, `${cue} did not decode its real local MP3`);
        return { cue, bytes, ...decoded };
      });
      return { nativeWebAudio: true, outputGain: s.contexts[0].silent.gain.value, leads, games,
        sourceStarts: s.sources.length, sourceIdsUnique: new Set(s.sources.map(record => record.id)).size === s.sources.length,
        transientDecodeRecovered: true, staleRealDecodeSuppressed: true, successfulCacheReused: true,
        suspendedContextResumed: true, stoppedSourcesCancelled: true, noAudibilityClaim: true };
    });
    assert.equal(result.leads.length, 4); assert.equal(result.games.length, 2); assert.equal(result.outputGain, 0);
    assert.deepEqual(errors, []);
    return result;
  } finally {
    await page.evaluate(async () => {
      const s = window.__voiceRestart;
      if (!s) return;
      s.releaseFetch(); s.guide.dispose();
      for (const { audio, silent } of s.contexts) {
        silent.disconnect();
        if (audio.state !== 'closed') await audio.close().catch(() => {});
      }
      window.fetch = s.originalFetch;
      if (s.originalContext) Object.defineProperty(window, 'AudioContext', s.originalContext);
      else delete window.AudioContext;
      delete window.__voiceRestart;
    }).catch(() => {});
    await page.close();
  }
}
