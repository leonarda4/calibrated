# Validation protocol

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

During implementation, provide `npm test`, `npm run check`, and `npm run build`. The bounded browser check should produce `.check/report.json` and `.check/screenshot.png`, following the reference kit. Inspect both; a nonblank canvas alone is insufficient.

Test the consequential behavior:

- Transform recovery from known synthetic points; nonzero yaw/translation, metres versus raw units, matrix order, and probe offsets at multiple orientations.
- Rejection of wrong/missing correspondences, non-finite data, weak point geometry, excessive capture noise, invalid scale/reflections, and mismatched asset/probe versions.
- Independent validation fails a deliberately incorrect alignment even if fit residual is small.
- Verified-state invalidation and recovery under session/reset/viewer-tracking/profile changes; stale profile imports never restore verification automatically. Invalid controller poses block capture, while loss of an unused controller alone does not force recalibration.
- Desktop loading/error UI, replacing and disposing an asset, restored countdown/buffer/CONFIRM capture with synthetic poses, and explicit unsupported-XR messaging.

Desktop tests use synthetic public data. No automated screenshot or emulated session is accepted as evidence of real spatial registration, stereo comfort, or wireless latency.

CONFIRM recovery regression coverage includes the 3 -> 2 -> 1 -> READY failure budget, the exact 30-second deadline, a return after no frames, late hand/controller confirmation with otherwise valid buffers, persistent wake guidance, transient loading/focus priority, fresh attempts, reference resets and session-end cancellation. `.check/confirm-recovery.png` contains copies of the actual instruction textures for visual inspection. Physical verification remains pending: deliberately enter CONFIRM with sleeping controllers, exercise both bounded exits, wake them and complete a new attempt. Desktop screenshots do not establish that the controllers reconnect on Steam Link hardware.

The desktop check launches its own Chrome with `--force-webxr-runtime=no-xr-runtime` and installs an inert XRSystem before application scripts on every page. Chromium's no-runtime selector prevents physical provider creation, including XR-compatible WebGL requests; detached regression factories explicitly supply fake XR objects. The runner verifies the launch flag. Never run the desktop check against the wearer's live OpenXR runtime: Chrome processes can share SteamVR's generated application key, and a test process exiting can clear the live browser's registration. The test flag affects only the check-owned browser. [Chromium runtime selection](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/xr/service/xr_runtime_manager_impl.cc)

The implemented bounded check uses installed Chrome and its own temporary Vite server, and closes both in `finally`. `npm run check` produces `.check/report.json`, `screenshot.png` (badge), `reversed.png` and loading/failure evidence. Calibration regressions use detached synthetic poses to check current XRFrame reads, physical-controller/hand separation, seven-second simultaneous placement, the per-attempt buffer through hand takeover, CONFIRM fallback and interruption cancellation. Timer/confirmation callbacks must not query an inactive XRFrame or treat a hand as a controller landmark. Fresh attempts clear old samples; missing/emulated connected-controller poses block measurement. Startup, rejected-fit, invalidation and session-end cases do not grant alignment from a previous session. These checks never establish real-world tracking or start a hardware immersive session. `CHECK_REAL_SCAN=1` additionally loads the ignored original hallway3 PLY for a local desktop screenshot. Neither path establishes headset frame timing.

Keep the restored software-flow checks separate from supervised physical validation. Completing the countdown and fit does not establish surveyed controller offsets, floor accuracy, held-out alignment, reliable step-up/step-down or comfort during the visual hallway turn. Record all of those as NOT TESTED until observed on the actual route.

Controller-recognition regression coverage includes Oculus Touch profiles with optional joints, explicit hand-profile priority, unsupported skeletal inputs, missing grip/gamepad, mutable profiles, reconnects and stale disconnected selects. Classification must not override Three.js hiding an unavailable controller pose. On hardware, reload before Enter VR, hold and wake both controllers in headset view, check LEFT/RIGHT controller-connected instructions, then test trigger/countdown and hand takeover. Console lines distinguish controller plus joint data from hands-only input and include grip availability and joint count. Hardware recognition remains NOT TESTED until observed; hand tracking stays enabled and scan placement stays unchanged.

## Scan replacement checks: hallway3

All quality profiles and legacy scan/format bookmarks must select the original hallway3 PLY without compression; _1, _2 and _3 are zero-vertex placeholders. Desktop checks verify that the current manual profile is applied: the configured start maps to the XR origin, the scan retains its configured orientation, and the upright metric box follows its raw anchor. Tests must not force earlier proposed placement values or modify scanAsset.ts. Production defaults load the supplied raw A [2.99, 19.14, -1.41] and B [2.90, 18.16, -1.26] without auto-starting capture or granting acceptance. Explicitly unconfigured and partial/replacement fixtures still block capture. A real-asset desktop load checks parser/render integration only. Physical fit, held-out landmarks, floor, metric dimensions and box placement remain separate hardware checks.

## Manual box and rotation checks

Disable **Narrated test after calibration** for the manual-only checks below.

Verify independent signed point-to-plane distances at the final mesh centre and floor pivot, including slightly nonparallel accepted wall fits; do not treat width/2 repeated twice as verification. A deliberate lateral edit must produce unequal measured distances, and Show box must restore the fitted bisector. The desktop pivot marker must match the mesh centre in X/Z at floorY, including after calibration and through the turn. A raw scan point initially under that pivot must remain at the same world point through0,30,90 and180 degrees. Report the fitted-wall residual separately from numerical centring equality; neither establishes surveyed physical perfection.

