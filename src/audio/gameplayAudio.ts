import { GAMEPLAY_AUDIO, GAMEPLAY_SPEECH, gameplayEffectPath, gameplayMusicPath, gameplayMusicLevel, gameplayEffectLevel,
  type GameplayEffect, type GameplaySpeech, type GameplayTransition } from './gameplayAudioConfig.ts';
import { DANGER_VOICE_CUES, type GameplayDanger } from './gameplayAudioConfig.ts';
import { createExplorationFootsteps } from './explorationFootsteps.ts';

export { GAMEPLAY_AUDIO } from './gameplayAudioConfig.ts';

interface MusicLayer {
  element: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  gain: GainNode;
  path: string;
  request: number;
  from: number;
  to: number;
  fadeStart: number;
  fadeEnd: number;
}
interface EffectLayer { source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode | null; speech: GameplaySpeech | null; exploration: boolean }
interface TiltLayer { source: AudioBufferSourceNode; gain: GainNode; startedAt: number; level: number; cleaned: boolean }
export interface GameplayAudioOptions {
  onCaption?: (caption: string) => void;
  onStatus?: (status: string) => void;
  random?: () => number;
}

/** Equal-power weights keep a crossfade's nominal energy unchanged. */
export function equalPowerCrossfade(fraction: number): readonly [number, number] {
  const t = Math.max(0, Math.min(1, fraction));
  return [Math.cos(t * Math.PI / 2), Math.sin(t * Math.PI / 2)];
}

