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
| Streaming software | **SteamVR / Steam Link — the single active route (user decision 2026-11-03).** Accepted on hardware 2026-11-02. Meta Link tried first and **parked**: three.js sessions never present over Horizon Link 208 (upstream bug); the classic `XRWebGLLayer` path fix (`src/xr/enterVR.ts`) made the SteamVR route work |
| Browser/runtime | Chrome on the PC + **SteamVR as the active OpenXR runtime** — the only working combination; all further work targets this path |
| Scan | Active original `public/splats/hallway3/hallway3_0.ply` (2,109,500 splats), loaded without compression; older exports retained privately; **metric scale still unverified (M2)** |
| Authoring | Agents work directly on the Windows PC (OpenCode + OpenRouter); headset validation runs on the same machine |
| Calibration setup | Restored guided flow: wear the headset with Steam Link connected, wake both controllers, enter VR, then start **CALIBRATE** or pull a controller trigger. Seven seconds to place LEFT/A and RIGHT/B in the same attempt; buffered physical poses handle hand takeover. Hand tracking stays enabled. |

The working path is **PC web app → PC WebXR (Chrome + SteamVR OpenXR) → Steam Link wireless stream → Quest 3**. This is the only route under active development from 2026-11-03 onward.

**Calibration rollback (2026-11-03):** at the user's request, the active flow is restored from local commit `8754817`: HALLWAY PROJECT title, trigger or PC CALIBRATE start, seven-second LEFT/A plus RIGHT/B placement, buffered physical controller poses, CONFIRM fallback and one-second scan reveal. The sequential trigger-hold, pre-headset queued start and two-second redo flow are removed. The headset is worn and Steam Link connected before Enter VR; the wearer can use SteamVR Desktop to access the PC page. Current-frame pose safety and installation invalidation remain. Desktop browser hardware isolation, bounded session-error UI, render quality, voice, hands and movement-boundary work are retained. This rollback needs a new hardware check; earlier route acceptance is not acceptance of the integrated rollback. See [headset setup](HEADSET_SETUP.md).

- **Meta Link route:** parked, upstream presentation bug (Horizon Link 208). Retry after the next Horizon Link/Chrome update; not part of the current work.
- **Quest Browser route (headset renders itself, opens the PC-served URL):** development history — the calibration UX was built and hardware-tested there before the PCVR route worked. Not part of the current working path; kept working as of 2026-11-02 but receives no further feature work.

**Status update 2026-11-02:** stereo + tracked controllers + working calibration demonstrated on hardware via SteamVR/Steam Link (developed on the Quest Browser route first). M0's formal enter/exit cycles and streaming-timing record are still to be captured; see `ai/strategy.md` for the evidence chain.

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

**Installation extension (2026-11-03):** purpose/exploration, education/badge voices, a central physical box with a reach orb, and a smooth four-second 180-degree visual hallway turn. See [INTERACTION_PLAN.md](INTERACTION_PLAN.md) for the implementation and physical gates. The user reports approximately 2.10 m hallway width; the selected scan cross-section supplies the centreline after calibration. The turn intentionally leaves calibrated wall alignment: hands, tracked rig, floor plane and box remain fixed. No wall-contact claim survives that artistic turn without new independent checks.

The supplied real box measures 36 x 36 cm and 43 cm high; the virtual box uses 0.36 x 0.36 x 0.43 metres. Its centre/floor placement and orb reach height still require on-site checks.

Narrative instructions use audio in the headset, with transcripts only on the PC. Missing, muted or blocked audio never enables headset captions. Calibration and interruption/recovery instructions remain in-headset. Voice generation requires only the local API key in the ignored root `.env.local`; see [VOICE_SETUP.md](VOICE_SETUP.md).

