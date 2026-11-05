# Handoff: volumetric floor fog for Calibrated

Written for the coding agent that will implement this in `leonarda4/calibrated`. The fog was designed in Houdini 22.0.466 by Jan and exported as a 3D density texture. It has not been tested in the app or on the headset.

This replaces the layered plane fog (`fog_effect_handoff.md`) as the main fog. Keep the layered fog as a fallback (see section 9).

Read first: `AGENTS.md`, `ai/strategy.md`. The rules that matter most here:

- Do not edit `src/viewer/scanAsset.ts`.
- Never push, pull or fetch. Commits are local only. Jan pushes with GitHub Desktop.
- Log the task, decisions and outcome in `ai/strategy.md`.
- The tracked XR rig stays at identity, one XR unit is one metre.
- Desktop checks are not hardware proof.

## 1. What to build

Realistic, puffy, rolling fog lying on the hallway floor. It is up to 30 cm high, thickest near the floor and gone by about 20 to 28 cm, with mounds and gaps, slowly drifting. It is lit, so the puff tops are brighter than the undersides.

Technique: ray-marched volume inside a thin box on the floor, sampling a baked, tileable 3D density texture. Target hardware: PC with an RTX 5090, rendered in Chrome and streamed over Steam Link.

## 2. Asset

| File | Details |
| --- | --- |
| `floor_fog_density.bin` | 1,280,000 bytes. Raw uint8 density, value / 255 = density 0..1. Order: x fastest, then y, then z. |
| `floor_fog_density.json` | Metadata (resolution, voxel size, bounds, axes, tiling, Houdini slider values). Load it and validate against the .bin. |
| Current location | Jan supplies both. They were exported to his Mac at `~/Desktop/calibrated_fx/`. |
| Suggested repo path | `public/effects/fog/` |

Contents of the JSON, for reference:

| Field | Value |
| --- | --- |
| resolution | 160 x 20 x 400 (x, y, z) |
| voxel size | 0.015 m |
| bounds | x -1.2..1.2, y 0..0.3, z -3..3 (metres) |
| axes | Y up from the floor, X across the hallway, Z along the hallway |
| tiling | seamless in X (period 2.4 m) and Z (period 6.0 m), not in Y |
| Houdini sliders | density_scale 2.0, depth_min 0.08, depth_max 0.28, puff_freq 2.5, gap_low 0.1, gap_high 0.45, swirl 0.35, speed 1.0 |

Density is stored without `density_scale`. Apply it in the shader.

Checked before handoff (offline, numpy):

- File size matches 160 x 20 x 400.
- 48% of voxels contain fog. Max value 0.82.
- Mean density per height: about 0.15 from 0 to 7 cm, falling to 0.06 at 12 cm, under 0.01 by 17 cm, zero above 21 cm. Mounds reach higher locally.
- Tiling: the difference across both wrap seams equals the normal voxel-to-voxel difference, so the seams are invisible. A 2 x 2 tiled top-down preview shows no seams.

## 3. Loading

```ts
const data = new Uint8Array(await (await fetch(binUrl)).arrayBuffer());
// validate: data.length === nx * ny * nz from the JSON
const tex = new THREE.Data3DTexture(data, nx, ny, nz);
tex.format = THREE.RedFormat;
tex.type = THREE.UnsignedByteType;
tex.minFilter = tex.magFilter = THREE.LinearFilter;
tex.wrapS = THREE.RepeatWrapping;       // x, across
tex.wrapT = THREE.ClampToEdgeWrapping;  // y, height
tex.wrapR = THREE.RepeatWrapping;       // z, along
tex.unpackAlignment = 1;
tex.needsUpdate = true;
```

Sample it as `texture(fogTex, vec3(x / 2.4, y / 0.3, z / 6.0) + 0.5)`, using local fog coordinates in metres (x across, y up, z along), with the scroll offset from section 5 added before the division.

## 4. Volume box and ray marching

- Geometry: a box mesh in the hallway frame, as wide as the hallway (about 2.1 m, so the fog stops at the walls), 0.3 m high, standing on local floor Y = 0, covering the walkable length. The texture tile is 2.4 m wide, so the hallway width fits without wrapping across.
- Render the box with `side: THREE.BackSide`. In the fragment shader, intersect the view ray with the box in local space and march from entry to exit. Clamp the entry to the camera position if the camera is inside the box (someone crouching or a hand at floor level).
- Steps: start with 48 per ray, with a per-pixel jittered start offset (hash or blue noise) to hide stepping. Tune for quality versus frame time.
- Accumulation: Beer-Lambert. `T *= exp(-extinction * density * dt)`, add the lit colour weighted by `T * (1 - exp(-extinction * density * dt))`. Expose `extinction` as a uniform. Start around 10 per metre at density 1 (after `density_scale`) and tune.
- Output premultiplied colour and alpha `1 - T`. Material: transparent, `depthWrite: false`, `depthTest: true`.

