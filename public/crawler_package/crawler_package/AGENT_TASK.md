# Task for the coding agent: bring the crawler ghost into Calibrated

You are implementing the crawler ghost (v4) in `leonarda4/calibrated`. The full specification is `crawler_v4_handoff.md` in this package. This file is the order of work. Follow the repository's own rules first (`AGENTS.md`, `ai/strategy.md`).

## Ground rules (from the repo, repeated because they matter here)

- Do not edit `src/viewer/scanAsset.ts`.
- Never push, pull or fetch. Commit locally only. Jan pushes with GitHub Desktop.
- Record the task and acceptance criteria in `ai/strategy.md` before you start, and the outcome after.
- The tracked XR rig stays at identity. Effects are added to the scene, never by moving the rig.
- Desktop screenshots are not headset proof. Never report a hardware result you did not measure.
- Ask Jan when a decision listed in the handoff (section 7) blocks you. Do not guess those.

## Package contents

| Package path | Goes to |
| --- | --- |
| `public/effects/crawler/crawler_v4.glb` | `public/effects/crawler/crawler_v4.glb` |
| `public/effects/crawler/crawler_v4_anim.json` | `public/effects/crawler/crawler_v4_anim.json` |
| `public/effects/dust/dust_sprite.png` | `public/effects/dust/dust_sprite.png` (skip if the dust effect already added it) |
| `tools/check_crawler_assets.py` | `scripts/check_crawler_assets.py` (or keep it out of the repo, Jan decides) |
| `crawler_v4_handoff.md` | `docs/effects/CRAWLER.md` (recommended, so the spec lives with the code) |
| `reference/crawler_v4_target_look.png` | `docs/effects/crawler_target_look.png` |
| `tools/crawler_v4_fix2.py` | Houdini source. Keep it with Jan's Houdini files, not in the app. |

Check that the asset files are covered by the repo's `.gitignore` rules the way Jan wants. Private scans are excluded; these effect assets are small and safe to commit, but confirm with Jan.

## Steps

1. **Verify the assets.** Run `python3 scripts/check_crawler_assets.py public/effects/crawler`. It must print `OK`. If it reports problems, stop and tell Jan. The assets come from a Houdini export and must be regenerated there, not patched by hand.

2. **Pure logic first** (`src/effects/crawlerConfig.ts`), with unit tests in `tests/crawlerConfig.test.ts`:
   - parse and validate `crawler_v4_anim.json` (same checks as the Python script)
   - `sampleTrack(name, t)`: linear interpolation of the 30 Hz tracks, clamped at the ends
   - phase helpers: `yRise(t)`, `tentacleY(t)`, `drape(t)`, `sinkBody(t)`, `sinkTentacles(t)`, `isFinished(t)`
   - `endForVisitor(start, visitorHeadOnFloor, frontReach, stopDistance = 1.5)`: the stop rule from section 6 of the handoff, clamped to the hallway
   - tests from section 8 of the handoff (tentacles only at t = 1 s, planted hand during a pull within 1 cm, stop distance respected, hidden after `endTime`)

3. **Loading and the body shader** (`src/effects/crawler.ts`):
   - load the GLB with `GLTFLoader` (three 0.180 exposes the custom attributes as `_part`, `_tid`, `_s`, `_flutter`, `_pull`, `_rise`)
   - replace the placeholder materials with a `ShaderMaterial` implementing section 4 (vertex) and section 5 (fragment) of the handoff, with the track values and phase values as uniforms updated each frame
   - two passes for the body (back faces, then front faces), `depthWrite: false`
   - put the crawler in the hallway frame using the existing helpers (see `src/experience/hallwayCenter.ts`); the anchor during the 180 degree turn is a decision for Jan
   - add a desktop-only debug control "Play crawler" next to the existing operator controls, and a URL option to freeze time for screenshots (for example `?crawlerT=7.5`); `?fx=0` disables all effects

4. **Desktop check of motion only.** Take screenshots from standing eye height at t = 1, 3.5, 6, a pause, and during the sink. Check against the handoff: tentacles alone first, nothing below the floor, hands not sliding, tentacles falling over the head. Fix before adding glow.

5. **Glow layers, one at a time**, each with its own toggle: core, rim, halo, wisps, then the light on the floor fog (only if the volumetric fog exists in the app). Compare each step with `crawler_target_look.png` and record the values you settle on.

6. **Trigger and safety.** Wire the trigger the way Jan decides (handoff section 7). Implement the stop rule and the early-sink rule from section 6. These are not optional.

7. **Finish.** Run `npm run typecheck`, `npm test`, `npm run check`. Record frame time on the desktop page with the crawler on and off. Update `ai/strategy.md` with decisions, checks and the outstanding headset checks. Commit locally and tell Jan what to push.

## Out of scope unless Jan asks

- Hallway dimming while the creature is out (described in the handoff, needs approval).
- Sound cues.
- Any change to the calibration flow, the scan placement or the narrated test timing.
