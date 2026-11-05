import test from 'node:test';
import assert from 'node:assert/strict';
import { createWallMovementAudio, WALL_MOVEMENT_ATTACK, WALL_MOVEMENT_CLIP,
  WALL_MOVEMENT_GAIN, WALL_MOVEMENT_RELEASE } from '../src/audio/wallMovement.ts';

class FakeGain {
  events: unknown[][] = [];
  disconnected = 0;
  gain = {
    setValueAtTime: (...args: number[]) => this.events.push(['set', ...args]),
    linearRampToValueAtTime: (...args: number[]) => this.events.push(['ramp', ...args]),
    cancelScheduledValues: (...args: number[]) => this.events.push(['cancel', ...args]),
  };
  connect() { return {}; }
  disconnect() { this.disconnected++; }
}
class FakeSource {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  starts: number[][] = [];
  stops: number[][] = [];
  disconnected = 0;
  connect(node: FakeGain) { return node; }
  start(...args: number[]) { this.starts.push(args); }
  stop(...args: number[]) { this.stops.push(args); }
  disconnect() { this.disconnected++; }
  finish() { this.onended?.(); }
}
class FakeContext {
  static instances: FakeContext[] = [];
  static resumeHandler: ((audio: FakeContext) => Promise<void>) | null = null;
  static decodeHandler: (() => Promise<{ duration: number }>) | null = null;
  state = 'suspended';
  currentTime = 10;
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  resumes = 0;
  decodes = 0;
  closes = 0;
  constructor() { FakeContext.instances.push(this); }
  async resume() {
    this.resumes++;
    if (FakeContext.resumeHandler) await FakeContext.resumeHandler(this);
    else this.state = 'running';
  }
  async close() { this.closes++; this.state = 'closed'; }
  async decodeAudioData() {
    this.decodes++;
    return FakeContext.decodeHandler ? await FakeContext.decodeHandler() : { duration: 10.24 };
  }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
}

async function withAudio(run: (sound: ReturnType<typeof createWallMovementAudio>) => Promise<void>, fetcher?: typeof fetch) {
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const originalFetch = globalThis.fetch;
  FakeContext.instances = []; FakeContext.resumeHandler = null; FakeContext.decodeHandler = null;
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
  globalThis.fetch = fetcher ?? (async () => new Response(new Uint8Array([1, 2]),
    { headers: { 'content-type': 'audio/wav' } })) as typeof fetch;
  const sound = createWallMovementAudio();
  try { await run(sound); }
  finally {
    sound.dispose(); globalThis.fetch = originalFetch;
    if (originalContext) Object.defineProperty(globalThis, 'AudioContext', originalContext);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 20 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'expected asynchronous audio boundary was reached');
}

test('wall audio loads once and loops at bounded gain only during observed movement', async () => {
  let requests = 0;
  await withAudio(async sound => {
    assert.equal(sound.setMoving(true), false);
    assert.equal(requests, 0, 'frame updates cannot initiate a fetch or create a context');
    assert.equal(sound.setMoving(false), false);
    assert.deepEqual(await Promise.all([sound.unlock(), sound.unlock()]), [true, true]);
    assert.equal(await sound.unlock(), true);
    const context = FakeContext.instances[0];
    assert.equal(FakeContext.instances.length, 1);
    assert.equal(requests, 1); assert.equal(context.decodes, 1); assert.equal(context.resumes, 1);
    assert.equal(context.sources.length, 0, 'unlock does not start an earlier moving request');
    assert.equal(sound.snapshot().sourceDuration, 10.24);
    assert.equal(sound.setMoving(true), true);
    for (let frame = 0; frame < 100; frame++) assert.equal(sound.setMoving(true), true);
    assert.equal(context.sources.length, 1); assert.equal(context.gains.length, 1);
    const source = context.sources[0], gain = context.gains[0];
    assert.equal(source.loop, true); assert.deepEqual(source.starts, [[10]]);
    assert.deepEqual(gain.events, [['set', 0, 10], ['ramp', WALL_MOVEMENT_GAIN, 10 + WALL_MOVEMENT_ATTACK]]);
    assert.ok(WALL_MOVEMENT_GAIN > .2 && WALL_MOVEMENT_GAIN <= 1);
    context.currentTime = 10.1;
    sound.setMoving(false); sound.setMoving(false); sound.stop();
    assert.equal(sound.snapshot().playing, false); assert.equal(sound.snapshot().moving, false);
    assert.deepEqual(source.stops, [[10.1]], 'a motion/safety stop has no trailing release');
    source.finish();
    assert.equal(source.disconnected, 1); assert.equal(gain.disconnected, 1);
    assert.equal(sound.setMoving(true), true);
    assert.equal(context.sources.length, 2);
    assert.equal(context.sources[1].buffer, source.buffer, 'resume reuses the decoded clip');
    assert.equal(sound.snapshot().playCount, 2);
    sound.dispose(); sound.dispose();
    assert.equal(context.sources[1].disconnected, 1); assert.equal(context.gains[1].disconnected, 1);
    assert.equal(context.closes, 1); assert.equal(sound.snapshot().ready, false);
    assert.equal(sound.setMoving(true), false); assert.equal(await sound.unlock(), false);
  }, (async input => {
    requests++; assert.equal(input, WALL_MOVEMENT_CLIP);
    return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/wav' } });
  }) as typeof fetch);
});

