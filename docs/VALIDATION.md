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

The desktop check launches its own Chrome with `--force-webxr-runtime=no-xr-runtime` and installs an inert XRSystem before application scripts on every page. Chromium's no-runtime selector prevents physical provider creation, including XR-compatible WebGL requests; detached regression factories explicitly supply fake XR objects. The runner verifies the launch flag. Never run the desktop check against the wearer's live OpenXR runtime: Chrome processes can share SteamVR's generated application key, and a test process exiting can clear the live browser's registration. The test flag affects only the check-owned browser. [Chromium runtime selection](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/xr/service/xr_runtime_manager_impl.cc)

The implemented bounded check uses installed Chrome and its own temporary Vite server, and closes both in `finally`. `npm run check` produces `.check/report.json`, `screenshot.png` (badge), `reversed.png` and loading/failure evidence. Calibration regressions use detached synthetic poses to check current XRFrame reads, physical-controller/hand separation, seven-second simultaneous placement, the per-attempt buffer through hand takeover, CONFIRM fallback and interruption cancellation. Timer/confirmation callbacks must not query an inactive XRFrame or treat a hand as a controller landmark. Fresh attempts clear old samples; missing/emulated connected-controller poses block measurement. Startup, rejected-fit, invalidation and session-end cases do not grant alignment from a previous session. These checks never establish real-world tracking or start a hardware immersive session. `CHECK_REAL_SCAN=1` additionally loads the ignored compressed ultra scan for a local desktop screenshot. Neither path establishes headset frame timing.

Keep the restored software-flow checks separate from supervised physical validation. Completing the countdown and fit does not establish surveyed controller offsets, floor accuracy, held-out alignment, reliable step-up/step-down or comfort during the visual hallway turn. Record all of those as NOT TESTED until observed on the actual route.

## Installation extension: physical checks still pending

Use [INTERACTION_PLAN.md](INTERACTION_PLAN.md), [VOICE_SETUP.md](VOICE_SETUP.md) and [RENDER_QUALITY.md](RENDER_QUALITY.md). Verify the approximately 2.10 m hallway width and chosen centreline against the actual scan and physical floor. Check placement of the supplied 36 x 36 cm, 43 cm high box, its surveyed centre and reachable orb height; check side clearance and independent landmarks before starting. A checked box placement is an operator attestation, not an automated validation score.

On the active Steam Link route, record whether actual WebXR joints are exposed. Verify both visible hands, fingertip contact and immediate contact loss when tracking disappears; controller rays/pinch-only sources must not collect the orb. Audition generated voices in the actual headset output route. Remain supported/stationary during the four-second turn and supervise stepping down. The rotated asymmetric hallway no longer implies wall alignment; do not resume wall touch until new independent checks support the intended geometry. Test STOP mid-turn, reset while stationary, viewer/visibility loss and reference-space reset, and verify that manual recalibration is required afterward. Hardware acceptance remains NOT TESTED.

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
