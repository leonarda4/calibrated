import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFractureRumble, FRACTURE_RUMBLE, type FractureAudioBus } from '../src/audio/fractureRumble.ts';
import { GAMEPLAY_AUDIO } from '../src/audio/gameplayAudioConfig.ts';
import { HALLWAY_COLLAPSE } from '../src/experience/hallwayCollapse.ts';

class Gain {
  events: (string | number)[][] = [];
  destination: unknown;
  disconnected = 0;
  gain = {
    setValueAtTime: (...values: number[]) => this.events.push(['set', ...values]),
    linearRampToValueAtTime: (...values: number[]) => this.events.push(['ramp', ...values]),
    cancelScheduledValues: (...values: number[]) => this.events.push(['cancel', ...values]),
  };
  connect(destination: unknown) { this.destination = destination; return destination; }
  disconnect() { this.disconnected++; }
}
class Source {
  buffer: unknown;
  onended: (() => void) | null = null;
  starts: number[][] = [];
  stops: number[][] = [];
  disconnected = 0;
  connect(gain: Gain) { return gain; }
  start(...values: number[]) { this.starts.push(values); }
  stop(...values: number[]) { this.stops.push(values); }
  disconnect() { this.disconnected++; }
}
class Context {
  state = 'running'; currentTime = 10;
  sources: Source[] = []; gains: Gain[] = [];
  decodes = 0; resumes = 0; closes = 0;
  decode: (() => Promise<{ duration: number }>) | null = null;
  async decodeAudioData() { this.decodes++; return this.decode ? this.decode() : { duration: 8 }; }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  async resume() { this.resumes++; }
  async close() { this.closes++; }
}
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const blast = (id: number, age = 0, active = true) => ({ id, age, active });
function fixture() {
  const context = new Context(), destination = { sharedMaster: true };
  const bus = { context, destination, authorized: true, muted: false, generation: 0 };
  let fetches = 0, signal: AbortSignal | null = null, failFetch = false;
  const sound = createFractureRumble({
    getAudioBus: () => bus as unknown as FractureAudioBus,
    fetch: (async (url, options) => {
      assert.equal(url, FRACTURE_RUMBLE.clip); fetches++; signal = options?.signal ?? null;
      return new Response(new Uint8Array([1, 2]), { status: failFetch ? 404 : 200, headers: { 'content-type': 'audio/wav' } });
    }) as typeof fetch,
  });
  return { context, destination, bus, sound, fetches: () => fetches, signal: () => signal,
    failFetch: (value: boolean) => { failFetch = value; } };
}

test('rumble excerpt normalization matches unchanged supplied PCM and retains headroom at the authored overlap', () => {
  const bytes = readFileSync(`public${FRACTURE_RUMBLE.clip}`);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  let data = 0, rate = 0, channels = 0, align = 0, dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
    if (tag === 'fmt ') {
      assert.equal(bytes.readUInt16LE(offset + 8), 1); assert.equal(bytes.readUInt16LE(offset + 22), 24);
      channels = bytes.readUInt16LE(offset + 10); rate = bytes.readUInt32LE(offset + 12); align = bytes.readUInt16LE(offset + 20);
    }
    if (tag === 'data') { data = offset + 8; dataBytes = length; }
    offset += 8 + length + length % 2;
  }
  assert.equal(dataBytes / align / rate, 8);
  const start = Math.round(FRACTURE_RUMBLE.offsetSeconds * rate);
  const end = Math.round((FRACTURE_RUMBLE.offsetSeconds + FRACTURE_RUMBLE.durationSeconds) * rate);
  let peak = 0, squares = 0, count = 0;
  for (let frame = start; frame < end; frame++) for (let channel = 0; channel < channels; channel++) {
    const sample = bytes.readIntLE(data + frame * align + channel * 3, 3) / 8388608;
    peak = Math.max(peak, Math.abs(sample)); squares += sample * sample; count++;
  }
  assert.ok(Math.abs(peak - FRACTURE_RUMBLE.sourcePeak) < 1e-12);
  assert.ok(Math.abs(Math.sqrt(squares / count) - FRACTURE_RUMBLE.sourceRms) < 1e-12);
  // Ten sites are staggered: the resource cap also permits synthetic stress
  // inputs, while the actual sequence has at most three simultaneous excerpts.
  const authoredOverlap = Math.ceil(FRACTURE_RUMBLE.durationSeconds / HALLWAY_COLLAPSE.minStaggerSeconds);
  assert.equal(authoredOverlap, 3);
  const supportPeak = FRACTURE_RUMBLE.nominalGain * FRACTURE_RUMBLE.normalizedPeak * authoredOverlap;
  const voicePeak = GAMEPLAY_AUDIO.gains.speech * GAMEPLAY_AUDIO.normalization.speechPeak;
  assert.ok(supportPeak < voicePeak);
  const backgroundPeak = GAMEPLAY_AUDIO.gains.music * GAMEPLAY_AUDIO.normalization.musicPeakCeiling * Math.SQRT2;
  assert.ok((supportPeak + voicePeak + backgroundPeak) * GAMEPLAY_AUDIO.gains.master < 1,
    'authored rumble overlap, full equal-power music crossfade and speech retain nominal headroom');
});

