# Interaction plan

Current flow: a narrated test starts automatically after calibration, with manual controls available when **Narrated test after calibration** is disabled. Delivery remains Windows Chrome -> SteamVR/OpenXR -> Steam Link -> Quest 3. The scan placement in [scanAsset.ts](../src/viewer/scanAsset.ts) is user-adjusted and protected: changing this flow does not change that file or the calibration landmarks.

## Narrated test

Timing starts at the successful fit callback, during the existing one-second scan reveal. No speech duration extends these deadlines.

| Time after calibration | Action and narration |
| --- | --- |
| 0 s | “welcome, I hope you are calibrated to your new environment” |
| 10 s | Show first box: “well would you look at that, a box appeared... I wonder if it's real...” |
| 15 s | Start the four-second turn: “Whoosh, what just happened?” |
| 20 s | Reveal second box: “oh look there's your seat because you are late for class.” |

The clock calls the same guarded placement/reveal actions as the buttons. Manual action and placement controls wait while the test runs; STOP and Reset remain available. A failed placement, stalled frames, new calibration, changed scan placement, VR session change or tracking/focus loss cancels further actions and audio. Recovery requires a fresh calibration. Disabling the test cancels it and restores manual controls. **Preview narrated test on desktop** resets the visual baseline and runs without granting a physical fit. See [voice setup](VOICE_SETUP.md) for required local ElevenLabs clips and access troubleshooting.

## Operator sequence

1. Load the hallway scan. For a headset run, enter VR and complete the existing controller calibration first. Desktop use requires neither a headset nor a calibration fit.
2. Click **Show box** in Chrome. The app estimates the hallway centre at the selected cross-section and shows the first upright **0.36 x 0.36 x 0.43 m** box with its bottom on **local-floor Y = 0**, matching the cyan origin/grid reference. It also prepares the second box's placement while keeping that box hidden.
3. Review the centering and second-box placement messages. If the first wall fit is weak, use **Pick two floor edges**; their midpoint supplies X/Z on floor Y = 0. To refine the second box's approximate guide, open placement details and choose **Pick second-box floor line**, then click its visible floor line once in the PC view before rotating.
4. Click **Rotate hallway 180°** when ready. The second placement is prepared again from the original scan before the turn. The visual hallway turns smoothly over **four seconds** around the first box's vertical axis. Both box poses and the tracked camera, hands and controllers remain fixed in their original XR frame.
5. When the turn finishes, click **Show second box**. This separate button reveals the prepared world-space pose; it does not recompute placement from the reversed scan. In the narrated test the same action runs automatically at +20 seconds.
6. **STOP** freezes a turn and invalidates live alignment. **Reset baseline** restores the saved hallway transform. Reset, fresh calibration, stop and session changes clear the prepared/visible second box. Headset use requires fresh calibration after an interruption or operator stop; resetting alone does not restore acceptance.

With the narrated test disabled, Show box, Rotate hallway and Show second box are separate operator actions. There is no orb collection or support/placement checkbox. A completed turn requires reset before another turn. Both boxes default to **0.36 x 0.36 x 0.43 m**; the first box's dimensions remain editable, while the second box keeps those fixed dimensions.

## Extracted wall object

**Show wall** is a separate operator button available after the scan loads; it needs no box or turn first. It loads the private uncompressed `public/splats/wall-section/wall-section.ply` only on demand and places the wall across the passage near raw Y = 24.8, beyond the second box. The same button becomes **Hide wall**. During loading it can cancel the pending reveal. A weak opposing-wall fit leaves the object hidden and reports the reason.

The object copies 33,437 original splats from the door-free graffiti wall near raw X = 0.90, Y = 19.75–21.85. This is the densest 2.10 m interval on a 0.10 m search grid within the visually clean wall stretch Y = 16.25–22.75. The wall height is 2.60 m, retaining the continuous scanned wall from raw Z = -1.45 to +1.15, including the upper wall above the horizontal band at +0.95. These are scan-derived dimensions; physical metric validation remains separate. Positions, normals and Gaussian orientation are rotated into a bottom-centred object frame; colour, scale and opacity remain original with no resampling or compression. Recreate the local asset with `npm run scan:extract-wall`; an existing crop requires the explicit `-- --force` option. Source fingerprint and crop evidence stay in private adjacent metadata. Source/crop and placement settings live in [wallSectionConfig.ts](../src/viewer/wallSectionConfig.ts), independently of the protected manual scan placement.

The copy shares the hallway's splat sorter so foreground/background blending respects depth. A scene-specific rectangular shader clip keeps visible Gaussian tails within the 2.10 × 2.60 m face. The original hallway and the tracked rig are unchanged. The wall follows the calibrated scan and any artistic hallway turn; both boxes retain their existing fixed-world behavior. Source-only scan centres remain the input to calibration picks and box/wall fits. Reset, calibration, stop and session/tracking interruptions hide the wall and cancel pending reveals. Recalibrating never reveals it automatically. This is a visual obstruction; it adds no physical collision geometry.

## Hallway-centre estimate

Primary centring uses independently fitted left/right wall planes and solves equal normalized perpendicular distances at the chosen longitudinal station. The operator panel measures the final rendered box centre and actual turn pivot against those planes; manual off-centre edits therefore show an imbalance. Show box and the Rotate action re-centre the placement. The cyan desktop marker denotes the XR origin before Show box, then follows the box's true floor pivot. Model equality is numerical; scan appearance residuals still limit physical accuracy.

