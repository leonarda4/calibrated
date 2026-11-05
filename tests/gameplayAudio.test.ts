import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameplayAudio, equalPowerCrossfade } from '../src/audio/gameplayAudio.ts';
import { DANGER_VOICE_CUES, GAMEPLAY_AUDIO, GAMEPLAY_SPEECH, GAMEPLAY_SOURCE_LEVELS, gameplayMusicLevel, gameplayEffectLevel } from '../src/audio/gameplayAudioConfig.ts';

class FakeGain {
  events: { type: string; values: number[] }[] = [];
  gain = {
    value: 0,
    setValueAtTime: (...values: number[]) => this.events.push({ type: 'set', values }),
    linearRampToValueAtTime: (...values: number[]) => this.events.push({ type: 'ramp', values }),
    cancelScheduledValues: (...values: number[]) => this.events.push({ type: 'cancel', values }),
    setValueCurveAtTime: (curve: Float32Array, ...values: number[]) => this.events.push({ type: 'curve', values: [...curve, ...values] }),
  };
  connect(node: unknown) { return node; }
  disconnect() {}
}
class FakeSource {
  buffer: { duration: number; file: string } | null = null;
  onended: (() => void) | null = null;
  starts: number[][] = [];
  stops = 0;
  stopTimes: number[][] = [];
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  connect(node: unknown) { return node; }
  disconnect() {}
  start(...values: number[]) { this.starts.push(values); }
  stop(...times: number[]) { this.stops++; this.stopTimes.push(times); }
  finish() { this.onended?.(); }
}
class FakePanner {
  events: number[][] = [];
  disconnected = false;
  pan = { setValueAtTime: (...values: number[]) => this.events.push(values),
    linearRampToValueAtTime: (...values: number[]) => this.events.push(values) };
  connect(node: unknown) { return node; }
  disconnect() { this.disconnected = true; }
}
class FakeMedia {
  static instances: FakeMedia[] = [];
  static playHandler: ((media: FakeMedia) => Promise<void>) | null = null;
  preload = '';
  src = '';
  loop = false;
  currentTime = 0;
  paused = true;
  plays = 0;
  pauses = 0;
  constructor() { FakeMedia.instances.push(this); }
  async play() { this.plays++; this.paused = false; await FakeMedia.playHandler?.(this); }
  pause() { this.pauses++; this.paused = true; }
  load() {}
  removeAttribute() { this.src = ''; }
}
class FakeContext {
  static instances: FakeContext[] = [];
  static decodeHandler: ((file: string) => Promise<{ duration: number; file: string }>) | null = null;
  static resumeHandler: ((context: FakeContext) => Promise<void>) | null = null;
  state = 'suspended';
  currentTime = 0;
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  panners: FakePanner[] = [];
  decodes: string[] = [];
  mediaNodes = 0;
  constructor() { FakeContext.instances.push(this); }
  async resume() { if (FakeContext.resumeHandler) await FakeContext.resumeHandler(this); else this.state = 'running'; }
  async close() { this.state = 'closed'; }
  async decodeAudioData(bytes: ArrayBuffer) {
    const file = new TextDecoder().decode(bytes);
    this.decodes.push(file);
    return FakeContext.decodeHandler ? await FakeContext.decodeHandler(file) : { duration: 6, file };
  }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createStereoPanner() { const pan = new FakePanner(); this.panners.push(pan); return pan; }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
  createMediaElementSource() { this.mediaNodes++; return { connect: (node: unknown) => node, disconnect() {} }; }
}
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
type Engine = ReturnType<typeof createGameplayAudio>;

async function fixture(run: (audio: Engine, context: FakeContext, fetched: string[]) => Promise<void>) {
  const originals = ['AudioContext', 'Audio'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const originalFetch = globalThis.fetch;
  FakeContext.instances = []; FakeContext.decodeHandler = null; FakeContext.resumeHandler = null;
  FakeMedia.instances = []; FakeMedia.playHandler = null;
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: FakeMedia });
  const fetched: string[] = [];
  globalThis.fetch = (async input => {
    const file = String(input); fetched.push(file);
    return new Response(new TextEncoder().encode(file), { headers: { 'content-type': 'audio/wav' } });
  }) as typeof fetch;
  const audio = createGameplayAudio({ random: () => .5 });
  try {
    await audio.unlock();
    await run(audio, FakeContext.instances[0], fetched);
  } finally {
    audio.dispose(); globalThis.fetch = originalFetch;
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}
function advance(audio: Engine, context: FakeContext, from: number, to: number) {
  for (let time = from + .25; time <= to + 1e-9; time += .25) {
    context.currentTime = time; audio.update(time);
  }
}

test('boundary warning preempts speech promptly, preserves queued lines and never changes music gain', async () => fixture(async (audio, context) => {
  await audio.preload(); audio.start(); await flush();
  audio.speech('welcome'); await flush();
  const interrupted = context.sources.at(-1)!;
  audio.speech('cleanRoom');
  const musicGains = JSON.stringify(context.gains.slice(0, 8).map(gain => gain.events));
  assert.equal(audio.warnDanger(), true); await flush();
  assert.ok(interrupted.stops > 0);
  assert.match(context.sources.at(-1)!.buffer!.file, /DangerZone01\.wav$/);
  assert.deepEqual(audio.snapshot().queuedSpeech, ['cleanRoom']);
  assert.equal(JSON.stringify(context.gains.slice(0, 8).map(gain => gain.events)), musicGains);
  assert.ok(FakeMedia.instances.some(media => !media.paused && media.src.endsWith('Ambience_1.wav')));
  context.sources.at(-1)!.finish(); await flush();
  assert.match(context.sources.at(-1)!.buffer!.file, /CLEANTHEROOM\.wav$/);
}));

