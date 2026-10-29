# Strategy

## Goal

Calibrated: a PC-rendered WebXR experience for Meta Quest 3 that displays one hallway's Gaussian splat scan aligned with that same physical hallway at real scale.

## Current phase

Planning only. No application, installed dependencies, working calibration, or completed headset test is claimed. The user requested publication of this planning pack to `https://github.com/leonarda4/calibrated.git`; application implementation is not yet requested.

## Plan

- [x] Draft the project plan and agent workflow.
- [ ] M0 — Prove the Windows PC → browser → Meta Link → Quest 3 runtime path.
- [ ] M1 — Build and check the desktop/XR splat viewer.
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

## Open inputs

- Windows version, GPU and driver, streaming software/version, router, and whether the PC has Ethernet to the router. Wireless streaming is confirmed; PC specifications will follow.
- Hallway scan availability, format, size, acquisition method, and whether its scale is already metric.
- Hallway dimensions, accessible landmarks, and available physical measurement/probe equipment.

## Validation record

2026-10-29 — Planning review completed: relative Markdown links and fenced blocks checked; independent calibration/runtime reviews incorporated. Probe validation checks cross-orientation agreement as well as stationary sample spread. No application tests or hardware tests were run; M0–M5 remain untested. Future entries must name the environment, date, checks run, evidence, and unresolved limitations.

## Next

Supply the missing setup details when available. When implementation is requested, begin with M0 and record the actual runtime combination before proceeding.
