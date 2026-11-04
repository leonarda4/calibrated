const sourceDepth = 0.24;
const faceGap = 0.02;

/** Two full-thickness outward-facing copies in one private derived PLY. */
export const WALL_SECTION = {
  sourceScanId: 'hallway3',
  modelUrl: '/splats/wall-section/wall-section.ply',
  sceneIndex: 1,
  slideSeconds: 1.25,
  slideMargin: 0.10,
  // Authored desktop-world stations; mapped into the live calibration frame.
  startWorldZ: -8,
  targetWorldZ: -2,
  approachSpeed: 0.30,
  afterTurnSeconds: 2,
  playerClearance: 0.75,
  resumeExtra: 0.15,
  width: 2.10,
  // Dense source wall continues above the cross-corridor band at raw Z=0.95.
  // Its upper edge is raw Z=1.15; retain the full wall from floor -1.45.
  height: 2.60,
  sourceDepth,
  faceGap,
  faceOffset: (sourceDepth + faceGap) / 2,
  depth: sourceDepth * 2 + faceGap,
  // Object origin is the source wall's bottom centre in raw PLY coordinates.
  // Crop (X,Y,Z) = (rawY-20.8, rawZ+1.45, rawX-0.9), before face offsets.
  sourceRawCenter: [0.90, 20.80, -1.45] as const,
  // Beyond the second box, transverse to the hallway; centred from scan walls.
  placementRawStation: [2, 24.8, -1.45] as const,
} as const;