The box's horizontal edges align with the fitted world-space hallway direction. Two-edge placement uses the perpendicular of the picked wall-to-wall vector. A new calibration updates this heading once; box orientation stays fixed while the visual hallway turns. This changes neither the floor centre nor the turn pivot.

The current raw PLY seed is **[2, 21.1, -1.45]**, supplied from the user's screenshot. It locates the cross-section to inspect; it is not a surveyed box point or a measured midpoint of the whole hallway.

The centering operation fits opposing walls using nearby scan splat centres, transforms the estimated midpoint through the current scan root, and places the box base at local-floor Y = 0. Report the fit result on the operator panel. A weak or ambiguous fit leaves the two-floor-edge picker as the explicit fallback. The approximately **2.10 m** hallway width is a physical comparison input, not permission to stretch the scan.

The wall model is an estimate from appearance data. Neither a plausible fit nor a symmetric-looking view certifies physical wall geometry, collision clearance, the runtime's floor estimate, or touch accuracy. Inspect the real box and independent alignment landmarks before a physical run. The manual controls add no extra acceptance checkbox.

## Second-box floor-line guide

The approximate screenshot guide is raw PLY **[2.8, 23.3, -1.45]**. A local wall fit near raw Y = 23.3 and a bounded floor-colour-band check across three strips support a draft seam near **Y = 22.99**, giving the guide **[2.8, 22.99, -1.45]**. This is an appearance-based guide, not a surveyed line or a claim that the seam was detected exactly.

The placement helper offsets the box centre **0.18 m inward from the fitted wall** and **0.18 m along raw +Y, away from the door**. Those offsets are half the fixed box width/depth. With the current initial scan profile, the resulting approximate raw base is **[2.95235, 23.17116, -1.45]**, projected to world base **[-0.95235, 0, 4.57116]**. Calibration changes the world projection; the protected scan profile and A/B source points are unchanged.

The optional one-click floor-line picker refines this guide from the desktop before the turn. It requires the loaded scan and an idle/ready/first-box phase. Review its placement message and the real floor/wall before a physical run. The second box's base and heading are saved in world space before rotation, remain outside the scan root, and stay unchanged when the hallway turns or the reveal button is pressed. The first box remains the turn pivot throughout.

## Coordinate and lifecycle contract

- Keep one XR unit = one metre, with the tracked camera/controller/hand parents at identity. Apply calibration and the artistic turn to the scan root only. Preserve the user-adjusted scan normalization and the separate A/B landmarks.
- Both boxes remain upright and metric in XR space. Each mesh centre is half its height above its floor contact. The first box alone supplies the turn pivot; preparing or revealing the second box does not change that pivot.
- Save the current calibrated scan transform before the turn. Compute each animated pose from that baseline and the current yaw, keeping the floor level and finishing at exactly 180 degrees without compounding transforms.
- A new fit, scan/start-point change, new session, reference-space reset, focus interruption, missing/emulated viewer tracking, or operator stop removes live alignment authority. Restore the baseline before another calibration. Recovery stays explicit; there is no automatic re-solving or persisted acceptance.
- STOP freezes the current visual pose. Reset is an explicit restoration while the wearer is still under operator guidance. Loss of an unused hand/controller alone does not invalidate hallway alignment.

The 180-degree reversal is an artistic divergence from calibrated alignment. An asymmetric reversed hallway may no longer match its real walls. Independent checks are required before further wall-touch exploration. The first physical box/turn trials remain supervised; desktop screenshots cannot establish spatial accuracy or comfort.

## Existing supporting features

Calibration remains the current title -> controller trigger or CALIBRATE -> seven-second placement -> fit/reveal flow. The committed raw A/B points are **A [2.99, 19.14, -1.41]** and **B [2.90, 18.16, -1.26]**, with LEFT on A and RIGHT on B. This manual interaction change does not edit them. See [calibration](CALIBRATION.md) and [headset setup](HEADSET_SETUP.md).

The desktop **Movement boundaries** panel remains an operator reference: cyan shows a runtime-reported bounded-floor polygon when available, and amber shows a manually configured rectangle. Its local-floor geometry stays outside the scan root, and it does not change the headset's boundary or restrict movement. Unsupported or stale runtime data is labelled accordingly.

Optional WebXR hand tracking and locally bundled generic skinned hands remain available when Steam Link, SteamVR and Chrome expose joint poses. Native Meta system hands are controlled by the headset. ElevenLabs generation and playback are documented in [voice setup](VOICE_SETUP.md); the narrated test invokes its four cues, while individual manual Show box / Rotate hallway actions remain silent.

Hallway3 continues to load its original private PLY without compression. Preserve the classic XR layer workaround and existing quality controls. Rendering detail, reconstruction detail and streaming resolution remain separate factors; see [render quality](RENDER_QUALITY.md).

## Validation

Automated checks cover manual transitions and the separate +0/+10/+15/+20 narrated clock, hidden preparation and post-turn reveal gating, the exact four-second yaw, fixed box poses and tracked parents, baseline restoration and interruption invalidation. Run `npm test`, `npm run typecheck`, the bounded desktop `npm run check`, and `npm run build`. Read generated reports and inspect their screenshots.

Physical checks remain separate: verify the estimated/picked cross-section, both box locations and clearance, the second floor-line guide, local-floor height, held-out alignment errors, tracked hands, stereo delivery, the stationary turn, stepping down and streaming performance. No synthetic pose or browser screenshot is hardware acceptance.

Related: [project plan](PROJECT_PLAN.md), [validation protocol](VALIDATION.md), [strategy and decisions](../ai/strategy.md).
