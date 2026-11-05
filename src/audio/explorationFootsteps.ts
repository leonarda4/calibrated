import { GAMEPLAY_AUDIO } from './gameplayAudioConfig.ts';

export interface FootstepPass {
  clip: typeof GAMEPLAY_AUDIO.explorationFootsteps.clips[number];
  gainScale: number;
  panFrom: number;
  panTo: number;
}

/** Pure irregular clock. Late events are skipped, never accumulated or replayed. */
export function createExplorationFootsteps(random: () => number = Math.random) {
  const settings = GAMEPLAY_AUDIO.explorationFootsteps;
  const unit = () => { const value = random(); return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .5; };
  const between = ([min, max]: readonly [number, number]) => min + (max - min) * unit();
  let nextAt: number | null = null, lastTime = 0, previousClip = -1;
  return {
    start(now: number) {
      nextAt = Number.isFinite(now) && now >= 0 ? now + between(settings.firstDelaySeconds) : null;
      lastTime = now; previousClip = -1;
    },
    stop() { nextAt = null; },
    update(now: number): FootstepPass | null {
      if (nextAt === null || !Number.isFinite(now) || now < lastTime) return null;
      lastTime = now;
      if (now + 1e-9 < nextAt) return null;
      const late = now - nextAt > GAMEPLAY_AUDIO.effectMaxDelaySeconds + 1e-9;
      nextAt = now + GAMEPLAY_AUDIO.explorationFootstepSeconds + between(settings.gapSeconds);
      if (late) return null;
      const choices = settings.clips.map((_, i) => i).filter(i => i !== previousClip);
      const clip = choices[Math.min(choices.length - 1, Math.floor(unit() * choices.length))];
      previousClip = clip;
      const side = unit() < .5 ? -1 : 1, extent = between(settings.panExtent);
      return { clip: settings.clips[clip], gainScale: between(settings.gainRange), panFrom: side * extent, panTo: -side * extent };
    },
    snapshot: () => ({ active: nextAt !== null, nextAtSeconds: nextAt }),
  };
}
