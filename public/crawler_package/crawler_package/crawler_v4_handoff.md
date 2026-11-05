# Handoff: crawler ghost (v4) for Calibrated

Written for the coding agent that will implement this in `leonarda4/calibrated`. The crawler was designed in Houdini 22.0.466 (script `crawler_v4_fix2.py`, network `/obj/crawler_v4`). The exported GLB was validated offline. Nothing has been tested in the app or on the headset.

This is a new ghost design. It replaces the earlier ghost handoffs (v1 to v3) unless Jan says otherwise. The glow system is the same as in v3.

Read first: `AGENTS.md`, `ai/strategy.md`. The rules that matter most here:

- Do not edit `src/viewer/scanAsset.ts`.
- Never push, pull or fetch. Commits are local only. Jan pushes with GitHub Desktop.
- Log the task, decisions and outcome in `ai/strategy.md`.
- The tracked XR rig stays at identity, one XR unit is one metre.
- Desktop checks are not hardware proof.

## 1. What to build

A low, white, see-through creature that drags itself across the floor toward the visitor:

- A hunched torso (about 0.75 m high) with a bowed head and no face. Its tail end lies flat on the floor and drags about 1.4 m behind it.
- 30 tentacles from thick to thin grow from the head, fall forward over it and spread across the floor up to about 1.4 m in front.
- Two overlong arms with high, sharply bent elbows and four long fingers each pull it forward. The hands stay planted on the floor while the body is dragged.
- A soft glow core inside the chest, plus the v3 glow layers.

It plays once, about 21 s with the defaults:

1. **Tentacles sprout** tip-first out of the floor, alone, and writhe (0 to 2.5 s).
2. **Body rises** among them (from 2.0 s, 2.5 s long). The tentacles fall forward over the head (from 2.8 s, 1.5 s long).
3. **Crawl** in a stop-start rhythm: reach, pull, freeze, sometimes a sharp twitch, then the other arm (from about 4.8 s).
4. **Hold** for 1 s, then **sink**: body first, tentacles 0.6 s later.

## 2. Assets

| File | Details |
| --- | --- |
| `crawler_v4.glb` | Two meshes. `crawler_body`: body, tentacles, arms and fingers, about 14,500 points and 28,300 triangles. `crawler_core`: about 400 points. Positions, smooth normals, four scalar and two vec3 custom attributes. Validated with the Khronos glTF validator (0 errors, 0 warnings) and loaded with three.js 0.180 `GLTFLoader`. |
| `crawler_v4_anim.json` | Phases, path, sampled crawl tracks, motion and look values, the front and rear extent, and counts. |
| Current location | Jan supplies both, exported on his Mac to `~/Desktop/calibrated_fx/`. |
| Suggested repo path | `public/effects/crawler/` |
| Reused asset | `dust_sprite.png` for the halo and wisps, at `public/effects/dust/dust_sprite.png` (the same path as in the dust handoff). |
| Target look | `reference/crawler_v4_target_look.png` in this package. |

Rest pose: the crawl pose with both arms reaching. It faces +Z, the floor is at y = 0, units are metres.

Custom attributes (three.js names in lower case):

| glTF | three.js | Meaning |
| --- | --- | --- |
| `_PART` | `_part` | 0 body, 1 tentacle, 2 core, 3 arm (incl. fingers) |
| `_TID` | `_tid` | tentacle number, or arm 0 (left) / 1 (right), -1 otherwise |
| `_S` | `_s` | 0..1 along the part: body tail to head, tentacle root to tip, arm shoulder to fingers |
| `_FLUTTER` | `_flutter` | 0 anchored .. 1 moves the most |
| `_PULL` | `_pull` | vec3: position in the pulled arm pose (equals `position` for non-arms) |
| `_RISE` | `_rise` | vec3: position in the sprouting tentacle pose (equals `position` for non-tentacles) |

`position` and the two vec3 attributes describe the same vertex in three poses. The shader blends between them.

## 3. Crawl tracks

The stop-start rhythm is generated in Houdini (keyframes from the stride, timing, pause and seed sliders). It is exported as sampled tracks, so the app does not need to rebuild it. Interpolate linearly between samples.

