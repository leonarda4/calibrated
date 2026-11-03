# Headset setup (Quest 3 / Steam Link)

Current calibration baseline: restored from local commit `8754817` on 2026-11-03 at the user's request. The SteamVR rendering route was user-confirmed on hardware on 2026-11-02; this rollback with the current installation integration still needs a fresh headset check. Desktop results do not establish physical alignment.

## Start the restored calibration flow

The active route remains **PC Chrome -> SteamVR/OpenXR -> Steam Link -> Quest 3**. Keep hand tracking enabled: physical controllers supply calibration landmarks, and real hand joints can supply the later fingertip interaction. The sequential trigger-hold setup has been removed.

1. On the PC, open Steam and SteamVR. Set SteamVR as the active OpenXR runtime.
2. Run `npm.cmd run dev` from the repository's PowerShell terminal and leave it running. In PC Chrome, open `https://localhost:5173/?quality=balanced&format=ksplat&xrDebug=1` and accept the local certificate warning once. Prepared private KSPLAT files must exist; see [render quality](RENDER_QUALITY.md).
3. Put on the headset in the marked setup area and connect Steam Link to the PC. Pick up both controllers and press a button on each to wake them. Keep them in view of the headset. The headset should already be worn and Steam Link connected before requesting VR.
4. Click **Enter VR** on the PC page, or use **Desktop** in SteamVR to click that browser button yourself while wearing the headset. There is no queued setup request or PC-before-wearing start mode.
5. Wait for the scan to finish loading and the headset view to be visible/tracked. The scan is hidden; the **HALLWAY PROJECT** title and floor grid are the calibration view. Confirm the app recognizes both physical controllers.
6. Pull a controller's front/index **trigger once**, or click **CALIBRATE** on the PC page, to start the **seven-second countdown**. During that countdown, place LEFT on the labelled physical mark A and RIGHT on B. Both placements belong to the same capture attempt.
7. At zero, the app fits the scan from the buffered physical controller positions. After a successful fit, the scan fades in over one second while the instructions/grid fade out. Review fit errors and independent physical landmarks before proceeding.

The front curved button beneath the index finger is the trigger. The side button beneath the middle finger is the grip. There is no half-second capture hold, sequential A/B save procedure or two-second redo gesture in this restored flow.

