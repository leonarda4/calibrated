# Rendering quality and the active scan

Audit: 2026-11-03, installed `@mkkellogg/gaussian-splats-3d` **0.4.7**, Three.js **0.180.0**. Active display route: PC Chrome -> SteamVR -> Steam Link -> Quest 3. The classic XR layer workaround is unchanged.

## What the assets contain

The active scan is the original `public/splats/hallway3/hallway3_0.ply`, loaded directly with **no compression** at the user's request. Old `scan=` and `format=ksplat` URL parameters cannot switch to the previous exports or a compressed derivative. The original active scan is unchanged and shared through Git LFS; unused exports remain local.

| Source export | Splats in actual header | PLY bytes | Available SH degree |
| --- | ---: | ---: | ---: |
| `hallway3/hallway3_0.ply` | 2,109,500 | 143,446,489 | 0 |
| `hallway3/hallway3_1.ply` | 0 | 420 | unused |
| `hallway3/hallway3_2.ply` | 0 | 420 | unused |
| `hallway3/hallway3_3.ply` | 0 | 420 | unused |

The valid file has `f_dc_0..2` and **no `f_rest_*` coefficients**. Raising the renderer's SH cap cannot add absent view-dependent detail. The other three files are empty placeholders, not detail levels or additional chunks. The pinned renderer supports degrees 0–2.

Bounded header inspection and streaming position statistics confirm a different coordinate frame from the previous scan. The old A/B were outside the new bounds. User-supplied raw landmarks now load from calibration/landmarks.ts: A [2.99, 19.14, -1.41], B [2.90, 18.16, -1.26]. Preserve the manually adjusted scanAsset.ts profile without explicit permission to change it. Whole-scene extrema do not establish the 2.10 m hallway width, 2.40 m floor-to-bars height, floor orientation or metric scale. See [new scan setup](CALIBRATION.md).

The previous global opacity of 0.70 made even the opaque PC route look translucent. Experience opacity now starts at 1.0; calibration still owns its hide/reveal fade. The default PLY alpha pruning threshold is reduced from 20 to 5 out of 255, retaining more faint detail. That may also reveal floaters: compare `?alphaCutoff=20` before deciding that every visible low-opacity splat is desirable.

The renderer's separate radial load reveal is disabled (`SceneRevealMode.Instant`). Its default reveal starts at the raw-coordinate origin and expands per rendered frame: an off-centre scan can report "loaded" while remaining invisible for many frames. The application's calibration fade remains the single reveal control. A synthetic corridor reproduced this with only 89 lit canvas samples before the fix and approximately 44,700 afterwards, with the same fixture, camera and threshold. This is desktop rendering evidence only.

The export does not record whether training used antialias compensation. The pinned renderer describes `antialiased` as compensation for an appropriate training process, rather than ordinary edge smoothing. The default now uses the conventional kernel; `?splatAA=1` provides a direct comparison for compensation-trained assets. This choice needs an actual headset A/B comparison; it is not proof that training was wrong. GPU covariances remain full precision. CPU sorting remains compatible with the existing non-shared worker configuration; floating-point distances avoid the documented integer-overflow risk in larger scenes. These choices need timing measurements. [Pinned renderer documentation](https://github.com/mkkellogg/GaussianSplats3D/tree/v0.4.7#advanced-options)

## Profiles and comparisons

| URL query | Effect |
| --- | --- |
| `?quality=balanced` | Original hallway3 PLY, cutoff 5, desktop pixel ratio capped at 1.5 |
| `?quality=detail` | Same original PLY, cutoff 1, desktop pixel ratio capped at 2 |
| `?quality=fast` | Same original PLY, cutoff 20, desktop pixel ratio 1 |
| `?quality=detail&scan=max` | Old bookmark; still the original hallway3 PLY |
| `?quality=detail&format=ksplat` | Old bookmark; still the original hallway3 PLY |
| `?quality=detail&splatAA=1` | A/B comparison with training compensation enabled |
| `?sh=0&alphaCutoff=20` | SH/pruning comparison on the original PLY |

Quality changes affect rendering settings, not the source file. The SH cap defaults to 2 and the library clamps it to the actual source degree, currently zero. High DPI changes affect desktop inspection; XR resolution remains owned by the runtime/session framebuffer. GPU covariance precision is full and `inMemoryCompressionLevel` stays zero. No scan compression, coordinate quantization, rescaling or compressed fallback is applied.

## Local inspection and original-file handling

The existing preparer has a bounded, header-only inspection mode. This command does not create a converted asset:

```powershell
node scripts/prepare-scan.mjs public/splats/hallway3/hallway3_0.ply --inspect
```

Open `https://localhost:5173/?quality=detail` for the lowest pruning threshold. The original file remains 143,446,489 bytes. Older PLY/KSPLAT files under `public/models/` remain local historical assets and are not selected by the app. The newly generated hallway3 compressed derivative was removed after the user requested no compression. The converter remains an existing offline utility, not part of loading.

## Near detail and distance-based LoD

The pinned renderer already performs octree visibility culling, but its documented future work includes streamed sections and LoD; visibility culling is not distance-based detail selection. Keep the original detailed scan and measure both PC frame time and Steam Link stream quality. A hallway this size may be limited by fill rate, reconstruction, or streaming rather than point count. [Pinned renderer scope](https://github.com/mkkellogg/GaussianSplats3D/tree/v0.4.7#future-work)

If native-resolution detail remains inadequate, first compare the actual trained export against this viewer from the same camera position. If close surfaces are already blurred in the source viewer, recover texture through a better reconstruction/export. If this viewer is sharp on the PC but blurred in the headset, measure and adjust the SteamVR render resolution and Steam Link encode/network/decode settings. If the detailed source looks good but misses frame time or loading targets, evaluate a renderer with a supported spatial LoD format in an isolated branch, preserving transforms and testing stereo sorting, hand/mesh composition, transitions, calibration and the 180-degree turn before adoption. Distance alone should never remove the nearby interaction surfaces unpredictably.

## Evidence and outstanding checks

Synthetic tests cover bounded settings, local-only asset selection, source-coordinate preservation, retained degree-1 SH, compression quantization, unchanged source bytes, and overwrite/truncation rejection. Hardware evidence is still pending: native-eye A/B comparisons, PC frame p95, dropped/reprojected frames, streaming resolution/bitrate/timing, load-to-first-detail time, and interaction-time sorting. See [validation](VALIDATION.md) and the [interaction plan](INTERACTION_PLAN.md).

`CHECK_REAL_SCAN=1 npm run check` loads the actual Git LFS hallway3 PLY in the isolated desktop browser and writes `.check/private-scan.png`. Software rendering is paused before capture because continuous multi-million-splat frames can delay screenshot readback. Neither its FPS counter nor a successful screenshot establishes PCVR frame timing or physical alignment. Compare the trained source viewer and real Steam Link route before attributing blur to reconstruction, rendering or streaming. Historical compressed-scan evidence remains in `ai/strategy.md`.
