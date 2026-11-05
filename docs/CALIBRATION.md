# Calibration design

Uncovered application space, including loading and fully faded/hidden scan
frames, clears to opaque white on desktop and in VR. Calibration still changes
only the scan transform/fade; the background color changes no landmarks, source
colors, metric scale or tracked-camera/controller poses.

Floor fog stretches to half the captured corridor height (1.3 m for 2.6 m), retaining its fixed 5-33 m interval in the added downward hallway, one metre beyond the broom at its four-metre station. Full-height mist occupies that same added corridor; the original hallway has no mist. Both follow the captured opening through calibration/turn/return with wall/mouth clipping and local collapse, without reading movement bounds or granting alignment acceptance. Mist is hidden during native calibration/recovery and follows scan fade. See [atmosphere placement and checks](FOG.md).

The validation-grade protocol below remains a method to test experimentally, not a claim of achieved Quest or scan accuracy.

## New scan setup: hallway3 (2026-11-03)

The active asset is the original public/splats/hallway3/hallway3_0.ply, loaded without compression. [scanAsset.ts](../src/viewer/scanAsset.ts) contains manually adjusted orientation, start, camera and box anchors: do not modify this file without explicit user permission. [splatViewer.ts](../src/viewer/splatViewer.ts) applies that placement, mapping the configured raw start to the XR origin. User-supplied raw PLY landmarks are stored separately in [landmarks.ts](../src/calibration/landmarks.ts): **A [2.99, 19.14, -1.41]**, **B [2.90, 18.16, -1.26]**. The hallway3 defaults load automatically; they are scan correspondences, not proof of a present physical fit. EDIT A/B can replace the pair for the page session, and reloading restores the configured pair. Missing or partial replacement pairs still block capture. Manual placement does not certify floor orientation or metric scale; yaw+translation calibration cannot correct remaining tilt.

1. Inspect the scan in desktop Chrome using its manually adjusted placement. Start floor point fields initially use the raw start from scanAsset.ts, then display the raw PLY point at world origin in the current view, including after the hallway turn. Editing them translates the scan while preserving its current heading, turn and fixed first-box pivot; subsequent frames retain the edit. Blank/incomplete numbers do not move it. These inspection fields pause during turns/capture/loading and are hidden in live XR; they return on the desktop after exiting VR. Scan edits cancel pending gameplay and optional props; a new VR session still requires a fresh fit. The tracked rig stays unchanged; do not change the protected source profile without permission.
2. Use the configured A/B above and identify their corresponding physical marks: LEFT on A, RIGHT on B. Use **EDIT A/B** only when intentionally selecting a replacement pair; beginning an edit clears both active points, and a partial selection blocks capture. Reload restores the configured pair.
3. The manual box route ignores the stale asset box anchor. **Show box** fits opposing scan walls near raw [2,21.1,-1.45], centres the box at that longitudinal station and uses the existing local-floor Y=0. Its 0.36 x 0.36 m footprint and 0.43 m height remain metric and upright. Weak wall estimates ask for two opposite floor-edge picks; those also use floor Y=0. Neither inferred geometry nor manual placement establishes physical acceptance. The protected scan profile is unchanged.
4. Check uniform metric scale with corresponding measurements, using approximately 2.10 m local width and approximately 2.40 m floor-to-bars height as independent references. Whole-scene bounds do not provide these distances. Scale and floor orientation still require physical checks.
5. Enter VR and perform the existing controller fit below, then check floor/box position, reach and independent landmarks before starting the installation. A picked box anchor follows the fit. Check any manually entered world placement again after a new fit.

The second 36 x 36 cm, 43 cm high box is prepared against the wall/floor-line guides before the turn. Refine its guide with **Pick second-box floor line** on the desktop before entering VR. Preparation retains its Z station in the shared calibrated hallway frame and selected physical wall side; this station is independent of the XR tracking axes. After rotation, on reveal and after an alignment-offset edit, its lateral position and heading refit to the current selected wall plane so a whole footprint edge meets that wall. Its displayed XYZ and yaw remain world coordinates. A new calibration fit or interruption clears its prior placement. The first box alone remains fixed as the turn pivot.

