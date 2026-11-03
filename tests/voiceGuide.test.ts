import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceGuide } from '../src/audio/voiceGuide.ts';
import { SCENARIO_VOICE_CUES, VOICE_CUES } from '../src/audio/voiceCues.ts';

class FakeNode {
  value = 0;
  gain = { value: 0, setValueAtTime() {} };
  pan = { value: 0 };
  playbackRate = { value: 1 };
  buffer: unknown = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connect(next: FakeNode) { return next; }
  disconnect() {}
  start(at: number) { this.startedAt = at; }
  stop() { this.stopped = true; }
}
class FakeAudio {
  static sources: FakeNode[] = [];
  static clipDuration = 4;
  state = 'running';
  currentTime = 10;
  destination = new FakeNode();
  createGain() { return new FakeNode(); }
  createStereoPanner() { return new FakeNode(); }
  createBufferSource() { const n = new FakeNode(); FakeAudio.sources.push(n); return n; }
  async decodeAudioData() { return { duration: FakeAudio.clipDuration }; }
  async resume() {}
  async close() {}
}

async function fakeAudio<T>(run: () => Promise<T>, fetcher?: typeof fetch, clipDuration = 4): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const savedFetch = globalThis.fetch;
  FakeAudio.sources = [];
  FakeAudio.clipDuration = clipDuration;
  Object.defineProperty(globalThis, 'AudioContext', { value: FakeAudio, configurable: true });
  globalThis.fetch = fetcher ?? (async () => new Response(new Uint8Array(100), { headers: { 'content-type': 'audio/mpeg' } })) as typeof fetch;
  try { return await run(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'AudioContext', descriptor);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
    globalThis.fetch = savedFetch;
  }
}

test('stop cancels both the lead and future scheduled whisper layers', async () => {
  await fakeAudio(async () => {
    const guide = createVoiceGuide();
    await guide.play('purpose');
    assert.equal(FakeAudio.sources.length, 3);
    assert.ok(FakeAudio.sources[1].startedAt! > FakeAudio.sources[0].startedAt!);
    guide.stop();
    assert.ok(FakeAudio.sources.every((node) => node.stopped));
    guide.dispose();
  });
});

test('stop during loading prevents the completed download from starting old audio', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await fakeAudio(async () => {
    const guide = createVoiceGuide();
    const pending = guide.play('badge');
    guide.stop();
    release();
    await pending;
    assert.equal(FakeAudio.sources.length, 0);
    guide.dispose();
  }, (async () => {
    await gate;
    return new Response(new Uint8Array(100), { headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch);
});

test('missing lead suppresses whisper-only playback while retaining the PC transcript', async () => {
  await fakeAudio(async () => {
    let caption = '';
    const guide = createVoiceGuide({ onCaption: (text) => { caption = text; } });
    await guide.play('badge');
    assert.match(caption, /Get your badge/);
    assert.equal(FakeAudio.sources.length, 0);
    guide.dispose();
  }, (async (path: string) => path.includes('-lead')
    ? new Response('<html>SPA fallback</html>', { headers: { 'content-type': 'text/html' } })
    : new Response(new Uint8Array(100), { headers: { 'content-type': 'audio/mpeg' } })) as typeof fetch);
});

test('mute cancels scheduled audio and subsequent cues retain PC transcripts without creating sources', async () => {
  await fakeAudio(async () => {
    let caption = '';
    const guide = createVoiceGuide({ onCaption: (text) => { caption = text; } });
    await guide.play('purpose');
    guide.setMuted(true);
    assert.ok(FakeAudio.sources.every((node) => node.stopped));
    await guide.play('congratulations');
    assert.match(caption, /Congratulations/);
    assert.equal(FakeAudio.sources.length, 3);
    guide.dispose();
  });
});

test('scenario preload and narration use only the requested lead clips, and the next cue cancels its predecessor', async () => {
  const fetched: string[] = [];
  await fakeAudio(async () => {
    let caption = '';
    let status = '';
    const guide = createVoiceGuide({
      onCaption: (text) => { caption = text; },
      onStatus: (text) => { status = text; },
    });
    await guide.preload(SCENARIO_VOICE_CUES);
    assert.equal(fetched.length, 4);
    assert.ok(fetched.every((path) => /scenario.*-lead\.mp3$/.test(path)));
    assert.match(status, /All local voice clips ready/);
    for (const [index, cue] of SCENARIO_VOICE_CUES.entries()) {
      await guide.play(cue);
      assert.equal(caption, VOICE_CUES[cue].caption);
      assert.equal(FakeAudio.sources.length, index + 1);
      assert.equal(status, 'Narration playing.');
      assert.equal(FakeAudio.sources[index].stopped, false);
      assert.equal(FakeAudio.sources[index].playbackRate.value, 1, 'short narration retains its natural playback rate');
      assert.ok(FakeAudio.sources.slice(0, index).every((source) => source.stopped));
    }
    assert.equal(fetched.length, 4, 'preloaded buffers are reused');
    guide.stop();
    assert.ok(FakeAudio.sources.every((source) => source.stopped));
    guide.dispose();
  }, (async (path: string) => {
    fetched.push(path);
    return new Response(new Uint8Array(100), { headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch);
});

test('long box narration fits the five-second cue gap without changing other cues or cancellation', async () => {
  await fakeAudio(async () => {
    const guide = createVoiceGuide();
    await guide.play('purpose');
    assert.deepEqual(FakeAudio.sources.map((source) => source.playbackRate.value), [1, 1, 1]);
    await guide.play('scenarioWelcome');
    assert.equal(FakeAudio.sources.at(-1)!.playbackRate.value, 1);
    await guide.play('scenarioBox');
    const boxSource = FakeAudio.sources.at(-1)!;
    assert.equal(boxSource.playbackRate.value, 1.5);
    assert.equal(FakeAudio.clipDuration / boxSource.playbackRate.value, 4.7);
    assert.ok(boxSource.startedAt! + 4.7 < 15, 'slot ends before the next cue at +5 seconds');
    await guide.play('scenarioTurn');
    assert.equal(boxSource.stopped, true);
    assert.equal(FakeAudio.sources.at(-1)!.playbackRate.value, 1);
    guide.stop();
    assert.ok(FakeAudio.sources.every((source) => source.stopped));
    guide.dispose();
  }, undefined, 7.05);
});
