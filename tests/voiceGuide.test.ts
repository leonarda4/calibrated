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
  static instances: FakeAudio[] = [];
  static initialState = 'running';
  static resumeCalls = 0;
  static resumeHandler: ((audio: FakeAudio) => Promise<void>) | null = null;
  static decodeHandler: ((data: ArrayBuffer) => Promise<{ duration: number }>) | null = null;
  state = FakeAudio.initialState;
  currentTime = 10;
  destination = new FakeNode();
  constructor() { FakeAudio.instances.push(this); }
  createGain() { return new FakeNode(); }
  createStereoPanner() { return new FakeNode(); }
  createBufferSource() { const n = new FakeNode(); FakeAudio.sources.push(n); return n; }
  async decodeAudioData(data: ArrayBuffer) {
    return FakeAudio.decodeHandler ? await FakeAudio.decodeHandler(data) : { duration: FakeAudio.clipDuration };
  }
  async resume() {
    FakeAudio.resumeCalls++;
    if (FakeAudio.resumeHandler) await FakeAudio.resumeHandler(this);
    else this.state = 'running';
  }
  async close() {}
}

async function fakeAudio<T>(run: () => Promise<T>, fetcher?: typeof fetch, clipDuration = 4): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const savedFetch = globalThis.fetch;
  FakeAudio.sources = [];
  FakeAudio.clipDuration = clipDuration;
  FakeAudio.instances = []; FakeAudio.initialState = 'running'; FakeAudio.resumeCalls = 0;
  FakeAudio.resumeHandler = null; FakeAudio.decodeHandler = null;
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
    assert.equal(guide.isCuePlaying('badge'), false);
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

test('scenario preload includes brief supporting whispers, and the next cue cancels every previous layer', async () => {
  const fetched: string[] = [];
  await fakeAudio(async () => {
    let caption = '';
    let status = '';
    const guide = createVoiceGuide({
      onCaption: (text) => { caption = text; },
      onStatus: (text) => { status = text; },
    });
    await guide.preload(SCENARIO_VOICE_CUES);
    assert.equal(fetched.length, 12);
    assert.ok(fetched.every((path) => /scenario.*-(lead|left|right)\.mp3$/.test(path)));
    assert.match(status, /All local voice clips ready/);
    for (const [index, cue] of SCENARIO_VOICE_CUES.entries()) {
      await guide.play(cue);
      assert.equal(caption, VOICE_CUES[cue].caption);
      assert.equal(FakeAudio.sources.length, (index + 1) * 3);
      assert.equal(status, 'Voices playing: lead + layered whispers.');
      assert.ok(FakeAudio.sources.slice(index * 3).every(source => !source.stopped && source.playbackRate.value === 1));
      assert.ok(FakeAudio.sources.slice(0, index * 3).every((source) => source.stopped));
    }
    assert.equal(fetched.length, 12, 'preloaded buffers are reused');
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
    const boxSource = FakeAudio.sources.at(-3)!;
    assert.equal(boxSource.playbackRate.value, 1.5);
    assert.equal(FakeAudio.clipDuration / boxSource.playbackRate.value, 4.7);
    assert.deepEqual(FakeAudio.sources.slice(-2).map(source => source.playbackRate.value), [1, 1]);
    assert.ok(boxSource.startedAt! + 4.7 < 15, 'slot ends before the next cue at +5 seconds');
    await guide.play('scenarioTurn');
    assert.equal(boxSource.stopped, true);
    assert.equal(FakeAudio.sources.at(-1)!.playbackRate.value, 1);
    guide.stop();
    assert.ok(FakeAudio.sources.every((source) => source.stopped));
    guide.dispose();
  }, undefined, 7.05);
});

test('fresh games retry a transient missing lead while retaining successfully decoded whisper buffers', async () => {
  for (const failure of ['fetch', 'html']) {
    const requests: string[] = [];
    let failLead = true;
    await fakeAudio(async () => {
      const guide = createVoiceGuide();
      await guide.preload(['scenarioBox']);
      assert.equal(FakeAudio.sources.length, 0);
      failLead = false;
      await guide.play('scenarioBox');
      assert.equal(FakeAudio.sources.length, 3, `${failure}: a failed cached lead must be retried in a fresh game`);
      assert.equal(requests.filter(path => path.endsWith('-lead.mp3')).length, 2);
      assert.equal(requests.filter(path => path.endsWith('-left.mp3')).length, 1);
      assert.equal(requests.filter(path => path.endsWith('-right.mp3')).length, 1);
      await guide.play('scenarioBox');
      assert.equal(requests.length, 4, 'successful lead and whispers remain cached for subsequent games');
      guide.dispose();
    }, (async (path: string) => {
      requests.push(path);
      if (failLead && path.endsWith('-lead.mp3')) {
        if (failure === 'fetch') throw new Error('Temporary local asset failure');
        return new Response('<html>temporarily unavailable</html>', { headers: { 'content-type': 'text/html' } });
      }
      return new Response(new Uint8Array(100), { headers: { 'content-type': 'audio/mpeg' } });
    }) as typeof fetch);
  }
});

