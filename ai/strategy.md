# Strategy

## Goal

Calibrated: a PC-rendered WebXR experience for Meta Quest 3 that displays one hallway's Gaussian splat scan aligned with that same physical hallway at real scale.

## Current phase

Planning pack published; **implementation started**. The working desktop/XR splat viewer prototype (Vite + TypeScript + Three.js + `@mkkellogg/gaussian-splats-3d`) was combined into this repository on 2026-10-29 and now lives under `src/` split along the plan's module boundaries. Desktop browser checks pass; **no hardware test has been run yet** — M0 remains open.

## Plan

- [x] Draft the project plan and agent workflow.
- [ ] M0 — Prove the Windows PC → browser → Meta Link → Quest 3 runtime path. **Open: no hardware test run.**
- [~] M1 — Build and check the desktop/XR splat viewer. **In progress:** viewer renders the scan 3× stacked; desktop browser checks pass (type-check clean, no console errors, ~29 fps in the test browser with ~800k splats); Quest hardware rendering untested.
- [ ] M2 — Prepare the hallway scan, metric scale, and landmark dataset.
- [ ] M3 — Implement guided landmark calibration and independent validation.
- [ ] M4 — Implement invalidation, recovery, and saved-profile revalidation.
- [ ] M5 — Measure performance and run a supervised hallway pilot.

The detailed deliverables and gates live in `docs/PROJECT_PLAN.md`; implementation tasks live in `docs/BACKLOG.md`.

## Decisions

- 2026-10-29 — The user confirmed wireless streaming from a Windows PC to Quest 3 over strong local Wi-Fi. Use Chrome and Meta Air Link provisionally until the streaming software is confirmed; M0 must demonstrate the actual setup. Record the router and transport, and use wired Ethernet from the PC to the router if available. USB Link is an optional diagnostic fallback. Mac development may cover documentation and desktop code.
- 2026-10-29 — Use one metric XR space and transform the scan root; keep the tracked camera/controller rig unchanged in calibrated mode.
- 2026-10-29 — Use paired physical/scan landmarks with separate held-out validation points; do not depend on automatic room matching or passthrough.
- 2026-10-29 — Save calibration metadata for inspection and reuse, but require revalidation in each new session and after viewer-tracking/reference-space interruptions. Invalid controller poses pause capture; losing an unused controller alone does not invalidate alignment.
- 2026-10-29 — Carry forward the Photolipsia plan/build/check/log workflow with honest separation between desktop checks and physical validation.
- 2026-10-29 — Keep agent permissions and model/provider selection in the user's existing tool configuration.
- 2026-10-29 — Publish the planning pack to the user's `leonarda4/calibrated` repository. Completion requires a successful push and matching local/remote commit IDs.
- 2026-10-29 — The user authorized combining the existing working viewer app into this repository. The app (Vite + TypeScript + Three.js 0.180 + `@mkkellogg/gaussian-splats-3d` 0.4.7, the latest published) becomes the M1 baseline under `src/viewer`, `src/xr`, and a thin `src/main.ts` entry. Spark from the plan's proposal remains an alternate candidate; mkkellogg is the proven-working baseline — switch only if the M1 gate demands it.
- 2026-10-29 — Scan binary `hallway.ply` (17 MB, INRIA-style 3DGS with normals, 265,974 splats, exported from the user's `01_GS_Model/00_Export/point_cloud_4.ply`) lives at `public/models/hallway.ply`, matching `src/viewer/splatViewer.ts` (`MODEL_URL = /models/hallway.ply`); `.gitignore`'s `*.ply` rule keeps it out of Git. The app loads the same file 3× stacked 6 m apart (test configuration; will be replaced by the single metric-normalized scan at M2).
- 2026-10-29 — `sharedMemoryForWorkers: false` on the splat viewer: the library's sort worker otherwise requires a cross-origin-isolated context (COOP/COEP), which the dev server does not set.

## Open inputs

- Windows version, GPU and driver, streaming software/version, router, and whether the PC has Ethernet to the router. Wireless streaming is confirmed; PC specifications will follow.
- Hallway scan availability, format, size, acquisition method, and whether its scale is already metric. **Partially supplied:** `01_GS_Model/00_Export/point_cloud_4.ply` (265,974 splats) is the working scan; metric scale unverified.
- Hallway dimensions, accessible landmarks, and available physical measurement/probe equipment.

## Validation record

2026-10-29 — Planning review completed: relative Markdown links and fenced blocks checked; independent calibration/runtime reviews incorporated. Probe validation checks cross-orientation agreement as well as stationary sample spread. No application tests or hardware tests were run; M0–M5 remain untested. Future entries must name the environment, date, checks run, evidence, and unresolved limitations.

2026-10-29 — Viewer combination (Windows 11 PC, Chrome-based desktop test browser): `npm run check` (tsc --noEmit) clean after adding local ambient types for the splat library; dev servers over HTTPS (5173) and HTTP (5174, for the in-app test browser only); page loads with zero console errors; scan `hallway.ply` loads 3× stacked and renders (~29 fps observed in the test browser with ~798k total splats, gpuAcceleratedSort on, SH degree 0). **Not claimed:** any Quest/Link hardware result — M0 remains open; the earlier 60 fps reading was the animation loop without the scan loaded.

2026-10-29 — Black-screen diagnosis (headset reported black window after "loaded ✓"). Frame-buffer readback + shader-uniform inspection showed the splat material's `focal`/`viewport` projection uniforms stayed `{0,0}` because the library's hidden callback-mesh update path did not run reliably with our renderer. Fix: call `splats.viewer.update(renderer, activeCamera)` explicitly at the top of every animation-loop frame (XR camera when presenting), in `src/main.ts`. Verified via manual render + readback: uniforms set (focal ≈ 577 px) and the buffer is no longer black (sampled luminance sum 3269 vs 0). Also switched to CPU sort (`gpuAcceleratedSort: false`) and `dynamicScene: true` as safer defaults for the Quest browser. Hidden in-app browser tabs throttle requestAnimationFrame, so automated pixel checks require a visible tab; headset confirmation still pending — **not claimed**.

## Next

1. Run the M0 hardware protocol: Windows Chrome → wireless Link → Quest 3 with the combined viewer; record stereo, head/controller poses, three enter/exit cycles, and streaming timing.
2. If M0 passes, finish the M1 gate: both-eye check of the stacked scan on hardware, then move to M2 (metric normalization of `hallway.ply`, landmark dataset).
3. Keep committing each working state to `leonarda4/calibrated` via GitHub Desktop; keep scan binaries and captures out of Git.
