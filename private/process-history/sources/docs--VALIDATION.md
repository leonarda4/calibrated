# Validation protocol

Fog regressions validate the supplied density metadata/binary and a fixed interval three metres beyond the added-hallway broom. Actual renders require both original hallway ends to remain unchanged, a clear near gap and side wall, and visible fog before, midway through and after the quarter-turn and return. The volume must reach beyond its former 18 m cap, keep its fixed coordinates and render without reading movement-area data or waiting for broom visibility. Check lighting, calibration fade, 30 seconds of drift and closing/reopening the corridor. Inspect `fog-downward-*.png` and `private-fog-downward-*.png`; these checks do not certify real wall geometry, headset stereo or streamed frame time. See [fog details](FOG.md).

All gates are **pending**. Thresholds below are proposed engineering targets, not measured performance or a guarantee of wall-contact accuracy.

## M0: prove the actual wireless runtime

Record date, Windows version, GPU/driver/RAM, Chrome version, Quest firmware, Link/SteamVR version, active OpenXR runtime, streaming client, refresh rate/resolution, router/access point, wireless band, PC network connection, and test location.

**Status 2026-11-03:** the working runtime is **SteamVR / Steam Link only** (user decision 2026-11-03): the PC renders and streams to Quest 3, user-confirmed working after the classic `XRWebGLLayer` fix in `src/xr/enterVR.ts` on 2026-11-02. The **Meta Link route is parked** (upstream presentation bug: three.js sessions never present over Horizon Link 208). The Quest Browser route is development history, where calibration was first hardware-tested. At the user's request, current calibration returns to local commit `8754817`'s title/trigger/seven-second placement with buffered physical controller poses and CONFIRM fallback. Formal three enter/exit cycles, baseline streaming timing and the restored capture record below remain open. Earlier route acceptance does not establish acceptance of this integrated rollback.

