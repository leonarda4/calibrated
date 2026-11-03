# Interaction plan

Implementation baseline: 2026-11-03. Delivery: Windows Chrome -> SteamVR/OpenXR -> Steam Link -> Quest 3. This extends the existing viewer; it does not replace the working PCVR layer workaround or calibration.

Measured input update: the user reports approximately **2.10 m hallway width**, in the same physical space as the scan, and a real box **36 x 36 cm, 43 cm high**. The virtual box defaults to **0.36 x 0.36 x 0.43 metres**, with its bottom on the configured floor. Use the provisional hallway width to check a selected scan cross-section. The whole scan's bounding box includes other geometry and cannot establish the intended corridor's centreline. The desktop **Pick two floor edges** action finds the midpoint of two explicitly selected opposite edges; choose that cross-section at the intended longitudinal midpoint. Store picks in scan coordinates and reproject after calibration so the installation follows the physical hallway. Placement and ceiling/reach height remain draft inputs.

## Intended sequence

Scan replacement update (2026-11-03): hallway3 uses the manually adjusted, protected scanAsset.ts profile. No agent may change it without explicit user permission. Calibration defaults A [2.99, 19.14, -1.41] and B [2.90, 18.16, -1.26] are stored separately in calibration/landmarks.ts. The metric 0.36 x 0.36 x 0.43 m box follows its current raw anchor and the fit; its physical location and floor still require checking. Floor-edge picks or applied XR placement can override the preview without granting acceptance. See [new scan setup](CALIBRATION.md).

1. **Prepare and calibrate.** Load the scan, place the remotes at A/B, run the existing fit, and let the hallway fade in. The operator checks the floor, physical box, reach target, and independent landmarks. Fit success alone does not certify touch alignment. Show tracked hands when the active runtime exposes WebXR hand joints; show an honest capability message otherwise.
2. **Purpose / exploration.** The operator starts the experience after checking placement. A clear lead voice says "Find your purpose and bring it back here." Allow approximately 20 seconds of quiet exploration; keep this duration configurable. The hallway remains at its calibrated transform.
3. **Education / badge.** Reveal the 36 x 36 cm, 43 cm high box on the floor and a glowing badge orb above its centre. Whisper layers prompt "Get your badge. Claim your education." The box sits at the hallway's measured lateral and longitudinal midpoint, away from walls. Initial placement coordinates remain draft values until checked on site.
4. **Reach.** The participant steps onto the matching real box. Only a valid tracked fingertip entering the orb's contact sphere collects it; a controller ray or a pinch at a distance does not. Provide an explicit operator simulation control for desktop review. Require the operator to confirm the wearer is stationary and supported before enabling the turn.
5. **Collect / turn.** Hide the orb exactly once, play a short congratulation cue, and rotate the visual hallway smoothly by 180 degrees over four seconds about the box's vertical axis. Keep the floor plane, scale, XR camera, controllers, hands, and physical box fixed.
6. **Reversed exploration.** Finish at exactly 180 degrees without accumulating transforms. The operator supervises stepping down. A reversed asymmetric hallway will no longer match its physical walls: wall touch remains unavailable until independent checks establish the intended reversed geometry. This is an artistic divergence from calibrated mode, never a claim of continued alignment.

## Coordinate and lifecycle contract

- Preserve the existing scan-root calibration transform and one XR unit = one metre. Store a baseline at experience start; apply the experience yaw to that baseline, never to an already rotated result.
- Installation props live in XR space after placement. The authored hallway3 bottom-centre anchor, or a picked floor-edge pair, remains scan-local and reprojects after a fresh calibration. The box remains upright and metric, extending upward from its base; height edits preserve the floor. Freeze props during the artistic turn so they do not rotate with the splat. Recheck the resulting floor/base height physically.
- Rotate about a world-Y axis through the box centre. For a floor-level baseline this preserves floor height, roll, pitch, and scale. Do not rotate the tracked rig or add locomotion.
- A new fit, edited placement/scan/start point, new session, reference-space reset, focus interruption, missing/emulated viewer tracking, or operator stop disarms the sequence and stops voice playback. Hand/controller loss alone pauses contact; it does not declare hallway drift.
- Recovery is explicit manual recalibration and placement checks. Restore the baseline before recalibration; never solve against an experience-rotated scan. No automatic re-anchoring or persistence of accepted alignment.
- STOP freezes the sequence and removes contact authority; reset restores the baseline while the participant is stationary under operator guidance. Do not silently animate a recovery around a moving wearer.

## Desktop movement boundaries

The desktop **Movement boundaries** panel compares two sources: a cyan runtime-reported `bounded-floor` polygon, when exposed by SteamVR/WebXR, and an amber manually configured installation rectangle. The manual rectangle starts hidden with draft 2.10 x 2.10 m values; set its measured width, depth, centre, floor height and rotation, then enable **Show manual area**. Its depth is a draft value, not a hallway measurement. Neither control edits the headset's system boundary or restricts physical movement.

The runtime polygon is transformed into the existing `local-floor` frame on a current XRFrame. It stays outside the scan root, so calibration and the artistic turn cannot move it. Desktop 3D floor outlines are hidden in immersive rendering; a desktop-only top-view canvas continues to show the polygon, manual rectangle, installation box and valid live head position during a session. Unsupported, empty, missing-tracking and hidden-session cases explicitly remove live geometry. After a normal session end, a retained outline is labelled **last-session snapshot**, never current acceptance. Bounds are not saved to disk or Git.

