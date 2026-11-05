# Calibrated

A PC-rendered WebXR project for Meta Quest 3: view a Gaussian splat of a hallway while standing in that same hallway, with the virtual walls aligned to the physical walls at real scale.

**Status: implementation running. Single active delivery route: SteamVR / Steam Link (user decision 2026-11-03).**

Uncovered world space uses an opaque white background on desktop and in VR,
including loading, scan gaps, floor openings and disintegrated corridor areas.
This changes only the background color; source splats, geometry and tracking
retain their existing behavior.

- **The route — PCVR via SteamVR / Steam Link:** the PC renders and streams to Quest 3 over Wi-Fi. Chrome runs on the PC with **SteamVR as the active OpenXR runtime**, using the classic `XRWebGLLayer` path (fix in `src/xr/enterVR.ts`). **This is the only route the project works on from now on.**
- **Meta Link — parked:** blocked by an upstream bug (three.js sessions never present over Horizon Link 208). Retry only after a Horizon Link/Chrome update.
- **Quest Browser route — development history only:** the headset renders itself while opening the PC-served page. The calibration UX was built and hardware-tested there first, but it is **not part of the current working path** and receives no further work.

## Build and run on another computer

Install **Node.js 22.18 or newer**, Git and [Git LFS](https://git-lfs.com/).
Clone this repository with GitHub Desktop or Git after installing LFS. The four
runtime splats use LFS (about 151 MB total); the supplied soundtrack, voices,
fog/mist density assets, fracture source and hand models are also included.
**No API key or `.env.local` is needed to run or build.**

From the cloned repository folder:

```sh
git lfs install --local
git lfs checkout
npm ci
node scripts/extract-hallway.mjs
node scripts/prepare-fracture.mjs
npm run dev:http
```

Open **http://localhost:5174** in desktop Chrome. The hallway should load and
**Preview gameplay on desktop** works without a headset. Click a page
control to unlock audio. On Windows PowerShell, use `npm.cmd` if `npm.ps1` is
blocked, for example `npm.cmd ci` and `npm.cmd run dev:http`.

`git lfs ls-files` should list four splats. If a PLY is only a small text file
starting with `version https://git-lfs.github.com/spec/v1`, its LFS contents
were not downloaded. Enable/install LFS and use GitHub Desktop to clone the
repository again with its large files. `git lfs checkout` restores contents
already downloaded; it does not download missing objects. Prefer a clone to
GitHub's Download ZIP, whose inclusion of LFS data depends on repository settings.

For the existing SteamVR / Steam Link headset route, use **Windows, PC Chrome,
SteamVR and a connected Quest**, then follow [headset setup](docs/HEADSET_SETUP.md).
`npm run dev` serves the HTTPS variant at **https://localhost:5173** with an
automatically generated local certificate. A desktop build alone does not
establish headset support or physical alignment on a new computer.

```sh
npm run build
npm run preview
```

The production files are written to `dist/`; preview serves them at
**http://localhost:4173**. Dependencies are pinned in `package-lock.json` and
installed by `npm ci`. Tests are optional when building: `npm test` checks logic;
`npm run check` runs the desktop browser checks (requires installed Chrome).
Test source is included; generated `.check/` reports/screenshots, `dist/`,
`node_modules/`, local credentials and calibration captures stay excluded.
Historical exports and the generated hallway cut/fracture derivatives stay local.
The two preparation commands above recreate those required runtime derivatives
from the included original hallway and fracture source on a fresh clone. Run
them before building as well as before the first development startup.
See the [asset inventory](public/splats/README.md) for the exact shared files.

## First experience

1. Load hallway3. Its raw calibration landmarks are A [2.99, 19.14, -1.41] and B [2.90, 18.16, -1.26]; match LEFT to physical A and RIGHT to physical B. **EDIT A/B** is available for an explicit replacement.
2. Wear the headset with Steam Link connected, wake both controllers and click **Enter VR** on the PC page or through SteamVR Desktop. Keep hand tracking enabled.
3. From the HALLWAY PROJECT title, pull a controller's front/index trigger once, or click **CALIBRATE**, to start seven seconds for placing LEFT on marked floor point A and RIGHT on B. Both belong to the same placement attempt; real controller positions are buffered for hand takeover.
4. The yaw+translation fit changes only the scan root. After success the scan fades in over one second; if controller measurements are missing, the CONFIRM prompt explains how to wake, place and confirm them. Hands can confirm available measurements but never supply controller landmarks. See [headset setup](docs/HEADSET_SETUP.md).
5. The gameplay sequence is enabled after each fresh calibration. Ambience 1 starts immediately, welcome plays at +1 s and the first box appears at +8 s with "Try to step on the box." Live headset entry starts Transition 1 after the announcement slot, then the four-second turn begins 2 s later. Desktop autoplay explores for about 20 s, turns at +22 s and shows the second box at +27 s. The supplied local soundtrack and effects replace the earlier generated voices. See [gameplay flow](docs/GAMEPLAY_FLOW.md) and [audio setup](docs/VOICE_SETUP.md). Throughout an active game, ambience or a transition keeps playing underneath wall movement, speech and other effects; a long render frame does not pause that background bed. Explicit Stop/reset/mute and calibration/tracking/session recovery still apply.
6. For manual review, disable the gameplay option after calibration; a new calibration reenables it. Click **Show box** to fit the centre near raw [2, 21.1, -1.45] on **local-floor Y = 0**; use **Pick two floor edges** if the estimate is weak. Before entering VR you can refine the second box guide with **Pick second-box floor line**. Both boxes default to 36 x 36 x 43 cm.
7. In manual mode click **Rotate hallway 180°**, then **Show second box** after the four-second turn. The first box remains the fixed pivot; the second box keeps its prepared world-Z station and physical wall side, with a whole edge refitted 10 cm inward from the current splat wall. Both box bases sit on the floor without extra visual lift. **Preview gameplay on desktop** runs the complete timed test without granting a headset fit.
8. **STOP** freezes the turn and invalidates alignment; **Reset baseline** restores the saved visual pose. Reset, calibration, stop and session changes clear the second box. After a tracking/boundary interruption, recalibrate; after a session end, click **Enter VR** first. Independently check alignment before a supervised physical run.

The Chrome controls also work on the desktop without a headset. Live XR requires a current calibration fit. The narrated test locks individual action/placement controls while running; STOP and Reset remain available. Disabling the test restores manual controls. The second reveal requires a completed turn and prepared placement. SteamVR Desktop provides access to the PC controls while wearing the headset.

At the user's request on 2026-11-03, calibration returns to local commit `8754817`'s guided title/trigger/seven-second placement flow. The sequential hold/queued-start redesign is removed; hand tracking remains enabled. The SteamVR route was accepted on hardware on 2026-11-02, but this rollback with the current installation integration still needs a fresh headset check. SteamVR has no passthrough; physical walking/box/turn validation remains supervised. The stricter probe/held-out-validation protocol in `docs/CALIBRATION.md` remains the target for validation-grade results.

## Read the plan

The desktop **Movement boundaries** panel can show a cyan headset-reported play-area polygon and an amber manual movement rectangle. Runtime data appears only when the active VR session exposes it; the manual draft is enabled through **Show manual area** after setting its measured dimensions. The panel includes a live top view during VR and labelled last-session snapshots. These are desktop references and do not change headset boundary settings. See [headset setup](docs/HEADSET_SETUP.md).

Hallway3 uses the manually adjusted placement in [scanAsset.ts](src/viewer/scanAsset.ts). Do not modify that file without explicit user permission. User-supplied raw PLY landmarks are configured separately in [landmarks.ts](src/calibration/landmarks.ts); their committed defaults survive reload, while EDIT A/B replacements last for the current page session. The box is placed from the local wall-centre estimate or explicit floor-edge picks, remains upright on local-floor Y = 0, and stays fixed during the artistic turn. The raw seed identifies the cross-section to inspect; it does not establish the whole hallway's measured midpoint.

The second box uses the approximate screenshot guide [2.8, 23.3, -1.45], a local wall fit and a draft floor-colour seam near raw Y = 22.99. This appearance-based guide chooses the longitudinal station and physical wall side, not a surveyed seam. The box refits its lateral position and heading to maintain a 10 cm gap from the current selected wall after the turn, at reveal and after alignment-offset changes. **Flipped hallway wall alignment** defaults to **0 cm**, with no sideways correction during the turn. Optional manual values blend during the turn; positive is right facing down the original hallway. The broom, opening and second box follow current corrected sections while the first box/rig stay fixed. The moving wall fits its whole route before entry and then keeps that trajectory fixed. See the [interaction plan](docs/INTERACTION_PLAN.md) for placement review.

| File | Purpose |
| --- | --- |
| [Project plan](docs/PROJECT_PLAN.md) | Scope, architecture, milestones, and open inputs |
| [Interaction plan](docs/INTERACTION_PLAN.md) | Narrated test and manual box / turn / seat controls, placement and recovery |
| [Gameplay audio and hands](docs/VOICE_SETUP.md) | Supplied local soundtrack, playback and WebXR hand capability |
| [Gameplay flow](docs/GAMEPLAY_FLOW.md) | Phase timers, automatic/user triggers, sound mapping and tuning |
| [Render quality](docs/RENDER_QUALITY.md) | Source-detail audit and current rendering quality controls |
| [Calibration design](docs/CALIBRATION.md) | Metric scale, landmark capture, transforms, and recovery |
| [Validation protocol](docs/VALIDATION.md) | PC/Quest checks and physical acceptance criteria |
| [GitHub backlog](docs/BACKLOG.md) | Ordered issues with completion criteria |
| [Headset setup](docs/HEADSET_SETUP.md) | Both delivery routes, boundary handling, runtime fixes |
| [Agent rules](AGENTS.md) | Shared instructions for coding agents |
| [Strategy and decisions](ai/strategy.md) | Current state, decisions, and next task |
| [Process history](private/process-history/README.md) | User-approved conversations, screenshots, participant recordings, gallery and standalone summary |
| [References and attribution](docs/REFERENCES.md) | Source kit and technical evidence |

The agent workflow is adapted from [Photolipsia](https://github.com/leonarda4/photolipsia-agentic-kit). `CLAUDE.md` points to the same rules. Tool accounts, model choices, and permissions remain in the user's existing configuration.

**Show wall / Hide wall** controls a separate door-free graffiti wall with the good face on both sides. It preloads hidden with the hallway; appearance and Hide are instant, without side slides. In gameplay, a valid headset inside the wall-to-wall, floor-to-ceiling 2 m hallway section centred on the fully raised second box arms the wall, and it stays hidden until look-away or five continuous seconds watching its spawn direction, with the standing footprint clear. It appears at **hallway Z=-8** and immediately moves unseen at **1 m/s**, toward the first box's captured hallway station, approximately **Z=2.5**, centred between the fitted scan walls. Looking back permits exactly **0.7 s** before stopping; the rumbling sound fades out during those same 0.7 s and fades in over **0.2 s** when motion starts. **Five continuous seconds looking at its final standing position**, or a genuine player passage through it at any route position, starts the stationary **0.55-second glitch disappearance**. Show/Run, desktop preview and VR share the route and gaze model; endpoint inspection buttons hold it still. Current valid headset direction or the desktop camera supplies gaze, with a 45-degree cone to begin looking and 50-degree retention. The fixed trajectory, width and heading never refit during movement. Its 75 cm player buffer and 15 cm release margin take precedence; the wall never retreats or catches up, while the player can walk through this visual object. **Wall position & motion** retains deliberate XYZ and motion overrides. The original-resolution PLY is included through Git LFS and can be recreated with `npm run scan:extract-wall`; see the [interaction plan](docs/INTERACTION_PLAN.md). Reset, recalibration and interruption cancel the sequence and sound.

**Show broom / Hide broom** reveals the supplied scanned straw broom, bristles-down at the current fitted hallway centre and floor Y, with **hallway Z=6 m**. Its local asset preloads hidden in the shared renderer. **Open floor hole / Close floor hole** uses the same wall-to-wall opening as the wall sequence. Prepare its near edge **1 m beyond the wall's captured final position**, opposite the approach direction, and extend it **2.60 m**. This position is fixed before the player passes; passage never moves it to the player. Once the actual opaque wall completely conceals all four fitted corners, the floor opening and connected downward hallway glitch in over **0.4 s**, possibly before final arrival. They remain fixed when the wall later disappears after final gaze or passage. Floor Y stays zero, both boxes keep their positions, and the captured corners also define the later turn hinge. Reset, calibration and tracking/session interruptions hide the broom and close the opening.

## Repository

The project repository is [leonarda4/calibrated](https://github.com/leonarda4/calibrated). This initial planning pack includes the agent instructions and dotfiles. Private hallway scans and calibration captures are excluded by `.gitignore`; synthetic test assets will be added during implementation.

Run: `npm install`, then `npm run dev` (HTTPS, port 5173; open on PC Chrome for Steam Link). Use `npm run typecheck`, `npm test`, `npm run check` (bounded Chrome checks and report/screenshots), and `npm run build`. On Windows PowerShell with script execution disabled, use `npm.cmd`. The browser checks use installed Chrome, start/stop their own local server on an available port, and disable hot reload. Private scan binaries are not in Git. The active asset is the original `public/splats/hallway3/hallway3_0.ply`, loaded directly without compression. Empty `_1`/`_2`/`_3` files are unused. Old `scan=std|high|ultra|max` and `format=ksplat` bookmarks still load the new original PLY.

Desktop browser checks launch with `--force-webxr-runtime=no-xr-runtime` and synthetic XR fixtures to avoid replacing the live Chrome application's SteamVR registration. This isolation and the compact session-error display with expandable technical details are retained independently of the calibration rollback.

The operator panel provides **Show box**, **Rotate hallway 180°**, **Show second box**, STOP, baseline reset and collapsed placement details. The approximately 2.10 m hallway width is a comparison input; it does not stretch the scan. Check both real box placements and independent alignment before a physical run. For detailed rendering use `https://localhost:5173/?quality=detail`; this still loads the original PLY. The supplied soundtrack requires no speech service or credentials; see [audio setup](docs/VOICE_SETUP.md). The 180-degree turn intentionally changes wall alignment and requires independent physical checks before further wall touch.
