# Project plan

The supplied volumetric fog uses one fixed interval in the added downward hallway, 5–33 m from its opening: three metres beyond the broom. It is present whenever that corridor is visible, including throughout turning. The original hallway ends have no fog, and fog has no movement-boundary dependency. It follows scan opacity and lighting. See [fog placement and validation](FOG.md); headset appearance/performance remain separate checks.

Planning baseline: 2026-10-29. Working name: **Calibrated**.

## Outcome

A person wearing Quest 3 in a real hallway sees that hallway's Gaussian splat at the same position, orientation, and scale. Their physical head movement produces corresponding movement through the scan. Calibration aligns the scan to the current tracking space; it does not modify the headset's tracking system or the person's IPD/eye settings.

The first deliverable is a supervised, repeatable demonstration in one measured **3–5 metre segment**, adjusted to the actual hallway. Extending to the entire hallway requires new measurements over the larger area.

## Confirmed and provisional setup

| Item | Decision/status |
| --- | --- |
| Headset | Meta Quest 3 |
| Rendering computer | Windows PC confirmed; OS version, GPU, driver, and RAM pending |
| Transport | Wireless streaming over strong local Wi-Fi confirmed |
| Streaming software | **SteamVR / Steam Link — the single active route (user decision 2026-11-03).** Accepted on hardware 2026-11-02. Meta Link tried first and **parked**: three.js sessions never present over Horizon Link 208 (upstream bug); the classic `XRWebGLLayer` path fix (`src/xr/enterVR.ts`) made the SteamVR route work |
| Browser/runtime | Chrome on the PC + **SteamVR as the active OpenXR runtime** — the only working combination; all further work targets this path |
| Scan | Active original `public/splats/hallway3/hallway3_0.ply` (2,109,500 splats), loaded without compression; runtime source shared through Git LFS; older exports retained privately; **metric scale still unverified (M2)** |
| Authoring | Agents work directly on the Windows PC (OpenCode + OpenRouter); headset validation runs on the same machine |
| Calibration setup | Restored guided flow: wear the headset with Steam Link connected, wake both controllers, enter VR, then start **CALIBRATE** or pull a controller trigger. Seven seconds to place LEFT/A and RIGHT/B in the same attempt; buffered physical poses handle hand takeover. Hand tracking stays enabled. |

The working path is **PC web app → PC WebXR (Chrome + SteamVR OpenXR) → Steam Link wireless stream → Quest 3**. This is the only route under active development from 2026-11-03 onward.

**Calibration rollback (2026-11-03):** at the user's request, the active flow is restored from local commit `8754817`: HALLWAY PROJECT title, trigger or PC CALIBRATE start, seven-second LEFT/A plus RIGHT/B placement, buffered physical controller poses, CONFIRM fallback and one-second scan reveal. The sequential trigger-hold, pre-headset queued start and two-second redo flow are removed. The headset is worn and Steam Link connected before Enter VR; the wearer can use SteamVR Desktop to access the PC page. Current-frame pose safety and installation invalidation remain. Desktop browser hardware isolation, bounded session-error UI, render quality, voice, hands and movement-boundary work are retained. This rollback needs a new hardware check; earlier route acceptance is not acceptance of the integrated rollback. See [headset setup](HEADSET_SETUP.md).

- **Meta Link route:** parked, upstream presentation bug (Horizon Link 208). Retry after the next Horizon Link/Chrome update; not part of the current work.
- **Quest Browser route (headset renders itself, opens the PC-served URL):** development history — the calibration UX was built and hardware-tested there before the PCVR route worked. Not part of the current working path; kept working as of 2026-11-02 but receives no further feature work.

**Status update 2026-11-02:** stereo + tracked controllers + working calibration demonstrated on hardware via SteamVR/Steam Link (developed on the Quest Browser route first). M0's formal enter/exit cycles and streaming-timing record are still to be captured; see `ai/strategy.md` for the evidence chain.

