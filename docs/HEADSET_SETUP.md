# Headset setup (Quest / Horizon OS)

Environment record for the calibrated hallway experience. Last verified 2026-10-29.

## Serving the app

1. PC: `npm run dev` → serves `https://<PC-IP>:5173` (self-signed cert).
2. Headset browser: open `https://<PC-IP>:5173`, accept the certificate warning
   (Advanced → proceed). Wait for `loaded ✓`.
3. The page prefers an **immersive-ar** session (passthrough) and falls back
   to immersive-vr. The status line names the mode that was granted.
4. `Enter VR` starts the session. The calibration wizard begins automatically.

## Boundary (guardian) configuration

Recent Horizon OS versions have **no user-facing "off" switch** — leaving the
boundary area pauses the app and switches to system passthrough by design.
Options, in order of preference:

1. **Developer Mode + Meta Quest Developer Hub (MQDH):** enable Developer Mode
   in the phone app (needs a free developer organization), install MQDH on the
   PC, connect the headset via USB, then Device Manager → Device Actions →
   toggle **Boundary off** (`Ctrl+Shift+G`). Toggle back on after testing.
2. **On-headset developer settings:** Settings → System → Developer →
   enable Custom Settings → disable Physical Space Features / Boundary.
   Behaviour varies by firmware version.
3. **No developer mode:** Quick controls → Boundary → Switch to Roomscale and
   trace the entire hallway to maximize the area before the passthrough switch.

Safety: with the boundary disabled, nothing prevents walking into real walls
while immersed. Only run boundary-off sessions in a controlled, supervised
environment (per the plan's supervised-trial requirement).

## Why the world "shifts" after a boundary event

Crossing the boundary / passthrough takeovers can **redefine the tracking
origin** (`local-floor` origin and yaw are re-derived). This cannot be
prevented from a web app. The app mitigates it:

- a solved calibration is saved and **restored as a candidate** on re-entry
  (in-headset notice asks you to verify landmarks),
- a reference-space `reset` **mid-wizard clears all captured pairs and
  restarts** the wizard (mixed-frame pairs would corrupt the fit),
- outside the wizard a reset marks alignment **invalid** until recalibrated.

Procedure after a boundary interruption: return to roughly the same physical
spot and facing as during calibration, re-enter, verify the restored
alignment, or squeeze the grip button to recalibrate.

## Calibration quick reference (in-headset panel guides you)

| Step | Action |
| --- | --- |
| 1/4 | Aim the ray at landmark A on the scan, trigger (left stick = fly) |
| 2/4 | Touch the real-world spot A with the controller tip, trigger |
| 3/4 | Aim at landmark B (well separated from A), trigger |
| 4/4 | Touch real spot B, trigger → transform applies, fit error shown |

Grip button (squeeze) = restart calibration. Results are also printed on the
flat page (yaw, translation, fit errors) — record them in the session notes.