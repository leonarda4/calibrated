# Hallway fog and mist

The added downward hallway uses the supplied [fog v3 package](../public/fog_package/fog_package/FOG_V3_ADDENDUM.md). Its position stays at **5-33 m** from the opening, one metre beyond the broom at its four-metre station. The rolling floor layer stretches vertically to **half the captured hallway height: 1.3 m for the 2.6 m corridor**. The unchanged source texture has a nominal height of 80 cm and 160 x 53 x 400 uint8 voxels. Its metadata bounds are remapped vertically at runtime; horizontal tiling and source bytes remain unchanged.

Fog follows the captured opening before, during and after both directions of the quarter-turn. It appears whenever the added corridor is visible, without waiting for the broom or reading movement boundaries. Wall/mouth clipping, lighting/calibration opacity and local destruction remain active; closing the opening hides it. It uses 64 ray samples, six lighting samples and extinction 6. The existing near gap keeps the taller layer away from the broom and step boxes.

The separate [mist package](../public/mist_package/mist_package/ROOM_MIST_HANDOFF_v2.md) supplies **full-height haze in that same added hallway, at depth 5-33 m**. There is no mist volume in the original hallway. One volume uses the captured corridor frame shared with fog through `corridorAtmosphere.ts`, including its floor, taper, calibration and both presentation turns. Source placement and tracked camera/controllers stay unchanged.

Mist uses its supplied 50 x 52 x 160 density, captured corridor height (2.6 m) and ground boost 1.6, with 32 ray samples, initial density 0.2, slow two-lookup drift, one-metre end fades and a near-eye fade. Both effects clip rays at the opening and corridor walls, share the added hallway's local collapse mask and hide when the opening closes. Near floor/wall surfaces and original hallway probes remain clear. The package reference image compares densities; actual source-scan appearance is checked separately.

The foreground broom has a **1.35 RGB gain** before shared scene dimming; its Gaussian opacity and source bytes remain unchanged. While atmosphere and broom are visible, `broomAtmosphere.ts` draws only its existing sorted Gaussian indices after fog/mist. The shared pass excludes those same broom indices to avoid doubling them. This preserves its exact soft silhouette over haze and prevents the volume compositing over the bristles; it is an artistic foreground treatment, not a surveyed depth buffer. Other splats keep their existing pass. The additional layer shares live textures/transforms, calibration/ending fade and glitch uniforms, filters only after the sorted list changes, and releases its own geometry/material on exit.

The operator's **Hallway mist** controls hide/show it and adjust strength. `?mist=0` disables mist, `?fog=off` disables downward fog and `?fx=0` disables both. They preload/warm before readiness, use current-eye matrices, follow scan visibility/calibration/lighting and dispose resources on exit. Missing/corrupt assets hide only the affected effect. Neither changes calibration acceptance or physical movement rules.

Run `npm test`, `npm run check` and `npm run build`. The Node validator mirrors the supplied Python byte/layout/seam checks and compares height-layer means within uint8 quantisation tolerance:

```powershell
node scripts/check-volume-assets.mts public/fog_package/fog_package/public/effects/fog floor_fog_v3_density
node scripts/check-volume-assets.mts public/mist_package/mist_package/public/effects/mist room_mist_v1_density
```

Use `CHECK_FOG_ONLY=1` for focused atmosphere checks; `CHECK_REAL_FOG=1` adds original hallway/cutout renders of both effects. `CHECK_DESKTOP_GPU=1` requests desktop D3D11 while retaining XR isolation. Inspect `fog-downward-*.png`, `mist-downward-*.png`, `mist-original-clear-*.png`, `combined-downward-atmosphere.png` and their `private-` counterparts. Checks cover half-height fog, full-height mist, the fixed gap, wall/mouth exclusion, clear original ends, calibration/turn/return transforms, opacity/lighting, 30-second drift, controls, resource reuse and closure. Lighting uses an isolated opaque-black control so white-void contrast does not contaminate the ratio; composite screenshots retain the real background.

The existing broom encounter scenario also compares fog, mist and both together against an isolated black/white Gaussian reference during its reveal/removal glitches. `CHECK_BROOM_AUDIO_ONLY=1` runs that native encounter profile; add `CHECK_REAL_BROOM=1` to use the supplied broom. Inspect `broom-cutout-glitch-*-atmosphere-*.png`. Opaque broom pixels must stay within three display values of their source-color bounds while the surrounding atmosphere remains visible. This avoids treating the old shared pass's background bleed as a reference color.

Fog reports record median render-only costs for three warmed eight-frame batches at 512 x 384 with GPU completion. These exclude sorting, stereo, streaming and headset frame delivery. Original-source desktop screenshots verify appearance, not surveyed geometry, headset comfort or Steam Link performance; those remain separate hardware checks.
