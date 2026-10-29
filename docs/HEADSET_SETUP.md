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
Meta's developer-account routes (Developer Mode, MQDH, ADB) all require an
account the user cannot create, so the workarounds are:

1. **Use AR passthrough (primary path).** Meta designed mixed reality so the
   boundary is suppressed while passthrough is rendered — in an
   `immersive-ar` session the "left the boundary → app paused" takeover does
   not occur the way it does in VR. The in-headset panel now prints the
   session's `environmentBlendMode` so this is verifiable:
   `alpha-blend (passthrough ✓)` vs `opaque (VR — no passthrough!)`.
2. **Draw the roomscale boundary beyond the hallway walls.** Trace the
   boundary slightly outside the physical walls of the hallway — since the
   walls stop you anyway, you never cross the boundary inside the corridor.
   Mind doorways and stairs.
3. **Enlarge the stationary boundary** (Quick controls → Boundary → adjust
   stationary size) and re-create it where you stand before entering VR.

Notes:
- The old "Settings → Device → Tracking off" trick disables the guardian but
  also switches the headset to 3DoF (world locked to your head) — unusable
  for calibration, which needs full 6DoF head tracking.
- Safety: a boundary that extends beyond the walls means the system will not
  warn you near real obstacles. Only do this in a controlled, supervised
  hallway (per the plan's supervised-trial requirement).

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