The visible boxes use the original local `WoodenBox.ply`, normalized upright to the existing dimensions. Each reveal rises from below the floor over 1.5 seconds; Hide lowers it below the same plane. The first box's headset trigger waits until its rise finishes; the narrated game also reserves five seconds after its reveal action for the announcement. These visual transitions do not move the first box, turn pivot or tracked rig. The second box follows the current selected wall at its prepared station. Recovery cancels both animations immediately.

The first box has an automatic exit: one second after actual rotation completion it glitches out in place over 0.55 seconds, with sliced jitter and disappearing chunks. It stays at its standing height throughout the effect, then hides; its logical anchor/pivot remains fixed. The second box is unaffected. Manual Hide retains the floor descent, and Show can restore the first box. STOP, fresh calibration, reset and tracking interruption cancel the delayed effect as well as an active one.

Both standing box splats now have zero extra lift: their bases sit on the logical floor, with the full 43 cm height above it. The first box's interaction volume and turn pivot remain at their existing coordinates; both hidden endpoints remain fully below the floor.

**Flipped hallway wall alignment** defaults to **0 cm**: the turn has no extra lateral correction. The earlier +10 cm trial has been removed; the control remains available for optional manual adjustment. Positive means right when facing from the start down the original hallway; negative means left, including after the flip. The original calibrated hallway is unchanged at zero rotation, and the correction eases to its full amount with the turn. Tune it in centimetres on the PC before or after a turn; adjustments are blocked during turning, active narration and tracking/calibration interruption. The first box remains fixed. The broom and second box follow the corrected hallway's current fitted sections at their explicit stations. The moving wall fits once before entry and retains its locked trajectory, heading and width through later alignment edits; its next reveal fits again. The hole fits the current walls at its relocated interval when opened, then retains its captured bounds through later edits. Reset/calibration preparation restores the original scan transform; the per-page amount is only an appearance setting. Check both real walls at the relevant station: translation cannot reconcile different scanned widths or wall angles and does not establish physical acceptance.

Every successful live calibration reenables the gameplay sequence and starts it from zero: Ambience 1 immediately, welcome at +1 s and first box/step-on prompt at +8 s. Its reveal reserves at least five seconds before current valid headset entry can start Transition 1; the four-second turn begins 2 s after that anticipation cue. Desktop autoplay starts anticipation at +20 s and turns at +22 s. The second box appears five seconds after actual turn onset. Both placements must succeed before the first reveal; failure stops/disarms the game. Recalibration cancels old audio, queued actions and effects before a new run. Disable gameplay after the fit for manual diagnostics in the current run; this does not suppress the next calibrated game. STOP, reset and tracking/calibration interruptions cancel the sequence. Explicit audio mute persists. Starting/completing gameplay never grants held-out validation. See [gameplay timing](GAMEPLAY_FLOW.md) and [audio setup](VOICE_SETUP.md). During an active game, native ambience/transition playback continues under wall motion, speech and effects, including long rendering frames; desktop visual clocks skip those stalled frames instead of cancelling music. Explicit mute and Stop/reset/calibration/tracking/session recovery retain their cancellation authority.

After the five-second minimum, live box entry also waits for scheduled/playing first-box speech to finish; pending/failed downloads, suspended audio and explicit mute do not hold the anticipation trigger. Accepted entry latches the two-second musical countdown; leaving the footprint afterward does not cancel it. Tracking/calibration recovery and STOP retain their cancellation guards.

## Headset-boundary voice