| Track | Meaning |
| --- | --- |
| `tracks.rate` | samples per second (30) |
| `progress` | 0..1 along start to end |
| `arm_l`, `arm_r` | 0 = reaching (rest pose), 1 = pulled (`_pull`) |
| `lift_l`, `lift_r` | 0..1 hand lift while reaching (times 0.12 m) |
| `twitch` | 0..1 short spikes during some pauses |

While an arm goes from reaching to pulled, `progress` advances by exactly one stride. The reach hand sits one stride ahead of the pulled hand in the rest pose, so the hand stays planted in world space. Keep progress and arm blend on the same samples so the hands do not slide.

## 4. Vertex shader

With `t` seconds since trigger and the values from `phases`, `path` and `motion` in the JSON. `smoothstep` is GLSL smoothstep:

```
A, B = path.start, path.end;  dir = normalize(B - A);  D = length(B - A)
prog = track(progress, t);  speed = d(progress)/dt * D        // from neighbouring samples

yrise = -1.0 * pow(1 - smoothstep(bodyStart, bodyStart + bodyEmerge, t), 3)
kb    = clamp((t - crawlEnd - hold) / sink, 0, 1)
kt    = clamp((t - crawlEnd - hold - tentacleSinkDelay) / sink, 0, 1)
y     = yrise - 1.3 * kb * kb

p = position
tentacle (_part == 1):
    yt    = -1.0 * pow(1 - smoothstep(0, tentacleEmerge, t), 2)
    drape = smoothstep(bodyStart + 0.8, bodyStart + 0.8 + drapeTime, t)
    rp    = _rise + vec3(sin(t*3.1 + _tid*1.3 + _s*6), 0, cos(t*2.7 + _tid*2.1 + _s*5)) * 0.07 * _s
    p     = mix(rp, position, drape)
    y     = mix(yt, yrise, drape) - 1.3 * kt * kt              // sink last
    sw    = curlNoise(position * 2.0 + vec3(_tid, t * 0.7, 0)) * tentacleSway * _flutter;  sw.y *= 0.3
    p    += sw * drape
    p    += curlNoise(position * 4.0 + vec3(0, t * 8, 0)) * 0.03 * twitch * _flutter     // shiver
arm (_part == 3):
    bl = (_tid < 0.5) ? arm_l : arm_r;   lf = (_tid < 0.5) ? lift_l : lift_r
    p  = mix(position, _pull, bl)
    p.y += lf * 0.12 * smoothstep(0.45, 1.0, _s)
body and core (_part == 0 or 2):
    p.x += twitch * 0.05 * sin(t * 45) * smoothstep(0.75, 0.9, _s)                   // head jerk
    sw2  = curlNoise(position * 1.5 + vec3(0, t * 0.4, 0)) * tailSway * _flutter;  sw2.y *= 0.3
    p   += sw2

trail = -dir * dragTrail * speed * pow(_flutter, 1.5)
a     = atan(dir.x, dir.z)
world = rotateY(p, a) + mix(A, B, prog) + vec3(0, y, 0) + trail      // hallway frame
hidden after phases.endTime
```

Any smooth GLSL curl noise is fine; match amplitudes by eye. Rotate normals with the same yaw. For blended poses, approximate normals by blending the normal with the same factor, or recompute in the fragment shader from derivatives if the shading looks wrong.

## 5. Look and glow

As in the v3 handoff, with these per-part rules in the body shader:

```
alpha = bodyOpacity                                                     // 0.22
body:     alpha *= smoothstep(0.0, 0.08, _s + (noise(position * 8) - 0.5) * 0.08)   // ragged tail end
tentacle: alpha *= 1.0 - smoothstep(0.85, 1.0, _s)                                 // tips fade
fresnel = pow(1.0 - abs(dot(N, V)), 2.5)
alpha  *= mix(0.2, 1.0, fresnel)
colour  = mix(vec3(0.85, 0.9, 1.0), vec3(1.0), fresnel) * (1.0 + rimGlow * fresnel)
if (heightAboveFloor < 0.0) discard;
```

Glow layers, each switchable:

