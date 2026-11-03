# Calibrated

A PC-rendered WebXR project for Meta Quest 3: view a Gaussian splat of a hallway while standing in that same hallway, with the virtual walls aligned to the physical walls at real scale.

**Status: implementation running. Single active delivery route: SteamVR / Steam Link (user decision 2026-11-03).**

- **The route — PCVR via SteamVR / Steam Link:** the PC renders and streams to Quest 3 over Wi-Fi. Chrome runs on the PC with **SteamVR as the active OpenXR runtime**, using the classic `XRWebGLLayer` path (fix in `src/xr/enterVR.ts`). **This is the only route the project works on from now on.**
- **Meta Link — parked:** blocked by an upstream bug (three.js sessions never present over Horizon Link 208). Retry only after a Horizon Link/Chrome update.
- **Quest Browser route — development history only:** the headset renders itself while opening the PC-served page. The calibration UX was built and hardware-tested there first, but it is **not part of the current working path** and receives no further work.

## First experience

1. Load hallway3, then use **EDIT A/B** on the desktop to select its paired physical floor landmarks. The new export has no preconfigured A/B.
2. Wear the headset with Steam Link connected, wake both controllers and click **Enter VR** on the PC page or through SteamVR Desktop. Keep hand tracking enabled.
3. From the HALLWAY PROJECT title, pull a controller's front/index trigger once, or click **CALIBRATE**, to start seven seconds for placing LEFT on marked floor point A and RIGHT on B. Both belong to the same placement attempt; real controller positions are buffered for hand takeover.
4. The yaw+translation fit changes only the scan root. After success the scan fades in over one second; if controller measurements are missing, the CONFIRM prompt explains how to wake, place and confirm them. Hands can confirm available measurements but never supply controller landmarks. See [headset setup](docs/HEADSET_SETUP.md).
5. Independently check alignment before the supervised hallway trial. After a tracking/boundary interruption, repeat CALIBRATE from the browser page; after a real session end, click **Enter VR** first. SteamVR Desktop provides access while wearing the headset.

At the user's request on 2026-11-03, calibration returns to local commit `8754817`'s guided title/trigger/seven-second placement flow. The sequential hold/queued-start redesign is removed; hand tracking remains enabled. The SteamVR route was accepted on hardware on 2026-11-02, but this rollback with the current installation integration still needs a fresh headset check. SteamVR has no passthrough; physical walking/box/turn validation remains supervised. The stricter probe/held-out-validation protocol in `docs/CALIBRATION.md` remains the target for validation-grade results.

## Read the plan

The desktop **Movement boundaries** panel can show a cyan headset-reported play-area polygon and an amber manual movement rectangle. Runtime data appears only when the active VR session exposes it; the manual draft is enabled through **Show manual area** after setting its measured dimensions. The panel includes a live top view during VR and labelled last-session snapshots. These are desktop references and do not change headset boundary settings. See [headset setup](docs/HEADSET_SETUP.md).

Hallway3 uses the manually adjusted placement in [scanAsset.ts](src/viewer/scanAsset.ts). Do not modify that file without explicit user permission. User-supplied raw PLY landmarks are configured separately in [landmarks.ts](src/calibration/landmarks.ts): A [2.99, 19.14, -1.41], B [2.90, 18.16, -1.26]. Match LEFT to physical A and RIGHT to physical B. These defaults survive reload; EDIT A/B replacements last for the current page session. The 36 x 36 x 43 cm box follows the configured raw anchor and calibration, remains upright and stays fixed during the artistic turn. Physical start still requires a fresh fit and placement check.

| File | Purpose |
| --- | --- |
| [Project plan](docs/PROJECT_PLAN.md) | Scope, architecture, milestones, and open inputs |
| [Interaction plan](docs/INTERACTION_PLAN.md) | Purpose/badge/box sequence, four-second visual turn, placement and physical gates |
| [Voices and hands](docs/VOICE_SETUP.md) | Offline ElevenLabs setup, local whisper mix, WebXR hand capability |
| [Render quality](docs/RENDER_QUALITY.md) | Source-detail audit, quality profiles, private compressed scan preparation |
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

Run: `npm install`, then `npm run dev` (HTTPS, port 5173; open on PC Chrome for Steam Link). Use `npm run typecheck`, `npm test`, `npm run check` (bounded Chrome checks and report/screenshots), and `npm run build`. On Windows PowerShell with script execution disabled, use `npm.cmd`. The browser checks use installed Chrome and start/stop their own local server on 5175. Private scan binaries are not in Git. The active asset is the original `public/splats/hallway3/hallway3_0.ply`, loaded directly without compression. Empty `_1`/`_2`/`_3` files are unused. Old `scan=std|high|ultra|max` and `format=ksplat` bookmarks still load the new original PLY.

Desktop browser checks launch with `--force-webxr-runtime=no-xr-runtime` and synthetic XR fixtures to avoid replacing the live Chrome application's SteamVR registration. This isolation and the compact session-error display with expandable technical details are retained independently of the calibration rollback.

The installation operator panel supports a desktop preview, measured placement, scan-picked centreline, STOP and manual reset. Approximately 2.10 m hallway width and the supplied 36 x 36 cm, 43 cm high box are prefilled; placement and reach height remain drafts. After a fit, check physical placement and independent alignment before **Start in headset**. **Desktop preview** grants no calibration authority. For detailed rendering use `https://localhost:5173/?quality=detail`; this still loads the original PLY. Generate local voice clips using the ignored credential setup in [VOICE_SETUP.md](docs/VOICE_SETUP.md); credentials never enter browser code. The 180-degree turn intentionally changes wall alignment and requires physical review before further wall touch.
