# Calibration design

This is a proposed method to validate experimentally. It is not a claim of achieved Quest or scan accuracy.

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

The baseline PC VR session may be opaque. The wearer remains stationary while an assistant places the tracked probe on labelled real landmarks. A desktop operator selects the matching landmark, checks live pose quality, and captures it. This may require another operator or a capture control within reach. Test this arrangement in M0; keep the controller in a region the headset can track. Never instruct the wearer to locate a real wall by reaching toward an unverified virtual one.

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

When invalidated, show a prominent stop cue and remove the implication that the hallway is aligned. The operator tells the wearer to remain still and exit to the system view when appropriate. A dark or transparent canvas does not provide passthrough in opaque VR. Preserve runtime boundary behavior. The app cannot detect every tracking failure or physically stop a person at a wall; the first trials use a clear route and an assistant.

## Data to persist locally

| Record | Required fields |
| --- | --- |
| Asset manifest | Schema version, asset ID/hash, normalization matrix and units/conventions, dimensions, landmark IDs/coordinates/roles, survey uncertainty |
| Probe profile | Profile/handedness, mount ID, grip-local tip offset, offset validation results |
| Session report | Unique session ID, runtime versions, reference-space type, captures/quality, fit transform/method, fit and held-out errors, tested extent, interruptions, timestamps |
| Saved candidate | References to matching asset/probe versions and prior report; never restored as `VERIFIED` |

Validate imported numbers, dimensions, positive scale, transform convention, and matching hashes. Local storage/export is sufficient; no cloud sync or location-identifying public dataset is required. Keep private reports under ignored paths. Local persistence stores evidence, not a persistent real-world anchor.
