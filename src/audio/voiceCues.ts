// Shared by the browser player and the offline Node generator. No credentials.
export const SCENARIO_VOICE_CUES = ['scenarioWelcome', 'scenarioBox', 'scenarioTurn', 'scenarioSeat'] as const;
export type VoiceCue = 'purpose' | 'badge' | 'congratulations' | 'reversed' | typeof SCENARIO_VOICE_CUES[number];
export type VoiceRole = 'lead' | 'left' | 'right';

export interface VoiceLayer {
  role: VoiceRole;
  text: string;
  gain: number;
  delay: number;
  pan: number;
}

export interface VoiceCueDefinition {
  caption: string;
  layers: readonly VoiceLayer[];
  /** Single-lead narration can speed up to finish within its timed slot. */
  maxDurationSeconds?: number;
}

const layers = (lead: string, left: string, right: string): readonly VoiceLayer[] => [
  { role: 'lead', text: lead, gain: 0.74, delay: 0, pan: 0 },
  { role: 'left', text: `[whispering] ${left}`, gain: 0.13, delay: 0.85, pan: -0.65 },
  { role: 'right', text: `[whispering] ${right}`, gain: 0.10, delay: 1.8, pan: 0.65 },
];

const narration = (text: string, maxDurationSeconds?: number): VoiceCueDefinition => ({
  caption: text,
  layers: [{ role: 'lead', text, gain: 0.74, delay: 0, pan: 0 }],
  maxDurationSeconds,
});

export const VOICE_CUES: Record<VoiceCue, VoiceCueDefinition> = {
  purpose: {
    caption: 'Find your purpose and bring it back here.',
    layers: layers(
      'Find your purpose and bring it back here.',
      'Your purpose... your purpose... bring it back.',
      'Find it... bring it back here... here.',
    ),
  },
  badge: {
    caption: 'Get your badge. Claim your education. Reach for the light above the box.',
    layers: layers(
      'Get your badge. Claim your education. Reach for the light above the box.',
      'Your badge... your education... your badge.',
      'The light... reach for the light... the light.',
    ),
  },
  congratulations: {
    caption: 'Congratulations. You have your badge. Stay still.',
    layers: layers(
      'Congratulations. You have your badge. Stay still.',
      'Well done... well done.',
      'Stay still... stay still.',
    ),
  },
  reversed: {
    caption: 'Your purpose is yours. Wait for your guide before stepping down.',
    layers: layers(
      'Your purpose is yours. Wait for your guide before stepping down.',
      'Yours... yours... your purpose.',
      'Wait for your guide... wait.',
    ),
  },
  scenarioWelcome: narration('welcome, I hope you are calibrated to your new environment'),
  scenarioBox: narration("well would you look at that, a box appeared... I wonder if it's real...", 4.7),
  scenarioTurn: narration('Whoosh, what just happened?'),
  scenarioSeat: narration("oh look there's your seat because you are late for class."),
};

export function voiceClipPath(cue: VoiceCue, role: VoiceRole): string {
  return `/audio/generated/${cue}-${role}.mp3`;
}
