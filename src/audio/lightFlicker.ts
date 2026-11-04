import { LIGHT_FLICKER_SECONDS } from '../experience/secondBoxLights.ts';

export const LIGHT_FLICKER_CLIP = '/audio/light_flicker.mp3';
export const LIGHT_FLICKER_GAIN = .16;
export const LIGHT_FLICKER_ATTACK = .08;
export const LIGHT_FLICKER_RELEASE = .20;

/** Quiet local effect, independent of narration; playback never waits for a fetch. */
export function createLightFlickerAudio() {
  let context: AudioContext | null = null;
  let buffer: AudioBuffer | null = null;
  let pending: Promise<void> | null = null;
  let request: AbortController | null = null;
  let playing: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  let disposed = false;
  let playCount = 0;
  let status = 'Waiting for an audio gesture.';
  const stop = () => {
    if (!playing) return;
    const { source, gain } = playing;
    source.onended = null;
    gain.gain.cancelScheduledValues(context!.currentTime);
    gain.gain.setValueAtTime(0, context!.currentTime);
    try { source.stop(); } catch { /* source already ended */ }
    source.disconnect(); gain.disconnect(); playing = null;
  };
  return {
    /** Call from a desktop/Enter VR gesture well before the delayed cue. */
    async unlock(): Promise<boolean> {
      if (disposed || typeof AudioContext === 'undefined') return false;
      try {
        context ??= new AudioContext();
        const audio = context;
        const resume = audio.state === 'running' ? Promise.resolve() : audio.resume();
        if (!buffer && !pending) {
          request = new AbortController();
          pending = fetch(LIGHT_FLICKER_CLIP, { signal: request.signal }).then(async response => {
            if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('Missing clip');
            const decoded = await audio.decodeAudioData(await response.arrayBuffer());
            if (!disposed) buffer = decoded;
          }).catch(() => { status = 'Local light-flicker sound unavailable.'; })
            .finally(() => { pending = null; request = null; });
        }
        await Promise.all([resume, pending]);
        if (disposed) return false;
        if (audio.state === 'running' && buffer) { status = 'Quiet light-flicker sound ready.'; return true; }
      } catch { status = 'Click the page to enable the light-flicker sound.'; }
      return false;
    },
    play(): boolean {
      stop();
      if (disposed || !context || context.state !== 'running' || !buffer) return false;
      const duration = Math.min(LIGHT_FLICKER_SECONDS, buffer.duration);
      if (!(duration > 0)) return false;
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer;
      const now = context.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(LIGHT_FLICKER_GAIN, now + Math.min(LIGHT_FLICKER_ATTACK, duration / 3));
      gain.gain.setValueAtTime(LIGHT_FLICKER_GAIN, now + duration - Math.min(LIGHT_FLICKER_RELEASE, duration / 3));
      gain.gain.linearRampToValueAtTime(0, now + duration);
      source.connect(gain).connect(context.destination);
      playing = { source, gain };
      source.onended = () => {
        source.disconnect(); gain.disconnect();
        if (playing?.source === source) playing = null;
      };
      source.start(now, 0, duration);
      playCount++;
      return true;
    },
    stop,
    dispose() {
      if (disposed) return;
      disposed = true; stop(); request?.abort(); buffer = null;
      void context?.close();
    },
    snapshot: () => ({ ready: !!buffer && context?.state === 'running', playing: !!playing,
      playCount, gain: LIGHT_FLICKER_GAIN, duration: LIGHT_FLICKER_SECONDS, sourceDuration: buffer?.duration ?? null, status }),
  };
}
