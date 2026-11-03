// Pure, bounded quality settings. Nothing here changes the metric transform.
import { ACTIVE_SCAN } from './scanAsset.ts';
export type ScanVariant = typeof ACTIVE_SCAN.id;
export type QualityProfile = 'fast' | 'balanced' | 'detail';
export type ScanFormat = 'ply';

export interface RenderQuality {
  profile: QualityProfile;
  variant: ScanVariant;
  format: ScanFormat;
  modelUrl: string;
  // The pinned renderer clamps this to the degree actually present in the asset.
  sphericalHarmonicsDegree: 0 | 1 | 2;
  antialiased: boolean;
  alphaRemovalThreshold: number;
  desktopPixelRatioLimit: number;
}

export function parseRenderQuality(search: string): RenderQuality {
  const query = new URLSearchParams(search);
  const requestedProfile = query.get('quality');
  const profile: QualityProfile = requestedProfile === 'fast' || requestedProfile === 'detail'
    ? requestedProfile : 'balanced';
  // There is one new export. Old scan=std/high/ultra/max bookmarks must not
  // silently select the previous coordinate system or an empty chunk.
  const variant: ScanVariant = ACTIVE_SCAN.id;
  // User requests the original PLY only, including older format bookmarks.
  const format: ScanFormat = 'ply';
  const requestedSh = query.get('sh');
  const sphericalHarmonicsDegree = requestedSh === '0' ? 0 : requestedSh === '1' ? 1 : 2;
  const rawAlpha = query.get('alphaCutoff');
  const defaultAlpha = profile === 'fast' ? 20 : profile === 'detail' ? 1 : 5;
  const alpha = rawAlpha === null || rawAlpha.trim() === '' ? defaultAlpha : Number(rawAlpha);
  const alphaRemovalThreshold = Number.isInteger(alpha) && alpha >= 1 && alpha <= 255 ? alpha : defaultAlpha;
  return {
    profile, variant, format,
    modelUrl: ACTIVE_SCAN.plyUrl,
    sphericalHarmonicsDegree,
    // Compensation-trained AA is different from ordinary WebGL antialiasing.
    // Export training metadata is unknown: opt in only after an A/B comparison.
    antialiased: query.get('splatAA') === '1',
    alphaRemovalThreshold,
    desktopPixelRatioLimit: profile === 'detail' ? 2 : profile === 'fast' ? 1 : 1.5,
  };
}
