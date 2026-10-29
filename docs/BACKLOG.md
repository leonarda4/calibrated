# Initial GitHub backlog

Create these as issues after publishing the planning repository. They are drafted here; no remote issues have been created. Hardware validation stays open until someone records evidence from the PC, headset, and hallway.

| ID / issue title | Depends on | Completion criteria |
| --- | --- | --- |
| **01 — Prove wireless PC WebXR on Quest 3** | Hardware available | M0 protocol completed; environment and feature matrix recorded; assisted pose capture demonstrated; any blockers explicit |
| **02 — Add the viewer and bounded browser checks** | 01 runtime decision | Pin Vite/Three/Spark/tooling; synthetic splat and desktop inspection; loading failures; tests/check/build; inspected report/screenshot; both-eye hardware check |
| **03 — Prepare the hallway's metric asset manifest** | Scan + measurements | Original preserved; normalization and asset fingerprint; length/width/height checks; 4–6 fit + 3+ held-out landmarks; documented segment and uncertainty |
| **04 — Implement pure registration and validation math** | 03 coordinate contract | Yaw/translation solver; fit/held-out errors; geometry rejection; deterministic synthetic tests; no camera or XR rig manipulation |
| **05 — Build controller-probe capture and operator wizard** | 01, 03 | Repeatable probe offset; select/capture/recapture flow; valid stationary samples; quality feedback; assisted physical acquisition tested |
| **06 — Integrate calibration and verified mode** | 02, 04, 05 | Shared content transform; separate checkpoint stage; no artificial movement; three fresh calibrations meet feasibility targets |
| **07 — Add stop, recovery, and local profiles** | 06 | Versioned storage; mismatches rejected; reset/tracking/session interruptions invalidate; fresh revalidation needed; recovery tests pass |
| **08 — Tune scan rendering and wireless delivery** | 02, 03, 07 | Measure full asset; adjust quality/LoD as needed; report frame, compositor, and streaming metrics for chosen settings |
| **09 — Run and document the hallway pilot** | 01–08 | Five-minute supervised trial; start/end/held-out measurements; explicit tested extent, result, and remaining limitations |

Issues 03 and 04 can progress alongside viewer work once their inputs are available. A failed runtime gate does not prevent offline measurement or math work, but it prevents calling the PC experience complete.

## Agent responsibilities

These are working roles, not required separate bots or paid services. One coding agent can perform them sequentially; parallel agents should own distinct files and share the coordinate contract.

| Role | Responsibility |
| --- | --- |
| Coordinator | Maintain `ai/strategy.md`, dependencies between issues, scope, and integration |
| Rendering/XR | Viewer, device lifecycle, performance, runtime probe |
| Calibration | Asset conventions, probe math, solver, independent error metrics |
| Validation reviewer | Challenge assumptions, review tests/state transitions, and distinguish simulated from physical evidence |
| Human operator | PC/headset setup, hallway measurements, probe/fixture handling, physical trial and observations |

Every handoff includes changed files, coordinate/data assumptions, checks actually run, remaining hardware checks, and the next action. Follow [AGENTS.md](../AGENTS.md); don't duplicate decisions into competing memory files.

## First implementation prompt

```text
Read AGENTS.md and ai/strategy.md. Implement issue 01's minimal runtime
probe for Windows Chrome and wireless Quest 3 streaming. Use the agreed
metric coordinate contract and record the exact runtime assumptions.
Run the desktop checks you can perform. Provide the human-run hardware
procedure and keep hardware outcomes NOT TESTED until evidence exists.
Update the strategy with the result and next step.
```

For each issue, record **problem, scope, dependencies, acceptance criteria, evidence, and next action**. Keep application implementation out of the initial planning commit.