The separate boundary voice uses current physical headset position and the live
runtime `bounded-floor` outline, independently of the scan's alignment or visual
turns. Moving outward within 0.5 m of an edge requests a supplied DangerZone
line; retreat to 0.75 m and an eight-second cooldown rearm it. It grants no
calibration acceptance. STOP, mute, invalid/reset tracking and session changes
cancel its audio/history; a fresh current motion sample is required afterward.
Hidden desktop guides do not disable it. As explicitly selected, unavailable
headset geometry has no manual-area fallback; its status is shown on the PC.
See [boundary audio](GAMEPLAY_FLOW.md#headset-boundary-voice).

## Automatic lights-out cue

After the second box finishes rising, the supplied sit-down recording asks the participant to sit. Its existing current-headset footprint trigger arms the wall; actual unseen wall appearance starts a separate five-second deadline for the classroom instruction. Waiting for appearance does not start that clock; later motion pauses do not postpone it. Speech queues complete recordings, and recovery clears pending prompts with the wall sequence. The footprint trigger does not measure whether the participant is physically seated.

The second box's completed floor rise starts a 6.5-second delay before one second of light flicker and its quiet local effect, then 30% hallway brightness. Transition 2 begins 2 s before the flicker and fades into Ambience 3 afterward. Manual lighting controls override this cue. STOP/reset/calibration/session or viewer-tracking interruption cancels pending/active lighting and sound and restores normal brightness; a later frame cannot revive the cancelled cue. See [lights out](INTERACTION_PLAN.md#lights-out). Audible Steam Link level and visual comfort need a separate headset check.

## Wall testing coordinates

The floor opening and its downward hallway cutout share one captured placement.
The cutout's floor edge is toward the prepared second box, its ceiling opposite,
and both wall edges meet the fitted hole sides. Width/taper and calibration yaw
come from the actual opening; its source floor/heading come from the private
crop metadata. Later scan corrections retain the captured join. Closing the
hole, STOP, recalibration or tracking recovery hides the cutout immediately.
Valid entry above the open hole starts its existing two-second anticipation,
then a four-second eased 90-degree visual world turn. Its hinge is the cutout's
floor edge, toward the second box. The new floor finishes level at physical
floor height, with the cutout's depth horizontal and its ceiling above it.
The entire authored environment turns together; canonical source/hole/box
coordinates, metric scale and tracked camera/controller parents are unchanged.
Real head movement supplies the walking view. At 90 degrees, crossing the
captured vertical opening from cutout interior toward the original side starts
a four-second smooth return about the same hinge. The swept head segment must
cross inside the fitted trapezoid, with 8 cm side hysteresis; starting outside
must first enter the cutout interior. Return restores the exact presentation
before the quarter-turn, preserving the earlier box/scan sequence. Before the
collapse-armed ending return, clear the horizontal footprint expanded by 10 cm,
then enter it again for the same two-second lead and four-second turn. Once
that ending return starts, further entry is blocked. Ambience 4 continues
without replaying the story or third transition music until the final solo
ending. Pose history clears at endpoints and on
interruption. STOP, reset, closing the hole, calibration or tracking/session
recovery cancels either direction and restores the baseline without replay.
Reset before editing props or source placement after the first hole turn. This
authored visual phase does not establish new physical wall registration or
acceptance; repeated passage, stereo and comfort still need hardware checks.

Only the first completed hole quarter-turn in each game starts the added
hallway's broom cue. After two seconds it glitches into view over 0.55 s,
centred four metres beyond the entrance and upright on that corridor's floor.
Its invisible 36 x 36 cm trigger uses the existing upward headset-footprint
rule, rather than requiring the headset inside a 43 cm tall physical box.
Entry while the hallway is fully upright latches a two-second delay before
a 0.55 s glitch out, even if the wearer leaves the footprint afterward.
The captured pose follows pitch/return; later visits do not replay the cue.
Close or manual Hide cancels it without rearming, and STOP/reset/calibration
or tracking/session recovery clears it. A new game/fresh calibration rearms it.
Manual Show broom outside this interaction retains its original Z6 diagnostic.

The first successful automatic reveal queues the full supplied
`CLEANTHEROOM.wav` on the initial glitch-in frame; a successful manual Show
also requests it. Current speech finishes first, and the soundtrack keeps its
level. Failed or repeated visible presentations do not request another line.
`RoomTilting.wav` follows actual angular movement in each four-second inward
and return leg, including later cycles. Anticipation and standing poses have
no tilt effect. Mute, close, STOP, reset and calibration/tracking/session
recovery cancel active and pending tilt playback. Audio scheduling does not
establish audible headset delivery or physical registration.

Completion of that automatic glitch out starts one distant added-hallway
collapse per game; manual Hide cannot trigger it. Ten seeded, semi-random
fracture spots give five on each side, progressing from the far crop toward
the protected near area with 0.6–1.1 s gaps. Each 1.8 s burst starts one supplied
`RumblingSound01.wav` excerpt and its own roughly three-second growth of
irregular local splat/fog loss. Surviving detail remains between cavities;
there is no full-cross-section cutoff plane. Keep
the complete route from the opening fully visible for at least 6 m, expanding
permanently to the greatest current-user depth plus 2 m; optional current bounds
can enlarge this by protecting their farthest depth plus 1 m. Missing bounds
do not block the effect. This captured opening-space policy works through
calibration yaw, either floor side and return, without moving the tracked rig.
Approaching damaged space restores its protected prefix. Original scene0 stays
unchanged before the ending return; near splats and the return aperture/trigger
remain protected. Return pauses the collapse clock while its mask persists.
Earlier visits do not replay the broom or story; the collapse-armed ending
return blocks another entry. Assets and render buffers remain
preloaded/reused, with source scans unchanged. Close, STOP, reset, recalibration,
tracking/session recovery or invalid/stalled frames cancel it; a fresh game
rearms it. These are tunable visual trial settings, not physical-safety or
headset-comfort certification.

Once actual automatic collapse has armed the ending, the existing physical
crossing starts the same four-second return, with organic damage at both ends
of the original hallway already visible during motion. Preserve a longitudinal
interval at least 4 m either side of the current user, including the opening
and available physical bounds, and expand it as the user moves. Actual return
completion starts the dimension clock at zero: reverse irregular relighting
from current brightness to full over the first second with the same
`light_flicker.mp3`, hold until five seconds, then glitch all authored content
away over one second with that sound. At six seconds hold opaque white and
play the complete 6.710979 s `WhatIsReality.wav` once alone via `finishReality`.
That intentional final removal includes the previously protected area. This
does not move the tracked rig, change metric scale, rewrite source assets or
grant fresh calibration acceptance. STOP/reset/calibration/tracking/session
recovery cancels both visual and audio state; a new game rearms it. Real-headset
registration, stereo, audible output and comfort remain pending.

The wall controls show bottom-centre XYZ in current world metres. In gameplay, a current valid headset above the fully raised second-box footprint arms the hidden wall. It waits for a look away from that hallway direction and a clear standing footprint, then appears instantly at **hallway Z=-8**, without a slide-in. It immediately approaches the first box's captured hallway station, approximately **Z=2.5**, at **1 m/s** while unseen. Looking back allows exactly **0.7 s** before stopping; looking away resumes. There is no watched introductory travel. **Five continuous seconds looking at the wall at its final standing position**, or a genuine passage through it at any route position, starts its stationary **0.55-second glitch**. The dwell starts fresh at actual arrival; looking away or invalid/stalled gaze resets it. Show/Run manually arm the same unseen reveal and motion used by preview and VR. Use current valid headset gaze in XR and the camera only on desktop, with 45-degree entry/50-degree retention cones; unknown gaze blocks movement.

Desktop route coordinates equal world coordinates. After a live fit, the route follows the calibrated hallway yaw and horizontal origin frozen before the artistic turn; arbitrary SteamVR axes cannot reverse the approach side. Floor Y remains zero. Player/gaze poses and swept clearance use this same frame; displayed/manual XYZ remain world metres. Each new fit replaces the frame without granting acceptance or bypassing interruption guards. Before reveal, five supported sections across the corrected scan define one straight centreline and fixed upright heading. Anchor the line at the normalized wall-distance midpoint at the captured first-box station, then size a constant width over the route and full slab depth, with 1 cm edge overlap; height/depth are preserved. Route, heading and width stay fixed during motion and waits, even after a later scan correction. New reveals or explicit authoring fit again; no per-frame section query adjusts the wall.

Its full-thickness footprint stays 75 cm from the current headset, requires 15 cm extra clearance to resume and limits swept steps before crossing that buffer. This overrides gaze permission. The wall never retreats, exceeds its captured endpoint or catches up after waits; the player can pass through it and trigger disappearance. Only a valid finite passage through its actual footprint counts, not proximity, a side miss or a pose jump. Appearance waits if occupied. Desktop preview uses the inspection camera. `/audio/SoundFX/RumblingSound02.wav` loops at 35% gain while translating, with a 0.2-second fade-in and a look-back fade-out matching the 0.7-second stopping delay. Proximity/paused/invalid waits, Stop and recovery silence it. These appearance/head-position checks certify neither body clearance nor physical safety.

Wall, broom and floor use this same calibrated hallway frame for every button/system trigger. Explicit manual coordinates are scan-local candidates for this page, honoured by Show/Run and gameplay and reprojected through a new rigid fit; manual forward/back follows the hallway. Manual position/motion or Stop overrides the script. Calibration/reset/tracking/session interruption cancels pending reveals, motion and audio and hides the wall; a fresh enabled game waits for the second-box-above trigger again. Hide does not author coordinates; the next default Show arms the same unseen instant reveal from -8 toward the captured first-box station. Use start position clears explicit overrides and restores -8. The tracked rig never moves. See [interaction plan](INTERACTION_PLAN.md).

## Restored current method (2026-11-03)

The optional scanned broom stands bristles-down at the current fitted hallway centre and **hallway Z=6 m**, following hallway correction and refitting after the turn. STOP, reset, calibration preparation and tracking/session interruption hide it. The wall endpoint is centred between the fitted walls at the captured first-box station, approximately Z=2.5. Before passage, prepare a wall-to-wall hole with its near edge **1 m beyond that fixed wall endpoint opposite approach**, extending another **2.60 m**. For the usual endpoint this is Z=-1.1 to 1.5. Player position and crossing direction never relocate it. Once the actual opaque wall conceals all four fitted floor corners from the current valid viewer, the floor and connected hallway glitch in over **0.4 s**, including during approach when fully covered. The prepared geometry remains locked; five seconds of final gaze or a genuine passage only starts the wall's stationary 0.55-second glitch. Both boxes keep their prepared positions, and the same frozen aperture defines the cutout join and later turn hinge. Static endpoint buttons inspect without arming a floor cue. These stations share the calibrated frame and world XYZ diagnostics, while their assets never supply landmarks. Review scale, floor contact and physical alignment independently on hardware.

At the user's request, calibration returns to the guided title/trigger/seven-second flow from local commit `8754817`. The SteamVR/Steam Link route was user-confirmed on hardware on 2026-11-02; this restored flow with the current installation integration needs a fresh hardware check. The later sequential controller-hold redesign is no longer the active procedure.

- **Enter VR while wearing the headset:** start SteamVR/Steam Link, wake both controllers, then click **Enter VR** in PC Chrome or through SteamVR Desktop. There is no queued pre-headset solo-start mode.
- **Title and countdown:** the scan is hidden behind the HALLWAY PROJECT title and floor grid. Pull a physical controller's front/index trigger once, or click **CALIBRATE** on the PC page, to start seven seconds for placing LEFT on A and RIGHT on B. Both placements are acquired in the same attempt; there is no sequential save or trigger-hold capture requirement.
- **Landmark contract:** the labelled physical marks correspond to the scan-local A/B configured for the active export in `src/calibration/landmarks.ts`, or intentionally replaced using **EDIT A/B**. Missing points block capture. Controllers supply the measured reference; `PROBE_TIP_OFFSET` remains zero and does not establish a surveyed physical tip. Arbitrary floor locations are not substitutes for the paired marks.
- **Buffered physical controller positions:** samples come from active XR frames. If hand tracking takes over after placement and controller sources disconnect, their last real buffered measurements remain available for the current attempt. Hands are excluded from measurement; invalid/emulated poses from a still-connected controller block that active measurement. The buffer cannot prove the later placement of an untracked controller.
- **Bounded CONFIRM fallback:** if the countdown ends without both measurements, wake both controllers where the headset can see them, place LEFT on A and RIGHT on B, then pinch or pull a trigger to confirm available buffered measurements. A pinch may confirm; it does not measure a hand as a landmark. The hint shows three available attempts, decreasing only when a confirmation is missing controller data. Three failed confirmations or 30 elapsed seconds return to READY with a persistent wake-controller hint and cleared buffers. A late confirmation cannot fit expired data. The deadline is checked on the next XR frame or confirmation input; there is no new background calibration timer or automatic fit.
- **Fit and reveal:** the existing closed-form yaw plus XYZ translation solver changes only the scan root. The scan fades to full opacity over one second after a successful fit while the title/grid fade out. Fit residuals remain distinct from independent validation errors.
- **Hand tracking stays enabled:** optional hand tracking and real-joint fingertip interaction remain available to the experience. The rollback adds no headset hand-tracking setting change.
- **Controller identity with joint data:** Oculus Touch controller profiles with a gamepad and grip remain controller inputs even when SteamVR supplies skeletal data. Explicit hand profiles take priority and cannot provide landmark measurements. Unknown skeletal sources remain excluded. READY shows LEFT and RIGHT separately; pick up a missing controller, keep it in headset view and press its front trigger. Console input lines include profile, gamepad, grip and joint information. A normal source disconnect during hand takeover is informational; only fresh controller poses can update physical measurements. [Chromium OpenXR input path](https://raw.githubusercontent.com/chromium/chromium/main/device/vr/openxr/openxr_input_helper.cc)
- **Wait versus interruption:** the title screen without an active capture or fit waits through hidden/unfocused startup or menus. It names `visible-blurred` (view covered/unfocused; close the dashboard/menu) or `hidden` (view unavailable; keep the headset on and return to browser VR) separately from actual position-tracking loss. No countdown or acceptance starts when focus returns.
- **Explicit recovery:** during COUNTDOWN/CONFIRM or after a fit, viewer/reference-space/visibility interruption cancels capture, discards the attempt and disarms the installation. Once visible, real tracking returns, the headset's **View restored** prompt asks for one press of either physical controller's front trigger to restart the complete seven-second placement. The PC **CALIBRATE** button is an alternative; a hand pinch cannot restart interrupted calibration. Actual session end requires **Enter VR** first, then a fresh fit and placement check. There is no automatic re-anchoring, queued capture acceptance or two-second redo gesture.

The two-landmark MVP does not implement the held-out validation protocol below and cannot establish section 5's physical accuracy targets. A successful fit is not independent acceptance.

The [installation sequence](INTERACTION_PLAN.md) supports a headset-position trigger alongside Chrome **Show box** and **Rotate hallway 180°** buttons. Desktop inspection needs no headset; live XR requires a current explicit A/B fit and visible tracking. The shown first box triggers rotation when the current tracked headset enters its footprint at or above the base; there is no hand-contact or support-checkbox requirement. Manual recalibration restores the content baseline before solving; the four-second turn rotates only the visual scan around the centred box base. The fixed box and tracked hands stay in XR space, and reversed walls require independent checks before touch exploration.

## Coordinate contract

Maintain three explicit spaces:

| Space | Meaning |
| --- | --- |
| Raw scan | Original reconstruction coordinates; units/up-axis may be unknown |
| Hallway | Prepared, right-handed, metre-based coordinates with +Y up |
| XR reference | Current session's `local-floor` tracking space |

WebXR positions use metres; its floor origin can be estimated. Verify physical height instead of treating that origin as a surveyed floor. [WebXR spaces](https://www.w3.org/TR/webxr/#spaces)

With column-vector convention:

```text
p_hallway = T_hallway_from_raw × p_raw
p_xr      = T_xr_from_hallway × p_hallway
p_tip_xr  = T_xr_from_grip × p_tip_in_grip
```

`T_hallway_from_raw` is permanent asset normalization: axis correction, a positive uniform scale, and origin selection. `T_xr_from_hallway` is session registration. Never mix either with a desktop orbit-camera transform.

Suggested scene hierarchy:

```text
scene (XR reference coordinates)
  tracked camera + controllers (identity parent transform)
  hallwayRoot (T_xr_from_hallway)
    rawAssetRoot (T_hallway_from_raw)
      splat
    landmarks + diagnostic geometry (already in hallway metres)
```

This prevents applying scale twice to prepared landmarks. The user moves one virtual metre per physical metre. No calibrated-mode teleport, stick movement, artificial turn, rig scaling, or guessed eye height.

## 1. Prepare the hallway asset

Keep the original scan unchanged. Record an asset hash, format, bounding box, capture method, and normalization version. Check orientation and use several physical measurements across length, width, and height to estimate/verify uniform scale; reserve another distance as a check. Record measurement uncertainty.

Check both ends of the initial segment. If one scale factor cannot explain the dimensions, investigate reconstruction distortion. A good-looking splat is not automatically accurate geometry.

Choose **4–6 fitting landmarks** and **at least 3 separate validation landmarks**. Use identifiable corners, fixture centres, or surveyed markers with explicit contact definitions. Spread them along and across the segment, on both sides and at different heights where feasible. Validation points must cover the far end as well as the start.

Three non-collinear pairs are sufficient for a general rigid transform, but the MVP requires redundant, well-spread samples. Reject repeated, near-collinear, or tightly clustered layouts. Coplanarity alone is not a reason to reject a planar layout; report its sensitivity. Avoid anonymous points on a blank wall and ambiguous repeated doorframes.

Splat ray picking can assist annotation, but does not establish a physical surface. Prefer surveyed coordinates or a companion mesh where visual landmarks are unclear. Markers added after scanning need measured positions in the original hallway coordinate system.

## 2. Establish the physical probe

A controller's `gripSpace` is not a physical contact tip, and `targetRaySpace` does not supply a contact point. Use a blunt, rigid, repeatably mounted tip or docking fixture with a measured offset in the controller grip frame. Store the controller profile, handedness, mount identity, offset, and measurement method. Transform the offset through the full controller pose on every sample. [WebXR input sources](https://www.w3.org/TR/webxr/#xrinputsource-interface)

Verify offset repeatability at one fixed contact point using at least three substantially different controller orientations across multiple axes. Compare the per-window tip-position means against a shared centre; the proposed maximum deviation is ≤10 mm. This cross-orientation check is separate from within-window stability: a wrong offset can produce stable samples at several different positions. If simple measurement is inadequate, add a pivot-calibration procedure, then verify it with orientations not used to estimate the offset. Reattaching the probe invalidates its previous validation.

## 3. Capture matching points

The baseline PC VR session is opaque. The current guided sequence acquires the labelled floor/controller landmarks using the seven-second placement described above. For a validation-grade contact probe or fixture, use an assistant where the measurement cannot be reached reliably while the wearer stays stationary; desktop capture controls remain available for that supervised measurement. Keep the active controller in a region the headset can track. Never instruct the wearer to locate a real wall by reaching toward an unverified virtual one.

Capture an initial 0.5–1 second stationary window per point. Convert each valid frame to a tip position before averaging; retain raw sample count, time range, and spread. Reject missing/emulated poses and moving samples. Proposed repeatability target: 95th-percentile distance from the sample mean ≤10 mm, with orientation-change checks for the probe mount. Tune thresholds using observed fixture data and log changes.

Require explicit pairing and a recapture action. Keep old samples for diagnostics, but do not mix samples across reference-space changes or sessions. For far landmarks, move the wearer only under physical guidance while the app remains unverified; reacquire stable tracking before sampling.

## 4. Solve registration

Default to a **yaw rotation plus XYZ translation** after metric/up-axis preparation. This keeps the prepared floor level. Let `a_i` be hallway landmarks and `b_i` measured XR tips. Minimize:

```text
sum_i w_i || R_y(theta) a_i + t - b_i ||²
t = weighted_mean(b) - R_y(theta) weighted_mean(a)
```

Estimate yaw from centred horizontal point pairs. Start with equal weights for samples passing capture quality; any later uncertainty weighting must be explicit. Scale stays fixed at 1 during registration.

A proper 6-DoF rigid fit with reflection correction is a diagnostic or documented alternative when scan-up uncertainty justifies it. Do not silently introduce scale, non-uniform deformation, or a mirrored transform to improve the residual. A similarity fit may diagnose incorrect asset scale, but corrections belong in a new normalization version. [Rigid/similarity alignment reference](https://web.stanford.edu/class/cs273/refs/umeyama.pdf)

Report fit RMS, maximum residual, per-point errors, spatial spread, and rejected captures. Refuse solving when correspondence geometry is weak. A small fit residual alone does not unlock the experience.

## 5. Validate physical alignment

Capture the held-out landmarks without adding them to the fit. Compute errors against their transformed hallway positions. Show held-out RMS, maximum error, and each error vector. Check floor/width and visible edges at more than one head position to catch annotation, scale, and stereo errors.

If validation fails, investigate the cause and recapture/reprepare as needed. If validation points influence a manual adjustment, they have become fitting data; use fresh independent checks before acceptance. Do not offer casual alignment nudges after verification.

Small errors grow with distance: a 0.5° heading error creates about 8.7 cm lateral error at 10 m; a 0.5% scale error creates 5 cm over 10 m. Validate the whole claimed segment. A single touch near the start is insufficient.

## 6. State and recovery

```text
UNREGISTERED → CAPTURING → SOLVED_UNVERIFIED → VERIFIED
                                  ↓               ↓
                                FAILED     NEEDS_REVALIDATION
```

On failure, recapture and solve again. `NEEDS_REVALIDATION` returns to `VERIFIED` only after all independent checks pass; otherwise run a fresh capture/solve. Loading a saved profile starts unverified. Changing scan, normalization, landmark definitions, probe mount, or controller profile requires a new fit.

Invalidate verification on session end/restart, reference-space reset, missing/emulated viewer tracking, headset removal or focus/visibility interruption when observable, Link disconnect, and operator stop. A missing/emulated controller pose rejects or pauses active landmark capture; loss of an unused controller alone does not invalidate hallway alignment. On reset during capture, discard that capture batch. After viewer/reference-space interruption, require stable poses and fresh checkpoints. Revalidate periodically during longer trials; ordinary drift may occur without an event. [WebXR reset events](https://www.w3.org/TR/webxr/#event-types)

When invalidated, show a prominent stop cue with the specific cause and remove the implication that the hallway is aligned. Once visible tracking returns, update the cue to the concrete front-trigger restart action; the browser CALIBRATE control remains available. An ended session requires Enter VR first. During supervised physical trials, an assistant can guide the wearer to remain still or exit to the system view. A dark or transparent canvas does not provide passthrough in opaque VR. Preserve runtime boundary behavior. The app cannot detect every tracking failure or physically stop a person at a wall; the first walking/box trials use a clear route and an assistant.

## Data to persist locally

| Record | Required fields |
| --- | --- |
| Asset manifest | Schema version, asset ID/hash, normalization matrix and units/conventions, dimensions, landmark IDs/coordinates/roles, survey uncertainty |
| Probe profile | Profile/handedness, mount ID, grip-local tip offset, offset validation results |
| Session report | Unique session ID, runtime versions, reference-space type, captures/quality, fit transform/method, fit and held-out errors, tested extent, interruptions, timestamps |
| Saved candidate | References to matching asset/probe versions and prior report; never restored as `VERIFIED` |

Validate imported numbers, dimensions, positive scale, transform convention, and matching hashes. Local storage/export is sufficient; no cloud sync or location-identifying public dataset is required. Keep private reports under ignored paths. Local persistence stores evidence, not a persistent real-world anchor.
