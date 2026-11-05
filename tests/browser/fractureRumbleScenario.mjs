import assert from 'node:assert/strict';

/** Real local PCM decoding and shared-context scheduling, through a silent sink. */
export async function runFractureRumbleScenario(parentPage) {
  const page = await parentPage.context().newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.goto(new URL('/', parentPage.url()).href, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const [{ createGameplayAudio }, { createFractureRumble, FRACTURE_RUMBLE }] = await Promise.all([
        import('/src/audio/gameplayAudio.ts'), import('/src/audio/fractureRumble.ts'),
      ]);
      const ensure = (ok, message) => { if (!ok) throw new Error(`Native fracture rumble: ${message}`); };
      const descriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext'), Native = window.AudioContext;
      const contexts = [], sources = [], decoded = [];
      ensure(typeof Native === 'function', 'Native Web Audio is unavailable');
      class SilentContext {
        constructor() {
          const audio = new Native(), silent = audio.createGain();
          silent.gain.value = 0; silent.connect(audio.destination);
          Object.defineProperty(audio, 'destination', { configurable: true, value: silent });
          const decode = audio.decodeAudioData.bind(audio), create = audio.createBufferSource.bind(audio);
          audio.decodeAudioData = async bytes => {
            const buffer = await decode(bytes);
            ensure(buffer.length > 0 && buffer.numberOfChannels === 2 && Math.abs(buffer.duration - 8) < .001, 'Actual supplied rumble did not decode');
            decoded.push({ frames: buffer.length, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, duration: buffer.duration });
            return buffer;
          };
          audio.createBufferSource = () => {
            const source = create(), start = source.start.bind(source), stop = source.stop.bind(source);
            const record = { starts: 0, stopped: false, duration: null, offset: null };
            source.start = (...args) => {
              ensure(++record.starts === 1 && source.buffer?.length > 0, 'An empty or reused source was scheduled');
              record.offset = args[1]; record.duration = args[2]; start(...args);
            };
            source.stop = (...args) => { record.stopped = true; stop(...args); };
            sources.push(record); return source;
          };
          contexts.push({ audio, silent }); return audio;
        }
      }
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: SilentContext });
      const engine = createGameplayAudio();
      ensure(typeof engine.getEffectBus === 'function', 'Shared gameplay effect bus is missing');
      const sound = createFractureRumble({ getAudioBus: () => engine.getEffectBus() });
      const state = { engine, sound, contexts, sources, decoded, descriptor, ensure, config: FRACTURE_RUMBLE, ready: false };
      window.__fractureNative = state;
      ensure(await sound.prepare(), 'Local rumble preloading failed');
      ensure(sources.length === 0, 'Preparation started a source');
      const button = document.createElement('button'); button.id = 'fracture-native-unlock'; button.textContent = 'Enable silent fracture test';
      button.addEventListener('click', () => { void engine.unlock().then(enabled => { state.ready = enabled; }); });
      document.body.replaceChildren(button);
    });
    await page.locator('#fracture-native-unlock').click();
    await page.waitForFunction(() => window.__fractureNative.ready);
    const metrics = await page.evaluate(async () => {
      const s = window.__fractureNative, { ensure, sound, engine } = s;
      const blasts = Array.from({ length: 10 }, (_, id) => ({ id, age: 0, active: true }));
      ensure(s.contexts.length === 1 && s.contexts[0].silent.gain.value === 0, 'Rumble created a second context or audible destination');
      sound.update(blasts); const first = sound.snapshot();
      ensure(first.playCount === 10 && first.activeCount === 10, 'Ten native rumble starts did not overlap');
      sound.update(blasts.map(blast => ({ ...blast, age: .1 })));
      ensure(sound.snapshot().playCount === 10, 'Repeated blast frames replayed cues');
      sound.update([...blasts, { id: 10, age: 0, active: true }], false);
      ensure(sound.snapshot().activeCount === 0 && s.sources.every(source => source.stopped), 'Pause did not silence all sources');
      sound.update([{ id: 10, age: .1, active: true }]);
      ensure(sound.snapshot().playCount === 10, 'Reentry replayed a paused start');
      sound.reset(); sound.update(blasts);
      ensure(sound.snapshot().playCount === 10 && sound.snapshot().activeCount === 10, 'Fresh game did not reuse the same ten cue IDs');
      engine.setMuted(true); sound.update([...blasts, { id: 11, age: 0, active: true }]);
      ensure(sound.snapshot().activeCount === 0, 'Shared mute left rumble playing');
      engine.setMuted(false); sound.update([{ id: 11, age: .1, active: true }]);
      ensure(sound.snapshot().playCount === 10, 'Unmute replayed a missed cue');
      sound.update([{ id: 12, age: 0, active: true }]);
      ensure(sound.snapshot().activeCount === 1, 'New cues failed after unmute');
      engine.stop(); sound.update([{ id: 12, age: .1, active: true }]);
      ensure(sound.snapshot().activeCount === 0, 'Shared recovery generation left an old cue playing');
      ensure(await sound.prepare(), 'Cached preparation failed');
      ensure(sound.snapshot().requestCount === 1 && s.decoded.length === 1, 'Replay fetched or decoded another buffer');
      ensure(s.sources.length === 21 && s.sources.every(source => source.starts === 1), 'Native sources were reused or duplicated');
      ensure(s.sources.every(source => source.offset === .75 && source.duration === 1.8), 'The bounded supplied excerpt changed');
      sound.dispose();
      ensure(s.contexts[0].audio.state === 'running', 'Rumble disposed the shared context');
      return { nativeContexts: s.contexts.length, source: sound.snapshot().clip, decoded: s.decoded[0],
        nativeStarts: s.sources.length, overlappingPerGame: 10, games: 2, fetches: sound.snapshot().requestCount,
        pauseMuteRecoveryCancel: true, cacheReused: true, noLateReplay: true, silentOutputGain: 0,
        noAudibilityOrHardwareClaim: true };
    });
    assert.deepEqual(errors, []); assert.equal(metrics.nativeStarts, 21); assert.equal(metrics.nativeContexts, 1);
    return metrics;
  } finally {
    await page.evaluate(async () => {
      const s = window.__fractureNative; if (!s) return;
      s.sound.dispose(); s.engine.dispose();
      for (const { audio, silent } of s.contexts) {
        silent.disconnect(); if (audio.state !== 'closed') await audio.close().catch(() => {});
      }
      if (s.descriptor) Object.defineProperty(window, 'AudioContext', s.descriptor); else delete window.AudioContext;
      delete window.__fractureNative;
    }).catch(() => {});
    await page.close();
  }
}
