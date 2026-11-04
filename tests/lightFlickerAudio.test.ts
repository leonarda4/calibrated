import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightFlickerAudio, LIGHT_FLICKER_CLIP, LIGHT_FLICKER_GAIN } from '../src/audio/lightFlicker.ts';

test('local flicker sound preloads once and schedules only one quiet second with silent endpoints', async () => {
  const previousContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const previousFetch = globalThis.fetch;
  const events: unknown[][] = [], starts: unknown[][] = [];
  let requests = 0, stopped = 0, disconnected = 0;
  class Context {
    state = 'suspended'; currentTime = 10; destination = {};
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    async decodeAudioData() { return { duration: 8.04 }; }
    createGain() { return { gain: {
      setValueAtTime: (...args: unknown[]) => events.push(['set', ...args]),
      linearRampToValueAtTime: (...args: unknown[]) => events.push(['ramp', ...args]),
      cancelScheduledValues: (...args: unknown[]) => events.push(['cancel', ...args]),
    }, connect: () => ({}), disconnect: () => disconnected++ }; }
    createBufferSource() { return { buffer: null, onended: null,
      connect: (node: unknown) => node, start: (...args: unknown[]) => starts.push(args),
      stop: () => stopped++, disconnect: () => disconnected++ }; }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  globalThis.fetch = (async (input: unknown) => {
    requests++; assert.equal(input, LIGHT_FLICKER_CLIP);
    return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch;
  const sound = createLightFlickerAudio();
  try {
    assert.equal(sound.play(), false, 'an unloaded cue must not start a deferred request');
    assert.equal(await sound.unlock(), true); assert.equal(await sound.unlock(), true);
    assert.equal(requests, 1); assert.equal(sound.snapshot().sourceDuration, 8.04);
    assert.equal(sound.play(), true);
    assert.deepEqual(starts, [[10, 0, 1]], 'do not play the entire eight-second recording');
    assert.deepEqual(events, [['set', 0, 10], ['ramp', LIGHT_FLICKER_GAIN, 10.08],
      ['set', LIGHT_FLICKER_GAIN, 10.8], ['ramp', 0, 11]]);
    assert.ok(LIGHT_FLICKER_GAIN <= .16);
    sound.stop(); assert.equal(stopped, 1); assert.equal(disconnected, 2);
    assert.equal(sound.snapshot().playing, false); assert.equal(sound.snapshot().playCount, 1);
    sound.dispose(); sound.dispose(); assert.equal(sound.play(), false);
  } finally {
    sound.dispose(); globalThis.fetch = previousFetch;
    if (previousContext) Object.defineProperty(globalThis, 'AudioContext', previousContext);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});

test('an audio decode completing after disposal cannot revive a cancelled sound', async () => {
  const previousContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const previousFetch = globalThis.fetch;
  let finishDecode: ((value: { duration: number }) => void) | null = null;
  class Context {
    state = 'running';
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    decodeAudioData() { return new Promise(resolve => { finishDecode = resolve; }); }
    createBufferSource() { throw new Error('A stale decode scheduled audio'); }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  globalThis.fetch = (async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } })) as typeof fetch;
  const sound = createLightFlickerAudio();
  try {
    const loading = sound.unlock();
    for (let i = 0; i < 10 && !finishDecode; i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(finishDecode);
    sound.stop(); sound.dispose();
    (finishDecode as (value: { duration: number }) => void)({ duration: 8.04 });
    assert.equal(await loading, false);
    assert.equal(sound.play(), false); assert.equal(sound.snapshot().playCount, 0);
  } finally {
    sound.dispose(); globalThis.fetch = previousFetch;
    if (previousContext) Object.defineProperty(globalThis, 'AudioContext', previousContext);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});
