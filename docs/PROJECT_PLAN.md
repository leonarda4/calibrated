# Project plan

Planning baseline: 2026-10-29. Working name: **Calibrated**.

## Outcome

A person wearing Quest 3 in a real hallway sees that hallway's Gaussian splat at the same position, orientation, and scale. Their physical head movement produces corresponding movement through the scan. Calibration aligns the scan to the current tracking space; it does not modify the headset's tracking system or the person's IPD/eye settings.

The first deliverable is a supervised, repeatable demonstration in one measured **3–5 metre segment**, adjusted to the actual hallway. Extending to the entire hallway requires new measurements over the larger area.

## Confirmed and provisional setup

| Item | Decision/status |
| --- | --- |
| Headset | Meta Quest 3 |
| Rendering computer | Windows PC confirmed; OS version, GPU, driver, and RAM pending |
| Transport | Wireless streaming over strong local Wi-Fi confirmed |
| Streaming software | Meta Air Link proposed; user has not named a particular client |
| Browser/runtime | Chrome + Meta's active OpenXR runtime proposed; must pass M0 |
| Scan | One hallway; file, format, size, scan quality, and metric scale pending |
| Authoring | This Mac can prepare code/docs; PC XR validation runs on Windows |
| Calibration assistance | Assistant/operator and repeatable controller probe or fixture required for first trial |

The intended path is **PC web app → PC WebXR/OpenXR → wireless Link stream → Quest 3**. Opening a PC-hosted URL in Quest Browser would render on the headset and is a separate deployment option.

