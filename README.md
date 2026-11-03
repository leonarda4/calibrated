# Calibrated

A PC-rendered WebXR project for Meta Quest 3: view a Gaussian splat of a hallway while standing in that same hallway, with the virtual walls aligned to the physical walls at real scale.

**Status: implementation running; two delivery routes confirmed on hardware (2026-11-02).**

- **PCVR route (primary):** the PC renders and streams to Quest 3 over Wi-Fi via **SteamVR / Steam Link**. The **Meta Link route is parked** — blocked by an upstream bug (three.js sessions never present over Horizon Link 208; the classic `XRWebGLLayer` path fix in `src/xr/enterVR.ts` made SteamVR work). Chrome runs on the PC with SteamVR as the active OpenXR runtime.
- **Headset-browser route (secondary):** the Quest Browser opens the PC-served HTTPS page and renders on the headset itself. All calibration UX was developed and hardware-tested on this route first.

## First experience

1. Load the hallway scan with its predefined landmarks (A/B in `src/calibration/landmarks.ts`).
2. Start the CALIBRATE screen — from the headset or from the PC operator panel (the PCVR route has no passthrough, so the operator drives).
3. During the 10-second countdown, place the LEFT remote on real spot A and the RIGHT remote on spot B.
4. The yaw+translation fit is solved from the remotes' tracked positions and applied to the scan root.
5. Walk a short, measured hallway segment with real head movement; re-run CALIBRATE after any boundary/tracking event shifts the world.

The current version uses simplified manual landmark placement (remotes ARE the landmarks). It does not depend on automatic room matching; the stricter probe/held-out-validation protocol in `docs/CALIBRATION.md` remains the target for validation-grade results.

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
