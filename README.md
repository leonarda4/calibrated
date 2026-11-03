# Calibrated

A PC-rendered WebXR project for Meta Quest 3: view a Gaussian splat of a hallway while standing in that same hallway, with the virtual walls aligned to the physical walls at real scale.

**Status: implementation running. Single active delivery route: SteamVR / Steam Link (user decision 2026-11-03).**

- **The route — PCVR via SteamVR / Steam Link:** the PC renders and streams to Quest 3 over Wi-Fi. Chrome runs on the PC with **SteamVR as the active OpenXR runtime**, using the classic `XRWebGLLayer` path (fix in `src/xr/enterVR.ts`). **This is the only route the project works on from now on.**
- **Meta Link — parked:** blocked by an upstream bug (three.js sessions never present over Horizon Link 208). Retry only after a Horizon Link/Chrome update.
- **Quest Browser route — development history only:** the headset renders itself while opening the PC-served page. The calibration UX was built and hardware-tested there first, but it is **not part of the current working path** and receives no further work.

## First experience

1. Load hallway3. Its raw calibration landmarks are A [2.99, 19.14, -1.41] and B [2.90, 18.16, -1.26]; match LEFT to physical A and RIGHT to physical B. **EDIT A/B** is available for an explicit replacement.
2. Wear the headset with Steam Link connected, wake both controllers and click **Enter VR** on the PC page or through SteamVR Desktop. Keep hand tracking enabled.
3. From the HALLWAY PROJECT title, pull a controller's front/index trigger once, or click **CALIBRATE**, to start seven seconds for placing LEFT on marked floor point A and RIGHT on B. Both belong to the same placement attempt; real controller positions are buffered for hand takeover.
4. The yaw+translation fit changes only the scan root. After success the scan fades in over one second; if controller measurements are missing, the CONFIRM prompt explains how to wake, place and confirm them. Hands can confirm available measurements but never supply controller landmarks. See [headset setup](docs/HEADSET_SETUP.md).
5. **Narrated test after calibration** is enabled by default. It welcomes you immediately, shows the first box at +10 seconds, starts the four-second hallway turn at +15 seconds and reveals the second box at +20 seconds. Each action has its requested ElevenLabs narration; generate the four local clips first using [voice setup](docs/VOICE_SETUP.md).
6. For manual review, disable that option before calibration. Click **Show box** to fit the centre near raw [2, 21.1, -1.45] on **local-floor Y = 0**; use **Pick two floor edges** if the estimate is weak. Before entering VR you can refine the second box's guide with **Pick second-box floor line**. Both boxes default to 36 x 36 x 43 cm.
7. In manual mode click **Rotate hallway 180°**, then **Show second box** after the four-second turn. Both boxes remain fixed through the turn; reveal uses the second box's original world pose. **Preview narrated test on desktop** runs the complete timed test without granting a headset fit.
8. **STOP** freezes the turn and invalidates alignment; **Reset baseline** restores the saved visual pose. Reset, calibration, stop and session changes clear the second box. After a tracking/boundary interruption, recalibrate; after a session end, click **Enter VR** first. Independently check alignment before a supervised physical run.

The Chrome controls also work on the desktop without a headset. Live XR requires a current calibration fit. The narrated test locks individual action/placement controls while running; STOP and Reset remain available. Disabling the test restores manual controls. The second reveal requires a completed turn and prepared placement. SteamVR Desktop provides access to the PC controls while wearing the headset.

At the user's request on 2026-11-03, calibration returns to local commit `8754817`'s guided title/trigger/seven-second placement flow. The sequential hold/queued-start redesign is removed; hand tracking remains enabled. The SteamVR route was accepted on hardware on 2026-11-02, but this rollback with the current installation integration still needs a fresh headset check. SteamVR has no passthrough; physical walking/box/turn validation remains supervised. The stricter probe/held-out-validation protocol in `docs/CALIBRATION.md` remains the target for validation-grade results.

## Read the plan

The desktop **Movement boundaries** panel can show a cyan headset-reported play-area polygon and an amber manual movement rectangle. Runtime data appears only when the active VR session exposes it; the manual draft is enabled through **Show manual area** after setting its measured dimensions. The panel includes a live top view during VR and labelled last-session snapshots. These are desktop references and do not change headset boundary settings. See [headset setup](docs/HEADSET_SETUP.md).