1. Check the GPU against [Meta's current Link requirements](https://www.meta.com/help/quest/articles/headsets-and-accessories/oculus-link/requirements-quest-link/). Pair the wireless headset and PC; set **SteamVR as the active OpenXR runtime** for the accepted Steam Link path. Avoid mixing runtimes during the baseline test.
2. From **Chrome on the PC**, run the official [immersive VR sample](https://immersive-web.github.io/webxr-samples/immersive-vr-session.html). Confirm stereo and positional head tracking in Quest 3. Repeat enter/exit three times.
3. Build a minimal local probe with required `local-floor`, a metre reference, both controller grips, and capture controls. Verify measured controller displacement and button behavior. Log available features and unsupported capabilities.
4. Demonstrate the restored landmark capture without passthrough or a hand-tracking settings change: wear the headset with Steam Link connected, wake both controllers, click **Enter VR**, then start **CALIBRATE** or pull a controller trigger. Place LEFT on A and RIGHT on B during the same seven-second countdown. Verify the current-frame physical-pose buffer, hand takeover after placement, CONFIRM fallback when either measurement is missing, one-second reveal and independent alignment. Record session-end behavior and Enter VR access through SteamVR Desktop.
5. Benchmark a stationary view and head turns, then traverse the planned segment under guidance. Measure frame timing plus runtime/stream diagnostics where available. Repeat with a tiny synthetic splat.
6. Exercise reset, headset removal, focus loss, loss of tracking, reconnect, session end, and reload. Record which events are actually observable; mark gaps for operator controls.

For a PC-local app, `localhost` is an appropriate development origin; deployment to another device requires a secure origin. Do not confuse opening a URL in Quest Browser with PC rendering. [WebXR specification](https://www.w3.org/TR/webxr/)

## Automated and desktop checks

Opaque-output regressions read an actual RGBA render target, independently of
the desktop canvas's `alpha:false` setting. Empty/loading frames, normal splats,
partial calibration fades and fully hidden splats must have alpha 255 at every
pixel; uncovered space must be black while scan RGB still fades. A deliberately
transparent control must read alpha 0, proving the test can detect leakage.
Before isolating helpers, render the actual default scene with scan opacity 0
and with the complete scan group hidden: both frames must be opaque black.
Origin/pivot rings, landmark witnesses and movement outlines are opt-in desktop
diagnostics; the default PC map still works without drawing them in the world.
Fog must stop drawing when its owning scan is hidden.
An isolated browser regression uses the installed Three.js WebXRManager with
fake sessions and verifies that both initial attachment and re-entry create
classic layers with alpha:false. Native constructors must be restored before
construction and after compatibility/constructor/attachment failures, and
other sessions/contexts retain their options. No real XR request is made.
Synthetic session tests reject and close alpha-blend/additive sessions before
renderer attachment and retain successful opaque re-entry. Inspect
`opaque-loading-frame.png` and `opaque-splat-frames.png` in the selected check
folder. Verify the result in a fresh real SteamVR/Steam Link session separately;
these desktop tests do not exercise the headset compositor or system overlays.

During implementation, provide `npm test`, `npm run check`, and `npm run build`. The bounded browser check should produce `.check/report.json` and `.check/screenshot.png`, following the reference kit. Inspect both; a nonblank canvas alone is insufficient.

Test the consequential behavior:

- Transform recovery from known synthetic points; nonzero yaw/translation, metres versus raw units, matrix order, and probe offsets at multiple orientations.
- Rejection of wrong/missing correspondences, non-finite data, weak point geometry, excessive capture noise, invalid scale/reflections, and mismatched asset/probe versions.
- Independent validation fails a deliberately incorrect alignment even if fit residual is small.
- Verified-state invalidation and recovery under session/reset/viewer-tracking/profile changes; stale profile imports never restore verification automatically. Invalid controller poses block capture, while loss of an unused controller alone does not force recalibration.
- Desktop loading/error UI, replacing and disposing an asset, restored countdown/buffer/CONFIRM capture with synthetic poses, and explicit unsupported-XR messaging.

Desktop tests use synthetic public data. No automated screenshot or emulated session is accepted as evidence of real spatial registration, stereo comfort, or wireless latency.

Pivot-box exit checks use actual turn completion, including a custom eight-second turn: no effect during rotation or the following first second, then a 0.55-second glitch with the visible box at full standing height. Verify anchor/scan matrices stay fixed, second-box pose is unchanged, only the first box's rendered pixels change, and the box is hidden at completion. STOP/reset/calibration/tracking interruption cancel waiting and active effects without revival. Inspect box-glitch-before.png, box-glitch-during.png and box-glitch-after.png. Stereo appearance and comfort still require a headset test.

CONFIRM recovery regression coverage includes the 3 -> 2 -> 1 -> READY failure budget, the exact 30-second deadline, a return after no frames, late hand/controller confirmation with otherwise valid buffers, persistent wake guidance, transient loading/focus priority, fresh attempts, reference resets and session-end cancellation. `.check/confirm-recovery.png` contains copies of the actual instruction textures for visual inspection. Physical verification remains pending: deliberately enter CONFIRM with sleeping controllers, exercise both bounded exits, wake them and complete a new attempt. Desktop screenshots do not establish that the controllers reconnect on Steam Link hardware.

The desktop check launches its own Chrome with `--force-webxr-runtime=no-xr-runtime` and installs an inert XRSystem before application scripts on every page. Chromium's no-runtime selector prevents physical provider creation, including XR-compatible WebGL requests; detached regression factories explicitly supply fake XR objects. The runner verifies the launch flag. Never run the desktop check against the wearer's live OpenXR runtime: Chrome processes can share SteamVR's generated application key, and a test process exiting can clear the live browser's registration. The test flag affects only the check-owned browser. [Chromium runtime selection](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/xr/service/xr_runtime_manager_impl.cc)

The implemented bounded check uses installed Chrome and its own temporary Vite server, and closes both in `finally`. `npm run check` produces `.check/report.json`, `screenshot.png` (badge), `reversed.png` and loading/failure evidence. Calibration regressions use detached synthetic poses to check current XRFrame reads, physical-controller/hand separation, seven-second simultaneous placement, the per-attempt buffer through hand takeover, CONFIRM fallback and interruption cancellation. Timer/confirmation callbacks must not query an inactive XRFrame or treat a hand as a controller landmark. Fresh attempts clear old samples; missing/emulated connected-controller poses block measurement. Startup, rejected-fit, invalidation and session-end cases do not grant alignment from a previous session. These checks never establish real-world tracking or start a hardware immersive session. `CHECK_REAL_SCAN=1` additionally loads the shared original hallway3 PLY for a local desktop screenshot. Neither path establishes headset frame timing.

Keep the restored software-flow checks separate from supervised physical validation. Completing the countdown and fit does not establish surveyed controller offsets, floor accuracy, held-out alignment, reliable step-up/step-down or comfort during the visual hallway turn. Record all of those as NOT TESTED until observed on the actual route.

Controller-recognition regression coverage includes Oculus Touch profiles with optional joints, explicit hand-profile priority, unsupported skeletal inputs, missing grip/gamepad, mutable profiles, reconnects and stale disconnected selects. Classification must not override Three.js hiding an unavailable controller pose. On hardware, reload before Enter VR, hold and wake both controllers in headset view, check LEFT/RIGHT controller-connected instructions, then test trigger/countdown and hand takeover. Console lines distinguish controller plus joint data from hands-only input and include grip availability and joint count. Hardware recognition remains NOT TESTED until observed; hand tracking stays enabled and scan placement stays unchanged.

## Scan replacement checks: hallway3

All quality profiles and legacy scan/format bookmarks must select the original hallway3 PLY without compression; _1, _2 and _3 are zero-vertex placeholders. Desktop checks verify that the current manual profile is applied: the configured start maps to the XR origin, the scan retains its configured orientation, and the upright metric box follows its raw anchor. Tests must not force earlier proposed placement values or modify scanAsset.ts. Production defaults load the supplied raw A [2.99, 19.14, -1.41] and B [2.90, 18.16, -1.26] without auto-starting capture or granting acceptance. Explicitly unconfigured and partial/replacement fixtures still block capture. A real-asset desktop load checks parser/render integration only. Physical fit, held-out landmarks, floor, metric dimensions and box placement remain separate hardware checks.

## Manual box and rotation checks

The existing raw start panel must show the raw PLY point at world origin before and after a turn. Editing it must preserve yaw, lateral-offset preference, first-box pivot and camera, and retain its translation across later animation frames and repeated input/change events. Blank/partial input must not move the scan or be overwritten while typing. Block inspection during turns/loading/capture/live XR and restore the panel on the desktop after session end. Inspect `start-panel-rotated.png`; this is a manual coordinate-inspection control, with no object-placement feature or hardware acceptance.

Flipped-hallway offset checks cover the initial +10 cm production draft without changing the pre-turn scan; legacy pure-pivot checks explicitly choose zero. With a nonzero value, verify the scan receives the frozen original-hallway right vector times the offset and existing eased yaw fraction, while the first box, floor height and tracked camera stay fixed. The broom and second box follow current fitted hallway sections at their explicit stations. A revealed wall must retain its frozen world trajectory, width and orientation through later offset edits, with no further alignment queries; its next reveal fits again. Verify that the opening initially meets both current walls at its actual interval in the shared calibrated frame, then retains its captured near/far bounds, world corners and clipping uniforms through later offset edits. PC Apply, ±1 cm and Zero must recompute from the original baseline without accumulating; invalid values, active turns, narration or interrupted tracking must not move content. Explicit Reset restores the exact baseline while retaining only the draft amount. Inspect `rotation-offset.png` and the generated report. The source-only fits at the second-box station differ in width by about 2.4 cm and heading by about 1.4 degrees with roughly 4 cm residuals; these appearance estimates explain why a translation may only help locally and cannot determine a physical correction. Hardware wall alignment remains a separate measurement.

Wooden-box checks distinguish the invisible metric interaction volumes from the actual splat appearance. Verify that both hidden instances load before startup readiness and remain excluded from source landmark queries. Check source -Z upward, removal of the source's 19-degree heading, zero added lift at the standing floor base, exact hidden endpoints, eased ascent/descent, and cancellation on every disarm path. Show/Hide must reuse the same renderer resources. The first box's complete world pose stays fixed through the turn; the second box retains its prepared Z station in the shared calibrated hallway frame and physical wall side while refitting one whole footprint edge to the current selected wall plane. `CHECK_REAL_BOX=1` uses the shared supplied PLY in the desktop checks; inspect `wooden-box-upright.png`, `wooden-box-floor-in.png` and `wooden-box-floor-out.png` in the selected report folder. Synthetic fixture results verify integration; actual-Ply screenshots verify appearance only, with physical alignment and headset motion comfort still separate.

Disable **Gameplay after calibration** after the live fit for the manual-only checks below. Each fresh live calibration reenables the full game, so manual mode applies only to the current diagnostic run.

Verify independent signed point-to-plane distances at the first box's final mesh centre and floor pivot, including slightly nonparallel accepted wall fits; do not treat width/2 repeated twice as verification. A deliberate lateral edit must produce unequal measured distances, and Show box must restore the fitted bisector. The desktop pivot marker must match the first mesh centre in X/Z at floorY, including after calibration and through the turn. With the correction explicitly set to zero, a raw scan point initially under that pivot must remain at the same world point through0,30,90 and180 degrees. With a correction, that source point receives the intended translation while the physical pivot remains fixed. Report the fitted-wall residual separately from numerical centring equality; neither establishes surveyed physical perfection.

The current sequence uses Chrome **Show box** and **Rotate hallway 180°** buttons. Verify that no box appears before the first button, no elapsed timer or hand contact starts a turn, and repeated rotation cannot compound the final heading. Show box estimates two opposing local wall lines near raw screenshot station [2,21.1,-1.45], preserving its lengthwise position and existing local-floor Y=0; the box and yaw pivot share that floor centre. Test unequal point densities, floor/ceiling/outlier contamination, nonparallel/missing/weak walls, transforms and both XYZ/XYZW layouts. Unsupported fits must request explicit opposite-edge picks rather than fabricate a second wall. Report equal distances to fitted walls as an appearance estimate, not physical wall certification. Browser checks exercise actual buttons, static visibility, four-second180-degree yaw, fixed box/floor, STOP/reset and explicit fit/tracking guards. The optional original-PLY smoke also clicks Show box, records wall-fit evidence and captures the placed box over the real scan. Tracked camera/hand parents and the protected asset profile remain unchanged.

## Gameplay checks

Every successful live calibration must reenable gameplay and start Ambience 1 from zero, even after completion, interruption or disabling the option during the previous run. Verify welcome at +1 s, first box/step-on prompt at +8 s, Transition 1 at +20 s in autoplay and the visual turn 2 s later. Live entry waits for the fully raised box, five seconds since its prompt and actual scheduled/playing first-box speech; test already-present and late headsets. Verify second-box reveal five seconds after actual turn onset, turn commentary after completion, the sit instruction after the completed second-box rise, and classroom speech requested five seconds after actual wall appearance without cutting off earlier speech. Check exact deadlines, four-second rotation, fixed first box, wall-contact station and cue order. Both placements must succeed before revealing/narrating the first box; failure must stop/disarm with no dead visible box. A long desktop render frame must freeze visual progress without cancelling or advancing the soundtrack/story clock. Reset, STOP, new calibration, session/focus/tracking change or disabled gameplay still cancels pending actions/audio; native tracking/session recovery guards remain authoritative. Desktop preview grants no physical alignment. Inspect the scenario screenshot and generated report. See [gameplay flow](GAMEPLAY_FLOW.md).

Repeat calibration while waiting for the first box, after its reveal, during rotation, with the seat visible and after completion. Verify old audio, box effects, lighting, wall movement and floor opening cannot revive, then run the same welcome/box/turn/seat order from zero. Repeat with translated tracking yaw of 90 degrees, 180 degrees and -0.63 radians, checking the second box in hallway-route coordinates and its rendered XYZ/yaw in world coordinates. This synthetic lifecycle coverage does not grant headset or physical acceptance.

Audio regressions must retry a failed fetch or decode on a later play while retaining successful decoded buffers. After an operator gesture has enabled audio, suspend the context and verify playback can resume within its 500 ms bound; initial locked audio must still require a gesture. STOP/recalibration or a newer cue during a pending resume/download must prevent stale playback. Explicit mute remains set after recalibration and prevents sound. These checks cover scheduling and recovery, not audible output.

Audio scheduling and audible audition are separate checks. Verify the supplied WAV music/speech/effects decode locally, the selected transition excerpts last 9/6/7 s, and 1.2 s equal-power fades join the four ambiences without speech or effects ducking the bed. At least one ambience/transition must remain playing throughout every active unmuted phase, including wall waiting/moving/glitching, floor/cutout reveals, other effects and long rendering frames. Test native looping through render stalls and source endings, and require the incoming replacement to start successfully before fading out the outgoing bed; failed or delayed replacement must preserve the existing music. Recovery may not revive stale music after explicit Stop/reset/mute/dispose/calibration/tracking/session cancellation. Exploration footsteps/knocks stop at the first transition, and box effects follow actual successful reveals without stopping background music. Verify complete queued speech, recognizable supporting effects and intended Steam Link output separately on hardware. Retired generated narration must not be requested by gameplay; no API service/key check is needed.

After the five-second minimum, hold a delayed first-box speech source beyond its normal end and verify live headset entry waits for its actual scheduled/playing completion; pending/failed downloads, suspended audio and explicit mute must not hold the trigger. Cancel/recalibrate during pending fetch/decode/unlock and verify no old speech, music or effects revive. Native browser fixtures may mute output and therefore prove scheduling only.

## Installation extension: physical checks still pending

The second box has independent fixed dimensions 0.36 x 0.36 x 0.43 m; geometry-edge tests also verify the first box's default dimensions. Its approximate centre guide is raw [2.8,23.3,-1.45]. A dark transverse band near raw Y=22.99 supplies a draft floor-line guide; it remains an appearance estimate, with a desktop floor-plane picker for refinement. Preparation chooses the longitudinal station and physical wall side. Keep the box hidden throughout rotation, then refit and reveal it after the final phase. At initial preparation, completed turn, reveal and subsequent alignment edits, independently measure both endpoints of the entire selected footprint edge against the current actual wall plane, including accepted slightly nonparallel walls. The box's hallway-route Z station, dimensions and floor base must remain unchanged; its lateral position and tangent heading may change to maintain wall contact. Repeat under translated 90-degree, 180-degree and -0.63-radian calibration yaw; absolute XR world Z must not be used as its station. Unsupported refits must hide an already visible seat. Do not reproject its old raw guide through the rotated root. The first box/pivot and identity tracked rig must never move. Reset, new fit, session change, stop or tracking interruption must clear old placement and visibility. Browser checks cover actual reveal, floor-line selection, both rendered boxes and lifecycle cleanup. Private original-PLY evidence remains an appearance check, not physical chair alignment or surveyed-seam acceptance.

Use [INTERACTION_PLAN.md](INTERACTION_PLAN.md) and [RENDER_QUALITY.md](RENDER_QUALITY.md). Compare the fitted scan wall separation and centre with physical measurements; do not force the fit to the approximate2.10 m width. Check the supplied36 x36 cm,43 cm high real box, floor/base height and side clearance at the chosen station against independent landmarks before starting. Manual buttons and fitted distances do not certify registration.

On the active Steam Link route, check that the participant is supported at the fixed box before entering the trigger footprint or the operator clicking Rotate. The headset trigger tests the yaw-aligned XZ footprint from the box base upward, without an upper height limit; it does not prove foot placement or physical support. Hand tracking is not required. Supervise the four-second turn and stepping down. The rotated asymmetric hallway no longer implies wall alignment; do not resume wall touch until independent checks support the intended geometry. Test STOP mid-turn, reset while stationary, viewer/visibility loss and reference-space reset, and verify that manual recalibration is required afterward. Hardware acceptance remains NOT TESTED.

## Scripted wall approach checks

Verify `SitDownOnTheBox.wav` is requested once after the second box finishes its rise, including manual Show. The classroom recording must not play just because the box appears or its footprint arms the hidden wall. Keep watching/blocking it to prove no deadline starts. Successful unseen appearance starts exactly five seconds; request `GoBackToTheClassRoom.wav` once at that boundary, regardless of later gaze/motion pauses. Endpoint inspections remain silent. Stop/reset, wall cancellation and calibration/tracking/session recovery cancel pending deadlines. Verify complete sit/classroom WAV takes queue without altering the music. These silent scheduling/native-node checks do not establish audible headset playback.

Synthetic main.ts calibration checks rotate the tracking frame by 180 degrees, 90 degrees and -0.63 radians with a translated origin. Verify the same route from hallway Z=-8 to the captured first-box station, occupied-appearance blocking, physical-player pause, rendered-world diagnostics and floor Y=0. After Hide, click the actual wall button and compare its unseen reveal, restart station, width and gaze-controlled motion with Run/gameplay; Hide must not create an override. Honour deliberate XYZ edits through both paths. Compare actual broom/floor buttons with callable actions: broom base at hallway Z6, hole corners at the captured wall-relative prepared stations and clipping inverse in the shared frame. Temporarily hide the cutout for strict black-floor removal/restoration probes; separate rendered checks verify the downward hallway. Preview and mapped VR use the same second-box trigger, instant appearance and gaze phases. These adapters create no XR session; repeat approach-side, gaze, registration and placement checks after fresh real SteamVR calibration.

Verify no wall at calibration, first-box reveal, rotation or second-box appearance alone. Only a current valid headset above the fully raised second-box footprint arms it; test an already-present headset, late entry, an adjacent miss and incomplete rise. Arming latches while the player looks toward the hallway wall direction. Reveal instantly at hallway Z=-8 on the first valid look-away with a clear standing footprint; no side slide, renderer rebuild or post-turn timer may reveal it. Unknown gaze or occupied placement retains the hidden state. Manual Show/Run arm the same wait. Fit five supported sections to freeze one line from -8 to the first box's captured route station, approximately 2.5, at 1 m/s. Independently verify final normalized wall-distance equality, hard bounds, full-slab coverage and unchanged heading/width with no further section queries during movement or waits, including after later scan corrections. Include angled/tapered corridors, exact endpoint continuity and mutated fit data. The second box must not move or force arrival.

Exercise Show, Run, preview and mapped VR with the same gaze model: immediate unseen movement after reveal, no watched introductory distance, and a look-back allowance of exactly **0.7 s**, splitting a frame across its deadline. Looking away rearms movement without catching up. Check the 3D wall-centre cone at 45-degree entry/50-degree retention, including pitch and calibrated yaw/translation. XR must use current native position/forward from the same valid pose, with desktop camera fallback only outside XR. Unknown gaze blocks movement and cannot count as look-away. Invalid or paused frames above 0.5 s accrue neither movement nor endpoint gaze dwell and cannot grant fresh stop grace on reacquisition.

The player sweep uses the frozen full-thickness footprint and the next point on its fixed line. Hold at the 75 cm buffer, require another 15 cm to release and resume without catch-up; test a player on either side. Gaze permission never bypasses this guard and the wall never retreats. Test a genuine finite player segment through both faces: either direction, oblique placement, lateral/vertical misses, boundary jitter, wall motion without player motion, invalid/stale poses and large pose jumps. A real passage starts only the stationary 0.55 s wall glitch; it must not recapture or relocate the prepared hole. For the gaze alternative, require a **fresh 5 continuous seconds looking after actual final arrival**; prearrival watching cannot count. Reset that dwell on look-away or invalid/stalled gaze and test decimal steps at the exact deadline. The hole may already be open behind the still-opaque wall after its independent concealment gate. Keep both boxes/resources and the wall pose fixed during disappearance, and cancel on every recovery/manual override. Detached synthetic XR checks cover current native gaze/position and second-box triggering; body clearance, stereo, registration and comfort remain separate hardware checks.

For `/audio/SoundFX/RumblingSound02.wav`, verify preload/reuse, the 10.24 s looping source at 0.35 gain and a 0.2 s fade-in on actual translation. A look-back must start a 0.7 s fade-out immediately, matching the wall's remaining stopping time, without restarting that envelope every frame or adding a tail after movement ends. Looking away during that fade resumes smoothly. Proximity waits, a standing endpoint, unknown/stalled poses, hidden state and Stop must be silent; reset/recalibration/session/tracking recovery cancels pending decode/unlock and playback without revival. Instant appearance/disappearance alone does not play movement audio. Muted browser scheduling and fake WebAudio tests do not establish audible Steam Link routing or comfort; audition separately on hardware.

## Floor opening checks

Use **Open floor hole / Close floor hole** to inspect the wall-to-wall fitted opening at floor Y=0. Prepare its near edge **1 m beyond the captured final wall centre opposite approach**, extend **2.60 m**, and lock the fitted geometry before player passage; increase the offset only when needed to stay beyond the full slab plus 5 cm. The default endpoint 2.5 gives nominal Z[-1.1,1.5]. Different player positions, crossing directions and duplicate callbacks must leave those corners unchanged without new section queries. Hidden preparation must not cut floor pixels or reveal the connected hallway. Test complete concealment using all four fitted corners projected through the actual eye-facing wall face, including full normal thickness, horizontal width and vertical height with a small overlap. A wall beyond the hole, a viewer inside/behind its slab, lateral/high misses, invalid data or any uncovered corner must keep it hidden. As soon as concealment holds, run the **0.4 s floor/cutout glitch-in** while the wall remains opaque, including before arrival. Paired frozen framebuffer captures must show no outward change behind the opaque wall, then show the opening when the wall glitches away. Keep pure angled/calibrated frame, metric, unsupported-section, source-integrity and recovery guards. Floor-only probes may hide the cutout for strict original-floor removal/restoration; separate probes must retain it and verify the connected aperture.

The added hallway cutout must render downward through the opening, with source
floor toward the second box, ceiling opposite, and both side walls attached.
Check all four actual fitted corners, including a tapered opening and nonzero
calibration yaw/translation. Independent finite differences verify its taper
Jacobian used for Gaussian covariance. Actual shared-renderer probes compare
the visible cutout with the isolated black opening and require unchanged pixels
outside the rim. Both synthetic mapped VR adapters and the optional original
crop check must show it through that same aperture. Later root motion must not
move the frozen mouth; a new opening must derive a new join. Close, STOP/reset,
calibration and tracking recovery hide it with the hole, without rebuilding
geometry/material/textures/sorter or including its centres in calibration.
Inspect `hole-hallway-connected.png` and optional
`private-hole-hallway-connected.png`. The extra approximately 828k splats,
stereo rim appearance, depth sorting and headset frame delivery need a separate
SteamVR/Steam Link check; desktop frames do not establish those results.

For a bounded original-crop check with synthetic surroundings, set
`CHECK_HALLWAY_CUT_ONLY=1 CHECK_REAL_CUT=1 npm run check`; the generated report
names that limited coverage. `CHECK_REAL_SCAN=1` additionally loads the original
hallway. `CHECK_DESKTOP_GPU=1` requests D3D11 in the check-owned desktop browser
instead of SwiftShader; both paths retain the forced no-XR runtime and inert
XRSystem, and neither starts or validates a headset session. Use
`CHECK_REPORT_NAME` to keep separate runs' generated evidence.

**Check wall start / Check wall end** instantly render the exact frozen endpoints and hold without travel, gaze disappearance or a floor cue. The end must match the independent fitted midpoint at the captured first-box station. **Run wall sequence**, Show, preview and VR reuse this route while arming unseen instant reveal and hidden hole preparation. Verify the floor/cutout can glitch in over 0.4 s once the moving opaque wall fully conceals the prepared opening, before passage or five seconds of final gaze. Then test the separate wall-disappearance triggers: five fresh continuous endpoint-gaze seconds or genuine passage at any route position. Prearrival looking cannot shorten the dwell, and passage never moves the hole. Keep the actual wall matrix stationary through its 0.55 s sliced glitch and retain the same opening afterward. Stop during either effect/dwell cancels and closes the hole; global recovery cancels everything without revival. Failed floor fitting retains the opaque wall. Inspect endpoint, concealed reveal and arrival before/during/after captures plus calibrated results. Desktop evidence does not establish stereo, physical floor registration or comfort.

The third music trigger must use the open hole's captured trapezoid in its calibrated route frame. Test nonzero yaw/translation, interpolated side edges, all longitudinal/lateral boundaries, below-floor and invalid/missing headset poses, closed/hidden floor, once-only initial music cue, the 2 s anticipation deadline, reset/recalibration and interruption cancellation. After 2 s anticipation it starts a four-second eased 90-degree visual world turn and the Ambience 4 progression; the tracked viewpoint is unchanged. Subsequent cycles reuse the same anticipation without replaying Transition 3 or story cues. A desktop trigger test is not physical floor alignment or headset acceptance.

Check the two-second entry anticipation and four-second eased 90-degree turn,
with a fixed source-floor edge, level final floor, ceiling above it and unit
horizontal depth. Exercise either box/floor side and translated/yawed
calibration frames. The tracked camera/controllers, physical boundary display
and canonical source/box coordinates must stay fixed; all authored content and
floor/cutout/box clipping planes share the visual turn.

Verify `RoomTilting.wav` against actual angular changes through both four-second
rotation directions and repeated cycles, including manual open-hole mode.
Do not start or sustain its loop during the two-second anticipation, the
deferred first animation frame, held 90-degree/original poses or stationary
frames. Include the last angular movement frame before the endpoint, then
apply only the bounded 0.08 s stop release. Test close,
mute, STOP, reset, stalled/invalid poses and calibration/tracking/session
recovery while a load/resume is pending and during playback; stopped motion
must not receive stale audio later. The current background bed must remain
independent of the effect. These checks cover scheduling and cancellation;
audible balance and actual Steam Link output remain hardware checks.

At the completed pose, test swept head-segment crossings against the rendered
vertical trapezoid, including tapered edges and 8 cm side hysteresis. A valid
interior-to-original-side crossing starts the four-second eased return; starting
outside must enter the interior before an outward crossing can qualify. Reject
sideways crossings outside the opening, proximity alone, boundary jitter and
presentation-induced crossings. Require exact identity presentation after
return, preserving the earlier 180-degree authored scan state and clipping
uniforms, with no angle accumulation across repeated outward/return cycles.
Before each new forward cycle, require exit from the horizontal footprint
expanded by 10 cm and fresh reentry. Ambience 4 must continue without story or
Transition 3 replay; source/prop edits remain locked until Reset.

Verify cancellation during anticipation, outward turn, held 90-degree pose,
return and restored pose. Invalid/stalled frames, close, STOP, reset,
recalibration and tracking/session recovery must restore the presentation
baseline and clear all crossing/reentry history without later revival. Clearing
pose history at animation endpoints must prevent a stationary head from
immediately reversing or repeating the turn. Actual framebuffer checks must see
the passage after the turn, through a simulated physical-camera step, during
return and after exact restoration. Inspect `hole-turn-entry.png`,
`hole-turn-easing.png`, `hole-turn-horizontal.png`, the return/cycle captures
listed in the generated report and optional `private-` original-scan versions.
Manual open-hole, complete gameplay, desktop and mapped synthetic VR must use
the same geometry and motion. These desktop checks do not establish headset
stereo, physical registration, repeated-passage comfort or frame delivery.

## Extracted wall checks

The wall loads hidden with the hallway in one startup build. Hold its download while the hallway response finishes: controls stay disabled and no hallway-only build occurs. Reset during startup leaves the eventual wall hidden. After shader warmup, show/hide must not fetch or replace geometry/material/texture/sorter resources. Verify hidden arming while watched, instant full standing appearance on look-away, immediate Hide and no residual side-entry/exit transition. Measure full wall-to-wall width, X scale=renderedWidth/2.10 and unchanged height/depth scale 1. Prepare calibration while armed or moving and verify immediate cancellation without later revival. Source scan centres alone remain available to landmark/placement queries. Inspect endpoint/standing captures and the generated report.

`CHECK_REAL_SCAN=1 npm run check` additionally loads the original scan/cropped wall in the startup batch, compares source counts/dimensions/no-compression metadata/SHA256 and captures the actual standing wall. Inspect the private wall image and crop elevation for doors, cut edges, upper/floor extent and hallway coverage. The 2.60 m source appearance estimate is not a physical measurement. On Steam Link, separately verify stereo, full-height registration, instant first appearance without a startup hitch, gaze stop/fade feel, passage/glitch and interruption cancellation. No desktop result certifies physical clearance or headset comfort.

Wall position/motion checks use the actual XYZ fields, Set wall position, Forward, Back, Back & forth and Stop motion buttons. Verify exact world placement, metre/second travel, both loop extrema, no jump on Stop or mode changes, retained hide/show position, rejection of invalid commands without moving the wall, anchor reprojection after nonzero yaw/translation, and motion cancellation on calibration recovery. The renderer must keep its original resources and source-only landmark data. Inspect `wall-position-motion.png` for readable coordinates, units and button labels. Pure travel tests cover exact endpoints, smooth bounded loop speed, reset and invalid frames/inputs. Hardware movement/comfort and physical registration remain unverified by these desktop cases.

For a separate wall-only run, set `CHECK_WALL_ONLY=1` and `CHECK_REAL_SCAN=1`; the report explicitly identifies its focused coverage. `CHECK_REPORT_NAME=wall` places its generated report and screenshots in `.check/wall/` so concurrent checks do not overwrite them. This focused result does not replace the default full regression suite. The private wall capture must update camera/world matrices and await a completed depth sort after the new wall pose; a visibility flag or fixed delay alone is insufficient evidence that it rendered.

The wall now contains two opposing copies of the same good face, in one scene. Extraction checks verify unchanged colours/opacity/scales, proper anisotropic covariance and normal rotation on both sides, original 24 cm depth per slab and a 2 cm gap (50 cm total authored thickness). Source data must remain unchanged. Desktop checks isolate the panel and compare corresponding front/rear rendered pixels with asymmetric colour/lettering; changing the view must leave its transform and scale unchanged. Inspect `wall-front.png`/`wall-back.png`; the original-scan option additionally produces `private-wall-front.png`/`private-wall-back.png` and verifies doubled counts/metadata. Per-eye culling and separate face clipping must preserve the good appearance without the inward side bleeding through. Hardware stereo, edge appearance and movement still require an independent headset check.

## Scanned broom checks

The automatic cutout encounter must arm only on the first completed 90-degree
hole turn, then wait two seconds before a 0.55-second glitch in. Verify its
base is centred two metric metres inside the captured entrance, with the
original source bristles on the level floor and unchanged scale. Cover either
floor edge, taper and translated/yawed calibration. A current finite headset
above the invisible 36 x 36 cm footprint may trigger only in the stable upright
hallway; lateral/below-floor misses and mid-turn poses cannot qualify. Entry
latches a full two-second delay before the 0.55-second glitch out, even after
leaving. Return/re-entry must preserve the pending/present/finished encounter
without another reveal. Close/Hide, STOP, reset, calibration, pose loss and
invalid/stalled frames cancel without late revival; a fresh game rearms.
Verify the actual successful first glitch-in frame requests one complete
`CLEANTHEROOM.wav`, and manual hidden-to-visible Show requests the same speech.
Already visible presentations, failed placement, Hide and later automatic
visits must not request it. Hold a preceding speech source open to verify FIFO
ordering and full natural-rate playback with the music level unchanged.
Check mute and pending-load/recovery cancellation without late speech revival;
the original WAV stays unchanged. Browser scheduling does not establish
audible speech delivery on the headset.
Check actual broom framebuffer changes during both glitches, exact source-base
placement, stable shared resources and no rendered trigger geometry. Inspect
`broom-cutout-glitch-in.png`, `broom-cutout-visible.png`,
`broom-cutout-glitch-out.png` and `broom-cutout-gone.png` in the report folder.
The optional real-broom/real-cutout run remains a desktop appearance check;
headset stereo, physical clearance/registration and comfort need hardware.

The default desktop check uses a public synthetic broom fixture; `CHECK_REAL_BROOM=1` renders the shared supplied broom instead, with its source hash recorded in the generated report. Both use the actual Show/Hide control and scene2 in the shared renderer. Verify hidden startup and loading gates, base at the current fitted section's centre/floor Y/world Z6, upright bristles-down orientation, original scale, one asset request, unchanged shared resources and hallway-only calibration centres. Nonzero yaw/translation, the 180-degree turn and alignment-offset edits must keep its longitudinal station while updating its lateral position to the current hallway centre. Unsupported sections must fail hidden. Reset and calibration recovery hide it; the shared interruption path covers STOP and tracking/session invalidation. Inspect `broom.png`; neither a synthetic fixture nor the private-asset desktop render establishes real headset alignment.

## Distant added-hallway collapse checks

Require the actual automatic broom `glitchingOut` to `complete` edge before
arming collapse. Manual Hide, cancellation, a repeated visit or an already
completed snapshot must not replay it. Verify ten semi-random side-wall spots,
exactly five per side, progressing strictly from far to near with varied
0.6–1.1 s gaps and overlapping 1.8 s supplied animations. Capture the game seed:
repeating it must reproduce positions, timings and damage shapes, while a new
game seed varies them. Each burst starts its own zero-strength damage patch
at onset, growing over roughly three seconds; no global delayed wipe or
cross-section clipping plane may replace those local fields. These are
tunable first-trial values, not accepted headset timings.

Independently verify that opening-space depth, source width, side positions
and Gaussian protection work with taper, either floor edge and translated/yawed
calibration. Test both the short synthetic crop and the original crop length.
Each patch's growth/fade progress must be monotonic, and protection overrides
it: preserve all depth from the entrance through at least 6 m and permanently
expand that prefix to the greatest user depth plus 2 m. Optional current live
or explicitly supplied manual bounds may enlarge it to their farthest depth
plus 1 m; absent/invalid bounds must not block the effect or reinstate a fog
dependency. Move the current pose toward an already damaged region and verify
its enlarged surroundings and complete route back are restored and stay
visible after retreat. Suppress bursts/removal when no distant space remains.

Use actual framebuffer comparisons for unchanged original scene0 and near
crop/return aperture, visible overlapping fracture actors and progressive local
Gaussian/fog loss. At the same depths, require both missing and surviving
actual pixels, asymmetric floor/ceiling fingers and ragged cavity edges rather
than a uniform black end plane. Before a blast fires its site must not receive
that patch's damage; unrelated sites outside the local field must stay intact.
The original and near-area comparisons remain exact controls. Inspect several
seeded stages and the final organic distribution instead of requiring the
entire far cross-section to become black.
Verify that the supplied fracture source is converted locally and its recorded
animation frames drive the actors; a placeholder explosion is insufficient.
Compare `fracture_nowall.abc` and converted-GLB hashes with
[fracture.meta.json](../public/effects/fracture/fracture.meta.json). Verify all
42 fragment meshes, the 300 samples at 30 fps, the selected active window and
successful loading through the pinned Three.js loader. The offline converter
must retain source mesh normals/UV seams and remove only camera/light/static
wall objects; source Alembic and scan hashes remain unchanged.
Preload/reuse the source assets and fixed geometry/material/texture/animation
buffers and shared splat sorter. Playback changes state/data in those buffers;
it must not reload assets, replace render resources or alter source scans.

Each actual blast ID starts one supporting `RumblingSound01.wav` excerpt from
0.75 s for 1.8 s, using the existing shared gameplay audio context/cache/master.
Check the 30 ms attack, 250 ms release, source-peak normalization and bounded
overlap without music ducking. Muted, paused, late-unloaded or cancelled starts
must not play later, and a repeated visible frame/return cannot replay an ID.
Reset/new game clears cue IDs while retaining the decoded cache. Native silent
audio tests verify scheduling and envelopes, not audible headset balance.

Pause the clock while returning, original or turning inward; retain the
existing local patches, resume their same progress and keep Ambience 4 without another
broom/story cue. Perform the actual bounded-aperture crossing and smooth return
while distant removal is active, then repeat entry. Cancel during a burst,
mid-removal and completed removal using Close, STOP, reset, calibration and
tracking/session interruption; invalid/nonfinite or >0.5 s frames must also
cancel. Require cleared FX/mask, restored crop and no delayed revival, with
Reset or a fresh game rearming the cue. Inspect `hallway-collapse-before.png`,
`hallway-collapse-blasts.png`, `hallway-collapse-mid.png`,
`hallway-collapse-black.png`, `hallway-collapse-return.png` and optional
`private-` original-crop variants in the generated report. These checks do not
certify physical clearance, headset stereo, streamed frame time or comfort.

## Lights-out checks

Verify the PC button and callable system API fade RGB to the selected brightness over0.65 seconds (fresh default30%) and restore the exact original image, with unchanged rendered alpha, calibration opacity, source data, scan pose and material/geometry/texture/sorter objects. Check the PC slider's0%/100% endpoints, live60% preview, visible percentage, keyboard adjustment and unchanged normal image when editing the next target with lights on. A new page must restore only the manually chosen brightness, with lights still on; reset and all interruptions retain the current preference while restoring normal brightness. Freeze desktop camera damping and settle sorting before comparing pixels. Check loading/stopped/live-calibration guards, repeated commands, fade reversal, invalid brightness/frame values and immediate recovery without revival. Controller selects/squeezes must not activate lighting. Detached synthetic cases cover hidden/blurred views, missing/emulated viewer poses, paused frames, reference resets, session start/end and disposal. Inspect `lights-on.png`, `lights-out.png`, `lights-slider.png` and the generated report from `npm run check`; Node checks cover shader compatibility and bounded fade behavior.

The automatic cue must wait for the second box's completed 1.5-second rise, then a full 6.5 s before the 1 s flicker and local `public/audio/light_flicker.mp3`, settling at exactly 30%. Transition 2 must begin 2 s before flicker; default autoplay is about +33 s music and +35 s flicker. Check RGB dip/relight/final ratio with unchanged alpha/resources/scan, once-only effect start, 1 s source duration, 16% gain cap, 80 ms attack and 200 ms release. The source file stays unchanged. Test hide/cancel/paused deadlines, manual override and no late playback after decode/disposal or interruption. Inspect the generated lighting screenshots/report. Native browser checks may decode the real MP3 with output muted; this does not establish audible level/routing or headset comfort.

## Initial physical feasibility targets

Desktop boundary diagnostics need a separate runtime check: compare the cyan reported polygon and live head marker against the actual configured SteamVR play area; confirm unsupported/empty bounds are labelled honestly, reference-space resets clear old data, and ended sessions show only a labelled snapshot. Compare an operator-measured amber rectangle independently. Neither outline changes runtime boundaries or grants hallway alignment. Synthetic geometry/browser tests do not establish that Steam Link exposes its boundary on this hardware.

Use these gates for the first 3–5 m segment. If a target is missed, log the failure and revise the asset/procedure or scope; do not silently relax the threshold.

| Measure | Proposed pass criterion |
| --- | --- |
| Fixed-fixture capture | Within each stationary window: 95th-percentile distance from its sample mean ≤10 mm |
| Probe offset repeatability | Same fixed contact, ≥3 different orientations across multiple axes: maximum deviation of the window means from their shared centre ≤10 mm; use independent orientations if pivot calibration estimated the offset |
| Independent spatial checks | At least 3 held-out landmarks covering both sides and start/far end; RMS ≤30 mm and maximum ≤50 mm |
| Repeatability | Three fresh calibrations satisfy those held-out criteria |
| Stability | Same independent criteria pass after a five-minute trial and at start/end of route |
| Recovery | All observable invalidation scenarios remove verified status; operator stop covers documented gaps |
| Frame delivery | Start with a 72 Hz target if supported; application frame-work p95 <13.9 ms, runtime dropped frames <1% over five minutes, no sustained half-rate reprojection or visible stalls |

Frame-work time is not end-to-end latency. Separately record XR callback intervals and available GPU/compositor, encode/network/decode timing, bitrate, and reprojection diagnostics. Mark unavailable measurements as unavailable, not zero or passed. If the runtime uses another refresh rate, compute `1000 / Hz` and document the target before testing. Frame targets need headroom and an actual runtime report; browser FPS alone is not proof.

These spatial targets establish early feasibility only. The longer-term experience target is held-out RMS ≤20 mm and maximum ≤30 mm over the agreed area, with tighter tolerances considered if contact interactions are later requested. Passing the early gate does not demonstrate precise touch alignment.

## Hallway trial sequence

1. Measure and mark the trial extent; inspect fixed landmarks, lighting, current door states, and the clear walking route. Keep system boundaries enabled.
2. Validate the probe, capture fit points, and solve while the wearer is stationary or physically guided between stations.
3. Independently check both walls, height/floor references, and the far end. Reject mismatches before showing the view as verified.
4. First evaluate stationary head turns and small translations. Then walk the clear route with an assistant; no deliberate collision or blind wall-touch test.
5. At five minutes, capture fresh held-out checks. Repeat after a controlled reset/reconnect to prove the recovery workflow.
6. Save the report and record observed artifacts: double edges, floating/smeared walls, scale mismatch, interruptions, and discomfort. Stop on uncertainty.

## Report template

```text
Date / operator / build commit:
Asset hash / normalization / probe profile:
PC / browser / headset / runtime / network:
Reference space / refresh rate / render quality:
Tested segment and landmark layout:
Fit errors (RMS / max):
Held-out errors before and after (RMS / max / each point):
Frame-work p95 / dropped frames / reprojection:
Available streaming timing / unavailable measurements:
Interruption tests and recovery results:
Result: PASS | FAIL | NOT TESTED
Limitations and next action:
```

Private raw measurements stay in ignored local storage. Publish only deliberately reviewed, non-sensitive summaries or synthetic examples.
