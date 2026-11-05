/** Supporting rumble, taken from the supplied recording without editing it. */
export const FRACTURE_RUMBLE = Object.freeze({
  clip: '/audio/SoundFX/RumblingSound01.wav',
  offsetSeconds: .75, durationSeconds: 1.8,
  attackSeconds: .03, releaseSeconds: .25, maxDelaySeconds: .25,
  nominalGain: .22, normalizedPeak: .5,
  // Measured 24-bit PCM over [.75, 2.55), both channels, before the envelope.
  sourcePeak: .7858550548553467, sourceRms: .19305726175138477,
  maxOverlap: 10, maxConsumedIds: 256,
});

/** The owner alone unlocks, mutes, resets and closes the shared audio context. */
export interface FractureAudioBus {
  context: AudioContext;
  destination: AudioNode;
  authorized: boolean;
  muted: boolean;
  generation: number;
}
export interface FractureRumbleBlast {
  id: number;
  age: number;
  active: boolean;
}
export interface FractureRumbleOptions {
  getAudioBus(): FractureAudioBus | null;
  fetch?: typeof globalThis.fetch;
}
interface Playing {
  source: AudioBufferSourceNode;
  gain: GainNode;
  context: AudioContext;
  cleaned: boolean;
}

/** A fresh observed blast starts one cached cue; async work never starts audio. */
export function createFractureRumble(options: FractureRumbleOptions) {
  let buffer: AudioBuffer | null = null, pending: Promise<boolean> | null = null;
  let request: AbortController | null = null, disposed = false;
  let busContext: AudioContext | null = null, busGeneration: number | null = null;
  let requestCount = 0, requestedCount = 0, playCount = 0, skippedCount = 0;
  let status = 'Preparing local fracture rumble.';
  const consumed = new Set<number>(), playedIds: number[] = [], playing = new Set<Playing>();
  const level = FRACTURE_RUMBLE.nominalGain * FRACTURE_RUMBLE.normalizedPeak / FRACTURE_RUMBLE.sourcePeak;
  const clean = (layer: Playing) => {
    if (layer.cleaned) return;
    layer.cleaned = true; layer.source.onended = null;
    layer.source.disconnect(); layer.gain.disconnect(); playing.delete(layer);
  };
  const stop = () => {
    for (const layer of playing) {
      const at = layer.context.currentTime;
      try {
        layer.gain.gain.cancelScheduledValues(at);
        layer.gain.gain.setValueAtTime(0, at);
      } catch { /* The owner may already have closed its context. */ }
      try { layer.source.stop(at); } catch { /* Already ended or closed. */ }
      clean(layer);
    }
  };
  const reset = () => {
    stop(); consumed.clear(); playedIds.length = 0;
    requestedCount = playCount = skippedCount = 0;
    busContext = null; busGeneration = null;
  };
  const available = (bus: FractureAudioBus | null): bus is FractureAudioBus =>
    !!bus && bus.authorized && !bus.muted && bus.context.state === 'running';
  return {
    async prepare(): Promise<boolean> {
      if (disposed) return false;
      if (buffer) return true;
      if (pending) return pending;
      const bus = options.getAudioBus();
      if (!bus || bus.context.state === 'closed') { status = 'Shared audio unavailable.'; return false; }
      const controller = new AbortController(); request = controller; requestCount++;
      const loading = (async () => {
        try {
          const response = await (options.fetch ?? globalThis.fetch)(FRACTURE_RUMBLE.clip, { signal: controller.signal });
          if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('Missing rumble');
          const decoded = await bus.context.decodeAudioData(await response.arrayBuffer());
          if (disposed || controller.signal.aborted) return false;
          if (!Number.isFinite(decoded.duration) || decoded.duration < FRACTURE_RUMBLE.offsetSeconds + FRACTURE_RUMBLE.durationSeconds) {
            throw new Error('Short rumble');
          }
          buffer = decoded; status = 'Local fracture rumble prepared.'; return true;
        } catch {
          if (!disposed) status = 'Local fracture rumble unavailable.';
          return false;
        }
      })().finally(() => {
        if (pending === loading) pending = null;
        if (request === controller) request = null;
      });
      pending = loading; return loading;
    },
    /** Pass paused/muted samples too, so a missed start can never replay later. */
    update(blasts: readonly FractureRumbleBlast[], enabled = true): void {
      if (disposed) return;
      const bus = options.getAudioBus();
      if (busContext !== bus?.context || busGeneration !== bus?.generation) {
        stop(); busContext = bus?.context ?? null; busGeneration = bus?.generation ?? null;
      }
      if (!enabled || !available(bus)) stop();
      for (const blast of blasts) {
        if (!Number.isSafeInteger(blast.id) || blast.id < 0 || !Number.isFinite(blast.age) || blast.age < -1e-9 || consumed.has(blast.id)) continue;
        if (consumed.size >= FRACTURE_RUMBLE.maxConsumedIds) { status = 'Fracture cue limit reached.'; continue; }
        consumed.add(blast.id);
        if (!blast.active) continue;
        requestedCount++;
        if (!enabled || !available(bus) || !buffer || blast.age > FRACTURE_RUMBLE.maxDelaySeconds || playing.size >= FRACTURE_RUMBLE.maxOverlap) {
          skippedCount++; continue;
        }
        const age = Math.max(0, blast.age), duration = FRACTURE_RUMBLE.durationSeconds - age;
        const source = bus.context.createBufferSource(), gain = bus.context.createGain(), at = bus.context.currentTime;
        const layer: Playing = { source, gain, context: bus.context, cleaned: false };
        try {
          source.buffer = buffer;
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(level, at + Math.min(FRACTURE_RUMBLE.attackSeconds, duration / 3));
          gain.gain.setValueAtTime(level, at + duration - Math.min(FRACTURE_RUMBLE.releaseSeconds, duration / 3));
          gain.gain.linearRampToValueAtTime(0, at + duration);
          source.connect(gain).connect(bus.destination);
          playing.add(layer); source.onended = () => clean(layer);
          source.start(at, FRACTURE_RUMBLE.offsetSeconds + age, duration);
          playedIds.push(blast.id); playCount++;
        } catch { clean(layer); skippedCount++; }
      }
    },
    stop, reset,
    snapshot: () => ({ loaded: !!buffer, ready: !disposed && !!buffer && available(options.getAudioBus()),
      playing: playing.size > 0, activeCount: playing.size, playCount, requestedCount, skippedCount, requestCount,
      playedIds: [...playedIds], consumedIds: [...consumed], sourceDuration: buffer?.duration ?? null,
      clip: FRACTURE_RUMBLE.clip, gain: level, duration: FRACTURE_RUMBLE.durationSeconds, status }),
    dispose(): void {
      if (disposed) return;
      disposed = true; stop(); request?.abort(); buffer = null;
      // The shared bus and context remain owned by gameplayAudio.
    },
  };
}
