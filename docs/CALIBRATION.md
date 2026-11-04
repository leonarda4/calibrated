# Calibration design

The validation-grade protocol below remains a method to test experimentally, not a claim of achieved Quest or scan accuracy.

## New scan setup: hallway3 (2026-11-03)

The active asset is the original public/splats/hallway3/hallway3_0.ply, loaded without compression. [scanAsset.ts](../src/viewer/scanAsset.ts) contains manually adjusted orientation, start, camera and box anchors: do not modify this file without explicit user permission. [splatViewer.ts](../src/viewer/splatViewer.ts) applies that placement, mapping the configured raw start to the XR origin. User-supplied raw PLY landmarks are stored separately in [landmarks.ts](../src/calibration/landmarks.ts): **A [2.99, 19.14, -1.41]**, **B [2.90, 18.16, -1.26]**. The hallway3 defaults load automatically; they are scan correspondences, not proof of a present physical fit. EDIT A/B can replace the pair for the page session, and reloading restores the configured pair. Missing or partial replacement pairs still block capture. Manual placement does not certify floor orientation or metric scale; yaw+translation calibration cannot correct remaining tilt.

1. Inspect the scan in desktop Chrome using its manually adjusted placement. Start floor point fields initially use the raw start from scanAsset.ts, then display the raw PLY point at world origin in the current view, including after the hallway turn. Editing them translates the scan while preserving its current heading, turn and fixed first-box pivot; subsequent frames retain the edit. Blank/incomplete numbers do not move it. These inspection fields pause during turns/capture/loading and are hidden in live XR; they return on the desktop after exiting VR. Scan edits cancel pending gameplay and optional props; a new VR session still requires a fresh fit. The tracked rig stays unchanged; do not change the protected source profile without permission.
2. Use the configured A/B above and identify their corresponding physical marks: LEFT on A, RIGHT on B. Use **EDIT A/B** only when intentionally selecting a replacement pair; beginning an edit clears both active points, and a partial selection blocks capture. Reload restores the configured pair.
3. The manual box route ignores the stale asset box anchor. **Show box** fits opposing scan walls near raw [2,21.1,-1.45], centres the box at that longitudinal station and uses the existing local-floor Y=0. Its 0.36 x 0.36 m footprint and 0.43 m height remain metric and upright. Weak wall estimates ask for two opposite floor-edge picks; those also use floor Y=0. Neither inferred geometry nor manual placement establishes physical acceptance. The protected scan profile is unchanged.
4. Check uniform metric scale with corresponding measurements, using approximately 2.10 m local width and approximately 2.40 m floor-to-bars height as independent references. Whole-scene bounds do not provide these distances. Scale and floor orientation still require physical checks.
5. Enter VR and perform the existing controller fit below, then check floor/box position, reach and independent landmarks before starting the installation. A picked box anchor follows the fit. Check any manually entered world placement again after a new fit.

The second 36 x 36 cm, 43 cm high box is prepared against the wall/floor-line guides before the turn. Refine its guide with **Pick second-box floor line** on the desktop before entering VR. Preparation retains its world-Z station and selected physical wall side. After rotation, on reveal and after an alignment-offset edit, its lateral position and heading refit to the current selected wall plane so a whole footprint edge meets that wall. A new calibration fit or interruption clears its prior placement. The first box alone remains fixed as the turn pivot.

The visible boxes use the original local `WoodenBox.ply`, normalized upright to the existing dimensions. Each reveal rises from below the floor over 1.5 seconds; Hide lowers it below the same plane. The first box's headset trigger waits until its rise finishes. These visual transitions do not move the first box, turn pivot or tracked rig. The second box follows the current selected wall at its prepared station. Recovery cancels both animations immediately.

The first box has an automatic exit: one second after actual rotation completion it glitches out in place over 0.55 seconds, with sliced jitter and disappearing chunks. It stays at its standing height throughout the effect, then hides; its logical anchor/pivot remains fixed. The second box is unaffected. Manual Hide retains the floor descent, and Show can restore the first box. STOP, fresh calibration, reset and tracking interruption cancel the delayed effect as well as an active one.