test('boundary warnings cycle all four supplied files and cannot stack while a warning is pending/playing', async () => fixture(async (audio, context) => {
  await audio.preload();
  for (let index = 0; index < 4; index++) {
    assert.equal(audio.warnDanger(), true);
    assert.equal(audio.warnDanger(), false);
    await flush();
    assert.match(context.sources.at(-1)!.buffer!.file, new RegExp(`DangerZone0${index + 1}\\.wav$`));
    assert.equal(audio.warnDanger(), false);
    context.sources.at(-1)!.finish(); await flush();
  }
  assert.equal(context.decodes.filter(path => /DangerZone/.test(path)).length, 4);
}));

test('retreat cancellation prevents a pending warning and leaves unrelated current speech alone', async () => fixture(async (audio, context) => {
  await audio.preload();
  assert.equal(audio.warnDanger(), true); audio.cancelDangerWarning(); await flush();
  assert.equal(context.sources.length, 0, 'cancelled async scheduling cannot produce a warning');
  audio.speech('welcome'); await flush();
  const ordinary = context.sources.at(-1)!; audio.cancelDangerWarning();
  assert.equal(ordinary.stops, 0);
  assert.equal(audio.isSpeechPlaying('welcome'), true);
  assert.equal(audio.warnDanger(), true); await flush();
  const warning = context.sources.at(-1)!; audio.cancelDangerWarning();
  assert.ok(warning.stops > 0); assert.equal(audio.snapshot().dangerPlaying, false);
}));

test('mute, Stop and disposal invalidate a warning before asynchronous scheduling can revive it', async () => {
  for (const action of ['mute','stop','dispose'] as const) await fixture(async (audio, context) => {
    await audio.preload(); assert.equal(audio.warnDanger(), true);
    if (action === 'mute') audio.setMuted(true);
    else if (action === 'stop') audio.stop();
    else audio.dispose();
    await flush();
    assert.equal(context.sources.length, 0, action);
    assert.equal(audio.snapshot().dangerPlaying, false);
  });
});

test('unavailable/locked warning audio never interrupts narration and failed loads can retry', async () => fixture(async (audio, context) => {
  FakeContext.decodeHandler = async file => { if (/DangerZone01/.test(file)) throw Error('temporary'); return { duration: 6, file }; };
  await audio.preload(); audio.speech('welcome'); await flush();
  const ordinary = context.sources.at(-1)!;
  assert.equal(audio.warnDanger('danger1'), false); assert.equal(ordinary.stops, 0);
  context.state = 'suspended'; assert.equal(audio.warnDanger('danger2'), false); assert.equal(ordinary.stops, 0);
  FakeContext.decodeHandler = null; await audio.unlock(); await audio.preload();
  assert.equal(audio.warnDanger('danger1'), true); await flush();
  assert.match(context.sources.at(-1)!.buffer!.file, /DangerZone01\.wav$/);
  const locked = createGameplayAudio();
  try {
    await locked.preload(); assert.equal(locked.warnDanger(), false);
    await locked.unlock(); assert.equal(locked.warnDanger(), true); await flush();
  } finally { locked.dispose(); }
}));

test('equal-power fades preserve nominal energy and authored mix keeps speech above support', () => {
  for (let i = 0; i <= 100; i++) {
    const [outgoing, incoming] = equalPowerCrossfade(i / 100);
    assert.ok(Math.abs(outgoing ** 2 + incoming ** 2 - 1) < 1e-12);
  }
  assert.deepEqual(equalPowerCrossfade(-1), [1, 0]);
  assert.equal(equalPowerCrossfade(2)[1], 1);
  const gains = GAMEPLAY_AUDIO.gains;
  assert.ok(gains.speech > gains.music && gains.music > gains.box && gains.box > gains.footsteps && gains.footsteps > gains.bonk);
});

test('all authored speech and transition files exist with sufficient natural duration', () => {
  const duration = (file: string) => {
    const bytes = readFileSync(file);
    let bytesPerSecond = 0, dataLength = 0;
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const tag = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
      if (tag === 'fmt ') bytesPerSecond = bytes.readUInt32LE(offset + 16);
      if (tag === 'data') dataLength = length;
      offset += length + 8 + length % 2;
    }
    return dataLength / bytesPerSecond;
  };
  for (const speech of Object.values(GAMEPLAY_SPEECH)) assert.ok(duration(`public/audio/SoundFX/${speech.file}`) > 2);
  for (const index of [1, 2, 3] as const) {
    assert.equal(duration(`public/audio/BackgroundSounds/Transition_${index}.wav`), GAMEPLAY_AUDIO.transitionSourceSeconds[index]);
    assert.ok(GAMEPLAY_AUDIO.transitionOffsetSeconds[index] + GAMEPLAY_AUDIO.transitionSeconds[index] <= GAMEPLAY_AUDIO.transitionSourceSeconds[index]);
  }
});

test('measured normalization keeps background loudness consistent and sums within fixed headroom', () => {
  const levels = Object.entries(GAMEPLAY_SOURCE_LEVELS).filter(([file]) => /^(Ambience|Transition)_/.test(file));
  for (const [file, source] of levels) {
    const normalized = gameplayMusicLevel(`/audio/BackgroundSounds/${file}`);
    assert.ok(Math.abs(normalized * source.rms - GAMEPLAY_AUDIO.gains.music * GAMEPLAY_AUDIO.normalization.musicRms) < 1e-12);
  }
  const musicPeak = Math.max(...levels.map(([file, source]) => gameplayMusicLevel(file) * source.peak)) * Math.SQRT2;
  const speechPeak = Math.max(...Object.values(GAMEPLAY_SPEECH).map(({ file }) => gameplayEffectLevel(file, GAMEPLAY_AUDIO.gains.speech, true) * GAMEPLAY_SOURCE_LEVELS[file].peak));
  const supportingPeaks = GAMEPLAY_AUDIO.normalization.effectPeak * (GAMEPLAY_AUDIO.gains.box +
    GAMEPLAY_AUDIO.gains.footsteps * GAMEPLAY_AUDIO.explorationFootsteps.gainRange[1] + GAMEPLAY_AUDIO.gains.bonk + GAMEPLAY_AUDIO.gains.roomTilting);
  assert.ok((musicPeak + speechPeak + supportingPeaks) * GAMEPLAY_AUDIO.gains.master < .9, 'a full crossfade, speech, box, footsteps and bonk leave headroom');
});

