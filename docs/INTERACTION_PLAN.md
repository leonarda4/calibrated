# Interaction plan

Current flow: manual controls in Chrome on the PC. Delivery remains Windows Chrome -> SteamVR/OpenXR -> Steam Link -> Quest 3. The scan placement in [scanAsset.ts](../src/viewer/scanAsset.ts) is user-adjusted and protected: changing this flow does not change that file or the calibration landmarks.

## Operator sequence

1. Load the hallway scan. For a headset run, enter VR and complete the existing controller calibration first. Desktop use requires neither a headset nor a calibration fit.
2. Click **Show box** in Chrome. The app estimates the hallway centre at the selected cross-section and shows the upright **0.36 x 0.36 x 0.43 m** box with its bottom on the **local-floor Y = 0** plane, matching the cyan origin/grid reference.
3. Review the reported centering result and the box placement. If the wall fit is weak, use **Pick two floor edges** to select opposite edges at the intended cross-section. The midpoint supplies X/Z; the box base remains at local-floor Y = 0. Placement details show the resulting coordinates, width and box dimensions.
4. Click **Rotate hallway 180°** when ready. The visual hallway turns smoothly over **four seconds** around the box's vertical axis. The box stays fixed. The participant's tracked camera, hands and controllers stay in their original XR frame.
5. Use **STOP** to freeze a turn and invalidate live alignment. **Reset baseline** restores the saved hallway transform. After an interruption or operator stop, headset use requires fresh calibration; resetting alone does not restore acceptance.

Show box and Rotate hallway are separate operator actions. There is no automatic exploration timer, orb collection, voice cue, or support/placement checkbox in this manual sequence. Showing the box does not start a turn. A completed turn requires reset before another turn.

## Hallway-centre estimate

The current raw PLY seed is **[2, 21.1, -1.45]**, supplied from the user's screenshot. It locates the cross-section to inspect; it is not a surveyed box point or a measured midpoint of the whole hallway.

The centering operation fits opposing walls using nearby scan splat centres, transforms the estimated midpoint through the current scan root, and places the box base at local-floor Y = 0. Report the fit result on the operator panel. A weak or ambiguous fit leaves the two-floor-edge picker as the explicit fallback. The approximately **2.10 m** hallway width is a physical comparison input, not permission to stretch the scan.

The wall model is an estimate from appearance data. Neither a plausible fit nor a symmetric-looking view certifies physical wall geometry, collision clearance, the runtime's floor estimate, or touch accuracy. Inspect the real box and independent alignment landmarks before a physical run. The manual controls add no extra acceptance checkbox.

## Coordinate and lifecycle contract

- Keep one XR unit = one metre, with the tracked camera/controller/hand parents at identity. Apply calibration and the artistic turn to the scan root only. Preserve the user-adjusted scan normalization and the separate A/B landmarks.
- The real box remains upright and metric in XR space. Its mesh centre is half the box height above its floor contact; the turn pivot shares its X/Z and floor Y.
- Save the current calibrated scan transform before the turn. Compute each animated pose from that baseline and the current yaw, keeping the floor level and finishing at exactly 180 degrees without compounding transforms.
- A new fit, scan/start-point change, new session, reference-space reset, focus interruption, missing/emulated viewer tracking, or operator stop removes live alignment authority. Restore the baseline before another calibration. Recovery stays explicit; there is no automatic re-solving or persisted acceptance.
- STOP freezes the current visual pose. Reset is an explicit restoration while the wearer is still under operator guidance. Loss of an unused hand/controller alone does not invalidate hallway alignment.

The 180-degree reversal is an artistic divergence from calibrated alignment. An asymmetric reversed hallway may no longer match its real walls. Independent checks are required before further wall-touch exploration. The first physical box/turn trials remain supervised; desktop screenshots cannot establish spatial accuracy or comfort.

## Existing supporting features

Calibration remains the current title -> controller trigger or CALIBRATE -> seven-second placement -> fit/reveal flow. The committed raw A/B points are **A [2.99, 19.14, -1.41]** and **B [2.90, 18.16, -1.26]**, with LEFT on A and RIGHT on B. This manual interaction change does not edit them. See [calibration](CALIBRATION.md) and [headset setup](HEADSET_SETUP.md).

The desktop **Movement boundaries** panel remains an operator reference: cyan shows a runtime-reported bounded-floor polygon when available, and amber shows a manually configured rectangle. Its local-floor geometry stays outside the scan root, and it does not change the headset's boundary or restrict movement. Unsupported or stale runtime data is labelled accordingly.

Optional WebXR hand tracking and locally bundled generic skinned hands remain available when Steam Link, SteamVR and Chrome expose joint poses. Native Meta system hands are controlled by the headset. Existing ElevenLabs asset generation and local voice preview are documented separately in [voice setup](VOICE_SETUP.md); the manual Show box / Rotate hallway actions do not invoke narrative audio.

Hallway3 continues to load its original private PLY without compression. Preserve the classic XR layer workaround and existing quality controls. Rendering detail, reconstruction detail and streaming resolution remain separate factors; see [render quality](RENDER_QUALITY.md).

## Validation

Automated checks cover manual Show box / Rotate transitions, absence of timer/contact progression, the exact four-second yaw, fixed box and tracked parents, baseline restoration and interruption invalidation. Run `npm test`, `npm run typecheck`, the bounded desktop `npm run check`, and `npm run build`. Read generated reports and inspect their screenshots.

Physical checks remain separate: verify the estimated/picked cross-section, real box location and clearance, local-floor height, held-out alignment errors, tracked hands, stereo delivery, the stationary turn, stepping down and streaming performance. No synthetic pose or browser screenshot is hardware acceptance.

Related: [project plan](PROJECT_PLAN.md), [validation protocol](VALIDATION.md), [strategy and decisions](../ai/strategy.md).