Chromium documents Windows OpenXR VR support, and Meta documents Windows Link support with Quest 3. Their combination is a candidate stack, not proof that this particular machine works. Verify it before committing to the rest of the build. [Chromium support](https://chromium.googlesource.com/chromium/src/+/main/device/vr/), [Meta Link](https://developers.meta.com/vr/documentation/unity/unity-link/)

Recommend Ethernet from the PC to the access point where available, with a clear wireless path to the hallway. Record actual transport latency and interruptions along the route. Strong Wi-Fi signal alone does not establish streaming performance. A USB connection is an optional diagnostic fallback, not a requirement for this project's intended experience. [Meta support's Air Link guidance](https://communityforums.atmeta.com/discussions/OtherTroubleshooting/3s-air-link-not-working/1345035/replies/1345046)

## MVP scope

- One local hallway scan, one headset, one user at a time.
- Desktop inspection and operator controls; stereo immersive VR with tracked controllers.
- Scan preparation with metric scale, floor/up orientation, landmark definitions, and an asset fingerprint.
- Guided landmark capture, alignment, and independent validation with visible error values.
- Physical movement only during the calibrated experience.
- Save/export local calibration reports; revalidate after interruptions or new sessions.
- Measured rendering and wireless performance in the hallway.

Later work: automatic registration, persistent spatial anchors, passthrough overlays, multiple users/headsets, larger buildings, native applications, and remote asset hosting. No backend/account system is needed for the MVP.

**Current installation (2026-11-04):** every successful live calibration reenables and restarts the full game and supplied local soundtrack. Ambience 1 starts after the fit; welcome plays at +1 s and the first box rises at +8 s with its step-on instruction. After a five-second announcement minimum, current valid headset entry into/above the raised box starts Transition 1; the four-second visual turn follows 2 s later. Desktop autoplay starts Transition 1 at +20 s, turns at +22 s and reveals the second box at +27 s. The second box always follows actual turn onset by 5 s. Turn commentary plays on completion; SitDownOnTheBox.wav is requested after the second box finishes rising. The headset-above-box trigger arms the wall, and GoBackToTheClassRoom.wav is requested five seconds after its actual unseen appearance. Complete speech takes queue without cutting each other off. Recalibration cancels previous audio, actions and effects before restarting from zero. Both box placements must succeed before revealing the first box; an action failure stops and disarms the game. Supplied WAV music, speech and effects replace the earlier generated voices without an API dependency. Disable the gameplay option after the fit for the current run's manual diagnostics; the next calibration restores it. Show box fits opposing walls near raw [2,21.1,-1.45], places a metric floor-standing box and uses its base as the fixed turn pivot. The tracked rig, hands and first box stay fixed. The second box retains its prepared hallway-route station and physical wall side while refitting wall contact; the broom shares this calibrated frame. The wall freezes its route before entry, and the hole freezes its fitted bounds when opened. Desktop preview grants no calibration authority. See [gameplay flow](GAMEPLAY_FLOW.md) and [interaction plan](INTERACTION_PLAN.md). Estimated scan centring and the artistic turn do not establish continued physical wall alignment.

The supplied real box measures 36 x 36 cm and 43 cm high; the virtual box uses 0.36 x 0.36 x 0.43 metres. Its centre/floor placement still requires on-site checks.

The second box's completed rise starts a 6.5-second wait before the one-second flicker and 30% brightness hold. Transition 2 starts 2 s before the flicker; the short local light-flicker sound remains synchronized with the actual light change. This follows settled visibility for both manual and gameplay reveals. Manual lighting commands override the cue; recovery cancels audio/timing and restores normal brightness. See [lighting behavior](INTERACTION_PLAN.md#lights-out).

The current trial adds a +10 cm lateral scan correction blended through the turn, adjustable in **Flipped hallway wall alignment**. Positive is right facing down the original hallway; the first box remains fixed and unturned calibration is unchanged. The broom centres at hallway Z6, and the second box preserves its prepared station/physical wall side while refitting contact. Before wall reveal, capture its route from Z=-8 to the first box's hallway station, approximately Z=2.5, with its endpoint centred between the fitted scan walls. Later corrections do not alter its frozen trajectory. Prepare the hole's near edge 1 m beyond the captured final wall position opposite approach, before player passage. Fit both walls there, extend 2.60 m and freeze the hidden opening, connected cutout and later hinge. When the actual opaque wall conceals all four fitted corners, glitch the floor and cutout in over 0.4 s, possibly during approach. Player position and crossing direction never relocate it. The second box does not move. Translation cannot reconcile differing scan wall widths/angles, so reversed-wall alignment still needs physical checks. Both box splat bases sit on the floor without extra lift.

Music follows Ambience 1 ? Transition 1 ? Ambience 2 ? Transition 2 ? Ambience 3 ? Transition 3 ? Ambience 4, using the selected 9/6/7-second transition excerpts and 1.2-second fades. Throughout an active unmuted game, either ambience or a transition keeps playing at its nominal gain under speech, wall movement and other effects. Native media playback is independent of long rendering frames; desktop visual clocks skip those stalled frames instead of cancelling music. The outgoing bed remains audible until its incoming replacement actually starts, with crossfades and background-loop recovery preventing silent gaps. Explicit Stop/reset/mute and calibration/tracking/session recovery still cancel playback. The third cue uses the current headset over the open hole's captured fitted footprint. After its 2 s anticipation, the complete visual environment eases through 90 degrees over 4 s about the cutout's floor edge, bringing that corridor horizontal with a level floor and unchanged tracked viewpoint. The final pose holds for physical walking; recovery restores the baseline. Speech queues so complete supplied lines are not truncated. After the five-second minimum, live box entry also waits for actual scheduled/playing first-box speech, while pending/failed downloads, suspended audio or mute do not block the turn. Successful buffers are reused, failed loads can retry, and cancellation prevents stale playback. Initial audio permission needs a gesture; explicit mute persists. Calibration/recovery instructions remain in-headset. See [audio setup](VOICE_SETUP.md).

At the held 90-degree pose, the hole is a vertical fitted trapezoid. A swept head crossing through it from the cutout interior toward the original side, with 8 cm side hysteresis, starts a four-second eased return about the same frozen hinge to the exact pre-quarter-turn presentation. A head starting outside must first enter the interior. After return, clearing the horizontal footprint expanded by 10 cm and reentering repeats the two-second lead and four-second turn; subsequent outward crossings return again. The original 180-degree scan sequence remains in place, and Ambience 4 continues without story or Transition 3 replay. Prop/source authoring remains locked after the first hole turn until Reset. Closing the hole, STOP, reset, recalibration or tracking/session recovery cancels either direction and clears crossing/reentry history. The tracked rig, metric scale and captured geometry remain unchanged. These repeated physical passages and their headset comfort still need hardware validation.

PC passthrough is not an MVP dependency. Chromium's Windows AR path is not enabled by default; Meta's browser mixed-reality documentation concerns Quest Browser and does not establish the same features through PC Link. If passthrough becomes essential, evaluate a separate Quest Browser branch and retest its rendering budget. [Chromium support](https://chromium.googlesource.com/chromium/src/+/main/device/vr/), [Meta browser MR](https://developers.meta.com/vr/documentation/web/webxr-mixed-reality/)

## Proposed implementation (as built)

TypeScript ES modules, Vite, Three.js 0.180, with Node's test runner — no UI framework. **Gaussian splat rendering uses `@mkkellogg/gaussian-splats-3d` 0.4.7** (proven working with this project's INRIA-style `.ply` on both routes); Spark from the original proposal remains an unadopted candidate. [Reference package](https://github.com/leonarda4/photolipsia-agentic-kit/blob/49d501e551e4e2a1e2c96af3a95666ac32e97dff/02-splat-viewer/package.json)

The active Git LFS export is the original public/splats/hallway3/hallway3_0.ply (143,446,489 bytes, 2,109,500 splats), loaded directly without compression. Empty companion PLYs are ignored; all quality profiles and legacy bookmarks use the original export. The manually adjusted placement in scanAsset.ts is protected: do not modify it without explicit user permission. User-supplied A [2.99, 19.14, -1.41] and B [2.90, 18.16, -1.26] load from calibration/landmarks.ts; EDIT A/B can replace them for a page session. Physical calibration and independent floor, scale and box checks remain required. See [new scan setup](CALIBRATION.md). Source SH is degree 0; the pinned renderer has no supported distance-based LoD. See [RENDER_QUALITY.md](RENDER_QUALITY.md) before a renderer migration or higher-detail claim.

The extracted wall preloads hidden and warms its shader in the initial shared build. A valid headset above the fully raised second-box footprint arms gameplay appearance; the wall waits for a look away and a clear footprint, then appears instantly at hallway Z=-8 without a slide-in. It immediately moves unseen at **1 m/s**, toward the first box's captured station, approximately Z=2.5. Looking back allows **0.7 s** before stopping; there is no watched 2 m intro. Show/Run, desktop preview and VR use the same current headset/camera gaze cone, with 45-degree entry and 50-degree retention; invalid gaze blocks movement. Five supported sections lock a straight trajectory through the final-section normalized wall-distance midpoint and a constant covering width for the full slab. Width, height, depth and heading remain fixed throughout motion and waits, with no later section queries or realignment. Its 75 cm player clearance and 15 cm release margin override gaze, and it never retreats, catches up or exceeds route bounds. The player may pass through the visual wall. `/audio/SoundFX/RumblingSound02.wav` loops at 35% gain with a 0.2-second fade-in and a 0.7-second look-back fade-out synchronized with stopping; other waits and recovery silence it. **Check wall start/end** statically inspect the canonical endpoints without arming disappearance. The floor opening is prepared once 1 m beyond the final wall endpoint opposite approach, independently of player passage. As soon as the actual opaque wall fully conceals its four fitted corners, the floor and connected hallway glitch in over **0.4 s**, including during approach. **Five continuous seconds looking after final arrival**, or a genuine player passage through the finite wall footprint at any route position, only freezes the wall and immediately glitches it away over **0.55 s**; it never relocates the prepared opening. Show/Hide reuse existing render resources; reset, calibration and tracking/session recovery cancel all pending reveals, motion, effects and audio and close the opening. See [interaction plan](INTERACTION_PLAN.md).

The supplied `public/splats/broooooommm.ply` also preloads hidden in that shared build. **Show broom / Hide broom** reveals it upright, bristles-down, at the current fitted hallway centre/floor Y/hallway Z6. It follows the corrected hallway laterally at that station. The original 9,676-splat asset is shared through Git LFS and remains unchanged; physical dimensions and floor contact still need checking.

Successful broom reveals request the supplied complete `CLEANTHEROOM.wav`
speech: on the automatic encounter's first glitch-in frame, or a manual
hidden-to-visible Show. Repeated visible frames and failed placement do not
cue speech; the existing queue preserves complete lines without lowering
music. `RoomTilting.wav` supports actual angular movement during both
four-second directions of the hole turn, including later cycles and manual
open-hole mode. Anticipation and held endpoints stay silent in this effect
layer. Mute, close, STOP, reset and calibration/tracking/session recovery
cancel active/pending tilt playback. Audible balance and headset routing
still require an actual-route audition.

The first completed hole quarter-turn also starts one broom encounter per game.
Two seconds later, the same preloaded broom glitches in over 0.55 s, centred
two metres inside the added upright hallway with its bristles on that floor.
A valid headset above its invisible 36 x 36 cm footprint starts a latched
two-second delay, followed by a 0.55 s glitch out. Return/re-entry preserves
the encounter without replay; proximity applies only while that hallway is
fully upright. Close, Hide, STOP or tracking/calibration recovery cancels it;
a fresh game/recalibration rearms it. Source data and tracked poses stay fixed.

Only completion of that automatic broom glitch out starts the next cue: ten
semi-random fracture spots, five on each side of the added hallway, progressing
from far to near. A fresh per-game seed fixes varied positions, patch shapes
and 0.6–1.1 s gaps for reproducible playback. Each 1.8 s source-animation burst
starts one supplied `RumblingSound01.wav` excerpt and a local patch of splat/fog
loss that grows over about three seconds. Irregular cavities retain scattered
Gaussian detail between them instead of forming a planar cutoff or uniform
whole-volume void. Use the actual crop length and captured opening frame,
independent of tracking yaw or floor side.
Keep at least the first 6 m intact and permanently enlarge this return prefix
to the greatest user depth plus 2 m; optional current boundary points can
enlarge it to their farthest depth plus 1 m. Protection restores approached
space and overrides authored loss. Missing boundary data does not gate the
effect or fixed fog. Original scene0, the near area and opening/return trigger
remain intact. The clock pauses through return/original/inward poses while the
local damage persists; later visits resume without replaying the broom or story.
Preloaded source assets, render buffers/materials and the shared sorter are
reused. Close, STOP, reset, recalibration, tracking/session recovery or invalid
frames cancel it; Reset/fresh game rearms. Numerical settings are first-trial
visual choices; hardware rendering, physical registration and comfort remain
unvalidated.

The separate hallway crop also preloads hidden in that build. Opening the fitted
floor hole exposes it as a downward continuation: its floor meets the edge
toward the second box, ceiling meets the opposite edge and walls meet the sides.
The cutout reads the hole's captured corners and calibrated frame directly,
including taper, so later scan edits cannot separate their mouths. Only this
new scene is deformed/clipped; closing or recovery hides it with the opening.
The original scan, hole interval, boxes and tracked rig keep their coordinates.

Planned module boundaries, to be created during implementation:

| Area | Responsibility |
| --- | --- |
| `src/viewer/` | Load/dispose splats, desktop inspection, shared content root, rendering quality |
| `src/xr/` | Session lifecycle (`enterVR.ts` classic-layer PCVR fix), reference space, calibration capture input |
| `src/calibration/` | Pure transform math (yaw+translation solver), predefined landmarks |
| `src/ui/` | PC Enter VR/calibration and operator controls, in-headset title/countdown/recovery HUD |
| `src/experience/` | Pure sequence/rotation, fixed first-box pivot, current-section prop placement, lifecycle orchestration |
| `src/audio/` | Supplied local music, crossfades, queued speech, effects and cancellation |
| ~~`src/storage/`~~ | **Removed at the user's request** with the auto-recalibration machinery — calibration state is per-session; local persistence is a debugging record only |
| `tests/` | Solver, interaction, hand-contact, audio and conversion tests; `npm run check` runs type checking and bounded Playwright desktop checks |

Use a separate desktop inspection camera. In calibrated VR, leave tracked camera/controller parents at identity and apply alignment to the hallway content root. Do not inherit the kit's miniature-scene rig scaling, artificial eye-height offset, or stick locomotion. Draw every XR frame through Three.js's XR-compatible animation loop. Desktop checks remain separate from hardware proof.

## Milestones and completion gates

| Milestone | Deliverable | Gate before proceeding |
| --- | --- | --- |
| **M0 — Runtime proof** | Minimal metre-grid scene on Windows Chrome through wireless Link; environment record | Stereo, head/controller poses, three enter/exit cycles, baseline streaming timing, and restored guided landmark capture demonstrated on hardware |
| **M1 — Viewer** | Local splat loading, desktop inspection, XR rendering, error handling, browser-check harness | Synthetic asset passes automated/visual checks and renders correctly in both eyes; full hallway loads or has a documented asset-budget blocker |
| **M2 — Metric hallway** | Normalization transform, measured dimensions, 4–6 fit landmarks and 3+ validation landmarks | Length/width/height checks agree within the selected error budget; no unresolved deformation or ambiguous landmark definitions |
| **M3 — Calibration** | Probe capture, deterministic fit, held-out errors, state-gated aligned mode | Synthetic tests pass and three fresh physical calibrations meet the feasibility targets in the validation protocol |
| **M4 — Recovery** | Stop/invalidation, local profiles, schema validation, explicit revalidation | Reset, tracking/focus loss, session restart, changed assets/probe, and reconnect cannot silently restore verified status |
| **M5 — Hallway pilot** | Tuned scan budget, wireless benchmark, supervised short-route report | Five-minute trial, start/end physical checkpoints, and frame/streaming targets pass for the documented area |

M2 measurements can run alongside M1 development. M3 needs M0 input proof and M2 data. M5 needs all earlier gates. Dates follow availability of the PC, scan, and hallway; avoid promising a delivery date before M0.

## Decisions that could change the plan

| Finding | Response |
| --- | --- |
| PC/browser cannot start a stable session | Resolve runtime/GPU/transport first; keep calibration math independent of runtime |
| Scan has local distortion | Reconstruct/crop the asset or reduce tested extent; a global transform cannot repair it |
| Controller landmark samples are too noisy | Improve probe/fixture, sample procedure, and tracking visibility before tuning the solver |
| Opaque VR prevents practical acquisition | Validate the restored marked-floor/controller placement and browser capture controls; evaluate fixtures or passthrough as separate capability experiments if needed |
| Drift or streaming instability grows down the corridor | Shorten the tested segment or improve coverage/tracking conditions; retest before expansion |

## Inputs needed next

Windows version and GPU; actual streaming client; scan file metadata and a measured hallway dimension; hallway length/width and access; recognizable fixed landmarks; repeatable controller placement or probe/fixture, plus assistance for the supervised physical hallway/box trial. Software controls can be accessed from SteamVR Desktop while wearing the headset. These are implementation inputs, not prerequisites for publishing this plan.

The issue order is in [BACKLOG.md](BACKLOG.md). The exact calibration and acceptance procedures are in [CALIBRATION.md](CALIBRATION.md) and [VALIDATION.md](VALIDATION.md).