test('normalization metadata matches the actual authored transition and supporting excerpts', () => {
  const excerpts: { folder: string; file: string; offset: number; seconds: number }[] = [
    ...DANGER_VOICE_CUES.map(cue => ({ folder: 'SoundFX', file: GAMEPLAY_SPEECH[cue].file, offset: 0,
      seconds: cue === 'danger3' ? 3.9803125 : 5.345645833333333 })),
    { folder: 'SoundFX', file: 'SitDownOnTheBox.wav', offset: 0, seconds: 3.9803125 },
    { folder: 'SoundFX', file: 'CLEANTHEROOM.wav', offset: 0, seconds: 3.9873125 },
    { folder: 'SoundFX', file: 'WhatIsReality.wav', offset: 0, seconds: 6.710979166666666 },
    { folder: 'SoundFX', file: 'RoomTilting.wav', offset: GAMEPLAY_AUDIO.roomTilting.loopStartSeconds,
      seconds: GAMEPLAY_AUDIO.roomTilting.loopEndSeconds - GAMEPLAY_AUDIO.roomTilting.loopStartSeconds },
    ...([1, 2, 3] as const).map(index => ({ folder: 'BackgroundSounds', file: `Transition_${index}.wav`,
      offset: GAMEPLAY_AUDIO.transitionOffsetSeconds[index], seconds: GAMEPLAY_AUDIO.transitionSeconds[index] })),
    { folder: 'SoundFX', file: 'BoxMoving01.wav', offset: GAMEPLAY_AUDIO.boxEffectOffsetSeconds.box1, seconds: GAMEPLAY_AUDIO.boxEffectSeconds },
    { folder: 'SoundFX', file: 'BoxMoving03.wav', offset: GAMEPLAY_AUDIO.boxEffectOffsetSeconds.box2, seconds: GAMEPLAY_AUDIO.boxEffectSeconds },
    ...GAMEPLAY_AUDIO.explorationFootsteps.clips.map(file => ({ folder: 'SoundFX', file, offset: 0, seconds: GAMEPLAY_AUDIO.explorationFootstepSeconds })),
    ...GAMEPLAY_AUDIO.explorationEvents.map(event => ({ folder: 'SoundFX', file: event.clip, offset: 0, seconds: GAMEPLAY_AUDIO.explorationBonkSeconds })),
  ];
  for (const excerpt of excerpts) {
    const bytes = readFileSync(`public/audio/${excerpt.folder}/${excerpt.file}`);
    let bits = 0, rate = 0, channels = 0, dataStart = 0, dataEnd = 0;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const tag = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
      if (tag === 'fmt ') { bits = bytes.readUInt16LE(offset + 22); rate = bytes.readUInt32LE(offset + 12); channels = bytes.readUInt16LE(offset + 10); }
      if (tag === 'data') { dataStart = offset + 8; dataEnd = dataStart + length; }
      offset += length + 8 + length % 2;
    }
    const sampleBytes = bits / 8, bytesPerSecond = rate * channels * sampleBytes;
    const start = dataStart + Math.floor(excerpt.offset * bytesPerSecond);
    const end = start + Math.floor(excerpt.seconds * bytesPerSecond);
    assert.ok(end <= dataEnd, `${excerpt.file}: authored excerpt must fit the actual file`);
    let peak = 0, squared = 0, samples = 0;
    for (let offset = start; offset < end; offset += sampleBytes) {
      const value = bytes.readIntLE(offset, sampleBytes) / (2 ** (bits - 1));
      peak = Math.max(peak, Math.abs(value)); squared += value * value; samples++;
    }
    const recorded = GAMEPLAY_SOURCE_LEVELS[excerpt.file];
    assert.ok(Math.abs(recorded.peak - peak) < 1e-6 && Math.abs(recorded.rms - Math.sqrt(squared / samples)) < 1e-6,
      `${excerpt.file}: remeasure normalization after changing its source, offset, or duration`);
  }
});

test('preload streams music metadata and decodes only short local effects once', async () => fixture(async (audio, context, fetched) => {
  await audio.preload(); await audio.preload();
  assert.equal(FakeMedia.instances.length, 7);
  assert.equal(context.mediaNodes, 7);
  assert.ok(FakeMedia.instances.every(media => media.preload === 'metadata' && media.plays === 0));
  assert.ok(fetched.every(file => file.startsWith('/audio/SoundFX/')));
  assert.equal(new Set(fetched).size, fetched.length);
  const expectedFiles = new Set([
    ...Object.values(GAMEPLAY_SPEECH).map(speech => speech.file),
    'BoxMoving01.wav', 'BoxMoving03.wav', ...GAMEPLAY_AUDIO.explorationFootsteps.clips,
    ...GAMEPLAY_AUDIO.explorationEvents.map(event => event.clip), GAMEPLAY_AUDIO.roomTilting.file,
  ]);
  assert.equal(fetched.length, expectedFiles.size);
  for (const file of expectedFiles) assert.ok(fetched.includes(`/audio/SoundFX/${file}`));
  assert.equal(fetched.filter(file => file.endsWith('/WhatIsReality.wav')).length, 1);
  assert.equal(fetched.filter(file => file.endsWith('/SitDownOnTheBox.wav')).length, 1);
  assert.equal(context.sources.length, 0);
}));