Chromium documents Windows OpenXR VR support, and Meta documents Windows Link support with Quest 3. Their combination is a candidate stack, not proof that this particular machine works. Verify it before committing to the rest of the build. [Chromium support](https://chromium.googlesource.com/chromium/src/+/main/device/vr/), [Meta Link](https://developers.meta.com/vr/documentation/unity/unity-link/)

Recommend Ethernet from the PC to the access point where available, with a clear wireless path to the hallway. Record actual transport latency and interruptions along the route. Strong Wi-Fi signal alone does not establish streaming performance. A USB connection is an optional diagnostic fallback, not a requirement for this project's intended experience. [Meta support's Air Link guidance](https://communityforums.atmeta.com/discussions/OtherTroubleshooting/3s-air-link-not-working/1345035/replies/1345046)

## MVP scope

- One local hallway scan, one headset, one user at a time.
- Desktop inspection and operator controls; stereo immersive VR with tracked controllers.
- Scan preparation with metric scale, floor/up orientation, landmark definitions, and an asset fingerprint.
- Guided landmark capture, alignment, and independent validation with visible error values.
- Physical movement only during the calibrated experience.
- Save/export local calibration reports; revalidate after interruptions or new sessions.
- Measured rendering and wireless performance in the hallway.

Later work: automatic registration, persistent spatial anchors, passthrough overlays, multiple users/headsets, larger buildings, native applications, and remote asset hosting. No backend/account system is needed for the MVP.

PC passthrough is not an MVP dependency. Chromium's Windows AR path is not enabled by default; Meta's browser mixed-reality documentation concerns Quest Browser and does not establish the same features through PC Link. If passthrough becomes essential, evaluate a separate Quest Browser branch and retest its rendering budget. [Chromium support](https://chromium.googlesource.com/chromium/src/+/main/device/vr/), [Meta browser MR](https://developers.meta.com/vr/documentation/web/webxr-mixed-reality/)

## Proposed implementation

Use plain JavaScript ES modules, Vite, Three.js, and Spark, with Node's test runner and Playwright. This follows the source kit without introducing a UI framework. At M0, verify and pin a compatible dependency set and commit its lockfile; the reference kit uses Spark 2.4.0 and Three.js 0.186.1, which are starting candidates, not a tested combination for this project. [Reference package](https://github.com/leonarda4/photolipsia-agentic-kit/blob/49d501e551e4e2a1e2c96af3a95666ac32e97dff/02-splat-viewer/package.json)

Spark supplies Gaussian splat rendering inside Three.js. Start with a tiny synthetic splat, then one verified hallway format, preferably the original `.ply` or `.spz` if available. Add LoD/compressed streaming only if measured asset size and performance require it. [Spark documentation](https://sparkjs.dev/docs/)

Planned module boundaries, to be created during implementation:

| Area | Responsibility |
| --- | --- |
| `src/viewer/` | Load/dispose splats, desktop inspection, shared content root, rendering quality |
| `src/xr/` | Session lifecycle, reference space, input poses, stop/recovery events |
| `src/calibration/` | Pure transform math, sample quality, fit/validation, state machine |
| `src/ui/` | Operator wizard, in-headset status, progress/errors, stop action |
| `src/storage/` | Versioned asset/probe/profile metadata and local report export |
| `tests/` + `scripts/` | Synthetic math fixtures, browser checks, report/screenshot harness |

Use a separate desktop inspection camera. In calibrated VR, leave tracked camera/controller parents at identity and apply alignment to the hallway content root. Do not inherit the kit's miniature-scene rig scaling, artificial eye-height offset, or stick locomotion. Draw every XR frame through Three.js's XR-compatible animation loop. Desktop checks remain separate from hardware proof.

## Milestones and completion gates

| Milestone | Deliverable | Gate before proceeding |
| --- | --- | --- |
| **M0 — Runtime proof** | Minimal metre-grid scene on Windows Chrome through wireless Link; environment record | Stereo, head/controller poses, three enter/exit cycles, baseline streaming timing, and assisted landmark capture demonstrated on hardware |
| **M1 — Viewer** | Local splat loading, desktop inspection, XR rendering, error handling, browser-check harness | Synthetic asset passes automated/visual checks and renders correctly in both eyes; full hallway loads or has a documented asset-budget blocker |
| **M2 — Metric hallway** | Normalization transform, measured dimensions, 4–6 fit landmarks and 3+ validation landmarks | Length/width/height checks agree within the selected error budget; no unresolved deformation or ambiguous landmark definitions |
| **M3 — Calibration** | Probe capture, deterministic fit, held-out errors, state-gated aligned mode | Synthetic tests pass and three fresh physical calibrations meet the feasibility targets in the validation protocol |
| **M4 — Recovery** | Stop/invalidation, local profiles, schema validation, explicit revalidation | Reset, tracking/focus loss, session restart, changed assets/probe, and reconnect cannot silently restore verified status |
| **M5 — Hallway pilot** | Tuned scan budget, wireless benchmark, supervised short-route report | Five-minute trial, start/end physical checkpoints, and frame/streaming targets pass for the documented area |

M2 measurements can run alongside M1 development. M3 needs M0 input proof and M2 data. M5 needs all earlier gates. Dates follow availability of the PC, scan, and hallway; avoid promising a delivery date before M0.

## Decisions that could change the plan

| Finding | Response |
| --- | --- |
| PC/browser cannot start a stable session | Resolve runtime/GPU/transport first; keep calibration math independent of runtime |
| Scan has local distortion | Reconstruct/crop the asset or reduce tested extent; a global transform cannot repair it |
| Controller landmark samples are too noisy | Improve probe/fixture, sample procedure, and tracking visibility before tuning the solver |
| Opaque VR prevents practical acquisition | Use assistant-operated capture; evaluate passthrough only as a separate capability experiment |
| Drift or streaming instability grows down the corridor | Shorten the tested segment or improve coverage/tracking conditions; retest before expansion |

## Inputs needed next

Windows version and GPU; actual streaming client; scan file metadata and a measured hallway dimension; hallway length/width and access; recognizable fixed landmarks; availability of an assistant and a repeatable probe/fixture. These are implementation inputs, not prerequisites for publishing this plan.

The issue order is in [BACKLOG.md](BACKLOG.md). The exact calibration and acceptance procedures are in [CALIBRATION.md](CALIBRATION.md) and [VALIDATION.md](VALIDATION.md).