Restarting the dev server or refreshing the page ends the current session. Finish those actions before entering VR again. Chrome needs a user gesture to start an immersive session; the app does not silently reopen a session that the runtime ended. [WebXR session permission requirements](https://www.w3.org/TR/webxr/#immersive-session-allowed)

## Controllers, hand takeover and confirmation

The scan points A/B are predefined in `src/calibration/landmarks.ts`. They must correspond to the labelled physical marks. To edit their scan coordinates before VR, use **EDIT A/B** on the flat page; the first click sets A and the second B. Ordinary clicks do not edit landmarks.

Start while holding both controllers, then place them during the countdown while they remain visible to the headset. The app samples physical controller grips during active XR frames and buffers their positions for that attempt. If hands take over after placement and the controller sources disconnect, their last valid buffered measurements remain available. Hands never become controller landmarks. A missing/emulated pose from a still-connected controller blocks its active capture measurement.

If the countdown ends without both controller measurements, the **WAITING FOR REMOTES / CONFIRM** fallback keeps the fit pending. Wake and hold both controllers where the headset can see them, place LEFT on A and RIGHT on B, then pinch or pull a trigger to confirm. A hand pinch confirms available controller measurements; it cannot supply missing positions. If measurements are still absent, retry the placement instead of treating the hands as controllers. Hand tracking can stay enabled throughout.

The buffer records the last tracked controller positions; it cannot prove that an untracked controller was placed correctly afterward. Fit residuals are a consistency check, not independent physical acceptance. Check the actual placements and held-out landmarks. An invalid fit requires another attempt.

## Interruption and recovery

The SteamVR route has no passthrough. A hidden scan during calibration is expected and a dark canvas does not reveal the physical hallway. Keep the system boundary enabled.

A reference-space reset, viewer-tracking loss or interrupted established headset view cancels capture and invalidates the installation. Once tracking and visibility are restored, use **CALIBRATE** on the PC page, including through SteamVR Desktop if working alone, and repeat the complete seven-second LEFT/A plus RIGHT/B placement. The app never accepts old alignment automatically.

If the VR session actually ends, reconnect Steam Link as needed and click **Enter VR** again on the browser page while wearing the headset. Session end restores desktop scan visibility and keeps recovery instructions on the PC. A fresh session needs fresh calibration and placement checks; there is no queued solo preparation.

If Steam Link says **Online** but Chrome repeatedly refuses VR, the stream connection alone does not establish a working browser session. Fully exit Chrome using its menu's **Exit** command, leave SteamVR ready and Steam Link connected, reopen the viewer and click **Enter VR**. A page refresh can retain Chrome's existing XR service. One compact error reports the failed stage; the exact browser error is under **Technical details**, and repeated attempts replace that message.

Desktop browser checks use `--force-webxr-runtime=no-xr-runtime` plus synthetic XR fixtures, so they cannot replace the live browser's SteamVR registration. This isolation is retained independently of the calibration rollback. See [validation](VALIDATION.md) for what these checks do and do not prove.

To recalibrate after a completed fit, pull a controller trigger to return to the title screen, then pull it again to start the countdown. The PC **CALIBRATE** button starts a new countdown directly. No automatic re-anchoring or saved acceptance returns.

## Start the installation after calibration

The rollback does not change the [installation sequence](INTERACTION_PLAN.md), voice setup, scan rendering or physical placement/start and stationary-support gates. Check the supplied 36 x 36 cm, 43 cm high box, the provisional 2.10 m hallway width, the surveyed centre and independent landmarks. The four-second visual turn and physical step-up/step-down still need supervised physical validation.

The app can render real WebXR hands if Steam Link/Chrome exposes their joints. A hand-like controller profile or pinch-only input cannot authorize fingertip contact. See [voice setup](VOICE_SETUP.md) for local hand models/audio and [render quality](RENDER_QUALITY.md) for scan profiles.

## See movement boundaries on the PC

Open **Movement boundaries** in the desktop page. Cyan shows the play-area polygon reported by the active runtime, when WebXR exposes it. The app requests a separate bounded-floor reference and keeps the working local-floor calibration space unchanged. Before a VR session there is no live runtime boundary to read; unsupported or empty data is reported explicitly.

Amber is an optional manual installation outline. Open **Manual dimensions · metres**, enter its centre/width/depth/floor/rotation, click **Apply manual area**, and tick **Show manual area**. Its initial 2.10 x 2.10 m values are a draft square; the depth has not been measured. The checkbox and fields change only the desktop outline, not SteamVR/Quest settings or physical movement.

The top view updates on the PC during VR with a white live head marker and a grey installation-box marker. Desktop 3D floor outlines are hidden from immersive rendering. A retained cyan outline after session end is labelled a last-session snapshot, with no live head marker; a new session clears it. These diagnostics do not replace the headset's own boundary display or establish a collision-free area. [WebXR boundary geometry](https://www.w3.org/TR/webxr/#xrboundedreferencespace)

## SteamVR classic-layer implementation

The established PC route uses the classic `XRWebGLLayer` path in `src/xr/enterVR.ts`. The user identified that Three.js r180 and r187 otherwise choose projection layers when `XRWebGLBinding` is exposed; those sessions did not deliver frames on the tested PCVR setup.

- In classic mode, `XRWebGLBinding` is hidden only while constructing the renderer and restored immediately with `try/finally`.
- `renderState.layers` is hidden on that session instance where necessary; no global prototype patch is used.
- Desktop defaults to classic. `?xrLayers=0` explicitly selects classic; `?xrLayers=1` forces projection layers for diagnosis. The historical standalone Quest Browser path defaults to layers.
- `?xrDebug=1` shows GPU, layer path, presentation status, frames and the no-frames watchdog on the PC page. The renderer is not resized while presenting.

For runtime acceptance, record stereo, positional tracking, three enter/exit cycles and stream timing separately from desktop evidence. See [validation](VALIDATION.md).

## Historical routes

**Quest Browser:** used to develop and hardware-test earlier calibration iterations before the PCVR route worked. It rendered on the headset from a PC-served HTTPS URL. Its earlier AR/passthrough behavior is development history; use the current Steam Link instructions above.

**Meta Link / Air Link / USB Link:** parked since 2026-11-02 after Horizon Link 208 sessions connected controllers but failed to present Three.js content. The measured attempt took about 66 seconds to resolve `requestSession`; the official Three.js sample showed the same failure. An `OVRServer_x64.exe` crash was also observed. These observations do not describe the current Steam Link route and do not justify switching away from SteamVR during calibration.

Earlier boundary-off experiments, automatic recalibration and watchdog recovery were removed from the active procedure. Current calibration keeps the runtime boundary behavior and requires explicit fresh capture after an interruption.