test('music runs all seven parts in order at one unchanged nominal gain', async () => fixture(async (audio, context) => {
  audio.start(0); await flush();
  const parts = ['Ambience_1', 'Transition_1', 'Ambience_2', 'Transition_2', 'Ambience_3', 'Transition_3', 'Ambience_4'];
  assert.ok(audio.snapshot().currentMusic?.includes(parts[0]));
  let at = 0;
  for (const index of [1, 2, 3] as const) {
    advance(audio, context, at, at + 2); at += 2;
    assert.equal(audio.transition(index), true);
    assert.equal(audio.transition(index), false, 'duplicate transition cannot restart its anticipation');
    await flush();
    assert.ok(audio.snapshot().currentMusic?.includes(parts[index * 2 - 1]));
    const end = at + GAMEPLAY_AUDIO.transitionSeconds[index];
    advance(audio, context, at, end); at = end;
    await flush();
    assert.ok(audio.snapshot().currentMusic?.includes(parts[index * 2]));
  }
  assert.equal(audio.snapshot().musicStarts, 7);
  const musicGains = context.gains.slice(1);
  for (let index = 0; index < musicGains.length; index++) {
    const gain = musicGains[index];
    const fades = gain.events.filter(event => event.type === 'curve');
    const expected = gameplayMusicLevel(FakeMedia.instances[index].src);
    assert.ok(fades.some(event => Math.abs(event.values[32] - expected) < 1e-7));
  }
  assert.equal(FakeMedia.instances.filter(media => media.loop).length, 7,
    'Every background track loops until a ready replacement takes over.');
}));

test('speech queues complete natural takes, without touching background gains, and boxes use brief envelopes', async () => fixture(async (audio, context) => {
  audio.start(); await flush();
  const musicGain = context.gains[1], before = musicGain.events.length;
  audio.speech('turned'); audio.speech('classroom'); audio.effect('box2');
  await flush();
  assert.equal(audio.isSpeechPlaying('turned'), true);
  assert.equal(audio.isSpeechPlaying('classroom'), false);
  assert.deepEqual(audio.snapshot().queuedSpeech, ['classroom']);
  assert.equal(musicGain.events.length, before, 'speech and effects never duck the music');
  const turned = context.sources.find(source => source.buffer?.file.includes('TheHallwayTurned'))!;
  assert.equal(turned.starts[0][2], 6, 'spoken recording retains its natural duration');
  const box = context.sources.find(source => source.buffer?.file.includes('BoxMoving03'))!;
  assert.equal(box.starts[0][1], GAMEPLAY_AUDIO.boxEffectOffsetSeconds.box2);
  assert.equal(box.starts[0][2], GAMEPLAY_AUDIO.boxEffectSeconds);
  turned.finish(); await flush();
  assert.equal(audio.isSpeechPlaying('classroom'), true);
  assert.equal(audio.snapshot().speechStarts, 2);
  audio.stopSpeech();
  assert.equal(audio.isSpeechPlaying('classroom'), false);
  assert.ok(audio.snapshot().currentMusic?.includes('Ambience_1'));
}));

test('sit and classroom use complete supplied WAVs in order without changing the ambient bed', async () => fixture(async (audio, context) => {
  FakeContext.decodeHandler = async file => ({file,duration:file.includes('SitDownOnTheBox')?3.9803125:2.736});
  audio.start();await flush();
  const musicGain=context.gains[1],before=JSON.stringify(musicGain.events),bed=audio.snapshot().currentMusic;
  audio.speech('sitOnBox');await flush();
  const sit=context.sources.find(source=>source.buffer?.file.endsWith('/SitDownOnTheBox.wav'))!;
  assert.ok(sit);assert.equal(sit.starts[0][2],3.9803125);
  audio.speech('classroom');await flush();
  assert.deepEqual(audio.snapshot().queuedSpeech,['classroom']);
  assert.equal(audio.isSpeechPlaying('sitOnBox'),true);assert.equal(audio.isSpeechPlaying('classroom'),false);
  sit.finish();await flush();
  const classroom=context.sources.find(source=>source.buffer?.file.endsWith('/GoBackToTheClassRoom.wav'))!;
  assert.ok(classroom);assert.equal(classroom.starts[0][2],2.736);
  assert.equal(audio.isSpeechPlaying('classroom'),true);
  assert.equal(JSON.stringify(musicGain.events),before);assert.equal(audio.snapshot().currentMusic,bed);
}));

test('box effects select the audible source excerpts and clamp or skip short files', async () => fixture(async (audio, context) => {
  FakeContext.decodeHandler = async file => ({ file, duration: file.includes('BoxMoving01') ? 3 : 1 });
  audio.effect('box1'); audio.effect('box2'); await flush();
  assert.equal(context.sources.length, 1, 'a file ending before the authored offset is skipped');
  const box = context.sources[0];
  assert.equal(box.starts[0][1], GAMEPLAY_AUDIO.boxEffectOffsetSeconds.box1);
  assert.equal(box.starts[0][2], 3 - GAMEPLAY_AUDIO.boxEffectOffsetSeconds.box1, 'duration is bounded by the actual available audio');
}));

test('exploration footsteps and faint bonks stop permanently at the first transition', async () => fixture(async (audio, context) => {
  audio.start();
  for (let at = .25; at <= 20; at += .25) { context.currentTime = at; audio.update(at); await flush(); }
  const footSources = context.sources.filter(source => source.buffer?.file.includes('/Footsteps'));
  assert.equal(footSources.length, 3);
  assert.equal(audio.snapshot().effectStarts, GAMEPLAY_AUDIO.explorationEvents.length + 3);
  assert.deepEqual(footSources.map(source => source.starts[0][0]), [4.525,11.025,17.525]);
  assert.equal(context.panners.length, 3);
  assert.ok(context.panners.every(pan => pan.events.length === 2 && pan.events[0][0] === -pan.events[1][0]));
  const explorationSources = [...context.sources];
  assert.ok(explorationSources.every(source => source.starts[0][2] <= GAMEPLAY_AUDIO.explorationFootstepSeconds));
  audio.transition(1); advance(audio, context, 20, 50); await flush();
  assert.ok(explorationSources.every(source => source.stops > 0), 'transition ends all still-active exploration layers');
  assert.equal(audio.snapshot().effectStarts, GAMEPLAY_AUDIO.explorationEvents.length + 3);
  assert.ok(context.panners.every(pan => pan.disconnected), 'cancelled footstep panners release their nodes');
  assert.equal(audio.snapshot().explorationFootsteps.active, false);
  audio.start(50);
  for (let at = 50.25; at <= 56; at += .25) { context.currentTime = at; audio.update(at); await flush(); }
  assert.equal(audio.snapshot().effectStarts, GAMEPLAY_AUDIO.explorationEvents.length + 4, 'fresh run starts its exploration clock again');
}));

