/** Draft gameplay timings in seconds. Live entry remains a player action. */
export const GAMEPLAY_TIMING = {
  welcomeSeconds: 1,
  firstBoxSeconds: 8,
  /** Autoplay starts the first transition after this exploration time. */
  explorationSeconds: 20,
  transitionLeadSeconds: 2,
  boxAnnouncementSeconds: 5,
  turnDurationSeconds: 4,
  secondBoxDelaySeconds: 5,
  secondBoxRiseSeconds: 1.5,
  classroomAfterWallSeconds: 5,
  flickerDelaySeconds: 6.5,
  flickerLeadSeconds: 2,
  flickerDurationSeconds: 1,
  holeLeadSeconds: 2,
} as const;
