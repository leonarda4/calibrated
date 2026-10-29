# Validation protocol

All gates are **pending**. Thresholds below are proposed engineering targets, not measured performance or a guarantee of wall-contact accuracy.

## M0: prove the actual wireless runtime

Record date, Windows version, GPU/driver/RAM, Chrome version, Quest firmware, Link version, active OpenXR runtime, streaming client, refresh rate/resolution, router/access point, wireless band, PC network connection, and test location.

1. Check the GPU against [Meta's current Link requirements](https://www.meta.com/help/quest/articles/headsets-and-accessories/oculus-link/requirements-quest-link/). Pair the wireless headset and PC; select Meta as the active OpenXR runtime for the proposed Air Link path. Avoid mixing runtimes during the baseline test.
2. From **Chrome on the PC**, run the official [immersive VR sample](https://immersive-web.github.io/webxr-samples/immersive-vr-session.html). Confirm stereo and positional head tracking in Quest 3. Repeat enter/exit three times.
3. Build a minimal local probe with required `local-floor`, a metre reference, both controller grips, and capture controls. Verify measured controller displacement and button behavior. Log available features and unsupported capabilities.
4. Demonstrate assistant-operated landmark acquisition without relying on passthrough. Verify stable controller tracking at the intended contact points.
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
- Desktop loading/error UI, replacing and disposing an asset, operator capture flow with synthetic poses, and explicit unsupported-XR messaging.

Desktop tests use synthetic public data. No automated screenshot or emulated session is accepted as evidence of real spatial registration, stereo comfort, or wireless latency.

## Initial physical feasibility targets

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