test('a late effect decode skips its missed reveal while speech can wait for a recording', async () => fixture(async (audio, context) => {
  const finishes: (() => void)[] = [];
  FakeContext.decodeHandler = file => new Promise(resolve => { finishes.push(() => resolve({ file, duration: 6 })); });
  audio.start(); audio.effect('box1'); audio.speech('welcome'); await flush();
  audio.update(.5);
  for (const finish of finishes) finish();
  await flush();
  assert.equal(audio.snapshot().effectStarts, 0);
  assert.equal(audio.snapshot().speechStarts, 1);
  assert.equal(context.sources.length, 1);
}));

test('pending random footsteps cannot revive after transition, mute, reset or disposal', async () => {
  for (const cancel of ['transition','mute','reset','dispose'] as const) await fixture(async (audio, context) => {
    let finish: (() => void) | null = null;
    FakeContext.decodeHandler = file => file.includes('/Footsteps') ? new Promise(resolve => { finish = () => resolve({ file,duration: 6 }); })
      : Promise.resolve({ file,duration: 6 });
    audio.start(); advance(audio,context,0,4.5); await flush();
    assert.ok(finish, 'a current random pass must have requested its recording');
    if (cancel === 'transition') audio.transition(1);
    else if (cancel === 'mute') audio.setMuted(true);
    else if (cancel === 'reset') audio.stop();
    else audio.dispose();
    (finish as () => void)(); await flush();
    assert.equal(context.sources.filter(source => source.buffer?.file.includes('/Footsteps')).length, 0, cancel);
    assert.equal(context.panners.length, 0, 'discarded playback must not allocate a panner');
  });
});

test('stop and mute cancel pending decodes and queued speech without reviving old cues', async () => fixture(async (audio, context) => {
  let finish!: (buffer: { duration: number; file: string }) => void;
  FakeContext.decodeHandler = file => new Promise(resolve => { finish = buffer => resolve({ ...buffer, file }); });
  audio.speech('turned'); audio.speech('classroom');
  await flush();
  audio.stop();
  finish({ duration: 6, file: '' }); await flush();
  assert.equal(context.sources.length, 0);
  assert.deepEqual(audio.snapshot().queuedSpeech, []);
  FakeContext.decodeHandler = null;
  audio.start(); await flush();
  audio.speech('welcome'); await flush();
  audio.setMuted(true);
  assert.equal(audio.isSpeechPlaying('welcome'), false);
  assert.ok(context.sources.every(source => source.stops > 0));
  assert.ok(FakeMedia.instances.every(media => media.paused));
  const oldStarts = audio.snapshot().speechStarts;
  audio.setMuted(false); audio.update(.25); await flush();
  assert.equal(audio.snapshot().speechStarts, oldStarts);
  assert.ok(audio.snapshot().currentMusic?.includes('Ambience_1'), 'background resumes, while old one-shots remain cancelled');
}));

test('late media play cannot revive a stopped run or silence a newer run using the same track', async () => fixture(async (audio) => {
  const completions: (() => void)[] = [];
  FakeMedia.playHandler = () => new Promise(resolve => completions.push(resolve));
  audio.start(); await flush();
  audio.stop(); audio.start(); await flush();
  assert.equal(completions.length, 2);
  completions[1](); await flush();
  const media = FakeMedia.instances[0], pauses = media.pauses;
  completions[0](); await flush();
  assert.equal(media.pauses, pauses, 'an old promise cannot pause the new stream');
  assert.equal(audio.snapshot().musicStarts, 1);
  audio.stop();
  assert.equal(media.paused, true);
}));

test('a transient effect decode failure retries later, while successful buffers are reused', async () => fixture(async (audio, context, fetched) => {
  let attempt = 0;
  FakeContext.decodeHandler = async file => {
    if (++attempt === 1) throw new Error('temporary decode failure');
    return { file, duration: 2 };
  };
  audio.speech('welcome'); await flush();
  assert.equal(context.sources.length, 0);
  audio.speech('welcome'); await flush();
  assert.equal(context.sources.length, 1);
  context.sources[0].finish();
  audio.speech('welcome'); await flush();
  assert.equal(context.sources.length, 2);
  assert.equal(fetched.length, 2);
}));

test('render stalls and stale clocks leave music playing while explicit mute and stop retain authority', async () => fixture(async (audio, context) => {
  audio.start(10); audio.speech('welcome'); await flush();
  const media = FakeMedia.instances[0], pauses = media.pauses;
  media.currentTime = 12;
  audio.update(10.6);
  audio.update(Number.NaN); audio.update(9);
  assert.equal(audio.snapshot().running, true);
  assert.equal(media.paused, false); assert.equal(media.pauses, pauses);
  assert.equal(media.currentTime, 12, 'The background must not rewind on a fitting hitch.');
  assert.equal(audio.isSpeechPlaying('welcome'), true);
  audio.setMuted(true); audio.start(20); audio.speech('welcome');
  context.currentTime = 20; audio.update(20.25); await flush();
  assert.equal(audio.snapshot().muted, true);
  assert.equal(audio.snapshot().currentMusic, null);
  assert.equal(audio.transition(3), false, 'a run cannot skip prior music phases');
  audio.update(Number.NaN);
  assert.equal(audio.snapshot().running, true);
  audio.stop();
  assert.equal(audio.snapshot().running, false);
  assert.ok(FakeMedia.instances.every(media => media.paused));
}));

