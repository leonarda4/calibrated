/** Input identity for calibration, independent of optional skeletal rendering. */
export interface CalibrationInputSource {
  profiles?: readonly string[];
  hand?: unknown;
  gamepad?: unknown;
  gripSpace?: unknown;
}

export type CalibrationInputKind = 'controller' | 'hand' | 'unavailable';

// SteamVR can supply joints on controller profiles. Having joint data alone
// does not mean that a physical controller has been replaced by a hand.
const CONTROLLER_PROFILES = new Set([
  'oculus-touch', 'meta-quest-touch-plus', 'meta-quest-touch-pro',
  'generic-trigger-squeeze-thumbstick', 'generic-trigger-squeeze-touchpad-thumbstick',
]);

export function classifyCalibrationInput(source: CalibrationInputSource): CalibrationInputKind {
  const profiles = source.profiles ?? [];
  const handProfile = profiles.some(profile =>
    profile === 'generic-hand' || profile.startsWith('generic-hand-') ||
    profile === 'hand-interaction' || profile === 'hand-select-grasp' ||
    profile === 'ext-hand' || profile === 'meta-hand-aim');
  if (handProfile) return 'hand';
  const controllerPose = !!source.gamepad && !!source.gripSpace;
  if (controllerPose && profiles.some(profile => CONTROLLER_PROFILES.has(profile))) return 'controller';
  // Unrecognized skeletal sources stay excluded from physical measurement.
  if (source.hand != null) return 'hand';
  return controllerPose ? 'controller' : 'unavailable';
}
