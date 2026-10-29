# Strategy

## Goal

Calibrated: a PC-rendered WebXR experience for Meta Quest 3 that displays one hallway's Gaussian splat scan aligned with that same physical hallway at real scale.

## Current phase

Planning pack published; **implementation started**. The working desktop/XR splat viewer prototype (Vite + TypeScript + Three.js + `@mkkellogg/gaussian-splats-3d`) was combined into this repository on 2026-10-29 and now lives under `src/` split along the plan's module boundaries. Desktop browser checks pass; **no hardware test has been run yet** â€” M0 remains open.

## Plan

- [x] Draft the project plan and agent workflow.
- [ ] M0 â€” Prove the Windows PC â†’ browser â†’ Meta Link â†’ Quest 3 runtime path. **Open: no hardware test run.**
- [~] M1 â€” Build and check the desktop/XR splat viewer. **In progress:** viewer renders the scan 3Ã— stacked; desktop browser checks pass (type-check clean, no console errors, ~29 fps in the test browser with ~800k splats); Quest hardware rendering untested.
- [ ] M2 â€” Prepare the hallway scan, metric scale, and landmark dataset.
- [ ] M3 â€” Implement guided landmark calibration and independent validation.
- [ ] M4 â€” Implement invalidation, recovery, and saved-profile revalidation.
- [ ] M5 â€” Measure performance and run a supervised hallway pilot.

The detailed deliverables and gates live in `docs/PROJECT_PLAN.md`; implementation tasks live in `docs/BACKLOG.md`.

## Decisions

