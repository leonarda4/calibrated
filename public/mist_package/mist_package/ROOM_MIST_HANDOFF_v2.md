# Handoff: room mist for Calibrated

Written for the coding agent that will implement this in `leonarda4/calibrated`. The mist was designed in Houdini 22.0.466 (script `tools/room_mist_v1.py`, network `/obj/room_mist_v1`). Nothing has been tested in the app or on the headset.

This is a separate effect from the floor fog. Both can run together. Read first: `AGENTS.md`, `ai/strategy.md`, and the volumetric floor fog handoff, which this one builds on (same loading and ray-marching approach). The usual rules apply: do not edit `src/viewer/scanAsset.ts`, commit locally only, log in `ai/strategy.md`, rig stays at identity, no headset claims from desktop checks.

## 1. What to build

A soft, slowly drifting mist that fills the whole hallway from floor to ceiling. It is mostly even, with loose denser patches and faint streaks along the hallway, and slightly denser near the floor. The far end of the hallway looks hazier than the near walls. It should read as damp air, not as smoke.

Jan explicitly accepts that the mist may extend a little through the walls.

## 2. Asset

| File | Details |
| --- | --- |
| `public/effects/mist/room_mist_v1_density.bin` | Raw uint8, x fastest, then y, then z. Local mist variation 0..1. About 0.4 MB. |
| `public/effects/mist/room_mist_v1_density.json` | Resolution (about 50 x 52 x 160), voxel size (5 cm), bounds, `fogHeight` (2.6 m), tiling, `groundBoost`, per-height means, Houdini slider values. |

The current files were generated outside Houdini (numpy Perlin noise) with the same recipe as `tools/room_mist_v1.py`; the JSON `source` field says so. Running the Houdini script later overwrites them with the Houdini version; the format is identical.

Read the resolution and sizes from the JSON; do not hard-code them. Run `python3 tools/check_volume_assets.py public/effects/mist room_mist_v1_density` first; it must print `OK`.

The stored value is the local variation only. Overall density and the ground boost are applied in the shader (section 4), so they can be tuned without re-exporting.

## 3. Volume box: why it extends past the walls

The splats give no depth, so the mist cannot stop at the scan's surfaces. The box geometry does that job approximately:

- Width: the fitted wall-to-wall width (about 2.28 m, from `src/experience/hallwayCenter.ts`) plus about 0.15 m on each side. Rays toward a near wall then pass through only a little mist, while rays along the hallway pass through a lot. This gives the depth impression for free.
- Height: 2.6 m (floor to ceiling).
- Length: the walkable segment, or slightly longer. Optionally fade density over the last 1 m at both ends.
- Align and centre it on the hallway axis like the floor fog.

Sample with `vec3(x / tileX, y / fogHeight, z / tileZ) + 0.5`, with tile sizes from the JSON (2.5 m across, 8 m along). Repeat wrapping in X and Z, clamp in Y. The box can be longer than the 8 m tile; it repeats seamlessly.

## 4. Shader

Same structure as the floor fog: box mesh with `side: BackSide`, ray-box intersection, clamp the entry to the camera when inside (the camera is always inside this box), Beer-Lambert accumulation, premultiplied output, `depthWrite: false`.

```
v      = texture(mistTex, coords(p + scroll)).r
v2     = texture(mistTex, coords(p * 1.4 + scroll2)).r       // second lookup, avoids a conveyor look
local  = mix(v, v2, 0.35)
ground = mix(1.0, groundBoost, 1.0 - smoothstep(0.0, 1.2, p.y))   // groundBoost from the JSON (1.6)
near   = smoothstep(0.2, 0.8, distance(p, cameraPos))         // no mist right in front of the eyes
dens   = uMistDensity * local * ground * near
```

- `scroll = vec3(0.03, 0, 0.08) * uSpeed * t`, `scroll2 = vec3(-0.02, 0.005, 0.05) * uSpeed * t` (metres).
- Start with extinction (`uMistDensity`) about 0.2 per metre. `reference/mist_density_comparison.png` shows 0.12 (subtle), 0.2 (suggested start) and 0.35 (heavy), simulated with this exact asset and the shader above in a plain hallway. Tune by eye in the scan. Keep it subtle enough that the calibration HUD and the boxes stay readable.
- Steps: 24 to 32 per ray, jittered. The mist has no fine detail, so render it at half resolution and upsample; it will not show.
- Colour: cool grey-white, for example (0.78, 0.8, 0.84), plus a constant ambient term. No self-shadowing needed.
- Add slight dither to the output to avoid banding in the Steam Link stream.

## 5. Interaction with other effects

- **Floor fog**: draw the floor fog first, then the mist. The mist box contains the fog box; no special handling needed.
- **Crawler ghost**: in light style, add its core point light to the mist lighting (radius about 1.5 m). A glowing halo in the mist around the creature costs one term per step and looks very good. In dark style, darken the mist in the same radius instead.
- **Boxes, hands, HUD**: draw them after the mist so they stay clear.

## 6. Safety and comfort

- Disable or strongly reduce the mist during calibration, and whenever calibration or recovery instructions are shown.
- The step boxes must stay clearly visible (they are drawn after the mist).
- Thick, moving haze over the whole field of view can be uncomfortable for some people. Keep the drift slow and the default density low, and provide `?mist=0` and an operator toggle.

## 7. Integration

- `src/effects/roomMistConfig.ts`: JSON validation, box sizing from the fitted hallway width, coordinate mapping. Unit testable.
- `src/effects/roomMist.ts`: load, build box and material, `update(t)`, `setVisible`, `setDensity`, `dispose()`.
- Same frame loop and lifecycle as the other effects; `?mist=0` and `?fx=0` switch it off.

Decisions for Jan (do not guess): default density; whether the mist runs during the whole experience or only from a certain moment (for example with the crawler); whether it turns with the hallway during the 180 degree turn (it is air, so fixed is natural).

## 8. Acceptance

- Typecheck, tests and browser checks pass; unit tests cover JSON validation and box sizing.
- Desktop screenshots from standing eye height, looking along the hallway and at a near wall: the far end is visibly hazier than the near wall, no box edges or seams visible, HUD and boxes readable.
- Frame time recorded with mist on and off. No headset claims without a headset test.
- Decisions and checks recorded in `ai/strategy.md`.

## 9. Regenerating

In Houdini, tune the sliders on `/obj/room_mist_v1/mist_density`, then run `tools/room_mist_v1.py` again. **Preview Density** only affects the Houdini preview. **Denser Near Floor** is written to the JSON as `groundBoost` and used by the app.
