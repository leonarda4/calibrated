# Headset setup (Quest / Horizon OS)

Environment record for the calibrated hallway experience. Last verified 2026-11-02.

## Serving the app

1. PC: `npm run dev` → serves `https://<PC-IP>:5173` (self-signed cert).
2. Headset browser: open `https://<PC-IP>:5173`, accept the certificate warning
   (Advanced → proceed). Wait for `loaded ✓`.
3. The page prefers an **immersive-ar** session (passthrough) and falls back
   to immersive-vr. The status line names the mode that was granted.
4. `Enter VR` starts the session. The green **CALIBRATE** screen appears
   (aim + trigger); it does not start by itself.

## Boundary (guardian) configuration

Recent Horizon OS versions have **no user-facing "off" switch** — leaving the
boundary area pauses the app and switches to system passthrough by design.
The reliable way to disable it is a developer account (procedure adopted
2026-10-29; the existing headset Meta account is sufficient — no new
account):

1. Register as a developer at `developers.meta.com/horizon/sign-up` with the
   SAME Meta account the headset uses.
2. **Verify the account** — the step where most attempts fail. Requires
   either a mobile phone number (SMS 2FA) **or** a credit/debit card
   (PayPal is not accepted). Status: `developers.meta.com/manage/verify`.
3. Create a **developer team** in the Developer Dashboard (Org Manager →
   Select Team → Create). The team name is permanent. Requirements: 18+,
   no device-level restrictions.
4. Enable **Developer Mode**: Meta Horizon phone app → headset → Headset
   Settings → Developer Mode → ON (headset reboots).
5. Disable the boundary — either on-headset (Settings → System → Developer →
   boundary/physical-space features off; availability varies by firmware) or
   via **Meta Quest Developer Hub (MQDH)** on the PC:
   - Install MQDH from `developers.meta.com/downloads/package/meta-quest-developer-hub`
   - Sign in with the developer account
   - Connect the headset with a **USB-C DATA cable** — the cable included in
     the Quest box is charge-only and will NOT work
   - Allow USB debugging in the headset ("Always allow from this computer")
   - Device Manager → Device Actions → **Boundary: OFF** (`Ctrl+Shift+G`)