Both standing box splats now have zero extra lift: their bases sit on the logical floor, with the full 43 cm height above it. The first box's interaction volume and turn pivot remain at their existing coordinates; both hidden endpoints remain fully below the floor.

**Flipped hallway wall alignment** adds a lateral visual correction during the turn, initially **+10 cm** for the user's trial. Positive means right when facing from the start down the original hallway; negative means left, including after the flip. The original calibrated hallway is unchanged at zero rotation, and the correction eases to its full amount with the turn. Tune it in centimetres on the PC before or after a turn; adjustments are blocked during turning, active narration and tracking/calibration interruption. The first box remains fixed. The broom, floor opening and second box follow the corrected hallway's current fitted sections at their explicit world-Z stations. The moving wall fits once before entry and retains its locked trajectory, heading and width through later alignment edits; its next reveal fits again. Reset/calibration preparation restores the original scan transform; the per-page amount is only an appearance setting. Check both real walls at the relevant station: translation cannot reconcile different scanned widths or wall angles and does not establish physical acceptance.

**Narrated test after calibration** is enabled by default: welcome immediately after fit, first box at +10 seconds, turn when the tracked headset is inside or above the shown first box, and second box five seconds after turn onset. Disable it before calibrating to retain manual Show box / Rotate / Show second box control and more review time. STOP, reset and tracking/calibration interruptions cancel the test. Neither starting nor completing it grants held-out validation. See [interaction timing](INTERACTION_PLAN.md) and [voice setup](VOICE_SETUP.md).

## Automatic lights-out cue

The second box's completed floor rise starts a two-second delay, followed by one second of light flicker and a quiet, faded local sound, then30% hallway brightness. Manual lighting controls override this cue. STOP/reset/calibration/session or viewer-tracking interruption cancels pending/active lighting and sound and restores normal brightness; a later frame cannot revive the cancelled cue. See [lights out](INTERACTION_PLAN.md#lights-out). Audible Steam Link level and visual comfort need a separate headset check.

## Wall testing coordinates

The wall controls show bottom-centre XYZ in current world metres. Gameplay keeps it hidden until two seconds after the actual hallway rotation finishes, then reveals it at hallway route Z=-8 and approaches Z=-2 at 0.30 m/s. Desktop route coordinates equal world coordinates. After a live fit, the route follows the calibrated hallway yaw and horizontal origin, frozen before the artistic turn; arbitrary SteamVR axes therefore cannot reverse the approach side. Floor Y remains zero. Current headset positions and swept clearance checks use that same frame; displayed/manual XYZ remain actual world metres. A new fit replaces the frame; it grants no acceptance and cannot bypass interruption guards. Before entry, five supported sections across the current rotated/offset scan define one straight centreline and a constant upright heading. Its width is set once to cover both walls over that route, with 1 cm edge overlap for scan noise; height and depth stay unchanged. The route, heading and width remain fixed during movement and player waits, even if the scan correction changes. A new reveal or explicit authoring action fits again; no per-frame section query adjusts the wall. Its actual full-thickness rendered footprint keeps 75 cm from the current headset position, requires another 15 cm to resume, and limits swept steps so they cannot cross that buffer. It never retreats, passes -2 or catches up after waiting; missing current tracking blocks motion. Appearance and side entry also wait if occupied. Desktop previews use the inspection camera. These visual proximity checks do not certify body clearance or physical safety. Explicit manual coordinates remain scan-local candidates for this page and reproject through a new rigid fit; manual forward/back motion follows the hallway. Manual position/motion or Stop overrides the scripted route. Calibration/reset/tracking/session interruption cancels pending reveals and movement and hides it; a fresh enabled gameplay sequence arms a new post-turn reveal. Use start position restores Z=-8. The tracked rig never moves. See [interaction plan](INTERACTION_PLAN.md).

## Restored current method (2026-11-03)

The optional scanned broom uses the current fitted hallway centre at **world Z = 6 m**, standing bristles-down on the floor. It follows the hallway correction and refits after the turn, and is hidden on calibration preparation, STOP, reset and tracking/session interruption. The floor opening similarly fits both current walls at Z3 and 5.6 instead of using a fixed-width world rectangle. Their local assets never supply calibration landmarks. Review scale, floor contact and physical alignment independently on hardware.

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
