/** Full-resolution crop of the active original scan; private derived PLY. */
export const WALL_SECTION = {
  sourceScanId: 'hallway3',
  modelUrl: '/splats/wall-section/wall-section.ply',
  width: 2.10,
  // Dense source wall continues above the cross-corridor band at raw Z=0.95.
  // Its upper edge is raw Z=1.15; retain the full wall from floor -1.45.
  height: 2.60,
  depth: 0.24,
  // Object origin is the source wall's bottom centre in raw PLY coordinates.
  // Local (X,Y,Z) = (rawY-20.8, rawZ+1.45, rawX-0.9).
  sourceRawCenter: [0.90, 20.80, -1.45] as const,
  // Beyond the second box, transverse to the hallway; centred from scan walls.
  placementRawStation: [2, 24.8, -1.45] as const,
} as const;
