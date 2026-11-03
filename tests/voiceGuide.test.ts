import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceGuide } from '../src/audio/voiceGuide.ts';

class FakeNode {
  value = 0;
  gain = { value: 0, setValueAtTime() {} };
  pan = { value: 0 };
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
  state = 'running';
  currentTime = 10;
  destination = new FakeNode();
  createGain() { return new FakeNode(); }
  createStereoPanner() { return new FakeNode(); }
  createBufferSource() { const n = new FakeNode(); FakeAudio.sources.push(n); return n; }
  async decodeAudioData() { return { duration: 4 }; }
  async resume() {}
  async close() {}
}

async function fakeAudio<T>(run: () => Promise<T>, fetcher?: typeof fetch): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const savedFetch = globalThis.fetch;
  FakeAudio.sources = [];
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