PC passthrough is not an MVP dependency. Chromium's Windows AR path is not enabled by default; Meta's browser mixed-reality documentation concerns Quest Browser and does not establish the same features through PC Link. If passthrough becomes essential, evaluate a separate Quest Browser branch and retest its rendering budget. [Chromium support](https://chromium.googlesource.com/chromium/src/+/main/device/vr/), [Meta browser MR](https://developers.meta.com/vr/documentation/web/webxr-mixed-reality/)

## Proposed implementation (as built)

TypeScript ES modules, Vite, Three.js 0.180, with Node's test runner — no UI framework. **Gaussian splat rendering uses `@mkkellogg/gaussian-splats-3d` 0.4.7** (proven working with this project's INRIA-style `.ply` on both routes); Spark from the original proposal remains an unadopted candidate. [Reference package](https://github.com/leonarda4/photolipsia-agentic-kit/blob/49d501e551e4e2a1e2c96af3a95666ac32e97dff/02-splat-viewer/package.json)

The active private export is the original public/splats/hallway3/hallway3_0.ply (143,446,489 bytes, 2,109,500 splats), loaded directly without compression. Empty companion PLYs are ignored; all quality profiles and legacy bookmarks use the original export. The manually adjusted placement in scanAsset.ts is protected: do not modify it without explicit user permission. User-supplied A [2.99, 19.14, -1.41] and B [2.90, 18.16, -1.26] load from calibration/landmarks.ts; EDIT A/B can replace them for a page session. Physical calibration and independent floor, scale and box checks remain required. See [new scan setup](CALIBRATION.md). Source SH is degree 0; the pinned renderer has no supported distance-based LoD. See [RENDER_QUALITY.md](RENDER_QUALITY.md) before a renderer migration or higher-detail claim.

Planned module boundaries, to be created during implementation:

| Area | Responsibility |
| --- | --- |
| `src/viewer/` | Load/dispose splats, desktop inspection, shared content root, rendering quality |
| `src/xr/` | Session lifecycle (`enterVR.ts` classic-layer PCVR fix), reference space, calibration capture input |
| `src/calibration/` | Pure transform math (yaw+translation solver), predefined landmarks |
| `src/ui/` | PC Enter VR/calibration and operator controls, in-headset title/countdown/recovery HUD |
| `src/experience/` | Pure sequence/rotation, fixed installation props, scan-derived placement, lifecycle orchestration |
| `src/audio/` | Local cached voice cues, layered playback and cancellation; offline ElevenLabs generation under `scripts/` |
| ~~`src/storage/`~~ | **Removed at the user's request** with the auto-recalibration machinery — calibration state is per-session; local persistence is a debugging record only |
| `tests/` | Solver, interaction, hand-contact, audio and conversion tests; `npm run check` runs type checking and bounded Playwright desktop checks |

Use a separate desktop inspection camera. In calibrated VR, leave tracked camera/controller parents at identity and apply alignment to the hallway content root. Do not inherit the kit's miniature-scene rig scaling, artificial eye-height offset, or stick locomotion. Draw every XR frame through Three.js's XR-compatible animation loop. Desktop checks remain separate from hardware proof.

## Milestones and completion gates

| Milestone | Deliverable | Gate before proceeding |
| --- | --- | --- |
| **M0 — Runtime proof** | Minimal metre-grid scene on Windows Chrome through wireless Link; environment record | Stereo, head/controller poses, three enter/exit cycles, baseline streaming timing, and restored guided landmark capture demonstrated on hardware |
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
| Opaque VR prevents practical acquisition | Validate the restored marked-floor/controller placement and browser capture controls; evaluate fixtures or passthrough as separate capability experiments if needed |
| Drift or streaming instability grows down the corridor | Shorten the tested segment or improve coverage/tracking conditions; retest before expansion |

## Inputs needed next

Windows version and GPU; actual streaming client; scan file metadata and a measured hallway dimension; hallway length/width and access; recognizable fixed landmarks; repeatable controller placement or probe/fixture, plus assistance for the supervised physical hallway/box trial. Software controls can be accessed from SteamVR Desktop while wearing the headset. These are implementation inputs, not prerequisites for publishing this plan.

The issue order is in [BACKLOG.md](BACKLOG.md). The exact calibration and acceptance procedures are in [CALIBRATION.md](CALIBRATION.md) and [VALIDATION.md](VALIDATION.md).