1. **Rim glow** (above), `rimGlow` default 1.0.
2. **Core** (`crawler_core`): additive, `inner = pow(abs(dot(N, V)), 1.5)`, colour (0.8, 0.9, 1.0) * coreGlow * inner, pulsing `0.8 + 0.2 * sin(t * 2PI * 0.35)`.
3. **Halo**: camera-facing quad behind the core, about 1.6 m wide and 1.3 m tall (the creature is low and wide), `dust_sprite.png`, additive, opacity about 0.12.
4. **Wisps**: about 150 particles shed from tentacle tips (`_s > 0.85`) and the tail end (`_part == 0`, `_s < 0.05`). Each stays where it was released, drifts up about 0.3 m/s, and fades over 2 s.
5. **Light on the floor fog**: point light at the core position, as in v3. Here it matters even more, because the creature lies in the fog.

Draw order: splats, then body (back faces, then front faces), then core, then halo, then wisps, then floor fog, then virtual boxes and hands.

### Target look

`reference/crawler_v4_target_look.png` shows the intended glow strength: a soft light bleeding into the darkness around the creature. That image was made offline on a black background with a blur-based bloom, so it is a target, not a pixel reference. The defaults above are cautious. Tune toward the image, mainly with the halo strength and size, core glow, rim glow and the fog light. Expect the glow to read weaker against the lit hallway scan than on black. Record the final values.

### Optional: dim the hallway while the creature is out (decision for Jan)

The glow stands out much more if the scan darkens slightly while the creature is visible. For example, fade the scan to 60 to 70% brightness from the moment the tentacles appear, and back to 100% after the sink. This touches the scan rendering (an overlay or a scan colour multiplier, never `scanAsset.ts`), so implement it only after Jan approves, and as a separate toggle.

## 6. Path, stop distance and safety (must be decided with Jan)

The creature crawls straight toward the visitor. This is the most startling ghost so far.

- The tentacles reach `extentZ.frontReach` (about 1.46 m) in front of the creature's origin. The stop distance must be measured from there, not from the body.
- Suggested rule: at trigger time, take the visitor's tracked head position projected onto the floor, and set `end = head - dir * (1.5 + frontReach)`. Clamp it so the path stays inside the hallway and away from the step boxes.
- The Houdini default path, (0, 0, -2.5) to (0, 0, -0.2), assumes a visitor near z = 2.8. Do not ship it without the rule above.
- If the visitor walks toward the creature, it must stop and sink early when the front reach comes within 1.5 m of the head.
- Physical runs stay supervised. Brief the operator: visitors may step back suddenly.

## 7. Integration

Suggested structure, matching the other effect handoffs:

- `src/effects/crawlerConfig.ts`: JSON validation, track sampling, pure phase and pose math, stop distance rule. Unit testable.
- `src/effects/crawler.ts`: loads the GLB, builds the materials, halo and wisps, `trigger(visitorHead)`, `update(timeSeconds)`, `setVisible`, `dispose()`, and exposes the core position for the fog light.
- Same frame loop, lifecycle and `?fx=0` switch as the other effects. Add a desktop "Play crawler" button.

Decisions to confirm with Jan (do not guess):

1. **Trigger**: a fixed time in the narrated test, after it, or an operator button.
2. **Stop distance** and early-sink rule (section 6).
3. **Anchor during the 180 degree turn**: with the scan root or the physical frame.
4. **Sound**: dragging, scraping or breathing cues via `src/audio/`.
5. **Glow values** after a desktop review, layer by layer, against the target look.
6. **Hallway dimming** while the creature is out (section 5).

## 8. Acceptance criteria

- `npm run typecheck`, `npm test` and `npm run check` pass. Unit tests cover: JSON and track validation; at t = 1 s only tentacles are above the floor; after the body rise everything is above the floor; a hand stays within 1 cm in world space during a pull; the final front reach respects the stop distance; everything is hidden after `endTime`.
- A desktop screenshot sequence from standing eye height shows the tentacles alone, the body rising, mid-crawl, a pause, and the sink, with nothing below the floor.
- Each glow layer can be switched on and off.
- Plays exactly once per trigger; everything is cleaned up after.
- Draw cost recorded. No headset claims without a headset test.
- Record decisions, checks and outstanding hardware checks in `ai/strategy.md`.

## 9. How to regenerate the asset

In Houdini, change the sliders on `/obj/crawler_v4/crawler_shape` (tentacles) or `/obj/crawler_v4/crawler_preview` (phases, stride, timing, pauses, seed, path, look), then run `crawler_v4_fix2.py` again. It keeps the nodes, regenerates the crawl rhythm and rewrites `crawler_v4.glb` and `crawler_v4_anim.json`. Attribute and mesh names stay the same.