Safety: with the boundary disabled, nothing prevents walking into real walls
while immersed. Only run boundary-off sessions in a controlled, supervised
environment (per the plan's supervised-trial requirement).

Fallbacks if boundary-off is unavailable at any point:

1. **Use AR passthrough** — in an `immersive-ar` session the "left the
   boundary → app paused" takeover is far less disruptive; the in-headset
   panel prints `environmentBlendMode` to verify
   (`alpha-blend (passthrough ✓)` vs `opaque (VR — no passthrough!)`).
2. **Draw the roomscale boundary beyond the hallway walls** — the walls stop
   you anyway; mind doorways and stairs.
3. **Enlarge the stationary boundary** around the standing position.

The app-level safety net is **manual**: there is no automatic re-anchoring —
the auto-recalibration machinery was removed at the user's request. If the
world shifts after a boundary event, re-place the remotes on spots A/B and
re-run **CALIBRATE**. The old "Settings → Device → Tracking off" trick is NOT
an option — it disables 6DoF tracking entirely.

## Delivery route 2 (PARKED) — PC renders, streams via Meta Link

**Status: parked since 2026-11-02 — upstream presentation bug** (details and
the full measured trace at the end of this section). The accepted PCVR route
is **SteamVR / Steam Link** (next section). The setup below is kept for the
retry after the next Horizon Link / Chrome update.

The headset renders nothing itself; the PC GPU does and Link (Air Link / USB)
streams the picture. Setup:

1. Install the **Meta Quest Link** app on the PC; under Settings → General
   enable **"Set Meta Quest Link as active OpenXR runtime"** (Chrome's WebXR
   goes through OpenXR — without this, "Enter VR" won't appear).
2. Connect the headset: Quick Settings → **Air Link** (or USB cable → Quest
   Link).
3. On the PC open Chrome → `https://localhost:5173` (accept the self-signed
   cert warning once). Add `?scan=ultra` or `?scan=max` — the PC GPU can
   handle the heavy variants.
4. Click **Enter VR** — the session renders on the PC and streams to the
   headset.

Differences vs. the Quest Browser route: no passthrough (desktop Chrome has
no AR over Link — calibration runs against a black background instead of the
camera image), and splat resolution can go up to the 4.25M variant.

## Delivery route 2 — ACCEPTED: PCVR via SteamVR / Steam Link (classic XRWebGLLayer path)

**User-confirmed working 2026-11-02.** This is the primary PC-rendered route:
install Steam + SteamVR on the PC, the "Steam Link" app on the headset, and
set **SteamVR as the active OpenXR runtime**.

Root cause found by the user: three.js (r180 AND current r187) always takes
the WebXR **projection-layer** path when the browser exposes
`XRWebGLBinding` — checked at renderer construction, regardless of requested
features. On desktop Chrome over PCVR this path delivers **no frames**; the
classic `XRWebGLLayer` path works. Fix implemented in `src/xr/enterVR.ts`:

- In classic mode, `XRWebGLBinding` is hidden from the global scope **only
  while the renderer is constructed** (restored immediately, try/finally) —
  three.js then wires the classic path for that renderer.
- Additionally `renderState.layers` is hidden on the session instance
  (own-property proxy, never prototype patching) for three.js versions that
  check it.
- Path selection: classic on desktop by default, projection layers on the
  standalone Quest browser (OculusBrowser UA) where they work and are
  faster. Overrides: `?xrLayers=1` forces layers, `?xrLayers=0` forces
  classic. Diagnostics: `?xrDebug=1` shows GPU, layer path, frame count and
  a 5-second "no XR frames delivered" watchdog on the flat page.
- The WebGL2 context is created by the app (`xrCompatible`,
  `powerPreference: high-performance`, antialias off); the renderer is never
  resized while presenting.

Acceptance test (SteamVR route): install Steam + SteamVR on the PC, "Steam
Link" app on the headset, set SteamVR as active OpenXR runtime, then
`https://localhost:5173/?xrDebug=1` in Chrome → Enter VR → the overlay must
show the `XRWebGLLayer` base layer, frames counting, and the first-frame
time in the console. The Quest browser route must keep working unchanged.

**Hand-tracking takeover on Steam Link (user-verified behaviour):** SteamVR
registers the remotes, but as soon as they are put down on the floor, the
freed hands become tracked and SteamVR switches the inputs to them — the
calibration then reads hand positions instead of the remotes. Two fixes:

1. **System level (recommended):** turn hand tracking OFF in the headset
   settings (Settings → Movement Tracking → Hand Tracking) while using the
   Steam Link route — then SteamVR never sees hands at all.
2. **In-app (built in):** the app buffers each remote's streamed grip
   position every frame; at countdown end the buffered floor spots are used
   (with the hands excluded from the inputs where the runtime allows it).
   Recommended flow regardless: **HOLD both remotes when triggering the
   CALIBRATE button**, place them during the countdown, and keep your hands
   away from where the remotes lie.

**Status 2026-11-02: Link route currently BLOCKED by an upstream bug.**
Measured evidence: `requestSession` resolves after ~66 s, session starts
(blend=opaque), controllers connect — but **three.js content never presents
in the headset** ("Diese Seite reagiert nicht"). Confirmed identical with
the official `threejs.org/examples/webxr_vr_sandbox` sample, with and
without the `--disable-features=XRSandbox` flag. A second Enter VR click
fails with "There is already an active, immersive XRSession" (the session
exists but is not presenting). Community reports (Oct 2026) match: raw-WebGL
WebXR presents over Link, three.js sessions do not; unresolved on Meta's
side in Horizon Link 208. Note: an `OVRServer_x64.exe` crash (0xc0000409)
was also observed in the Windows event log the same day.

Retry the Link route after the next Horizon Link / Chrome update — remove
the XRSandbox flag from the Chrome shortcut first if it was added.
Alternative PCVR runtime if needed earlier: **SteamVR** (install Steam +
SteamVR on the PC, "Steam Link" app on the headset, set SteamVR as active
OpenXR runtime) — historically the more stable Chrome WebXR combination.

**Known behaviour over Link (measured 2026-11-02, Horizon Link 208):**
- `requestSession` takes **~66 seconds** to resolve (Chrome's XR sandbox;
  known Meta/Chromium issue). Click Enter VR **once**, keep the headset ON,
  and wait.
- Do **not** take the headset off during the wait — the proximity sensor
  ends the session.
- After a session ends, the next `requestSession` in the same Chrome run
  often fails ("Something went wrong initializing the session in the
  runtime"). **Restart Chrome** before each new attempt.
- Optional testing flag: launch Chrome with `--disable-features=XRSandbox`
  to cut the wait to ~1 s (disables a Chrome security layer — do not use
  for daily browsing).
- If it fails instantly instead of slowly: check whether `OVRServer_x64.exe`
  crashed (Windows Event Viewer → Application). Restart the Link app and
  reconnect.

**Calibration runs entirely from the PC in this route**: the flat page has a
CALIBRATE button (bottom-left) plus a live status line. The person in the
headset only places the remotes on the markers — the operator clicks
CALIBRATE on the PC, watches the 10-second countdown on screen, and reads
the fit result there. The in-headset HUD mirrors the same instructions.

Networking: prefer Ethernet from the PC to the router, 5 GHz WiFi with clear
line of sight to the headset; if Air Link stutters, test with USB first to
separate network from GPU problems.

## Session start behaviour

Every VR session starts **from the beginning**: the scan sits at its default
transform and the green **CALIBRATE** screen appears (aim + trigger to start;
on the PCVR route the operator clicks the flat-page CALIBRATE button instead).
A page reload always returns the app to this default state. The last
calibration is stored locally as a debugging record only — it is never
applied automatically, and no automatic re-anchoring exists.

## Why the world "shifts" after a boundary event

Crossing the boundary / passthrough takeovers can **redefine the tracking
origin** (`local-floor` origin and yaw are re-derived). This cannot be
prevented from a web app, and the app deliberately has **no automatic
recovery** (the watchdog/auto-recalibration machinery was removed at the
user's request after it produced random recalibrations on hardware).

Procedure after a boundary interruption: return to roughly the same physical
spot and facing as during calibration, re-place the LEFT remote on real spot
A and the RIGHT remote on spot B, and re-run **CALIBRATE**. Fit errors are
shown in-headset and on the flat page, so a bad re-fit is visible.

## Calibration quick reference

The landmark points A and B are **predefined** in
`src/calibration/landmarks.ts` (scan coordinates). To change them at
runtime, press the **EDIT A/B** button on the flat page first — idle clicks
on the scan are ignored and never modify the calibration points. In edit
mode, the 1st scan click sets A, the 2nd sets B (both take effect
immediately for the session and are printed for copying into the
constants); the mode switches itself off after B.

Then in VR the flow is:

| Screen | What happens |
| --- | --- |
| **CALIBRATE** (scan at 50%, camera visible) | aim at the green button, pull the trigger |
| **10-second countdown** | place the **LEFT** remote on real spot A (cyan marker) and the **RIGHT** remote on spot B (orange marker) — on the floor |
| **Result** | remotes are read at 0 s, yaw+translation solved and applied, fit errors shown (~4 s) |

Afterwards only the green **⟲ CALIBRATE** button remains — aim + trigger to
recalibrate (e.g. after the world shifted from leaving the boundary box).
There is no automatic re-arrangement and no squeeze shortcut (the grip
button restart was removed because handling the remotes accidentally
restarted the flow): if the scan shifts after a boundary event, re-place
the remotes and run CALIBRATE again. Fit errors are shown in-headset and
printed on the flat page.

Tips: pick scan points that are easy to reach with a physical remote
(floor/waist-height corners beat ceiling points), keep A and B well
separated, and on the Steam Link route **hold both remotes when triggering
CALIBRATE** and place them during the countdown (hand-takeover buffering,
see above).