This is an operator reference, not a duplicate headset guardian. Keep runtime boundaries enabled and verify the actual exposed geometry on Steam Link. [WebXR bounded reference spaces](https://www.w3.org/TR/webxr/#xrboundedreferencespace)

## Hands

Use Three.js r180's WebXR hand support, checked against the installed dependency. Request optional `hand-tracking`, render its skinned hand model when available, and sample `index-finger-tip` from the current XRFrame/reference space for contact. Meta's native system hands cannot be enabled by a web page over Steam Link; availability depends on the streaming/runtime/browser chain. Keep calibration's distinction between real remotes and hand sources. Provide joint-based visual fallback if an optional hand model cannot load; do not require remote CDN access for the installation.

## Voice production and playback

Generate ElevenLabs clips ahead of time using a local Node script and an `ELEVENLABS_API_KEY` environment variable or ignored local environment file. Never ship the key to Vite, browser JavaScript, URLs, logs, or Git. The browser plays cached local audio and does not call ElevenLabs during the experience.

Use a readable, centred lead take plus quieter, delayed, left/right whisper takes, short repetitions, and conservative gain. Keep the imperative words in the lead voice clear. Eleven v3 supports expressive audio tags; verify current endpoint/model parameters in official documentation and make voice IDs configurable. Narrative captions never appear in the headset, including audio failures; transcripts and audio status stay on the PC. Calibration and interruption/recovery instructions remain visible in the headset. Mute/stop must cancel delayed layers too. Generation needs only the user's local key and chooses available voices automatically unless overridden; do not fabricate completed audio.

## Gaussian quality and loading

Inspect the pinned renderer and actual PLY headers/metadata before changing defaults. Evaluate existing opacity, alpha pruning, antialiasing assumptions, SH degree, render resolution, covariance precision, sorting, and source detail. The PC renders, but streaming resolution/bitrate still limits what the wearer sees.

First preserve available source detail with full experience opacity, supported SH shading, and appropriate precision/quality controls. Keep the working classic XR layer path. Use the existing high/ultra/max source variants deliberately; additional points cannot restore details absent from reconstruction. Do not blindly densify the scan, silently change normalization, or claim a screenshot proves streaming quality.

The user requests **no compression** for hallway3: load its original PLY directly with in-memory compression disabled. Keep private binaries ignored. The older offline converter remains a utility and is not used by loading. Distance-based LoD needs a spatial hierarchy, a compatible renderer, and measured transition/calibration behaviour; record a researched follow-up if the pinned renderer does not support it. Compare source and rendered evidence before deciding that reconstruction or streaming is the bottleneck. Actual audit: [render quality](RENDER_QUALITY.md). Voice generation and hand capabilities: [voice setup](VOICE_SETUP.md).

## Parallel implementation and reviewable steps

| Workstream | Ownership | Acceptance |
| --- | --- | --- |
| Interaction | Pure sequence/rotation/contact math, prop scene and operator controls | Deterministic one-shot collection, floor-preserving four-second yaw, centre/dimensions editable, draft placement gated, stop/reset |
| Hands and voices | Hand adapter, offline ElevenLabs generator, local playback/mixing, setup notes | Optional capabilities reported; real joint contact only; no browser secret; captions/mute/stop/missing-file handling |
| Rendering | Pinned-renderer quality audit/settings, compressed asset tooling, quality notes | Evidence-backed changes, no coordinate changes, explicit quality profiles, reproducible private conversion |
| Integration | Main loop, calibration lifecycle hooks, plan/backlog updates, checks | Calibration still works; interruption disarms; controls reviewable on desktop; tests/check/build pass |

## Validation and remaining physical inputs

Implementation status: sequence, fixed box/orb, scan-centre picker, operator preview/start/STOP/reset, current-frame fingertip adapter, locally bundled generic WebXR skinned hands with joint fallback, captions/mixer, offline ElevenLabs generator, quality presets and private compressed scans are implemented. The public hand-model download succeeded on the user's authorized retry; its MIT licence is retained. These are the generic models used by Three.js, rather than native Meta compositor hands. Live joints still depend on the Steam Link/runtime route. Voice clips await the user's local key and voice selections.

Automated: pure state transitions, invalid/stale contact rejection, single collection, rotation endpoint/pivot/floor preservation, and reset behaviour. Run `npm test`, type checking, `npm run check` (bounded desktop report and screenshot), and `npm run build`. Read reports and inspect screenshots. Synthetic browser checks demonstrate UI/rendering only.

Physical, pending user measurement: hallway midpoint, width, length/clear extent, floor height and ceiling height; surveyed box centre and placement check for the supplied 36 x 36 x 43 cm box; comfortable reachable orb height; independent fit/held-out checks; Steam Link joint availability; stereo hand rendering/contact; supported stationary four-second turn; step down; PC/GPU/render and streaming timings. No hardware acceptance is inferred from automated tests.

Relevant constraints: [calibration](CALIBRATION.md), [validation](VALIDATION.md), [project plan](PROJECT_PLAN.md), [headset route](HEADSET_SETUP.md). Implementation decisions and actual results live in [strategy](../ai/strategy.md).