The current sequence uses Chrome **Show box** and **Rotate hallway 180°** buttons. Verify that no box appears before the first button, no elapsed timer or hand contact starts a turn, and repeated rotation cannot compound the final heading. Show box estimates two opposing local wall lines near raw screenshot station [2,21.1,-1.45], preserving its lengthwise position and existing local-floor Y=0; the box and yaw pivot share that floor centre. Test unequal point densities, floor/ceiling/outlier contamination, nonparallel/missing/weak walls, transforms and both XYZ/XYZW layouts. Unsupported fits must request explicit opposite-edge picks rather than fabricate a second wall. Report equal distances to fitted walls as an appearance estimate, not physical wall certification. Browser checks exercise actual buttons, static visibility, four-second180-degree yaw, fixed box/floor, STOP/reset and explicit fit/tracking guards. The optional original-PLY smoke also clicks Show box, records wall-fit evidence and captures the placed box over the real scan. Tracked camera/hand parents and the protected asset profile remain unchanged.

## Narrated test checks

The default enabled test starts on a successful live calibration fit. Verify welcome at +0 seconds, first box at +10 seconds, rotation and Whoosh at +15 seconds, and the original-world second-box reveal and seat line at +20 seconds. Check exact deadline boundaries, four-second rotation, fixed boxes, and cue order using fabricated scan centres and synthetic tracked poses. A failed placement, >0.5-second frame pause, reset, STOP, new calibration, session/focus/tracking change or disabled test must cancel pending actions and audio; a fresh calibration starts one new welcome. The desktop preview grants no physical alignment and manual mode stays available. The isolated scenario generates `.check/test-scenario.png`; inspect it and `.check/report.json`.

Speech generation and audition are separate checks: working ElevenLabs key permissions, four generated MP3s, audible complete lines and intended Steam Link output must be verified. On 2026-11-03 the service rejected local generation with HTTP 401; no new speech assets were created. Fixed timing tests and mocked audio do not prove actual spoken delivery. Supervised headset testing must confirm timing, audio, physical placement and comfort independently.

## Installation extension: physical checks still pending

The second box has independent fixed dimensions 0.36 x 0.36 x 0.43 m; geometry-edge tests also verify the first box's default dimensions. Its approximate centre guide is raw [2.8,23.3,-1.45]. A dark transverse band near raw Y=22.99 supplies a draft floor-line guide; it remains an appearance estimate, with a desktop floor-plane picker for refinement. Placement tests require one footprint edge on the selected fitted wall, another on the supplied line and the base at local-floor Y=0. Capture the world placement before the turn, keep it hidden throughout rotation, then reveal it only with Show second box after the final phase. Compare the complete secondary world pose before/after the scan turn and verify no scan query or primary/pivot change occurs on reveal. Reset, new fit, session change, stop or tracking interruption must clear old placement and visibility. Browser checks cover the actual reveal button, floor-line pick, both rendered meshes and lifecycle cleanup. The optional original-PLY smoke additionally records default hidden preparation and the same world pose after a synthetic desktop turn/reveal; it does not establish hardware alignment or that the visible seam is surveyed accurately.

Use [INTERACTION_PLAN.md](INTERACTION_PLAN.md) and [RENDER_QUALITY.md](RENDER_QUALITY.md). Compare the fitted scan wall separation and centre with physical measurements; do not force the fit to the approximate2.10 m width. Check the supplied36 x36 cm,43 cm high real box, floor/base height and side clearance at the chosen station against independent landmarks before starting. Manual buttons and fitted distances do not certify registration.

On the active Steam Link route, check that the participant is supported at the fixed box before the operator clicks Rotate. The manual route does not detect stepping or require hand tracking. Supervise the four-second turn and stepping down. The rotated asymmetric hallway no longer implies wall alignment; do not resume wall touch until independent checks support the intended geometry. Test STOP mid-turn, reset while stationary, viewer/visibility loss and reference-space reset, and verify that manual recalibration is required afterward. Hardware acceptance remains NOT TESTED.

## Extracted wall checks

The wall starts hidden and its crop is not requested until **Show wall**. The desktop regression uses a fabricated wall PLY, verifies cancellation by Reset while loading, checks its 2.10 m width and configured scan-derived height in world space, upright/transverse placement, unit scale, a single shared sorted scene, cached show/hide and unchanged scan/camera pose. Preparing calibration hides it; it cannot revive on load completion. `.check/wall-blocker.png` captures the public fixture. Original scan centres alone must remain available to subsequent calibration and placement queries.

`CHECK_REAL_SCAN=1 npm run check` additionally loads the original scan and cropped wall, compares counts, dimensions, no-compression metadata and the source SHA256, and captures `.check/private-wall-blocker.png`. Inspect that image and the private crop elevation for doors, cut edges, floor/top extent, coverage and hallway placement. Source appearance supports the 2.60 m wall height above the existing raw floor; it is not a physical measurement. On Steam Link hardware, verify stereo, full floor-to-wall-top extent, width/registration against the real hallway, show/hide, interruption cancellation and frame timing separately. No desktop result certifies a physical obstacle or collision protection.

For a separate wall-only run, set `CHECK_WALL_ONLY=1` and `CHECK_REAL_SCAN=1`; the report explicitly identifies its focused coverage. `CHECK_REPORT_NAME=wall` places its generated report and screenshots in `.check/wall/` so concurrent checks do not overwrite them. This focused result does not replace the default full regression suite. The private wall capture must update camera/world matrices and await a completed depth sort after the new wall pose; a visibility flag or fixed delay alone is insufficient evidence that it rendered.

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