test('a long update skips missed support sounds without stopping or restarting the ambient bed', async () => fixture(async (audio, context) => {
  audio.start(); await flush();
  const media = FakeMedia.instances[0], plays = media.plays, pauses = media.pauses;
  context.currentTime = 19; audio.update(19); await flush();
  assert.equal(audio.snapshot().running, true);
  assert.equal(media.plays, plays); assert.equal(media.pauses, pauses);
  assert.equal(context.sources.length, 0, 'Missed footsteps/knocks must not burst out after a long render stall.');
  assert.ok(audio.snapshot().currentMusic?.endsWith('/Ambience_1.wav'));
}));

test('a delayed ambience leaves the transition loop audible until its replacement actually starts', async () => fixture(async (audio, context) => {
  audio.start(); await flush();
  advance(audio, context, 0, 2);
  assert.equal(audio.transition(1), true); await flush();
  const outgoing = FakeMedia.instances.find(media => media.src.endsWith('/Transition_1.wav'))!;
  const outgoingGain = context.gains[2], before = outgoingGain.events.length;
  let complete!: () => void;
  FakeMedia.playHandler = media => media.src.endsWith('/Ambience_2.wav')
    ? new Promise(resolve => { complete = resolve; }) : Promise.resolve();
  context.currentTime = 50; audio.update(50); await flush();
  assert.equal(audio.snapshot().running, true);
  assert.equal(outgoing.loop, true); assert.equal(outgoing.paused, false);
  assert.equal(outgoingGain.events.length, before, 'A zero-gain pending replacement cannot fade out the playing bed.');
  assert.ok(audio.snapshot().currentMusic?.endsWith('/Transition_1.wav'));
  complete(); await flush();
  assert.ok(audio.snapshot().currentMusic?.endsWith('/Ambience_2.wav'));
  assert.equal(outgoing.paused, false, 'The outgoing music overlaps the new ambience during its fade.');
  context.currentTime += GAMEPLAY_AUDIO.crossfadeSeconds + .1;
  audio.update(50.25);
  assert.equal(outgoing.paused, true);
}));

test('a rejected replacement preserves the looping bed and a later audio gesture can retry', async () => fixture(async (audio, context) => {
  audio.start(); await flush();
  advance(audio, context, 0, 2); audio.transition(1); await flush();
  const outgoing = FakeMedia.instances.find(media => media.src.endsWith('/Transition_1.wav'))!;
  let failures = 0;
  FakeMedia.playHandler = async media => {
    if (media.src.endsWith('/Ambience_2.wav')) { failures++; throw new Error('Temporary media playback failure'); }
  };
  context.currentTime = 50; audio.update(50); await flush();
  audio.update(51); await flush();
  assert.equal(failures, 1, 'Rejected media must not retry on every render frame.');
  assert.equal(outgoing.paused, false); assert.equal(outgoing.loop, true);
  assert.ok(audio.snapshot().currentMusic?.endsWith('/Transition_1.wav'));
  FakeMedia.playHandler = null; await audio.unlock(); audio.update(51.25); await flush();
  assert.ok(audio.snapshot().currentMusic?.endsWith('/Ambience_2.wav'));
}));

test('an unexpectedly paused current bed resumes once without rewinding or reallocating music nodes', async () => fixture(async (audio, context) => {
  audio.start(); await flush();
  const media = FakeMedia.instances[0], gainEvents = context.gains[1].events.length;
  media.currentTime = 12; media.pause();
  audio.update(1); audio.update(1.1); await flush();
  assert.equal(media.plays, 2); assert.equal(media.paused, false); assert.equal(media.currentTime, 12);
  assert.equal(context.mediaNodes, 1); assert.equal(context.gains[1].events.length, gainEvents);
  audio.update(1.2); await flush(); assert.equal(media.plays, 2);
}));

test('clean-room speech joins the full-length FIFO without changing the background', async () => fixture(async (audio, context, fetched) => {
  audio.start(); await flush();
  const media = FakeMedia.instances[0], musicGain = context.gains[1], gainEvents = musicGain.events.length;
  audio.speech('turned'); audio.speech('cleanRoom'); await flush();
  assert.deepEqual(audio.snapshot().queuedSpeech, ['cleanRoom']);
  assert.equal(audio.isSpeechPlaying('cleanRoom'), false);
  context.sources[0].finish(); await flush();
  assert.equal(audio.isSpeechPlaying('cleanRoom'), true);
  const speech = context.sources.find(source => source.buffer?.file.endsWith('/CLEANTHEROOM.wav'))!;
  assert.deepEqual(speech.starts, [[.025, 0, 6]], 'the whole synthetic recording plays at its natural rate');
  assert.ok(fetched.some(path => path.endsWith('/CLEANTHEROOM.wav')));
  assert.equal(musicGain.events.length, gainEvents);
  assert.equal(media.paused, false);
  assert.equal(GAMEPLAY_SPEECH.cleanRoom.caption, 'Clean the room.');
}));

