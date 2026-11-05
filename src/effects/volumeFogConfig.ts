import type { Point3 } from '../viewer/hallwayCutPlacement.ts';
export { volumeMetadata as fogMetadata, type VolumeMetadata as FogMetadata } from './volumeTexture.ts';

export const FOG = {
  metadataUrl: '/fog_package/fog_package/public/effects/fog/floor_fog_v3_density.json',
  densityUrl: '/fog_package/fog_package/public/effects/fog/floor_fog_v3_density.bin',
  wallInset: .14, wallFade: .10, endFade: .6,
  // Fixed added-hallway coordinates, independent of broom placement. The
  // original cutout reaches just under 33 m from its source opening.
  startDepth: 5, endDepth: 33,
  heightFraction: .5,
  steps: 64, lightSteps: 6, extinction: 6, densityScale: 2,
} as const;

export interface FogPassage {
  start: number; end: number;
  /** Left/right at start, then left/right at end, all in the volume frame. */
  sides: readonly [number, number, number, number];
  portalHeight?: number;
}
export function passageSides(passage: FogPassage, z: number): [number, number] {
  const t = (z - passage.start) / (passage.end - passage.start), v = passage.sides;
  return [v[0] + (v[2] - v[0]) * t, v[1] + (v[3] - v[1]) * t];
}
export function inFogPassage(p: Point3, passage: FogPassage, height: number): boolean {
  const [left, right] = passageSides(passage, p[2]);
  return p.every(Number.isFinite) && p[1] >= 0 && p[1] <= height &&
    p[2] >= passage.start && p[2] <= passage.end && p[0] > left + FOG.wallInset && p[0] < right - FOG.wallInset;
}
