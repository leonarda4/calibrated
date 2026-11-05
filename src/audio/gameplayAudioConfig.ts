export type GameplayTransition = 1 | 2 | 3;
export const DANGER_VOICE_CUES = ['danger1', 'danger2', 'danger3', 'danger4'] as const;
export type GameplayDanger = typeof DANGER_VOICE_CUES[number];
export type GameplaySpeech = 'welcome' | 'findBox' | 'stepOnBox' | 'turned' | 'sitOnBox' | 'classroom' | 'cleanRoom' | 'whatIsReality' | GameplayDanger;
export type GameplayEffect = 'box1' | 'box2';

/** Authored mix and timing. Gains are linear, and speech never ducks the music. */
export const GAMEPLAY_AUDIO = {
  gains: { master: .4, music: .65, speech: 1.3, box: .26, footsteps: .16, bonk: .085, roomTilting: .22 },
  normalization: { musicRms: .09, musicPeakCeiling: .85, speechPeak: .9, effectPeak: .5 },
  crossfadeSeconds: 1.2,
  // Excerpts of the original 28/22/10-second recordings; adjust without editing assets.
  transitionSeconds: { 1: 9, 2: 6, 3: 7 } as Record<GameplayTransition, number>,
  transitionOffsetSeconds: { 1: 0, 2: 0, 3: 0 } as Record<GameplayTransition, number>,
  transitionSourceSeconds: { 1: 28, 2: 22, 3: 10 },
  boxEffectSeconds: 1.5,
  boxEffectOffsetSeconds: { box1: 2.75, box2: 1.75 } as Record<GameplayEffect, number>,
  effectAttackSeconds: .06,
  effectReleaseSeconds: .3,
  effectMaxDelaySeconds: .25,
  roomTilting: { file: 'RoomTilting.wav', loopStartSeconds: .5, loopEndSeconds: 4.5,
    attackSeconds: .05, releaseSeconds: .08 },
  explorationFootstepSeconds: 3,
  explorationFootsteps: {
    clips: ['Footsteps01.wav', 'Footsteps02.wav'] as const,
    firstDelaySeconds: [3, 6] as const,
    gapSeconds: [2, 5] as const,
    gainRange: [.85, 1.15] as const,
    panExtent: [.35, .75] as const,
  },
  explorationBonkSeconds: 1.2,
  explorationEvents: [
    { seconds: 10.5, clip: 'BoxBonking01.wav', kind: 'bonk' },
    { seconds: 18, clip: 'BoxBonking03.wav', kind: 'bonk' },
  ] as const,
};

export const GAMEPLAY_SPEECH: Record<GameplaySpeech, { file: string; caption: string }> = {
  welcome: { file: 'Welcome To The Hallway.wav', caption: 'Welcome to the hallway.' },
  findBox: { file: 'TryToFindTheBox.wav', caption: 'Try to find the box.' },
  stepOnBox: { file: 'TryToStepOnTheBox.wav', caption: 'Try to step on the box.' },
  turned: { file: 'TheHallwayTurned.wav', caption: 'The hallway turned.' },
  sitOnBox: { file: 'SitDownOnTheBox.wav', caption: 'Sit down on the box.' },
  classroom: { file: 'GoBackToTheClassRoom.wav', caption: 'Go back to the classroom.' },
  cleanRoom: { file: 'CLEANTHEROOM.wav', caption: 'Clean the room.' },
  whatIsReality: { file: 'WhatIsReality.wav', caption: 'What is reality?' },
  danger1: { file: 'DangerZone01.wav', caption: "Don't go there." },
  danger2: { file: 'DangerZone02.wav', caption: "Don't go there." },
  danger3: { file: 'DangerZone03.wav', caption: "Don't go there." },
  danger4: { file: 'DangerZone04.wav', caption: "Don't go there." },
};

export function gameplayMusicPath(kind: 'Ambience' | 'Transition', index: number): string {
  return `/audio/BackgroundSounds/${kind}_${index}.wav`;
}
export function gameplayEffectPath(file: string): string { return `/audio/SoundFX/${file}`; }

/**
 * Measured PCM levels: full ambiences/speech and the authored transition/effect
 * excerpts. Remeasure after changing a file, excerpt offset, or duration.
 * No runtime analyser, remixing, or source edits.
 */
export const GAMEPLAY_SOURCE_LEVELS: Record<string, { peak: number; rms: number }> = {
  'Ambience_1.wav': { peak: .813538, rms: .139042 },
  'Ambience_2.wav': { peak: .433472, rms: .054594 },
  'Ambience_3.wav': { peak: .418396, rms: .054505 },
  'Ambience_4.wav': { peak: .735321, rms: .121439 },
  'Transition_1.wav': { peak: .175995, rms: .031006 },
  'Transition_2.wav': { peak: .269775, rms: .048656 },
  'Transition_3.wav': { peak: .900635, rms: .113241 },
  'Welcome To The Hallway.wav': { peak: .151299, rms: .009381 },
  'TryToFindTheBox.wav': { peak: .121407, rms: .011262 },
  'TryToStepOnTheBox.wav': { peak: .149886, rms: .010927 },
  'TheHallwayTurned.wav': { peak: .294356, rms: .013864 },
  'SitDownOnTheBox.wav': { peak: .885086, rms: .103445 },
  'GoBackToTheClassRoom.wav': { peak: .281595, rms: .015662 },
  'CLEANTHEROOM.wav': { peak: .886604, rms: .207389 },
  'WhatIsReality.wav': { peak: .886660, rms: .088503 },
  'DangerZone01.wav': { peak: .886793, rms: .077761 },
  'DangerZone02.wav': { peak: .886794, rms: .105109 },
  'DangerZone03.wav': { peak: .886310, rms: .079341 },
  'DangerZone04.wav': { peak: .886795, rms: .097338 },
  'RoomTilting.wav': { peak: .886795, rms: .302838 },
  'BoxMoving01.wav': { peak: .207358, rms: .028053 },
  'BoxMoving03.wav': { peak: .318367, rms: .065785 },
  'Footsteps01.wav': { peak: .037370, rms: .005267 },
  'Footsteps02.wav': { peak: .031781, rms: .004358 },
  'BoxBonking01.wav': { peak: .619388, rms: .075719 },
  'BoxBonking03.wav': { peak: .375125, rms: .062885 },
};

export function gameplayMusicLevel(path: string): number {
  const source = GAMEPLAY_SOURCE_LEVELS[path.slice(path.lastIndexOf('/') + 1)];
  if (!source) return GAMEPLAY_AUDIO.gains.music;
  const { musicRms, musicPeakCeiling } = GAMEPLAY_AUDIO.normalization;
  return GAMEPLAY_AUDIO.gains.music * Math.min(musicRms / source.rms, musicPeakCeiling / source.peak);
}

export function gameplayEffectLevel(file: string, nominalGain: number, speech: boolean): number {
  const source = GAMEPLAY_SOURCE_LEVELS[file];
  if (!source) return nominalGain;
  return nominalGain * (speech ? GAMEPLAY_AUDIO.normalization.speechPeak : GAMEPLAY_AUDIO.normalization.effectPeak) / source.peak;
}