- 2026-10-29 â€” The user confirmed wireless streaming from a Windows PC to Quest 3 over strong local Wi-Fi. Use Chrome and Meta Air Link provisionally until the streaming software is confirmed; M0 must demonstrate the actual setup. Record the router and transport, and use wired Ethernet from the PC to the router if available. USB Link is an optional diagnostic fallback. Mac development may cover documentation and desktop code.
- 2026-10-29 â€” Use one metric XR space and transform the scan root; keep the tracked camera/controller rig unchanged in calibrated mode.
- 2026-10-29 â€” Use paired physical/scan landmarks with separate held-out validation points; do not depend on automatic room matching or passthrough.
- 2026-10-29 â€” Save calibration metadata for inspection and reuse, but require revalidation in each new session and after viewer-tracking/reference-space interruptions. Invalid controller poses pause capture; losing an unused controller alone does not invalidate alignment.
- 2026-10-29 â€” Carry forward the Photolipsia plan/build/check/log workflow with honest separation between desktop checks and physical validation.
- 2026-10-29 â€” Keep agent permissions and model/provider selection in the user's existing tool configuration.
- 2026-10-29 â€” Publish the planning pack to the user's `leonarda4/calibrated` repository. Completion requires a successful push and matching local/remote commit IDs.
- 2026-10-29 â€” The user authorized combining the existing working viewer app into this repository. The app (Vite + TypeScript + Three.js 0.180 + `@mkkellogg/gaussian-splats-3d` 0.4.7, the latest published) becomes the M1 baseline under `src/viewer`, `src/xr`, and a thin `src/main.ts` entry. Spark from the plan's proposal remains an alternate candidate; mkkellogg is the proven-working baseline â€” switch only if the M1 gate demands it.
- 2026-10-29 â€” Scan binary `hallway.ply` (17 MB, INRIA-style 3DGS with normals, 265,974 splats, exported from the user's `01_GS_Model/00_Export/point_cloud_4.ply`) lives at `public/models/hallway.ply`, matching `src/viewer/splatViewer.ts` (`MODEL_URL = /models/hallway.ply`); `.gitignore`'s `*.ply` rule keeps it out of Git. The app loads the same file 3Ã— stacked 6 m apart (test configuration; will be replaced by the single metric-normalized scan at M2).
- 2026-10-29 â€” `sharedMemoryForWorkers: false` on the splat viewer: the library's sort worker otherwise requires a cross-origin-isolated context (COOP/COEP), which the dev server does not set.

## Open inputs

- Windows version, GPU and driver, streaming software/version, router, and whether the PC has Ethernet to the router. Wireless streaming is confirmed; PC specifications will follow.
- Hallway scan availability, format, size, acquisition method, and whether its scale is already metric. **Partially supplied:** `01_GS_Model/00_Export/point_cloud_4.ply` (265,974 splats) is the working scan; metric scale unverified.
- Hallway dimensions, accessible landmarks, and available physical measurement/probe equipment.

## Validation record

2026-10-29 â€” Planning review completed: relative Markdown links and fenced blocks checked; independent calibration/runtime reviews incorporated. Probe validation checks cross-orientation agreement as well as stationary sample spread. No application tests or hardware tests were run; M0â€“M5 remain untested. Future entries must name the environment, date, checks run, evidence, and unresolved limitations.

2026-10-29 â€” Viewer combination (Windows 11 PC, Chrome-based desktop test browser): `npm run check` (tsc --noEmit) clean after adding local ambient types for the splat library; dev servers over HTTPS (5173) and HTTP (5174, for the in-app test browser only); page loads with zero console errors; scan `hallway.ply` loads 3Ã— stacked and renders (~29 fps observed in the test browser with ~798k total splats, gpuAcceleratedSort on, SH degree 0). **Not claimed:** any Quest/Link hardware result â€” M0 remains open; the earlier 60 fps reading was the animation loop without the scan loaded.

2026-10-29 â€” Black-screen diagnosis (headset reported black window after "loaded âœ“"). Frame-buffer readback + shader-uniform inspection showed the splat material's `focal`/`viewport` projection uniforms stayed `{0,0}` because the library's hidden callback-mesh update path did not run reliably with our renderer. Fix: call `splats.viewer.update(renderer, activeCamera)` explicitly at the top of every animation-loop frame (XR camera when presenting), in `src/main.ts`. Verified via manual render + readback: uniforms set (focal â‰ˆ 577 px) and the buffer is no longer black (sampled luminance sum 3269 vs 0). Also switched to CPU sort (`gpuAcceleratedSort: false`) and `dynamicScene: true` as safer defaults for the Quest browser. Hidden in-app browser tabs throttle requestAnimationFrame, so automated pixel checks require a visible tab; headset confirmation still pending â€” **not claimed**.

2026-10-29 â€” M3 calibration core implemented (user requested two-landmark controller calibration):
- `src/calibration/yawTranslationSolver.ts` â€” pure yaw+translation least-squares solver (closed form, 2D Procrustes on the x/z plane; y is the runtime's job via `local-floor`), plus quaternion/translation composition onto the live scan root. No rendering/XR imports, so Node's test runner executes it directly.
- `tests/yawTranslationSolver.test.ts` â€” 5 deterministic synthetic tests: exact 2-pair recovery, 4-pair pure translation, Â±1 cm noise robustness, composition equals double application, and the <2-pair rejection. `npm test`: **5/5 pass**.
- `src/viewer/splatRaycast.ts` â€” CPU rayâ†’splat-center intersection (click-time only) so landmarks on the scan can be picked by aiming; first-hit + local centroid refinement as a flyer-splat mitigation.
- `src/xr/calibrationCapture.ts` â€” guided 4-step wizard (A_SCAN â†’ A_PHYS â†’ B_SCAN â†’ B_PHYS â†’ DONE) with controller ray, cyan/orange pair markers, an in-headset canvas-sprite instruction panel, squeeze-button restart, `PROBE_TIP_OFFSET` constant for the measured gripâ†’tip offset (currently 0 â€” to be measured), and application of the solved transform to the scan root only. Fit residuals are shown in-headset and reported on the flat page.
- Desktop smoke check after wiring: page loads with zero console errors; solver tests and `npm run check` green. **Not claimed:** any physical calibration accuracy â€” that needs the hallway, the probe offset measurement, and per the plan a third held-out validation landmark (not yet implemented) before M3's gate can close.

2026-10-29 â€” **User confirmed the two-landmark calibration works on the real headset.** Hardware-observed by the user (not agent-verified): wizard completes, transform applies. Follow-up changes requested and implemented:
- **Thumbstick dolly while aiming at the scan** (A_SCAN/B_SCAN steps): moves the SCAN ROOT, never the XR rig (invariant preserved). Scan picks are stored in the root's LOCAL frame and converted to world only at solve time, so dolly moves between picks cannot corrupt the fit.
- **Passthrough during physical-point steps:** the session now requests `immersive-ar` first (Quest Browser passthrough), falling back to `immersive-vr`. Renderer runs with `alpha: true` + transparent clear so the compositor camera feed shows through.
- **Guardian/recenter world-shift:** root cause is the headset re-defining the reference-space origin when passthrough/guardian events occur â€” it cannot be disabled. Mitigated per the M4 plan: the solved transform is persisted to `localStorage` and restored on the next session as a **candidate** with an explicit "verify landmarks" notice; a `reference-space reset` event now marks alignment INVALID in-headset with a recalibrate prompt.
- Flat-page report after calibration retained. Still open: probe-tip offset measurement, held-out validation landmark, and a supervised re-entry test after guardian interruption (M4 protocol).

2026-10-29 â€” Hardware feedback round 2 (user report from the headset):
- **Passthrough reportedly not working properly.** First mitigation implemented: global splat opacity `SCAN_OPACITY = 0.70` via an in-place fragment-shader patch (`uGlobalOpacity` uniform multiplies the final alpha), so the real room is visible through the splats. Verified in the desktop browser (uniform present, shader patched). Still to verify on hardware: whether immersive-ar actually started (status line now names the mode) â€” if the device/browser reports no AR support we silently fall back to immersive-vr, which would fully explain the report.
- **"Recalibration changed everything afterwards."** Plausible root cause found: a guardian/tracking recenter DURING the wizard leaves the captured pairs in a stale reference frame â†’ garbage fit. Fix: a reference-space `reset` mid-wizard now clears all pairs and restarts the wizard with an explicit notice; outside the wizard it still marks alignment INVALID. Untested on hardware.
- **Guardian boundary:** cannot be disabled from a web app (OS-level safety). Guidance given: Quest Settings â†’ Physical Space â†’ Boundary off / draw a stationary boundary over the whole hallway; immersive-ar sessions are also inherently less disruptive since the user already sees the room.

2026-10-29 â€” Wizard redesigned per user protocol; remotes become reference anchors:
- **New step order:** 1/4 real spot A (scan faded to ~4% so the camera feed dominates), 2/4 scan spot A (scan at 70%, sticks move the scan: LEFT stick = world Z, RIGHT stick = world X/Y), 3/4 real spot B, 4/4 scan spot B â†’ solve & apply. Scan picks remain in the root's LOCAL frame so stick moves cannot corrupt the fit.
- **Remotes-as-anchors:** after the fit, a 10-second countdown has the user place the LEFT remote on real spot A and the RIGHT remote on spot B. From then on a reference-space reset triggers an automatic re-solve from the remotes' current tracked positions ("AUTO-RECALIBRATED", rejected if RMS > 1 m â€” remotes presumably moved). Placement quality per remote is reported in cm. This directly addresses the user's report that boundary/recenter events "reposition the PLY at a random spot": with armed remotes the transform is re-anchored instead of drifting.
- Both controllers are wired (rays, trigger capture from either, squeeze restarts). Opacity is runtime-switchable (`setScanOpacity`) and the session's `environmentBlendMode` is printed on the panel.
- Checks: `npm run check` clean, solver tests 5/5, page loads with zero console errors. **Hardware run of the new protocol still pending â€” not claimed.**

2026-10-29 â€” Final wizard protocol per user specification (remotes ARE the landmarks):
- **1/4** pick scan point A in the PLY (left remote represents its real spot), **2/4** pick scan point B (right remote), sticks move the scan during picking (L = world Z, R = world X/Y), **3/4** 10-second countdown to place the LEFT remote on real spot A and the RIGHT remote on spot B (scan faded out â€” camera view), **4/4** remotes' tracked grip positions are read as the measured points, yaw+translation solved and applied, remotes armed as auto-recalibration anchors (reset event â†’ re-solve from current remote positions, refused above 1 m RMS).
- The wall-probing trigger steps are gone: no probe-tip-on-wall capture remains, `PROBE_TIP_OFFSET` now describes grip-origin â†’ placed-point on the remote. Per-remote placement is not re-validated at capture time beyond the fit residuals (the fit IS the placement check).
- Checks: `npm run check` clean, solver tests 5/5, zero console errors on load. **Hardware validation of this exact protocol pending.**

2026-10-29 â€” **User confirmed the wizard (steps 1â€“3, and the countdown/fit) works on hardware; auto-recalibration did not.** Two root causes identified and fixed:
- **Landmark pairs were session-only.** The saved transform was restored on re-entry, but the scan points A/B (needed to re-solve from the remotes) lived only in memory â€” after a reload there was nothing to recalibrate from. The pairs (and their left/right remote assignment) are now persisted with the transform; a session that restores both goes straight to ARMED and the watchdog verifies/corrects within seconds.
- **The reference-space `reset` event rarely fires on Quest**, so in-session recenters went unnoticed. Added a watchdog that polls the remotes every 1.5 s: a rigid, consistent drift between scan points and remotes (post-fit RMS below the limit) is treated as a tracking-origin redefinition and re-solved automatically ("AUTO-RECALIBRATED"); a non-rigid change (post-fit RMS > 1 m) is treated as moved remotes and marks the references INVALID until they are re-placed â€” re-placement auto-recovers to ARMED.
- Honest limitation recorded: a user rigidly carrying both remotes in both hands can look like an origin shift; the discriminator is the post-fit residual, which normally exceeds the limit when remotes are handled independently.
- Checks: tsc clean, solver tests 5/5, zero console errors. **Hardware re-test of auto-recal pending.**

2026-10-29 â€” Tour mode was added and then **reverted at the user's request** (implemented without being asked; the user wanted approaches discussed first). Repo state is clean at the auto-recalibration fix. The 30 m-inside-small-boundary question remains open â€” options (scaled diorama, auto-guided path, stick locomotion, walk-in-place, redirected walking) were presented for decision.

2026-10-29 â€” **Guarded auto-recalibration implemented** (design agreed with the user before execution, following the loop-safety discussion):
- **Loop-proof by construction:** the recal is a one-shot closed-form solve against stationary remotes â€” a correction removes the error that triggered it, so the sequence converges in one step. Explicit guards on top:
  - **Cooldown:** no second auto-recal within 5 s (a rate limit, NOT a delay â€” the first correction is immediate; total user-visible interruption â‰¤ ~1.5 s plus the 0.5 s glide).
  - **Pose stability:** remotes must be tracked, distinct, and unmoving for â‰¥ 0.5 s before solving (no stale/garbage poses at session resume).
  - **Sanity limits:** a re-anchor is refused above 3 m translation or 45Â° yaw (that pattern means the remotes moved, not the origin).
  - **Smoothed application:** the correction glides over ~0.5 s ("REALIGNINGâ€¦"), then a convergence re-check must confirm the drift is gone before "AUTO-RECALIBRATED" is declared; otherwise the references are marked INVALID.
  - **Fast watchdog** (0.5 s) for the first 10 s of a session and while INVALID; 1.5 s steady state.
- Checks: tsc clean, solver tests 5/5, zero console errors on load. **Hardware test of the guarded recal pending.**

2026-10-29 â€” **Watchdog polling disabled at the user's request** (`WATCHDOG_POLLING = false`): the user observed random recalibrations on hardware. Probable causes to investigate before re-enabling: (a) remote pose jitter crossing the 10 cm drift trigger, (b) remotes held in hands producing temporarily consistent rigid shifts. Remaining auto path: the reference-space `reset` event (still guarded by cooldown/stability/sanity). tsc clean, tests 5/5.

2026-10-29 â€” Session-start behavior changed per user report: **every VR session now starts the calibration wizard from step 1/4 with the default scan-root transform.** The localStorage restore path was removed (the last calibration is still written as a debugging record, never auto-applied) â€” a page reload therefore always starts from default. Stick mapping during scan picking changed to LEFT = X/Y, RIGHT = forward/back (Z). The info panel now disappears ~4 s after calibration completes, leaving a pointable green "âŸ² CALIBRATE" button (aim + trigger) as the only way back into the wizard; the squeeze shortcut was removed because gripping the remotes restarted the wizard accidentally. UI layering fixed: panel, button and markers render after the splats (renderOrder 999/1000, depthTest off) so gaussians no longer hide or wash them out. Checks: tsc clean, tests 5/5, zero console errors on load. Hardware re-test pending.


2026-10-29 — **Calibration radically simplified per user request** ("too messy"):
- **All automatic re-arrangement deleted**: watchdog, reference-space reset recal, smoothed glide, stability/sanity machinery, localStorage persistence — gone. The boundary restriction is accepted; if the scan shifts after a boundary event the user re-places the remotes and re-runs via the button. One decision path only.
- **Predefined landmarks**: points A/B live in `src/calibration/landmarks.ts` (scan-local coordinates). A desktop picker (click the scan in the flat view) prints coordinates to copy into the constants. In VR the flow is placement-only: put LEFT remote on A, RIGHT on B, pull trigger → solve → apply. Wizard steps, in-VR raycast picking and stick movement removed.
- **HUD sticks to the view**: instruction panel and ⟲ button are parented to the camera (added to the scene) — rigid head-locked UI, no per-frame positioning, rendered above the splats.
- Fit quality guards remain minimal and explicit: both remotes tracked, ≥ 0.3 m apart, RMS ≤ 1 m — otherwise a hint appears and nothing is applied.
- Checks: tsc clean, solver tests 5/5, zero console errors on load. Hardware test of the simplified flow pending.
## Next

1. ~~M0 hardware run~~ â€” **2026-10-29, user-reported from the real headset (Meta glasses, Quest Browser, HTTPS LAN): the scan loads 3Ã— and the user entered the immersive WebXR session in stereo.** Observed defect: the hallway stood vertical (scan's long axis is its local Y) â€” fixed by the new scan-root transform. Operator/assistant-run enter/exit cycling and streaming-timing numbers are still to be recorded for the full M0 protocol; the Quest-Browser variant is demonstrated, the PCâ†’Link variant is not yet tested.
2. M2 next: with the single-scan root transform in place, define the metric normalization properly (verify the 4.7 m thin axis really is height; align floor; then landmark dataset).
3. Git: user pushes manually via GitHub Desktop; agent only commits locally.

