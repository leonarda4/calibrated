import { Euler, MathUtils, Quaternion } from 'three';

// Edit these angles in degrees: [X, Y, Z], using Three.js XYZ Euler order.
const rotationDegrees: [number, number, number] = [90, 180, 0];

/** Coordinate-dependent settings belong to this scan export only. */
export const ACTIVE_SCAN = {
  id: 'hallway3',
  plyUrl: '/splats/hallway3/hallway3_0.ply',
  // Derived quaternion [x,y,z,w]; change rotationDegrees above, not these values.
  rotation: new Quaternion().setFromEuler(new Euler(
    MathUtils.degToRad(rotationDegrees[0]),
    MathUtils.degToRad(rotationDegrees[1]),
    MathUtils.degToRad(rotationDegrees[2]),
    'XYZ',
  )).toArray() as [number, number, number, number],
  startPoint: [2, 18.6, -1.45] as [number, number, number],
  // Desktop inspection only. The tracked XR camera keeps its identity parent.
  desktopCamera: [2, 18.6, -1.45] as [number, number, number],
  landmarks: null,
  boxPlyCenter: null,
  boxPlyBase: [3, -2.1, 2] as [number, number, number],
} as const;