test('a decode finishing after a movement pause cannot start a stale loop', async () => {
  await withAudio(async sound => {
    let finish!: (clip: { duration: number }) => void;
    FakeContext.decodeHandler = () => new Promise(resolve => { finish = resolve; });
    const loading = sound.unlock();
    sound.setMoving(true);
    await until(() => !!finish);
    sound.stop();
    finish({ duration: 6.8 });
    assert.equal(await loading, true);
    assert.equal(sound.snapshot().moving, false); assert.equal(sound.snapshot().playing, false);
    assert.equal(FakeContext.instances[0].sources.length, 0);
    sound.setMoving(true);
    assert.equal(FakeContext.instances[0].sources.length, 1, 'only a fresh movement observation starts audio');
  });
});

test('a late context resume cannot revive motion which already stopped', async () => {
  await withAudio(async sound => {
    let resume!: () => void;
    FakeContext.resumeHandler = audio => new Promise(resolve => {
      resume = () => { audio.state = 'running'; resolve(); };
    });
    const loading = sound.unlock();
    sound.setMoving(true);
    await until(() => FakeContext.instances[0].decodes === 1);
    sound.setMoving(false);
    resume();
    assert.equal(await loading, true);
    assert.equal(sound.snapshot().playing, false); assert.equal(sound.snapshot().moving, false);
    assert.equal(FakeContext.instances[0].sources.length, 0);
  });
});

test('disposal aborts loading and discards a late decode without reviving or retaining resources', async () => {
  let signal: AbortSignal | null = null;
  await withAudio(async sound => {
    let finish!: (clip: { duration: number }) => void;
    FakeContext.decodeHandler = () => new Promise(resolve => { finish = resolve; });
    const loading = sound.unlock();
    await until(() => !!finish);
    sound.setMoving(true); sound.dispose(); sound.dispose();
    assert.equal((signal as AbortSignal | null)?.aborted, true);
    finish({ duration: 6.8 });
    assert.equal(await loading, false);
    assert.equal(sound.snapshot().sourceDuration, null); assert.equal(sound.snapshot().moving, false);
    assert.equal(sound.snapshot().playCount, 0); assert.equal(FakeContext.instances[0].closes, 1);
    assert.equal(FakeContext.instances[0].sources.length, 0);
  }, (async (_input, init) => {
    signal = init?.signal ?? null;
    return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/wav' } });
  }) as typeof fetch);
});

test('an interrupted context silences the loop and requires a new motion observation after unlock', async () => {
  await withAudio(async sound => {
    await sound.unlock(); sound.setMoving(true);
    const context = FakeContext.instances[0], source = context.sources[0];
    context.state = 'suspended';
    assert.equal(sound.setMoving(true), false);
    assert.equal(sound.snapshot().playing, false); assert.equal(source.disconnected, 1);
    assert.equal(await sound.unlock(), true);
    assert.equal(context.sources.length, 1, 'resume does not restart a suspended source');
    assert.equal(sound.setMoving(true), true); assert.equal(context.sources.length, 2);
  });
});

test('safety stop and rapid resume clean resources without an old end clearing the new loop', async () => {
  await withAudio(async sound => {
    await sound.unlock(); sound.setMoving(true);
    const context = FakeContext.instances[0], source = context.sources[0];
    const oldEnd = source.onended;
    context.currentTime += .02;
    sound.stop();
    assert.deepEqual(source.stops, [[10.02]], 'Stop cuts even an unfinished attack immediately');
    sound.setMoving(true);
    assert.equal(source.disconnected, 1); assert.equal(context.gains[0].disconnected, 1);
    oldEnd?.();
    assert.equal(sound.snapshot().playing, true); assert.equal(source.disconnected, 1);
    sound.stop(); sound.dispose();
    assert.equal(context.sources[1].disconnected, 1); assert.equal(context.gains[1].disconnected, 1);
  });
});

