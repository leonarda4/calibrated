# Rendering quality and local scan preparation

Audit: 2026-11-03, installed `@mkkellogg/gaussian-splats-3d` **0.4.7**, Three.js **0.180.0**. Active display route: PC Chrome -> SteamVR -> Steam Link -> Quest 3. The classic XR layer workaround is unchanged.

## What the assets contain

Only bounded PLY headers were read for this audit; scan bodies were processed locally by the converter, never printed into agent context.

| Private source | Splats in actual header | PLY bytes | Available SH degree |
| --- | ---: | ---: | ---: |
| `hallway.ply` | 265,972 | 18,086,900 | 0 |
| `hallway_high.ply` | 1,064,203 | 72,366,609 | 0 |
| `hallway_ultra.ply` | 2,128,334 | 144,727,517 | 0 |
| `hallway_max.ply` | 4,254,452 | 289,303,541 | 0 |

All four exports have `f_dc_0..2` and **no `f_rest_*` coefficients**. Raising the renderer's SH cap cannot add the missing view-dependent detail. Header comments identify `lcc2` exports; they do not establish whether the larger variants were independently trained, filtered, or densified. More splats are not evidence of better reconstruction. Future exports should preserve their trained SH coefficients if available; the pinned renderer supports degrees 0–2.

The previous global opacity of 0.70 made even the opaque PC route look translucent. Experience opacity now starts at 1.0; calibration still owns its hide/reveal fade. The default PLY alpha pruning threshold is reduced from 20 to 5 out of 255, retaining more faint detail. That may also reveal floaters: compare `?alphaCutoff=20` before deciding that every visible low-opacity splat is desirable.

The renderer's separate radial load reveal is disabled (`SceneRevealMode.Instant`). Its default reveal starts at the raw-coordinate origin and expands per rendered frame: an off-centre scan can report "loaded" while remaining invisible for many frames. The application's calibration fade remains the single reveal control. A synthetic corridor reproduced this with only 89 lit canvas samples before the fix and approximately 44,700 afterwards, with the same fixture, camera and threshold. This is desktop rendering evidence only.