test('room tilting loops only actual inward/return observations and reuses its buffer independently of speech/music', async () => fixture(async (audio, context, fetched) => {
  await audio.preload();
  audio.start(); await flush();
  const media = FakeMedia.instances[0], musicGain = context.gains[1], gainEvents = musicGain.events.length;
  assert.equal(audio.setRoomTilting(false), false);
  assert.equal(audio.snapshot().roomTiltingStarts, 0);
  assert.equal(audio.setRoomTilting(true), true);
  const inward = context.sources[0], inwardGain = context.gains.at(-1)!;
  assert.equal(inward.loop, true);
  assert.equal(inward.loopStart, .5); assert.equal(inward.loopEnd, 4.5);
  assert.deepEqual(inward.starts, [[0, .5]]);
  for (let frame = 0; frame < 30; frame++) assert.equal(audio.setRoomTilting(true), true);
  assert.equal(context.sources.length, 1, 'repeated movement observations retain one loop');
  assert.equal(audio.snapshot().roomTiltingPlaying, true);
  audio.speech('cleanRoom'); await flush();
  audio.stopSpeech();
  assert.equal(audio.snapshot().roomTiltingPlaying, true, 'a speech-only stop leaves movement sound running');
  context.currentTime = .25;
  const oldEnded = inward.onended!;
  audio.setRoomTilting(false);
  assert.equal(audio.snapshot().roomTiltingPlaying, false);
  assert.deepEqual(inward.stopTimes.at(-1), [.25 + GAMEPLAY_AUDIO.roomTilting.releaseSeconds]);
  assert.deepEqual(inwardGain.events.at(-1), { type: 'ramp', values: [0, .25 + GAMEPLAY_AUDIO.roomTilting.releaseSeconds] });
  assert.equal(audio.setRoomTilting(true), true);
  const returning = context.sources.at(-1)!;
  assert.equal(returning.buffer, inward.buffer);
  assert.equal(audio.snapshot().roomTiltingStarts, 2);
  oldEnded();
  assert.equal(audio.snapshot().roomTiltingPlaying, true, 'an old ended callback cannot clear the return loop');
  audio.setRoomTilting(false); returning.finish();
  assert.equal(audio.snapshot().roomTiltingPlaying, false);
  assert.equal(fetched.filter(file => file.endsWith('/RoomTilting.wav')).length, 1);
  assert.equal(musicGain.events.length, gainEvents);
  assert.equal(media.paused, false);
}));

test('a room-tilting decode finishing after movement stops waits for another true observation', async () => fixture(async (audio, context) => {
  let finish!: () => void;
  FakeContext.decodeHandler = file => new Promise(resolve => { finish = () => resolve({ file, duration: 9.625 }); });
  assert.equal(audio.setRoomTilting(true), false);
  await flush();
  audio.setRoomTilting(false); finish(); await flush();
  assert.equal(context.sources.length, 0);
  assert.equal(audio.snapshot().roomTiltingPlaying, false);
  assert.equal(audio.snapshot().roomTiltingReady, true);
  assert.equal(audio.setRoomTilting(true), true, 'only a current movement observation starts the decoded loop');
  assert.equal(context.sources.length, 1);
}));

test('a failed room-tilting load retries on the next movement while successful buffers stay cached', async () => fixture(async (audio, context, fetched) => {
  let attempts = 0;
  FakeContext.decodeHandler = async file => {
    if (++attempts === 1) throw new Error('temporary room sound decode failure');
    return { file, duration: 9.625 };
  };
  audio.setRoomTilting(true); await flush();
  for (let frame = 0; frame < 30; frame++) audio.setRoomTilting(true);
  await flush();
  assert.equal(attempts, 1, 'a failed load does not retry on every frame of one movement');
  audio.setRoomTilting(false); audio.setRoomTilting(true); await flush();
  assert.equal(context.sources.length, 0, 'decode completion alone has no movement authority');
  audio.setRoomTilting(true);
  assert.equal(context.sources.length, 1);
  audio.setRoomTilting(false); audio.setRoomTilting(true);
  assert.equal(context.sources.length, 2);
  assert.equal(fetched.filter(file => file.endsWith('/RoomTilting.wav')).length, 2);
}));

test('a room-tilting resume finishing after false, stop, mute or disposal cannot start playback', async () => {
  for (const cancel of ['false', 'stop', 'mute', 'dispose']) await fixture(async (audio, context) => {
    await audio.preload();
    let resume!: () => void;
    context.state = 'suspended';
    FakeContext.resumeHandler = current => new Promise(resolve => { resume = () => { current.state = 'running'; resolve(); }; });
    assert.equal(audio.setRoomTilting(true), false);
    if (cancel === 'false') audio.setRoomTilting(false);
    else if (cancel === 'stop') audio.stop();
    else if (cancel === 'mute') audio.setMuted(true);
    else audio.dispose();
    resume(); await flush();
    assert.equal(context.sources.length, 0, `${cancel}: late resume cannot play`);
    assert.equal(audio.snapshot().roomTiltingPlaying, false);
    assert.equal(audio.snapshot().roomTiltingMoving, false);
  });
});

test('mute, game reset and disposal silence active/releasing tilt loops without altering the background mix', async () => fixture(async (audio, context) => {
  await audio.preload(); audio.start(); await flush();
  audio.setRoomTilting(true);
  const first = context.sources[0];
  audio.setMuted(true);
  assert.equal(first.stops, 1);
  assert.equal(audio.snapshot().roomTiltingPlaying, false);
  assert.equal(audio.setRoomTilting(true), false);
  audio.setMuted(false); audio.update(.25); await flush();
  assert.equal(audio.snapshot().roomTiltingStarts, 1, 'unmuting never revives an old movement observation');
  audio.setRoomTilting(true); audio.setRoomTilting(false);
  const releasing = context.sources.at(-1)!;
  audio.start(0);
  assert.ok(releasing.stops >= 2, 'new games immediately cancel a pending release');
  assert.equal(audio.snapshot().roomTiltingPlaying, false);
  audio.setRoomTilting(true);
  const final = context.sources.at(-1)!;
  audio.dispose();
  assert.equal(final.stops, 1);
  assert.equal(audio.snapshot().roomTiltingPlaying, false);
  assert.equal(audio.setRoomTilting(true), false);
}));

test('room tilting requires an initial audio gesture and respects short source bounds', async () => fixture(async () => {
  const locked = createGameplayAudio();
  try {
    await locked.preload();
    const context = FakeContext.instances.at(-1)!;
    assert.equal(context.state, 'suspended');
    assert.equal(locked.setRoomTilting(true), false);
    await flush();
    assert.equal(context.state, 'suspended');
    assert.equal(context.sources.length, 0);
    await locked.unlock();
    assert.equal(context.sources.length, 0, 'unlock completion itself cannot play a previous observation');
    assert.equal(locked.setRoomTilting(true), true);
  } finally { locked.dispose(); }
  for (const duration of [.25, 2]) {
    FakeContext.decodeHandler = async file => ({ file, duration });
    const short = createGameplayAudio();
    try {
      await short.unlock(); await short.preload();
      assert.equal(short.setRoomTilting(true), duration > GAMEPLAY_AUDIO.roomTilting.loopStartSeconds);
      const source = FakeContext.instances.at(-1)!.sources.at(-1);
      if (source) assert.equal(source.loopEnd, duration);
    } finally { short.dispose(); }
  }
}));

