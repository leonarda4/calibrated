import {FOG} from './volumeFogConfig.ts';

export const MIST = {
  metadataUrl: '/mist_package/mist_package/public/effects/mist/room_mist_v1_density.json',
  densityUrl: '/mist_package/mist_package/public/effects/mist/room_mist_v1_density.bin',
  density: .2, maxDensity: .5, steps: 32, endFade: 1,
  startDepth:FOG.startDepth,endDepth:FOG.endDepth,wallInset:FOG.wallInset,wallFade:FOG.wallFade,
} as const;