Hallway3 uses the manually adjusted placement in [scanAsset.ts](src/viewer/scanAsset.ts). Do not modify that file without explicit user permission. User-supplied raw PLY landmarks are configured separately in [landmarks.ts](src/calibration/landmarks.ts); their committed defaults survive reload, while EDIT A/B replacements last for the current page session. The box is placed from the local wall-centre estimate or explicit floor-edge picks, remains upright on local-floor Y = 0, and stays fixed during the artistic turn. The raw seed identifies the cross-section to inspect; it does not establish the whole hallway's measured midpoint.

The second box uses the approximate screenshot guide [2.8, 23.3, -1.45], a local wall fit and a draft floor-colour seam near raw Y = 22.99. This appearance-based guide is not a surveyed or exact automatically detected seam. The helper offsets the centre inward and away from the door by half a box width/depth. See the [interaction plan](docs/INTERACTION_PLAN.md) for guide coordinates and placement review.

| File | Purpose |
| --- | --- |
| [Project plan](docs/PROJECT_PLAN.md) | Scope, architecture, milestones, and open inputs |
| [Interaction plan](docs/INTERACTION_PLAN.md) | Narrated test and manual box / turn / seat controls, placement and recovery |
| [Voices and hands](docs/VOICE_SETUP.md) | Offline ElevenLabs setup, timed narration and WebXR hand capability |
| [Render quality](docs/RENDER_QUALITY.md) | Source-detail audit and current rendering quality controls |
| [Calibration design](docs/CALIBRATION.md) | Metric scale, landmark capture, transforms, and recovery |
| [Validation protocol](docs/VALIDATION.md) | PC/Quest checks and physical acceptance criteria |
| [GitHub backlog](docs/BACKLOG.md) | Ordered issues with completion criteria |
| [Headset setup](docs/HEADSET_SETUP.md) | Both delivery routes, boundary handling, runtime fixes |
| [Agent rules](AGENTS.md) | Shared instructions for coding agents |
| [Strategy and decisions](ai/strategy.md) | Current state, decisions, and next task |
| [References and attribution](docs/REFERENCES.md) | Source kit and technical evidence |

The agent workflow is adapted from [Photolipsia](https://github.com/leonarda4/photolipsia-agentic-kit). `CLAUDE.md` points to the same rules. Tool accounts, model choices, and permissions remain in the user's existing configuration.

**Show wall / Hide wall** reveals a separate door-free graffiti wall across the passage: 2.10 m wide and the scan's 2.60 m wall height. The private original-resolution PLY is prepared with `npm run scan:extract-wall`; see the [interaction plan](docs/INTERACTION_PLAN.md) for source selection, placement and recovery. Reset and recalibration hide it.

## Repository

The project repository is [leonarda4/calibrated](https://github.com/leonarda4/calibrated). This initial planning pack includes the agent instructions and dotfiles. Private hallway scans and calibration captures are excluded by `.gitignore`; synthetic test assets will be added during implementation.

Run: `npm install`, then `npm run dev` (HTTPS, port 5173; open on PC Chrome for Steam Link). Use `npm run typecheck`, `npm test`, `npm run check` (bounded Chrome checks and report/screenshots), and `npm run build`. On Windows PowerShell with script execution disabled, use `npm.cmd`. The browser checks use installed Chrome, start/stop their own local server on an available port, and disable hot reload. Private scan binaries are not in Git. The active asset is the original `public/splats/hallway3/hallway3_0.ply`, loaded directly without compression. Empty `_1`/`_2`/`_3` files are unused. Old `scan=std|high|ultra|max` and `format=ksplat` bookmarks still load the new original PLY.

Desktop browser checks launch with `--force-webxr-runtime=no-xr-runtime` and synthetic XR fixtures to avoid replacing the live Chrome application's SteamVR registration. This isolation and the compact session-error display with expandable technical details are retained independently of the calibration rollback.

The operator panel provides **Show box**, **Rotate hallway 180°**, **Show second box**, STOP, baseline reset and collapsed placement details. The approximately 2.10 m hallway width is a comparison input; it does not stretch the scan. Check both real box placements and independent alignment before a physical run. For detailed rendering use `https://localhost:5173/?quality=detail`; this still loads the original PLY. Existing voice-generation tools remain documented in [VOICE_SETUP.md](docs/VOICE_SETUP.md), with credentials kept outside browser code. The 180-degree turn intentionally changes wall alignment and requires independent physical checks before further wall touch.
