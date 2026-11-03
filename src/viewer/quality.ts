// Pure, bounded quality settings. Nothing here changes the metric transform.
export type ScanVariant = 'std' | 'high' | 'ultra' | 'max';
export type QualityProfile = 'fast' | 'balanced' | 'detail';
export type ScanFormat = 'ply' | 'ksplat';

const VARIANTS: Record<ScanVariant, string> = {
  std: 'hallway', high: 'hallway_high', ultra: 'hallway_ultra', max: 'hallway_max',
};

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
  const defaultVariant: ScanVariant = profile === 'detail' ? 'ultra' : profile === 'fast' ? 'std' : 'high';
  const requestedScan = query.get('scan');
  const variant: ScanVariant = requestedScan !== null && Object.hasOwn(VARIANTS, requestedScan)
    ? requestedScan as ScanVariant : defaultVariant;
  const format: ScanFormat = query.get('format') === 'ksplat' ? 'ksplat' : 'ply';
  const requestedSh = query.get('sh');
  const sphericalHarmonicsDegree = requestedSh === '0' ? 0 : requestedSh === '1' ? 1 : 2;
  const rawAlpha = query.get('alphaCutoff');
  const defaultAlpha = profile === 'fast' ? 20 : profile === 'detail' ? 1 : 5;
  const alpha = rawAlpha === null || rawAlpha.trim() === '' ? defaultAlpha : Number(rawAlpha);
  const alphaRemovalThreshold = Number.isInteger(alpha) && alpha >= 1 && alpha <= 255 ? alpha : defaultAlpha;
  return {
    profile, variant, format,
    modelUrl: `/models/${VARIANTS[variant]}.${format}`,
    sphericalHarmonicsDegree,
    // Compensation-trained AA is different from ordinary WebGL antialiasing.
    // Export training metadata is unknown: opt in only after an A/B comparison.
    antialiased: query.get('splatAA') === '1',
    alphaRemovalThreshold,
    desktopPixelRatioLimit: profile === 'detail' ? 2 : profile === 'fast' ? 1 : 1.5,
  };
}
