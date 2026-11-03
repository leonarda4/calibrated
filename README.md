# Calibrated

A PC-rendered WebXR project for Meta Quest 3: view a Gaussian splat of a hallway while standing in that same hallway, with the virtual walls aligned to the physical walls at real scale.

**Status: implementation running. Single active delivery route: SteamVR / Steam Link (user decision 2026-11-03).**

- **The route — PCVR via SteamVR / Steam Link:** the PC renders and streams to Quest 3 over Wi-Fi. Chrome runs on the PC with **SteamVR as the active OpenXR runtime**, using the classic `XRWebGLLayer` path (fix in `src/xr/enterVR.ts`). **This is the only route the project works on from now on.**
- **Meta Link — parked:** blocked by an upstream bug (three.js sessions never present over Horizon Link 208). Retry only after a Horizon Link/Chrome update.
- **Quest Browser route — development history only:** the headset renders itself while opening the PC-served page. The calibration UX was built and hardware-tested there first, but it is **not part of the current working path** and receives no further work.

## First experience

1. Load the hallway scan with its predefined landmarks (A/B in `src/calibration/landmarks.ts`).
2. Start the CALIBRATE screen — from the headset or from the PC operator panel (the SteamVR route has no passthrough, so the operator drives).
3. During the 10-second countdown, place the LEFT remote on real spot A and the RIGHT remote on spot B.
4. The yaw+translation fit is solved from the remotes' tracked positions and applied to the scan root.
5. Walk a short, measured hallway segment with real head movement; re-run CALIBRATE after any boundary/tracking event shifts the world.

The current version uses simplified manual landmark placement (remotes ARE the landmarks). It does not depend on passthrough or automatic room matching — on the SteamVR route calibration runs against a black background with the operator driving from the PC. The stricter probe/held-out-validation protocol in `docs/CALIBRATION.md` remains the target for validation-grade results.

## Read the plan

| File | Purpose |
| --- | --- |
| [Project plan](docs/PROJECT_PLAN.md) | Scope, architecture, milestones, and open inputs |
| [Calibration design](docs/CALIBRATION.md) | Metric scale, landmark capture, transforms, and recovery |
| [Validation protocol](docs/VALIDATION.md) | PC/Quest checks and physical acceptance criteria |
| [GitHub backlog](docs/BACKLOG.md) | Ordered issues with completion criteria |
| [Headset setup](docs/HEADSET_SETUP.md) | Both delivery routes, boundary handling, runtime fixes |
| [Agent rules](AGENTS.md) | Shared instructions for coding agents |
| [Strategy and decisions](ai/strategy.md) | Current state, decisions, and next task |
| [References and attribution](docs/REFERENCES.md) | Source kit and technical evidence |

The agent workflow is adapted from [Photolipsia](https://github.com/leonarda4/photolipsia-agentic-kit). `CLAUDE.md` points to the same rules. Tool accounts, model choices, and permissions remain in the user's existing configuration.

## Repository

The project repository is [leonarda4/calibrated](https://github.com/leonarda4/calibrated). This initial planning pack includes the agent instructions and dotfiles. Private hallway scans and calibration captures are excluded by `.gitignore`; synthetic test assets will be added during implementation.

Run: `npm install`, then `npm run dev` (HTTPS on LAN, port 5173 — the headset route), `npm run dev:http` (plain HTTP on 5174, for bounded browser checks), `npm run check` (type-check), `npm test` (solver tests), `npm run build`. The private scan binary is not in Git — place `hallway.ply` at `public/models/` locally.
