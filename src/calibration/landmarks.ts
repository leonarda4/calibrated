// User-supplied raw PLY landmarks for hallway3. Keep these separate from the
// manually adjusted placement in scanAsset.ts; match LEFT/A and RIGHT/B.

import type { Vec3 } from './yawTranslationSolver';
import { ACTIVE_SCAN } from '../viewer/scanAsset.ts';

export interface ScanLandmarkPair { a: Vec3; b: Vec3; }

export const SCAN_LANDMARKS: ScanLandmarkPair | null = ACTIVE_SCAN.id === 'hallway3' ? {
  a: [2.99, 19.14, -1.41],
  b: [2.90, 18.16, -1.26],
} : null;
export const SCAN_POINT_A: Vec3 | null = SCAN_LANDMARKS?.a ?? null;
export const SCAN_POINT_B: Vec3 | null = SCAN_LANDMARKS?.b ?? null;
