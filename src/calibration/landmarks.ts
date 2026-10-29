// src/calibration: predefined landmark points (scan-LOCAL frame = raw PLY
// coordinates). The calibration is placement-only: the LEFT remote is put
// on real spot A, the RIGHT remote on real spot B, and the scan is aligned
// from those two correspondences.
//
// HOW TO SET THESE VALUES: run the app on the PC (flat view), click on the
// scan — the 1st click prints point A, the 2nd point B, further clicks
// alternate. Copy the printed coordinates into these constants.
// Rule of thumb: pick two spots that are easy to mark with a physical
// remote (floor/waist height) and at least 1.5 m apart.

import type { Vec3 } from './yawTranslationSolver';

export const SCAN_POINT_A: Vec3 = [-19.45, -17.23, -1.32];
export const SCAN_POINT_B: Vec3 = [-19.43, -16.34, -1.34];