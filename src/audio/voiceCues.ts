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
  /** Lead narration can speed up to finish within its timed slot. */
  maxDurationSeconds?: number;
}

const whisper = (text: string): string =>
  `[whispering] ${text.replace(/([.!?])\s+(?=\S)/g, '$1 [whispering] ')}`;

const layers = (lead: string, left: string, right: string): readonly VoiceLayer[] => [
  { role: 'lead', text: whisper(lead), gain: 0.40, delay: 0, pan: 0 },
  { role: 'left', text: whisper(left), gain: 0.045, delay: 0.85, pan: -0.65 },
  { role: 'right', text: whisper(right), gain: 0.035, delay: 1.8, pan: 0.65 },
];

const narration = (text: string, left: string, right: string, maxDurationSeconds?: number): VoiceCueDefinition => ({
  caption: text,
  layers: layers(text, left, right),
  maxDurationSeconds,
});

export const VOICE_CUES: Record<VoiceCue, VoiceCueDefinition> = {
  purpose: {
    caption: 'Find your purpose and bring it back here.',
    layers: layers(
      'Find your purpose and bring it back here.',
      'Purpose...',
      'Bring it...',
    ),
  },
  badge: {
    caption: 'Get your badge. Claim your education. Reach for the light above the box.',
    layers: layers(
      'Get your badge. Claim your education. Reach for the light above the box.',
      'Your badge...',
      'The light...',
    ),
  },
  congratulations: {
    caption: 'Congratulations. You have your badge. Stay still.',
    layers: layers(
      'Congratulations. You have your badge. Stay still.',
      'Well done...',
      'Stay still...',
    ),
  },
  reversed: {
    caption: 'Your purpose is yours. Wait for your guide before stepping down.',
    layers: layers(
      'Your purpose is yours. Wait for your guide before stepping down.',
      'Yours...',
      'Wait...',
    ),
  },
  scenarioWelcome: narration('welcome, I hope you are calibrated to your new environment', 'Welcome...', 'Calibrated...'),
  scenarioBox: narration("well would you look at that, a box appeared... I wonder if it's real...", 'A box...', 'Real...', 4.7),
  scenarioTurn: narration('Whoosh, what just happened?', 'Whoosh...', 'What happened...'),
  scenarioSeat: narration('Sit down on the box.', 'Your seat...', 'Sit down...'),
};

export function voiceClipPath(cue: VoiceCue, role: VoiceRole): string {
  return `/audio/generated/${cue}-${role}.mp3`;
}
