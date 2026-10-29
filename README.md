# Calibrated

A PC-rendered WebXR project for Meta Quest 3: view a Gaussian splat of a hallway while standing in that same hallway, with the virtual walls aligned to the physical walls at real scale.

**Status: planning only — no application or headset validation yet.**

The intended setup is a Windows PC streaming wirelessly to Quest 3 over the available local Wi-Fi. Meta Air Link is the provisional transport; the Windows version, GPU, streaming software, and hallway scan details will be recorded before implementation is validated.

## First experience

1. Load the hallway scan and its measured scale/landmarks.
2. Start PC WebXR and remain stationary while an assistant samples labelled physical landmarks with a tracked controller/probe.
3. Align the scan and verify separate checkpoints.
4. Explore a short, measured hallway segment with real walking and head movement.
5. Stop and revalidate whenever tracking or alignment becomes uncertain.

The first version uses manual landmark calibration. It does not depend on passthrough or automatic room recognition. Registration accuracy must be measured in the actual hallway.

## Read the plan

| File | Purpose |
| --- | --- |
| [Project plan](docs/PROJECT_PLAN.md) | Scope, architecture, milestones, and open inputs |
| [Calibration design](docs/CALIBRATION.md) | Metric scale, landmark capture, transforms, and recovery |
| [Validation protocol](docs/VALIDATION.md) | PC/Quest checks and physical acceptance criteria |
| [GitHub backlog](docs/BACKLOG.md) | Ordered issues with completion criteria |
| [Agent rules](AGENTS.md) | Shared instructions for coding agents |
| [Strategy and decisions](ai/strategy.md) | Current state, decisions, and next task |
| [References and attribution](docs/REFERENCES.md) | Source kit and technical evidence |

The agent workflow is adapted from [Photolipsia](https://github.com/leonarda4/photolipsia-agentic-kit). `CLAUDE.md` points to the same rules. Tool accounts, model choices, and permissions remain in the user's existing configuration.

## Repository

The project repository is [leonarda4/calibrated](https://github.com/leonarda4/calibrated). This initial planning pack includes the agent instructions and dotfiles. Private hallway scans and calibration captures are excluded by `.gitignore`; synthetic test assets will be added during implementation.

There are no install/run commands yet. The first implementation task is **M0: prove wireless PC WebXR on the actual Windows PC and Quest 3**.