## 5. Motion

The bake is a still frame. Motion comes from sliding the lookup through the tileable block. The Houdini drift was 0.02 m/s across and 0.06 m/s along (times `speed`, 1.0):

```glsl
vec3 scroll = vec3(0.02, 0.0, 0.06) * uSpeed * uTime;   // metres
float d = sampleFog(p + scroll);
```

A single scroll looks like a conveyor belt. Use a second lookup at a different speed and scale and blend them, so the fog appears to evolve:

```glsl
float d1 = sampleFog(p + scroll);
float d2 = sampleFog(p * vec3(1.3, 1.0, 1.3) + vec3(-0.015, 0.0, 0.035) * uSpeed * uTime);
float d = mix(d1, d2, 0.4) * uDensityScale;
```

Expose `uSpeed` (default 1.0) and the mix weight. Jan tunes these on the desktop page, then in the headset.

## 6. Lighting and look

- One directional light from above and slightly in front. Expose its direction.
- Per march step, take 4 to 6 short steps toward the light through the volume (the box is only 0.3 m tall, so the light path is short) and use the resulting transmittance as self-shadowing. Add an ambient term so the shadowed undersides are not black.
- Colour: cool grey, about `vec3(0.8, 0.85, 0.9)` lit and roughly 40% of that in shadow. Expose both.
- Add a little per-pixel grain (dither) to the final colour. Smooth dark gradients band badly in the Steam Link video stream; grain reduces visible banding. This needs a headset check.

## 7. Shaping in the shader

The baked data has no edges. Add them analytically, in local fog coordinates:

- Ends: fade density to zero over the last 0.6 m at both ends of the fog box.
- Walls: fade over the last 5 to 10 cm before each wall, so there is no hard cut line.
- Height is already in the data. Do not add another height falloff unless Jan asks.

## 8. Depth, occlusion and safety

- The splat renderer does not provide reliable depth, so the fog cannot be occluded by scan geometry. This is acceptable because the box stops at the hallway walls and the fog is below knee height. Door frames or objects on the floor in the scan will have fog drawn over them. Report how noticeable it is.
- Render order: splats, then fog, then the virtual boxes and hands. The boxes and hands are not fogged and stay clearly visible.
- Safety: the real step boxes (36 x 36 x 43 cm, two placements, see `docs/INTERACTION_PLAN.md`) must stay readable. In addition to drawing them after the fog, fade the fog density to zero around each box footprint, with a margin of about 0.3 m. Confirm the margin with Jan.

## 9. Integration

Suggested structure, matching the dust and layered fog handoffs:

- `src/effects/volumeFogConfig.ts`: constants, JSON validation, coordinate mapping and fade math. Pure, unit testable.
- `src/effects/volumeFog.ts`: loads the texture, builds the box and shader material, `update(timeSeconds)`, `setVisible`, `setOpacity`, `dispose()`.
- Same frame loop and lifecycle as the other effects, same `?fx=0` switch.
- Add `?fog=volume|layers|off`, default `volume`, so Jan can compare with the layered fallback and turn it off if the stream or frame time suffers.

Decisions to confirm with Jan (do not guess):

1. **Anchor during the 180 degree turn.** The fog lies on the real floor, which does not turn, so a fixed world anchor is the natural choice. Either way, align and centre the box on the hallway axis using `src/experience/hallwayCenter.ts`.
2. **Visibility timing.** Suggested: hidden before calibration, fades in with the scan reveal, hidden on reset or recalibration.
3. **Box safety margin** from section 8.
4. **Final speed, density, extinction and light** after a desktop review.

## 10. Acceptance criteria

- `npm run typecheck`, `npm test` and `npm run check` pass. Unit tests cover JSON and .bin validation (size mismatch rejected), coordinate mapping and the fades.
- A desktop screenshot in the real scan, from standing eye height looking along the hallway, shows lit, puffy fog on the floor with no visible box edges, seams or hard wall line.
- No conveyor-belt look over 30 seconds of motion.
- Boxes stay readable through or above the fog.
- PC frame time is recorded on the desktop page with the fog on and off. Do not claim headset frame time or stream quality without a headset test.
- Record decisions, checks and the outstanding hardware checks in `ai/strategy.md`.

## 11. How to regenerate the asset

In Houdini (`/obj/floor_fog_v2`), tune the sliders on `fog_density`, then run `export_floor_fog.py` from the Python Shell. It rewrites both files. The JSON records the slider values used. The resolution and tiling stay the same, so no code change is needed.
