export const WALL_MOVEMENT_CLIP = '/audio/SoundFX/RumblingSound02.wav';
export const WALL_MOVEMENT_GAIN = .35;
export const WALL_MOVEMENT_ATTACK = .2;
export const WALL_MOVEMENT_RELEASE = .7;

type Loop = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  envelope: { start: number; end: number; from: number; to: number };
  stopDeadline: number | null;
  cleaned: boolean;
};

/** Local movement-only loop. Async loading/unlocking never schedules playback. */
export function createWallMovementAudio() {
  let context: AudioContext | null = null;
  let buffer: AudioBuffer | null = null;
  let pending: Promise<void> | null = null;
  let request: AbortController | null = null;
  let playing: Loop | null = null;
  let moving = false;
  let disposed = false;
  let playCount = 0;
  let status = 'Waiting for an audio gesture.';

  const cleanup = (loop: Loop) => {
    if (loop.cleaned) return;
    loop.cleaned = true;
    loop.source.onended = null;
    loop.source.disconnect();
    loop.gain.disconnect();
    if (playing === loop) playing = null;
  };
  const silence = (loop: Loop) => {
    try { loop.source.stop(context?.currentTime ?? 0); } catch { /* already stopped */ }
    cleanup(loop);
  };
  const levelAt = (loop: Loop, now: number) => {
    const { start, end, from, to } = loop.envelope;
    const fraction = Math.max(0, Math.min(1, (now - start) / (end - start || 1)));
    return from + (to - from) * fraction;
  };
  const ramp = (loop: Loop, target: number, seconds: number, now: number) => {
    const level = levelAt(loop, now);
    loop.gain.gain.cancelScheduledValues(now);
    loop.gain.gain.setValueAtTime(level, now);
    loop.gain.gain.linearRampToValueAtTime(target, now + seconds);
    loop.envelope = { start: now, end: now + seconds, from: level, to: target };
  };
  /** Safety/recovery stops have no acoustic tail beyond the actual movement. */
  const stop = () => {
    moving = false;
    if (playing) silence(playing);
  };

  return {
    /** Preload/resume from a desktop or Enter VR gesture, before wall motion. */
    async unlock(): Promise<boolean> {
      if (disposed || typeof AudioContext === 'undefined') return false;
      try {
        context ??= new AudioContext();
        const audio = context;
        const resume = audio.state === 'running' ? Promise.resolve() : audio.resume();
        if (!buffer && !pending) {
          request = new AbortController();
          pending = fetch(WALL_MOVEMENT_CLIP, { signal: request.signal }).then(async response => {
            if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('Missing clip');
            const decoded = await audio.decodeAudioData(await response.arrayBuffer());
            if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error('Empty clip');
            if (!disposed) buffer = decoded;
          }).catch(() => { if (!disposed) status = 'Local wall movement sound unavailable.'; })
            .finally(() => { pending = null; request = null; });
        }
        await Promise.all([resume, pending]);
        if (disposed) return false;
        if (audio.state === 'running' && buffer) { status = 'Wall movement sound ready.'; return true; }
      } catch { if (!disposed) status = 'Click the page to enable the wall movement sound.'; }
      return false;
    },
    /** Fade during the remaining look-back travel, never after movement stops. */
    setMoving(value: boolean, stopInSeconds?: number): boolean {
      if (!value || disposed) { stop(); return false; }
      if (stopInSeconds !== undefined && (!Number.isFinite(stopInSeconds) || stopInSeconds <= 0)) {
        stop(); return false;
      }
      if (!context || context.state !== 'running' || !buffer) {
        stop();
        moving = true;
        return false;
      }
      moving = true;
      if (playing) {
        const now = context.currentTime;
        if (stopInSeconds === undefined && playing.stopDeadline !== null) {
          playing.stopDeadline = null;
          ramp(playing, WALL_MOVEMENT_GAIN, WALL_MOVEMENT_ATTACK, now);
        } else if (stopInSeconds !== undefined && playing.stopDeadline === null) {
          const seconds = Math.min(WALL_MOVEMENT_RELEASE, stopInSeconds);
          playing.stopDeadline = now + seconds;
          ramp(playing, 0, seconds, now);
        }
        return true;
      }
      // A clip becoming available halfway through a stopping period must not
      // start an audible tail; wait for a fresh unrestricted movement sample.
      if (stopInSeconds !== undefined) return false;
      const source = context.createBufferSource();
      const gain = context.createGain();
      const now = context.currentTime;
      const loop: Loop = { source, gain, cleaned: false, stopDeadline: null,
        envelope: { start: now, end: now + WALL_MOVEMENT_ATTACK, from: 0, to: WALL_MOVEMENT_GAIN } };
      source.buffer = buffer;
      source.loop = true;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(WALL_MOVEMENT_GAIN, now + WALL_MOVEMENT_ATTACK);
      source.connect(gain).connect(context.destination);
      source.onended = () => cleanup(loop);
      playing = loop;
      source.start(now);
      playCount++;
      return true;
    },
    stop,
    dispose() {
      if (disposed) return;
      disposed = true;
      moving = false;
      if (playing) silence(playing);
      request?.abort();
      buffer = null;
      void context?.close().catch(() => { /* context already closed */ });
    },
    snapshot: () => ({ ready: !disposed && !!buffer && context?.state === 'running', moving,
      playing: !!playing, playCount, gain: WALL_MOVEMENT_GAIN,
      currentGain: playing ? levelAt(playing, context?.currentTime ?? 0) : 0,
      fading: playing?.stopDeadline != null,
      stopInSeconds: playing?.stopDeadline == null ? null : Math.max(0, playing.stopDeadline - (context?.currentTime ?? 0)),
      sourceDuration: buffer?.duration ?? null, status }),
  };
}