test('a transient decoder failure is retried without a page reload', async () => {
  let requests = 0;
  await fakeAudio(async () => {
    FakeAudio.decodeHandler = async () => { throw new Error('Temporary decoder interruption'); };
    const guide = createVoiceGuide();
    await guide.preload(['scenarioBox']);
    FakeAudio.decodeHandler = null;
    await guide.play('scenarioBox');
    assert.equal(FakeAudio.sources.length, 3);
    assert.equal(requests, 6);
    guide.dispose();
  }, (async () => {
    requests++;
    return new Response(new Uint8Array(100), { headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch);
});

test('previously enabled audio resumes after suspension, while initial gesture permission and mute remain explicit', async () => {
  await fakeAudio(async () => {
    FakeAudio.initialState = 'suspended';
    const guide = createVoiceGuide();
    await guide.play('scenarioBox');
    assert.equal(FakeAudio.sources.length, 0); assert.equal(FakeAudio.resumeCalls, 0);
    assert.equal(await guide.unlock(), true);
    FakeAudio.instances[0].state = 'interrupted';
    await guide.play('scenarioBox');
    assert.equal(FakeAudio.resumeCalls, 2, 'a new cue should resume its already authorized context');
    assert.equal(FakeAudio.sources.length, 3);
    guide.setMuted(true); FakeAudio.instances[0].state = 'suspended';
    await guide.play('scenarioBox');
    assert.equal(FakeAudio.resumeCalls, 2, 'muted cues must not resume the context');
    assert.ok(FakeAudio.sources.every(source => source.stopped));
    guide.dispose();
  });
});

test('STOP and a fresh cue during resume never let the old cue consume the new playback generation', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requests: string[] = [];
  await fakeAudio(async () => {
    const guide = createVoiceGuide();
    await guide.unlock();
    FakeAudio.instances[0].state = 'suspended';
    FakeAudio.resumeHandler = async audio => { await gate; audio.state = 'running'; };
    const old = guide.play('scenarioBox');
    assert.equal(guide.isCuePlaying('scenarioBox'), false, 'a cue awaiting resume has no scheduled lead');
    guide.stop();
    const fresh = guide.play('scenarioWelcome');
    release(); await Promise.all([old, fresh]);
    assert.equal(FakeAudio.sources.length, 3);
    assert.ok(requests.every(path => path.includes('scenarioWelcome')), 'the cancelled cue may not load or schedule after resume');
    assert.equal(guide.isCuePlaying('scenarioBox'), false);
    assert.equal(guide.isCuePlaying('scenarioWelcome'), true);
    guide.dispose();
  }, (async (path: string) => {
    requests.push(path);
    return new Response(new Uint8Array(100), { headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch);
});

test('a resume that never settles cannot queue narration indefinitely or play it after late recovery', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await fakeAudio(async () => {
    const guide = createVoiceGuide();
    await guide.unlock();
    FakeAudio.instances[0].state = 'suspended';
    FakeAudio.resumeHandler = async audio => { await gate; audio.state = 'running'; };
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        guide.play('scenarioBox'),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Audio resume did not respect its bounded wait.')), 1500); }),
      ]);
    } finally { if (deadline !== undefined) clearTimeout(deadline); }
    assert.equal(FakeAudio.resumeCalls, 2, 'the suspended authorized context must attempt a bounded resume');
    assert.equal(FakeAudio.sources.length, 0);
    guide.stop(); release(); await Promise.resolve(); await Promise.resolve();
    assert.equal(FakeAudio.sources.length, 0);
    guide.dispose();
  });
});

test('cue visibility follows its lead alone and clears on end, stop, mute and disposal', async () => {
  await fakeAudio(async () => {
    const guide = createVoiceGuide();
    assert.equal(guide.isCuePlaying('purpose'), false);
    await guide.play('purpose');
    assert.equal(guide.isCuePlaying('purpose'), true);
    assert.equal(guide.isCuePlaying('scenarioBox'), false);
    FakeAudio.sources[0].onended?.();
    assert.equal(guide.isCuePlaying('purpose'), false, 'supporting whispers cannot keep a cue active after its lead');
    assert.ok(FakeAudio.sources.slice(1).every(source => !source.stopped));
    await guide.play('scenarioBox');
    assert.equal(guide.isCuePlaying('scenarioBox'), true);
    const oldLeadEnded = FakeAudio.sources.at(-3)!.onended!;
    guide.stop(); assert.equal(guide.isCuePlaying('scenarioBox'), false);
    await guide.play('scenarioBox');
    oldLeadEnded();
    assert.equal(guide.isCuePlaying('scenarioBox'), true, 'a queued old end event cannot clear the next game\'s lead');
    guide.setMuted(true); assert.equal(guide.isCuePlaying('scenarioBox'), false);
    guide.setMuted(false); assert.equal(guide.isCuePlaying('scenarioBox'), false, 'unmuting cannot revive an old lead');
    await guide.play('scenarioBox');
    assert.equal(guide.isCuePlaying('scenarioBox'), true);
    guide.dispose(); assert.equal(guide.isCuePlaying('scenarioBox'), false);
  });
});

test('resuming a startup cue becomes active only once its lead is scheduled and never blocks while suspended', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await fakeAudio(async () => {
    const guide = createVoiceGuide();
    await guide.unlock();
    const audio = FakeAudio.instances[0];
    audio.state = 'interrupted';
    FakeAudio.resumeHandler = async context => { await gate; context.state = 'running'; };
    const pending = guide.play('scenarioBox');
    assert.equal(guide.isCuePlaying('scenarioBox'), false);
    release(); await pending;
    assert.equal(guide.isCuePlaying('scenarioBox'), true);
    audio.state = 'suspended';
    assert.equal(guide.isCuePlaying('scenarioBox'), false, 'a suspended context cannot keep the game waiting indefinitely');
    guide.stop(); audio.state = 'running';
    assert.equal(guide.isCuePlaying('scenarioBox'), false, 'later context recovery cannot revive stopped cue identity');
    guide.dispose();
  });
});
