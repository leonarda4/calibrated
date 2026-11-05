import { VOICE_CUES, voiceClipPath, type VoiceCue, type VoiceRole } from './voiceCues.ts';

export interface VoiceGuideOptions {
  onCaption?: (caption: string) => void;
  onStatus?: (status: string) => void;
}

interface PlayingLayer {
  cue: VoiceCue;
  role: VoiceRole;
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

/** Local, pre-generated audio only. ElevenLabs is never called by this module. */
export function createVoiceGuide(options: VoiceGuideOptions = {}) {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;
  let disposed = false;
  let unlocked = false;
  let generation = 0;
  const playing = new Set<PlayingLayer>();
  const buffers = new Map<string, Promise<AudioBuffer | null>>();
  const pending = new Set<AbortController>();
  const status = (message: string) => options.onStatus?.(message);

  const getContext = (): AudioContext | null => {
    if (disposed) return null;
    if (context) return context;
    if (typeof AudioContext === 'undefined') {
      status('Web Audio unavailable. Voice transcript is on the PC.');
      return null;
    }
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.65;
    // The maximum combined layer gain is below 1; the master adds headroom.
    master.connect(context.destination);
    return context;
  };

  const load = (path: string): Promise<AudioBuffer | null> => {
    const cached = buffers.get(path);
    if (cached) return cached;
    const audio = getContext();
    if (!audio) return Promise.resolve(null);
    const controller = new AbortController();
    pending.add(controller);
    const result: Promise<AudioBuffer | null> = fetch(path, { signal: controller.signal })
      .then(async (response) => {
        // Vite's SPA fallback can return index.html for a missing MP3.
        if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) return null;
        return await audio.decodeAudioData(await response.arrayBuffer());
      })
      .catch(() => null)
      .then(buffer => {
        // A transient fetch/decode failure must not silence every later game.
        // Retain successful buffers, and never evict a newer request's entry.
        if (!buffer && buffers.get(path) === result) buffers.delete(path);
        return buffer;
      })
      .finally(() => pending.delete(controller));
    buffers.set(path, result);
    return result;
  };

  const stop = (): void => {
    generation += 1; // in-flight fetch/decode results can never schedule audio
    for (const layer of playing) {
      layer.source.onended = null;
      try { layer.source.stop(); } catch { /* already ended */ }
      layer.source.disconnect();
      layer.gain.disconnect();
      layer.pan.disconnect();
    }
    playing.clear();
    options.onCaption?.('');
  };

  const resumeAuthorized = async (audio: AudioContext): Promise<boolean> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        audio.resume().then(() => audio.state === 'running'),
        new Promise<boolean>(resolve => { timeout = setTimeout(() => resolve(false), 500); }),
      ]);
    } catch { return false; }
    finally { if (timeout !== undefined) clearTimeout(timeout); }
  };

  return {
    /** Call directly from an operator click, before awaiting any other work. */
    async unlock(): Promise<boolean> {
      const audio = getContext();
      if (!audio) return false;
      try {
        await audio.resume();
        if (disposed) return false;
        const ready = audio.state === 'running';
        if (ready) unlocked = true;
        status(ready ? (muted ? 'Audio ready; muted.' : 'Audio ready. Local clips only.') : 'Click ENABLE VOICES to allow audio.');
        return ready;
      } catch {
        status('Audio could not start. Voice transcript is on the PC.');
        return false;
      }
    },
    async preload(cues: readonly VoiceCue[] = Object.keys(VOICE_CUES) as VoiceCue[]): Promise<void> {
      const paths = cues.flatMap((cue) =>
        VOICE_CUES[cue].layers.map((layer) => voiceClipPath(cue, layer.role)));
      const loaded = await Promise.all(paths.map(load));
      const count = loaded.filter(Boolean).length;
      status(count === paths.length
        ? 'All local voice clips ready.'
        : `Local voice clips: ${count}/${paths.length}. Generate missing clips, then reload.`);
    },
    async play(cue: VoiceCue): Promise<void> {
      stop();
      // Capture before resuming or loading: recovery/new cues invalidate this
      // exact request, even when a shared resume resolves for several callers.
      const token = generation;
      if (disposed) return;
      const definition = VOICE_CUES[cue];
      options.onCaption?.(definition.caption);
      if (muted) { status('Voices muted.'); return; }
      const audio = getContext();
      if (!audio) return;
      if (audio.state !== 'running') {
        // Initial permission still requires an explicit operator gesture.
        // A context already enabled by that gesture can recover suspension.
        if (!unlocked) { status('Click ENABLE VOICES to allow audio.'); return; }
        const ready = await resumeAuthorized(audio);
        if (disposed || muted || token !== generation) return;
        if (!ready) { status('Click ENABLE VOICES to allow audio.'); return; }
      }
      const loaded = await Promise.all(definition.layers.map((layer) => load(voiceClipPath(cue, layer.role))));
      if (disposed || muted || token !== generation) return;
      // Preserve the instruction: skip whisper-only playback if lead is absent.
      if (!loaded[0]) {
        status('Lead voice clip missing. Generate local clips, then reload.');
        return;
      }
      const startAt = audio.currentTime + 0.06;
      definition.layers.forEach((layer, index) => {
        const buffer = loaded[index];
        if (!buffer) return;
        const source = audio.createBufferSource();
        const gain = audio.createGain();
        const pan = audio.createStereoPanner();
        source.buffer = buffer;
        if (layer.role === 'lead' &&
            definition.maxDurationSeconds && definition.maxDurationSeconds > 0) {
          // Leave room for the source scheduling lead-in and the next frame's cue.
          // Short recordings and supporting whispers retain their natural rate.
          source.playbackRate.value = Math.max(1, buffer.duration / definition.maxDurationSeconds);
        }
        gain.gain.value = layer.gain;
        pan.pan.value = layer.pan;
        source.connect(gain).connect(pan).connect(master!);
        const active: PlayingLayer = { cue, role: layer.role, source, gain, pan };
        playing.add(active);
        source.onended = () => {
          playing.delete(active);
          source.disconnect(); gain.disconnect(); pan.disconnect();
        };
        source.start(startAt + layer.delay);
      });
      status(definition.layers.length === 1 ? 'Narration playing.'
        : loaded.every(Boolean) ? 'Voices playing: lead + layered whispers.' : 'Lead playing; some whisper clips are missing.');
    },
    /** Only a scheduled/playing lead can delay a live action; loading cannot. */
    isCuePlaying(cue: VoiceCue): boolean {
      if (disposed || muted || context?.state !== 'running') return false;
      for (const layer of playing) if (layer.cue === cue && layer.role === 'lead') return true;
      return false;
    },
    stop,
    setMuted(value: boolean): void {
      muted = value;
      if (muted) stop(); // cancels sources scheduled for the future too
      if (master && context) master.gain.setValueAtTime(muted ? 0 : 0.65, context.currentTime);
      status(muted ? 'Voices muted.' : 'Voices unmuted. New cues will play.');
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stop();
      for (const controller of pending) controller.abort();
      pending.clear(); buffers.clear();
      master?.disconnect();
      void context?.close();
    },
  };
}
