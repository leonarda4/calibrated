# Floor fog v3 (80 cm): changes to the volumetric fog handoff

Read `volumetric_fog_handoff.md` first. Everything there still applies, except the points below. The fog is now up to 80 cm tall instead of 30 cm: a dense layer on the floor with rolling billows that rise to between 30 and 80 cm, thinning toward the top.

## 1. Files

| File | Details |
| --- | --- |
| `public/effects/fog/floor_fog_v3_density.bin` | Raw uint8 density, x fastest, then y, then z. About 3.4 MB. |
| `public/effects/fog/floor_fog_v3_density.json` | Resolution, voxel size, bounds, `fogHeight`, tiling, `meanDensityPerHeightLayer`, Houdini slider values. |

These replace `floor_fog_density.*` (the 30 cm version). Do not hard-code the resolution (about 160 x 53 x 400). Read it and `fogHeight` from the JSON and validate the .bin length against it. Run `tools/check_fog_assets.py` before using the files.

## 2. Volume box and sampling

- Box height = `fogHeight` (0.8 m), still as wide as the hallway, standing on local floor Y = 0.
- Sample with `vec3(x / 2.4, y / fogHeight, z / 6.0) + 0.5`. Tiling is unchanged: seamless in X (2.4 m) and Z (6 m), clamped in Y.
- `meanDensityPerHeightLayer` in the JSON shows how the fog is distributed by height. Use it to check that the app shows the same profile.

## 3. Cost

Rays now pass through up to 80 cm of fog instead of 30 cm, and along the hallway at a grazing angle through much more. Expect a clearly higher cost than v2.

- Start with 64 steps per ray (up from 48) and a jittered start. Raise only if banding shows.
- Light march: 6 to 8 steps toward the light (up from 4 to 6).
- If PC frame time suffers, render the fog at half resolution and upsample, before reducing steps.
- Start `extinction` lower than in v2, around 6 per metre at density 1. The longer paths make the fog much thicker overall.
- Record PC frame time with fog on and off, as before.

## 4. Occlusion

At 80 cm the fog is no longer below knee height. The cut at the walls is still exact, but door frames, wall bases and anything standing in the scan will be visibly fogged over up to 80 cm, because the splats provide no depth. Report how noticeable this is in the desktop screenshots, from standing eye height.

## 5. Safety (stricter than v2)

- The step boxes (43 cm tall) are now completely inside the fog. The fade around each box footprint (margin about 0.3 m) and drawing the boxes after the fog are both **mandatory**, not optional.
- Visitors cannot see their own feet or the real floor through the fog. Physical runs stay supervised. Brief the operator.

## 6. Interaction with the crawler ghost

The crawler is about 0.75 m tall, so it is fully inside this fog.

- Light style: its point light now lights a large part of the fog. This should look good; tune its radius and intensity together with the fog.
- Dark style: the fog shadow around it matters more.
- Offer a toggle that thins the fog density within about 0.6 m of the crawler, so it stays readable. Default off; Jan decides.

## 7. Fallback

The layered plane fog (`fog_effect_handoff.md`) only covers about 30 cm. It remains a performance fallback, not an equivalent of this fog.

## 8. Regenerating

In Houdini, tune the sliders on `/obj/floor_fog_v3/fog_density` (including **Fog Box Height**), then run `tools/floor_fog_v3.py` again. It rewrites both files. If the height changes, the resolution changes too; the app reads both from the JSON, so no code change is needed.