test('reality ending immediately replaces ordinary/danger speech, music and support with one full cached line', async () => fixture(async (audio, context, fetched) => {
  await audio.preload(); audio.start(); await flush();
  audio.effect('box1'); audio.setRoomTilting(true); audio.speech('welcome'); audio.speech('classroom'); await flush();
  assert.equal(audio.warnDanger('danger1'), true); await flush();
  const previous = [...context.sources];
  audio.finishReality(); audio.finishReality(); await flush();
  assert.equal(audio.snapshot().realityFinished, true); assert.equal(audio.snapshot().running, false);
  assert.equal(audio.snapshot().currentMusic, null); assert.ok(FakeMedia.instances.every(media => media.paused));
  assert.ok(previous.every(source => source.stops > 0), 'every previous effect, warning and tilt layer stops');
  assert.equal(audio.snapshot().roomTiltingPlaying, false); assert.equal(audio.snapshot().explorationFootsteps.active, false);
  assert.deepEqual(audio.snapshot().queuedSpeech, []); assert.deepEqual(audio.snapshot().playingSpeech, ['whatIsReality']);
  const final = context.sources.filter(source => source.buffer?.file.endsWith('/WhatIsReality.wav'));
  assert.equal(final.length, 1); assert.deepEqual(final[0].starts, [[.025, 0, 6]], 'full synthetic recording, without excerpting or looping');
  audio.speech('cleanRoom'); audio.effect('box2'); assert.equal(audio.warnDanger('danger2'), false);
  assert.equal(audio.setRoomTilting(true), false); audio.finishReality(); await flush();
  assert.deepEqual(audio.snapshot().playingSpeech, ['whatIsReality']); assert.equal(final[0].stops, 0);
  final[0].finish(); audio.finishReality(); await flush();
  assert.equal(context.sources.filter(source => source.buffer?.file.endsWith('/WhatIsReality.wav')).length, 1);
  audio.start(10); assert.equal(audio.snapshot().realityFinished, false);
  audio.finishReality(); await flush();
  assert.equal(context.sources.filter(source => source.buffer?.file.endsWith('/WhatIsReality.wav')).length, 2);
  assert.equal(fetched.filter(file => file.endsWith('/WhatIsReality.wav')).length, 1);
  assert.equal(FakeContext.instances.length, 1); assert.equal(GAMEPLAY_SPEECH.whatIsReality.caption, 'What is reality?');
}));

test('late ordinary decode cannot follow the final reality line or block it behind an old FIFO owner', async () => fixture(async (audio, context) => {
  let finishOrdinary!: () => void;
  FakeContext.decodeHandler = file => file.endsWith('/Welcome To The Hallway.wav')
    ? new Promise(resolve => { finishOrdinary = () => resolve({ file, duration: 6 }); })
    : Promise.resolve({ file, duration: 6.710979166666666 });
  audio.start(); audio.speech('welcome'); audio.speech('classroom'); await flush();
  assert.ok(finishOrdinary);
  audio.finishReality(); await flush();
  assert.deepEqual(audio.snapshot().playingSpeech, ['whatIsReality']);
  finishOrdinary(); await flush();
  assert.equal(context.sources.length, 1); assert.deepEqual(audio.snapshot().queuedSpeech, []);
  assert.deepEqual(context.sources[0].starts, [[.025, 0, 6.710979166666666]]);
}));

test('stop, fresh game, mute and disposal cancel a final decode or authorized resume without revival', async () => {
  for (const stage of ['decode', 'resume']) for (const action of ['stop', 'start', 'mute', 'dispose']) {
    await fixture(async (audio, context) => {
      let release!: () => void;
      if (stage === 'decode') FakeContext.decodeHandler = file => new Promise(resolve => {
        release = () => resolve({ file, duration: 6.710979166666666 });
      });
      else {
        await audio.preload(); context.state = 'suspended';
        let resumes = 0;
        FakeContext.resumeHandler = current => ++resumes === 1
          ? new Promise(resolve => { release = () => { current.state = 'running'; resolve(); }; })
          : Promise.resolve().then(() => { current.state = 'running'; });
      }
      audio.finishReality(); await flush(); assert.ok(release);
      const releaseEnding = release;
      if (action === 'stop') audio.stop();
      else if (action === 'start') audio.start(10);
      else if (action === 'mute') audio.setMuted(true);
      else audio.dispose();
      releaseEnding(); await flush();
      assert.equal(context.sources.length, 0, `${stage}/${action}: stale final speech started`);
      assert.deepEqual(audio.snapshot().playingSpeech, []);
      if (action !== 'start') {
        if (action === 'mute') audio.setMuted(false);
        audio.finishReality(); await flush();
        assert.equal(context.sources.length, 0, `${stage}/${action}: ending was replayed without a new game`);
      }
    });
  }
});

test('a muted reality ending captions once and never follows a later unmute gesture', async () => fixture(async () => {
  const captions: string[] = [], ending = createGameplayAudio({ onCaption: text => captions.push(text) });
  try {
    await ending.unlock(); ending.setMuted(true); ending.finishReality(); ending.finishReality();
    assert.equal(captions.filter(caption => caption === 'What is reality?').length, 1);
    assert.equal(ending.snapshot().realityFinished, true);
    ending.setMuted(false); await ending.unlock(); ending.finishReality(); await flush();
    assert.equal(ending.snapshot().speechStarts, 0); assert.deepEqual(ending.snapshot().queuedSpeech, []);
  } finally { ending.dispose(); }
}));
