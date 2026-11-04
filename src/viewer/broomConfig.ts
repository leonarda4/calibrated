/** User-supplied private SH0 splat object; retain all original Gaussians. */
export const BROOM = {
  modelUrl: '/splats/broooooommm.ply',
  sceneIndex: 2,
  // Bottom centre of the bristle end, in the supplied file's raw coordinates.
  sourceBase: [0.1806081049144268, -1.2656397819519043, 1.3037186861038208] as const,
  // Proper rotation: raw (X,Y,Z) -> object (-Y,-Z,X).
  // Bristles down; local +Y runs from the bristles toward the handle.
  sourceRotation: [0.5, -0.5, 0.5, 0.5] as const,
  height: 1.4620437175035477,
} as const;