The export does not record whether training used antialias compensation. The pinned renderer describes `antialiased` as compensation for an appropriate training process, rather than ordinary edge smoothing. The default now uses the conventional kernel; `?splatAA=1` provides a direct comparison for compensation-trained assets. This choice needs an actual headset A/B comparison; it is not proof that training was wrong. GPU covariances remain full precision. CPU sorting remains compatible with the existing non-shared worker configuration; floating-point distances avoid the documented integer-overflow risk in larger scenes. These choices need timing measurements. [Pinned renderer documentation](https://github.com/mkkellogg/GaussianSplats3D/tree/v0.4.7#advanced-options)

## Profiles and comparisons

| URL query | Effect |
| --- | --- |
| `?quality=balanced` | Default: high source, cutoff 5, desktop pixel ratio capped at 1.5 |
| `?quality=detail` | Ultra source, cutoff 1, desktop pixel ratio capped at 2 |
| `?quality=fast` | Standard source, cutoff 20, desktop pixel ratio 1 |
| `?quality=detail&scan=max` | Explicit largest source; measure memory and frame delivery first |
| `?quality=detail&format=ksplat` | Ultra compressed source after preparing it below |
| `?quality=detail&splatAA=1` | A/B comparison with training compensation enabled |
| `?scan=high&sh=0&alphaCutoff=20` | Explicit source/SH/pruning comparison |

`scan=std|high|ultra|max` overrides the profile's source. `format=ksplat` is explicit: missing prepared files produce the normal loading error, rather than silently substituting a different-quality scan. Keep the matching private file beside the PLY. The SH cap defaults to 2 and the library clamps it to the actual source degree, currently zero. High DPI changes affect desktop inspection; XR resolution remains owned by the runtime/session framebuffer. No camera/rig scaling or normalization changes are introduced.

## Faster loading with KSPLAT

Run locally from the repository. The script uses the installed renderer's parser and cache-ordering/bucket generator. It does not require network access.

```powershell
node scripts/prepare-scan.mjs public/models/hallway_ultra.ply --inspect
node --max-old-space-size=8192 scripts/prepare-scan.mjs public/models/hallway_ultra.ply
```

Open the viewer at `https://localhost:5173/?quality=detail&format=ksplat`. For the largest source:

```powershell
node --max-old-space-size=8192 scripts/prepare-scan.mjs public/models/hallway_max.ply
```

Then use `?quality=detail&scan=max&format=ksplat`. Memory use during preparation grows with source size; process variants sequentially.

Default conversion uses level 1 and alpha cutoff 1; it keeps the original file unchanged, retains its renderer-supported SH degree, and writes `.ksplat` plus `.ksplat.meta.json` with source SHA-256, exact counts, parameters, timing, and coordinate convention. Both outputs are private and ignored. Existing outputs require explicit `--force`. The script rejects silent degree-3 SH truncation; `--sh=2` is an explicit lossy choice for such a source. Use a renderer supporting degree 3 if those coefficients must survive.

Compression is **not lossless**. Positions use rounded offsets inside five-raw-unit buckets (step approximately 0.0000763 raw units); scales, rotations and SH use half precision. No translation, scale or axis conversion is baked in. Level 0 (`--compression=0`) avoids that position/covariance quantization and is useful for comparison. The application applies the same normalization/calibration to either format. Changing the asset still requires a fresh physical check. [Pinned KSPLAT format and conversion](https://github.com/mkkellogg/GaussianSplats3D/tree/v0.4.7#creating-ksplat-files)

Local preparation results with level 1, alpha 1: high **25,596,372 bytes** from 72,366,609; ultra **51,185,404 bytes** from 144,727,517; max **102,311,896 bytes** from 289,303,541. Every input splat survived in these conversions. These are file-size observations, not browser load-time or headset performance measurements.

## Near detail and distance-based LoD

The pinned renderer already performs octree visibility culling, but its documented future work includes streamed sections and LoD; visibility culling is not distance-based detail selection. Keep the complete detailed scan initially, compress it, and measure both PC frame time and Steam Link stream quality. A hallway this size may be limited by fill rate, reconstruction, or streaming rather than point count. [Pinned renderer scope](https://github.com/mkkellogg/GaussianSplats3D/tree/v0.4.7#future-work)

If native-resolution detail remains inadequate, first compare the actual trained export against this viewer from the same camera position. If close surfaces are already blurred in the source viewer, recover texture through a better reconstruction/export. If this viewer is sharp on the PC but blurred in the headset, measure and adjust the SteamVR render resolution and Steam Link encode/network/decode settings. If the detailed source looks good but misses frame time or loading targets, evaluate a renderer with a supported spatial LoD format in an isolated branch, preserving transforms and testing stereo sorting, hand/mesh composition, transitions, calibration and the 180-degree turn before adoption. Distance alone should never remove the nearby interaction surfaces unpredictably.

## Evidence and outstanding checks

Synthetic tests cover bounded settings, local-only asset selection, source-coordinate preservation, retained degree-1 SH, compression quantization, unchanged source bytes, and overwrite/truncation rejection. Hardware evidence is still pending: native-eye A/B comparisons, PC frame p95, dropped/reprojected frames, streaming resolution/bitrate/timing, load-to-first-detail time, and interaction-time sorting. See [validation](VALIDATION.md) and the [interaction plan](INTERACTION_PLAN.md).

Desktop evidence 2026-11-03: the actual private ultra KSPLAT loaded successfully in headless Chrome; `.check/private-scan.png` was inspected. The local image shows the hallway walls/floor and remaining ceiling smear, so fine-detail quality is not declared solved. Software rendering was paused for screenshot capture because continuous multi-million-splat frames delayed the first attempt. The screenshot's FPS counter is not a PCVR performance measurement. Compare the trained source viewer and real Steam Link route before attributing the remaining blur to reconstruction, this renderer, or streaming.