/** Streams long background WAVs; only short speech/effects are decoded into memory. */
export function createGameplayAudio(options: GameplayAudioOptions = {}) {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let disposed = false, muted = false, unlocked = false, running = false;
  let generation = 0, speechGeneration = 0, musicGeneration = 0, explorationGeneration = 0;
  let now = 0, startedAt = 0, explorationIndex = 0, lastTransition = 0;
  let transition: { index: GameplayTransition; startedAt: number } | null = null;
  let desiredMusic: string | null = null, requestedMusic: string | null = null, currentMusic: string | null = null;
  let pendingMusicRequest: number | null = null;
  let failedMusic: string | null = null;
  let message = 'Click ENABLE AUDIO to allow local music and sounds.';
  let musicStarts = 0, effectStarts = 0, speechStarts = 0;
  let speechBusy = false;
  let realityFinished = false;
  let currentSpeech: GameplaySpeech | null = null;
  let dangerWarnings = 0;
  const readyDanger = new Set<string>();
  const isDanger = (cue: GameplaySpeech | null): cue is GameplayDanger =>
    cue !== null && (DANGER_VOICE_CUES as readonly string[]).includes(cue);
  let tiltBuffer: AudioBuffer | null = null;
  let tiltLoading: Promise<void> | null = null;
  let tiltResuming: Promise<unknown> | null = null;
  let tiltLoadAttempted = false, tiltMoving = false, tiltStarts = 0;
  let tilting: TiltLayer | null = null, tiltReleasing: TiltLayer | null = null;
  const speechQueue: GameplaySpeech[] = [];
  const music = new Map<string, MusicLayer>();
  const effects = new Set<EffectLayer>();
  const buffers = new Map<string, Promise<AudioBuffer | null>>();
  const requests = new Set<AbortController>();
  const footsteps = createExplorationFootsteps(options.random);
  const status = (value: string) => { if (!disposed) { message = value; options.onStatus?.(value); } };
  const getContext = () => {
    if (disposed || typeof AudioContext === 'undefined') return null;
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : GAMEPLAY_AUDIO.gains.master;
      master.connect(context.destination);
    }
    return context;
  };
  const getMusic = (path: string): MusicLayer | null => {
    const cached = music.get(path);
    if (cached) return cached;
    const audio = getContext();
    if (!audio || !master || typeof Audio === 'undefined') return null;
    const element = new Audio();
    element.preload = 'metadata';
    element.src = path;
    // A delayed/rejected replacement must never let a transition end in silence.
    // Authored excerpt timing still crossfades away during ordinary playback.
    element.loop = true;
    const gain = audio.createGain();
    gain.gain.value = 0;
    const node = audio.createMediaElementSource(element);
    node.connect(gain).connect(master);
    const layer: MusicLayer = { element, gain, node, path, request: 0, from: 0, to: 0, fadeStart: 0, fadeEnd: 0 };
    music.set(path, layer);
    return layer;
  };
  const loadEffect = (file: string): Promise<AudioBuffer | null> => {
    const path = gameplayEffectPath(file), cached = buffers.get(path);
    if (cached) return cached;
    const audio = getContext();
    if (!audio) return Promise.resolve(null);
    const request = new AbortController();
    requests.add(request);
    const pending: Promise<AudioBuffer | null> = fetch(path, { signal: request.signal }).then(async response => {
      if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) return null;
      const decoded = await audio.decodeAudioData(await response.arrayBuffer());
      return Number.isFinite(decoded.duration) && decoded.duration > 0 ? decoded : null;
    }).catch(() => null).then(buffer => {
      if (buffer && !disposed && DANGER_VOICE_CUES.some(cue => GAMEPLAY_SPEECH[cue].file === file)) readyDanger.add(file);
      if (!buffer && buffers.get(path) === pending) buffers.delete(path);
      return buffer;
    }).finally(() => requests.delete(request));
    buffers.set(path, pending);
    return pending;
  };
  const cleanEffect = (layer: EffectLayer) => {
    layer.source.onended = null;
    layer.source.disconnect(); layer.gain.disconnect(); layer.pan?.disconnect(); effects.delete(layer);
  };
  const stopEffect = (layer: EffectLayer) => {
    try { layer.source.stop(); } catch { /* Already ended. */ }
    cleanEffect(layer);
  };
  const cleanTilt = (layer: TiltLayer) => {
    if (layer.cleaned) return;
    layer.cleaned = true;
    layer.source.onended = null;
    layer.source.disconnect(); layer.gain.disconnect();
    if (tilting === layer) tilting = null;
    if (tiltReleasing === layer) tiltReleasing = null;
  };
  const silenceTilt = (layer: TiltLayer) => {
    try { layer.source.stop(context?.currentTime ?? 0); } catch { /* Already ended. */ }
    cleanTilt(layer);
  };
  const stopRoomTilting = (immediate = false) => {
    tiltMoving = false; tiltLoadAttempted = false;
    if (immediate) {
      if (tilting) silenceTilt(tilting);
      if (tiltReleasing) silenceTilt(tiltReleasing);
      return;
    }
    if (!tilting) return;
    if (tiltReleasing) silenceTilt(tiltReleasing);
    const layer = tilting;
    tilting = null;
    if (!context || context.state !== 'running') { silenceTilt(layer); return; }
    tiltReleasing = layer;
    const at = context.currentTime, { attackSeconds, releaseSeconds } = GAMEPLAY_AUDIO.roomTilting;
    const level = layer.level * Math.min(1, Math.max(0, at - layer.startedAt) / attackSeconds);
    layer.gain.gain.cancelScheduledValues(at);
    layer.gain.gain.setValueAtTime(level, at);
    layer.gain.gain.linearRampToValueAtTime(0, at + releaseSeconds);
    try { layer.source.stop(at + releaseSeconds); } catch { cleanTilt(layer); }
  };
  const prepareRoomTilting = (): Promise<void> => {
    if (disposed || tiltBuffer) return Promise.resolve();
    if (tiltLoading) return tiltLoading;
    tiltLoadAttempted = true;
    const pending = loadEffect(GAMEPLAY_AUDIO.roomTilting.file).then(buffer => {
      if (!disposed && buffer) tiltBuffer = buffer;
      if (!disposed && !buffer) status('Local room-tilting sound unavailable.');
    }).finally(() => { if (tiltLoading === pending) tiltLoading = null; });
    tiltLoading = pending;
    return pending;
  };
  const silence = () => {
    generation++; speechGeneration++; musicGeneration++; explorationGeneration++;
    speechBusy = false; currentSpeech = null; speechQueue.length = 0;
    requestedMusic = currentMusic = null;
    pendingMusicRequest = null;
    failedMusic = null;
    stopRoomTilting(true);
    for (const layer of effects) stopEffect(layer);
    for (const layer of music.values()) {
      layer.request = musicGeneration;
      layer.element.pause();
      try { layer.element.currentTime = 0; } catch { /* Metadata is not ready yet. */ }
      layer.gain.gain.cancelScheduledValues(context?.currentTime ?? 0);
      layer.gain.gain.setValueAtTime(0, context?.currentTime ?? 0);
      layer.from = layer.to = 0;
    }
    options.onCaption?.('');
  };
  const stop = () => { running = false; desiredMusic = null; transition = null; footsteps.stop(); silence(); };
  const resumeAuthorized = async (audio: AudioContext) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([audio.resume().then(() => audio.state === 'running'),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 500); })]);
    } catch { return false; }
    finally { if (timer !== undefined) clearTimeout(timer); }
  };
  const ready = async (token: number) => {
    const audio = getContext();
    if (disposed || muted || token !== generation) return null;
    if (!audio) { status('Web Audio unavailable. Supplied speech transcript is on the PC.'); return null; }
    if (audio.state !== 'running') {
      if (!unlocked || !await resumeAuthorized(audio)) { status('Click ENABLE AUDIO to allow local music and sounds.'); return null; }
      if (disposed || muted || token !== generation) return null;
    }
    return audio;
  };
  const layerLevel = (layer: MusicLayer, time: number) => {
    if (time >= layer.fadeEnd || layer.fadeEnd <= layer.fadeStart) return layer.to;
    const fraction = Math.max(0, (time - layer.fadeStart) / (layer.fadeEnd - layer.fadeStart));
    return layer.to > layer.from
      ? layer.from + (layer.to - layer.from) * equalPowerCrossfade(fraction)[1]
      : layer.to + (layer.from - layer.to) * equalPowerCrossfade(fraction)[0];
  };
  const fade = (layer: MusicLayer, to: number, at: number) => {
    const from = layerLevel(layer, at), duration = GAMEPLAY_AUDIO.crossfadeSeconds;
    const curve = new Float32Array(33);
    for (let i = 0; i < curve.length; i++) {
      const weights = equalPowerCrossfade(i / (curve.length - 1));
      curve[i] = to > from ? from + (to - from) * weights[1] : to + (from - to) * weights[0];
    }
    layer.gain.gain.cancelScheduledValues(at);
    layer.gain.gain.setValueAtTime(from, at);
    layer.gain.gain.setValueCurveAtTime(curve, at, duration);
    layer.from = from; layer.to = to; layer.fadeStart = at; layer.fadeEnd = at + duration;
  };
  const ensureMusic = () => {
    const path = desiredMusic;
    if (!running || muted || disposed || !path || failedMusic === path) return;
    if (requestedMusic === path && (pendingMusicRequest !== null ||
        (currentMusic === path && music.get(path)?.element.paused === false && context?.state === 'running'))) return;
    requestedMusic = path;
    const token = generation, requestToken = ++musicGeneration;
    pendingMusicRequest = requestToken;
    void (async () => {
      const audio = await ready(token);
      if (!audio || token !== generation || requestToken !== musicGeneration || desiredMusic !== path) {
        if (token === generation && requestToken === musicGeneration && requestedMusic === path) requestedMusic = null;
        return;
      }
      const incoming = getMusic(path);
      if (!incoming) { requestedMusic = null; status('Background music unavailable in this browser.'); return; }
      incoming.request = requestToken;
      try {
        const transitionNumber = /\/Transition_([123])\.wav$/.exec(path)?.[1];
        const resuming = currentMusic === path && incoming.to > 0;
        if (!resuming) incoming.element.currentTime = transitionNumber
          ? GAMEPLAY_AUDIO.transitionOffsetSeconds[Number(transitionNumber) as GameplayTransition] : 0;
        await incoming.element.play();
        if (disposed || muted || !running || token !== generation || requestToken !== musicGeneration || desiredMusic !== path) {
          if (incoming.request === requestToken) incoming.element.pause();
          return;
        }
        const at = audio.currentTime;
        for (const layer of music.values()) if (layer !== incoming && layer.to > 0) fade(layer, 0, at);
        if (!resuming) fade(incoming, gameplayMusicLevel(path), at);
        currentMusic = path; musicStarts++;
        status('Local music and sounds ready.');
      } catch {
        if (token === generation && requestToken === musicGeneration) {
          requestedMusic = null;
          failedMusic = path;
          status('Background music could not start; click ENABLE AUDIO and retry.');
        }
      }
    })().finally(() => { if (pendingMusicRequest === requestToken) pendingMusicRequest = null; });
  };
  const playEffect = async (file: string, gainValue: number, speech: GameplaySpeech | null = null,
    maxSeconds?: number, exploration = false, offsetSeconds = 0, sweep?: readonly [number, number]): Promise<boolean> => {
    const token = generation, speechToken = speechGeneration, explorationToken = explorationGeneration, requestedAt = now;
    const audio = await ready(token);
    if (!audio || token !== generation) return false;
    const buffer = await loadEffect(file);
    if (disposed || muted || token !== generation || (speech && speechToken !== speechGeneration) ||
      (exploration && explorationToken !== explorationGeneration)) return false;
    if (!buffer) { status(speech ? 'Supplied speech file unavailable; transcript is on the PC.' : 'Local sound effect unavailable.'); return false; }
    // A late decode must not produce a box scrape or footstep after its event.
    if (!speech && now - requestedAt > GAMEPLAY_AUDIO.effectMaxDelaySeconds) return false;
    const offset = Math.max(0, offsetSeconds);
    const duration = Math.min(buffer.duration - offset, maxSeconds ?? buffer.duration);
    if (!Number.isFinite(offset) || !Number.isFinite(duration) || duration <= 0) return false;
    const source = audio.createBufferSource(), gain = audio.createGain();
    source.buffer = buffer;
    const at = audio.currentTime + .025;
    const attack = Math.min(GAMEPLAY_AUDIO.effectAttackSeconds, duration / 3);
    const release = Math.min(GAMEPLAY_AUDIO.effectReleaseSeconds, duration / 3);
    const level = gameplayEffectLevel(file, gainValue, speech !== null);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + attack);
    gain.gain.setValueAtTime(level, at + duration - release);
    gain.gain.linearRampToValueAtTime(0, at + duration);
    source.connect(gain);
    const pan = sweep ? audio.createStereoPanner() : null;
    if (pan && sweep) {
      // Each walker is one passing source. Downmix before panning so stereo
      // samples cannot double their peak when moved toward one ear.
      gain.channelCount = 1; gain.channelCountMode = 'explicit';
      pan.pan.setValueAtTime(sweep[0], at);
      pan.pan.linearRampToValueAtTime(sweep[1], at + duration);
      gain.connect(pan).connect(master!);
    } else gain.connect(master!);
    const layer: EffectLayer = { source, gain, pan, speech, exploration };
    effects.add(layer);
    source.onended = () => {
      cleanEffect(layer);
      if (speech && speechToken === speechGeneration) {
        speechBusy = false; currentSpeech = null; options.onCaption?.(''); processSpeech();
      }
    };
    source.start(at, offset, duration);
    if (speech) { speechStarts++; status('Supplied speech playing.'); } else effectStarts++;
    return true;
  };
  const processSpeech = () => {
    if (speechBusy || disposed || muted) return;
    const id = speechQueue.shift();
    if (!id) return;
    speechBusy = true; currentSpeech = id;
    const token = speechGeneration, speech = GAMEPLAY_SPEECH[id];
    options.onCaption?.(speech.caption);
    void playEffect(speech.file, GAMEPLAY_AUDIO.gains.speech, id).then(played => {
      if (!played && token === speechGeneration) {
        speechBusy = false; currentSpeech = null; processSpeech();
      }
    });
  };
  const stopSpeech = () => {
    speechGeneration++; speechBusy = false; currentSpeech = null; speechQueue.length = 0;
    for (const layer of effects) if (layer.speech) stopEffect(layer);
    options.onCaption?.('');
  };
  const requestSpeech = (id: GameplaySpeech) => {
    if (disposed) return;
    if (muted) { options.onCaption?.(GAMEPLAY_SPEECH[id].caption); status('Local audio muted.'); return; }
    speechQueue.push(id); processSpeech();
  };

  return {
    async unlock(): Promise<boolean> {
      const audio = getContext();
      if (!audio) { status('Web Audio unavailable.'); return false; }
      const enabled = await resumeAuthorized(audio);
      if (disposed) return false;
      if (enabled) unlocked = true;
      if (enabled) failedMusic = null;
      if (enabled) tiltLoadAttempted = false;
      status(enabled ? (muted ? 'Local audio ready; muted.' : 'Local music and sounds ready.') : 'Click ENABLE AUDIO to allow local music and sounds.');
      return enabled;
    },
    async preload(): Promise<void> {
      if (disposed) return;
      for (let index = 1; index <= 4; index++) getMusic(gameplayMusicPath('Ambience', index));
      for (let index = 1; index <= 3; index++) getMusic(gameplayMusicPath('Transition', index));
      const files = new Set([...Object.values(GAMEPLAY_SPEECH).map(speech => speech.file),
        'BoxMoving01.wav', 'BoxMoving03.wav', ...GAMEPLAY_AUDIO.explorationFootsteps.clips,
        ...GAMEPLAY_AUDIO.explorationEvents.map(event => event.clip)]);
      const [loaded] = await Promise.all([Promise.all([...files].map(loadEffect)), prepareRoomTilting()]);
      if (!disposed) status(loaded.every(Boolean) && tiltBuffer ? 'Local audio ready; background tracks stream on demand.' : 'Some local sound files are unavailable; reload to retry.');
    },
    start(nowSeconds = 0): void {
      stop();
      if (disposed || !Number.isFinite(nowSeconds) || nowSeconds < 0) return;
      realityFinished = false;
      now = startedAt = nowSeconds; explorationIndex = 0; lastTransition = 0;
      footsteps.start(nowSeconds);
      running = true; desiredMusic = gameplayMusicPath('Ambience', 1); ensureMusic();
    },
    update(nowSeconds: number): void {
      if (!running || disposed) return;
      // Media playback is independent of render/scan-fitting stalls. Only an
      // explicit lifecycle stop cancels the bed; stale clocks have no authority.
      if (!Number.isFinite(nowSeconds) || nowSeconds < now) return;
      now = nowSeconds;
      if (transition) {
        const duration = GAMEPLAY_AUDIO.transitionSeconds[transition.index];
        if (now - transition.startedAt >= duration - GAMEPLAY_AUDIO.crossfadeSeconds) {
          desiredMusic = gameplayMusicPath('Ambience', transition.index + 1);
        }
        if (now - transition.startedAt >= duration) transition = null;
      }
      if (lastTransition === 0) {
        const pass = footsteps.update(now);
        if (pass) void playEffect(pass.clip, GAMEPLAY_AUDIO.gains.footsteps * pass.gainScale, null,
          GAMEPLAY_AUDIO.explorationFootstepSeconds, true, 0, [pass.panFrom, pass.panTo]);
        const events = GAMEPLAY_AUDIO.explorationEvents;
        while (explorationIndex < events.length && now - startedAt >= events[explorationIndex].seconds) {
          const event = events[explorationIndex++];
          if (now - startedAt - event.seconds > GAMEPLAY_AUDIO.effectMaxDelaySeconds) continue;
          void playEffect(event.clip, GAMEPLAY_AUDIO.gains[event.kind], null, GAMEPLAY_AUDIO.explorationBonkSeconds, true);
        }
      }
      ensureMusic();
      for (const layer of music.values()) if (layer.path !== currentMusic && layer.path !== requestedMusic && layer.to === 0 && context && context.currentTime >= layer.fadeEnd) layer.element.pause();
    },
    /** Starts its anticipation now; the visual coordinator owns the later trigger. */
    transition(index: GameplayTransition): boolean {
      if (!running || disposed || transition || index !== lastTransition + 1) return false;
      lastTransition = index;
      if (index === 1) {
        footsteps.stop();
        explorationGeneration++;
        for (const layer of effects) if (layer.exploration) stopEffect(layer);
      }
      transition = { index, startedAt: now };
      desiredMusic = gameplayMusicPath('Transition', index); ensureMusic();
      return true;
    },
    speech(id: GameplaySpeech): void {
      if (!realityFinished) requestSpeech(id);
    },
    /** The white ending replaces every previous layer with one complete line. */
    finishReality(): void {
      if (disposed || realityFinished) return;
      realityFinished = true;
      stop();
      requestSpeech('whatIsReality');
    },
    /** Preloaded priority speech; no delayed warning can start after cancellation. */
    warnDanger(id: GameplayDanger = DANGER_VOICE_CUES[dangerWarnings % DANGER_VOICE_CUES.length]): boolean {
      if (disposed || realityFinished || muted || !unlocked || context?.state !== 'running' ||
        !readyDanger.has(GAMEPLAY_SPEECH[id].file) || isDanger(currentSpeech)) return false;
      const queued = speechQueue.filter(cue => !isDanger(cue));
      stopSpeech(); // A boundary prompt must not wait behind a long story line.
      speechQueue.push(id, ...queued); dangerWarnings++; processSpeech();
      return true;
    },
    cancelDangerWarning(): void {
      if (isDanger(currentSpeech)) {
        const queued = speechQueue.filter(cue => !isDanger(cue));
        stopSpeech(); speechQueue.push(...queued); processSpeech();
      } else {
        for (let i = speechQueue.length - 1; i >= 0; i--) if (isDanger(speechQueue[i])) speechQueue.splice(i, 1);
      }
    },
    effect(id: GameplayEffect): void {
      if (disposed || realityFinished || muted) return;
      void playEffect(id === 'box1' ? 'BoxMoving01.wav' : 'BoxMoving03.wav', GAMEPLAY_AUDIO.gains.box, null,
        GAMEPLAY_AUDIO.boxEffectSeconds, false, GAMEPLAY_AUDIO.boxEffectOffsetSeconds[id]);
    },
    /** A fresh observed movement is required; loading/resuming never starts a loop. */
    setRoomTilting(active: boolean): boolean {
      if (!active || disposed || realityFinished || muted) { stopRoomTilting(disposed || realityFinished || muted); return false; }
      tiltMoving = true;
      const audio = getContext();
      if (!tiltBuffer && !tiltLoadAttempted) void prepareRoomTilting();
      if (!audio || audio.state !== 'running' || !tiltBuffer) {
        if (tilting) stopRoomTilting();
        tiltMoving = true;
        if (audio && audio.state !== 'running' && unlocked && !tiltResuming) {
          const pending = ready(generation).finally(() => { if (tiltResuming === pending) tiltResuming = null; });
          tiltResuming = pending;
        }
        return false;
      }
      if (tilting) return true;
      if (tiltReleasing) silenceTilt(tiltReleasing);
      const { file, loopStartSeconds, loopEndSeconds, attackSeconds } = GAMEPLAY_AUDIO.roomTilting;
      const loopEnd = Math.min(loopEndSeconds, tiltBuffer.duration);
      if (!Number.isFinite(loopStartSeconds) || loopStartSeconds < 0 || loopEnd <= loopStartSeconds) return false;
      const source = audio.createBufferSource(), gain = audio.createGain(), at = audio.currentTime;
      const level = gameplayEffectLevel(file, GAMEPLAY_AUDIO.gains.roomTilting, false);
      source.buffer = tiltBuffer; source.loop = true;
      source.loopStart = loopStartSeconds; source.loopEnd = loopEnd;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level, at + attackSeconds);
      source.connect(gain).connect(master!);
      const layer: TiltLayer = { source, gain, startedAt: at, level, cleaned: false };
      tilting = layer;
      source.onended = () => cleanTilt(layer);
      source.start(at, loopStartSeconds);
      tiltStarts++;
      return true;
    },
    isSpeechPlaying(id: GameplaySpeech): boolean {
      return !disposed && !muted && context?.state === 'running' && [...effects].some(layer => layer.speech === id);
    },
    /** Supporting effects share this context and master; permission stays owned here. */
    getEffectBus() {
      const audio = getContext();
      return !disposed && audio && master ? { context: audio, destination: master, authorized: unlocked, muted, generation } : null;
    },
    stop,
    stopSpeech,
    setMuted(value: boolean): void {
      if (value === muted) return;
      muted = value;
      if (muted) silence();
      if (master && context) master.gain.setValueAtTime(muted ? 0 : GAMEPLAY_AUDIO.gains.master, context.currentTime);
      status(muted ? 'Local audio muted.' : 'Local audio enabled; new cues will play.');
    },
    snapshot: () => ({ running, muted, unlocked, ready: context?.state === 'running',
      currentMusic, desiredMusic, transition: transition?.index ?? null, lastTransition,
      musicStarts, effectStarts, speechStarts, queuedSpeech: [...speechQueue], playingSpeech: [...effects].filter(layer => layer.speech).map(layer => layer.speech!),
      roomTiltingPlaying: !!tilting, roomTiltingStarts: tiltStarts, roomTiltingMoving: tiltMoving,
      roomTiltingReady: !!tiltBuffer && context?.state === 'running', roomTiltingGain: GAMEPLAY_AUDIO.gains.roomTilting,
      dangerWarnings, dangerPlaying: isDanger(currentSpeech), realityFinished,
      explorationFootsteps: footsteps.snapshot(),
      status: message }),
    dispose(): void {
      if (disposed) return;
      stop(); disposed = true;
      for (const request of requests) request.abort();
      requests.clear(); buffers.clear(); readyDanger.clear();
      tiltBuffer = null;
      for (const layer of music.values()) {
        layer.element.removeAttribute('src'); layer.element.load();
        layer.node.disconnect(); layer.gain.disconnect();
      }
      music.clear(); master?.disconnect();
      void context?.close().catch(() => { /* Context already closed. */ });
    },
  };
}