test('prefetch decodes once in the shared suspended context and never revives a missed cue', async () => {
  const f = fixture(); f.context.state = 'suspended';
  let finish: ((value: { duration: number }) => void) | undefined;
  f.context.decode = () => new Promise(resolve => { finish = resolve; });
  try {
    f.sound.update([blast(0)]);
    const first = f.sound.prepare(), second = f.sound.prepare(); await tick(); assert.ok(finish);
    assert.equal(f.fetches(), 1); assert.equal(f.context.decodes, 1);
    f.sound.stop(); finish({ duration: 8 }); assert.equal(await first, true); assert.equal(await second, true);
    assert.equal(f.context.sources.length, 0); assert.equal(f.context.resumes, 0);
    f.context.state = 'running'; f.sound.update([blast(0, .1)]);
    assert.equal(f.context.sources.length, 0, 'the already-consumed cue must not follow unlock/decode');
    f.sound.update([blast(1)]); assert.equal(f.context.sources.length, 1);
    assert.equal(await f.sound.prepare(), true); assert.equal(f.fetches(), 1);
  } finally { f.sound.dispose(); }
  assert.equal(f.context.closes, 0, 'the rumble never closes the shared context');
});

test('ten actual blast starts overlap once each through the shared master with bounded enveloped excerpts', async () => {
  const f = fixture();
  try {
    await f.sound.prepare();
    const samples = Array.from({ length: 10 }, (_, id) => blast(id));
    f.sound.update(samples); f.sound.update(samples.map(sample => ({ ...sample, age: .1 })));
    const state = f.sound.snapshot();
    assert.equal(state.playCount, 10); assert.equal(state.requestedCount, 10); assert.equal(state.activeCount, 10);
    assert.deepEqual(state.playedIds, samples.map(sample => sample.id));
    f.context.sources.forEach(source => assert.deepEqual(source.starts, [[10, .75, 1.8]]));
    f.context.gains.forEach(gain => {
      assert.equal(gain.destination, f.destination);
      assert.deepEqual(gain.events, [['set', 0, 10], ['ramp', state.gain, 10.03],
        ['set', state.gain, 11.55], ['ramp', 0, 11.8]]);
    });
    f.sound.update([blast(10)]); assert.equal(f.sound.snapshot().activeCount, 10); assert.equal(f.sound.snapshot().skippedCount, 1);
    const ended = f.context.sources[0].onended!; ended(); ended();
    assert.equal(f.sound.snapshot().activeCount, 9); assert.equal(f.context.sources[0].disconnected, 1);
    f.sound.update([blast(10, .1)]); assert.equal(f.sound.snapshot().playCount, 10, 'a previously skipped overlap is consumed');
    f.sound.update([blast(11, .1)]);
    assert.deepEqual(f.context.sources.at(-1)!.starts, [[10, .85, 1.7]], 'ordinary frame delay advances the excerpt instead of extending its tail');
  } finally { f.sound.dispose(); }
});

test('pause, shared mute/generation changes and stop silence active cues without replay on reentry', async () => {
  const f = fixture();
  try {
    await f.sound.prepare(); f.sound.update([blast(0)]);
    f.sound.update([blast(0, .1), blast(1)], false);
    assert.equal(f.sound.snapshot().activeCount, 0); assert.equal(f.context.sources[0].stops.length, 1);
    f.sound.update([blast(0, .2), blast(1, .1)]); assert.equal(f.sound.snapshot().playCount, 1);
    f.sound.update([blast(2)]); assert.equal(f.sound.snapshot().activeCount, 1);
    f.bus.muted = true; f.sound.update([blast(2, .1), blast(3)]); assert.equal(f.sound.snapshot().activeCount, 0);
    f.bus.muted = false; f.sound.update([blast(3, .1)]); assert.equal(f.sound.snapshot().playCount, 2);
    f.sound.update([blast(4)]); f.bus.generation++;
    f.sound.update([blast(4, .1)]); assert.equal(f.sound.snapshot().activeCount, 0);
    f.context.state = 'suspended'; f.sound.update([blast(5)]); f.context.state = 'running'; f.sound.update([blast(5, .1)]);
    f.bus.authorized = false; f.sound.update([blast(6)]); f.bus.authorized = true; f.sound.update([blast(6, .1)]);
    assert.equal(f.sound.snapshot().playCount, 3); assert.equal(f.context.resumes, 0);
    f.sound.update([blast(7, .3), blast(8, 0, false)]);
    f.sound.update([blast(8)]); assert.equal(f.sound.snapshot().playCount, 3, 'late or previously suppressed starts are consumed');
  } finally { f.sound.dispose(); }
});

test('reset begins a new game with the cached buffer while stale ended callbacks cannot stop its new cue', async () => {
  const f = fixture();
  try {
    await f.sound.prepare(); f.sound.update([blast(0)]);
    const staleEnded = f.context.sources[0].onended!;
    f.sound.reset(); f.sound.update([blast(0)]); staleEnded();
    assert.equal(f.sound.snapshot().playCount, 1); assert.equal(f.sound.snapshot().activeCount, 1);
    assert.deepEqual(f.sound.snapshot().playedIds, [0]); assert.equal(f.fetches(), 1);
    f.sound.stop(); f.sound.update([blast(0, .1)]); assert.equal(f.sound.snapshot().activeCount, 0);
  } finally { f.sound.dispose(); }
});

test('missing clips retry only during preparation; disposal aborts pending work and prevents stale decode playback', async () => {
  const f = fixture();
  f.failFetch(true); assert.equal(await f.sound.prepare(), false);
  f.failFetch(false); let finish: ((value: { duration: number }) => void) | undefined;
  f.context.decode = () => new Promise(resolve => { finish = resolve; });
  const preparing = f.sound.prepare(); await tick(); assert.ok(finish);
  f.sound.update([blast(0)]); const signal = f.signal(); f.sound.dispose(); f.sound.dispose();
  assert.equal(signal?.aborted, true); finish({ duration: 8 }); assert.equal(await preparing, false);
  f.sound.update([blast(1)]); assert.equal(f.context.sources.length, 0); assert.equal(f.sound.snapshot().loaded, false);
  assert.equal(await f.sound.prepare(), false); assert.equal(f.fetches(), 2); assert.equal(f.context.closes, 0);
});