test('look-back fades the existing loop exactly through the remaining movement deadline', async () => {
  await withAudio(async sound => {
    await sound.unlock(); sound.setMoving(true);
    const context = FakeContext.instances[0], source = context.sources[0], gain = context.gains[0];
    context.currentTime = 11;
    assert.equal(sound.snapshot().currentGain, WALL_MOVEMENT_GAIN);
    sound.setMoving(true, .7);
    assert.equal(WALL_MOVEMENT_RELEASE, .7);
    assert.deepEqual(gain.events.slice(-3), [['cancel', 11], ['set', WALL_MOVEMENT_GAIN, 11], ['ramp', 0, 11.7]]);
    const fadeEvents = gain.events.length;
    context.currentTime = 11.35;
    sound.setMoving(true, .35);
    sound.setMoving(true, .7);
    assert.equal(gain.events.length, fadeEvents, 'later frames cannot restart or extend the same fade');
    assert.ok(Math.abs(sound.snapshot().currentGain - WALL_MOVEMENT_GAIN / 2) < 1e-12);
    assert.equal(context.sources.length, 1, 'fading does not create a new source');
    assert.deepEqual(source.stops, [], 'do not schedule an irreversible stop while look-away can cancel the fade');
    context.currentTime = 11.7;
    assert.equal(sound.snapshot().currentGain, 0, 'audio reaches silence at the movement deadline');
    sound.setMoving(false);
    assert.deepEqual(source.stops, [[11.7]]);
    assert.equal(sound.snapshot().playing, false); assert.equal(sound.snapshot().fading, false);
  });
});

test('looking away cancels the fade from its current level and a later look gets its own deadline', async () => {
  await withAudio(async sound => {
    await sound.unlock(); sound.setMoving(true);
    const context = FakeContext.instances[0], gain = context.gains[0];
    context.currentTime = 11; sound.setMoving(true, .7);
    context.currentTime = 11.35; sound.setMoving(true);
    assert.equal(sound.snapshot().fading, false);
    const currentLevel = gain.events.at(-2)![1] as number;
    assert.ok(Math.abs(currentLevel - WALL_MOVEMENT_GAIN / 2) < 1e-12);
    assert.deepEqual(gain.events.at(-1), ['ramp', WALL_MOVEMENT_GAIN, 11.35 + WALL_MOVEMENT_ATTACK]);
    assert.equal(context.sources.length, 1, 'look-away resumes the original loop, without restarting its clip');
    context.currentTime = 12; sound.setMoving(true, .7);
    assert.deepEqual(gain.events.at(-1), ['ramp', 0, 12.7], 'a fresh look-back must not retain the old deadline');
    context.currentTime = 12.2; sound.setMoving(false);
    assert.deepEqual(context.sources[0].stops, [[12.2]], 'player/safety stop cancels the pending fade immediately');
    assert.equal(gain.disconnected, 1);
  });
});

test('a fade during attack starts at its actual level and invalid stopping observations fail silent', async () => {
  await withAudio(async sound => {
    await sound.unlock(); sound.setMoving(true);
    const context = FakeContext.instances[0], gain = context.gains[0];
    context.currentTime = 10.1; sound.setMoving(true, .6);
    assert.ok(Math.abs((gain.events.at(-2)![1] as number) - WALL_MOVEMENT_GAIN / 2) < 1e-12);
    assert.deepEqual(gain.events.at(-1), ['ramp', 0, 10.7], 'remaining travel sets the actual silence deadline');
    sound.setMoving(true, Number.NaN);
    assert.equal(sound.snapshot().playing, false); assert.equal(sound.snapshot().moving, false);
    assert.equal(sound.setMoving(true, 0), false);
    assert.equal(sound.setMoving(true, -.1), false);
    assert.equal(sound.setMoving(true, .4), false, 'do not start a late sound tail while the wall is already stopping');
    assert.equal(context.sources.length, 1);
    assert.equal(sound.setMoving(true), true, 'fresh unrestricted movement can fade in again');
    assert.equal(context.sources.length, 2);
  });
});

test('a missing local sound fails silently and a later gesture can retry', async () => {
  let requests = 0;
  await withAudio(async sound => {
    assert.equal(await sound.unlock(), false);
    assert.equal(sound.setMoving(true), false);
    assert.equal(FakeContext.instances[0].sources.length, 0);
    assert.match(sound.snapshot().status, /unavailable/);
    assert.equal(await sound.unlock(), true);
    assert.equal(FakeContext.instances[0].sources.length, 0);
    assert.equal(sound.setMoving(true), true); assert.equal(requests, 2);
  }, (async () => ++requests === 1
    ? new Response('<html>SPA fallback</html>', { headers: { 'content-type': 'text/html' } })
    : new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/wav' } })) as typeof fetch);
});
