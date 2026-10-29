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

The two remotes ARE the physical landmarks (user-specified protocol):

| Step | View | Action |
| --- | --- | --- |
| 1/4 | scan at 70% | aim the ray at **scan point A**, trigger. The LEFT remote will later mark its real-world spot. Sticks move the scan: LEFT = forward/back, RIGHT = left/right + up/down |
| 2/4 | scan at 70% | aim at **scan point B** (right remote represents it), trigger |
| 3/4 | camera / room (scan faded) | **10-second countdown:** put the LEFT remote on real spot A and the RIGHT remote on real spot B |
| 4/4 | done | the remotes' tracked positions are read as the measured points; yaw+translation solves and applies automatically |

After 4/4 the remotes stay as **reference anchors**: a tracking reset
(guardian/passthrough takeover) re-solves the alignment from wherever the
remotes currently are ("AUTO-RECALIBRATED"). If the remotes get moved
(residual > 1 m) the app refuses to auto-apply and asks for manual
recalibration. Fit errors are shown in-headset and printed on the flat page.

Grip button (squeeze) = restart calibration manually.

Tips: pick scan points that are easy to reach with a physical remote
(floor/waist-height corners beat ceiling points), keep A and B well
separated, and leave the remotes undisturbed for as long as the
auto-recalibration should work.

## Tour mode — walk a ~30 m scan inside a small boundary

The scan is much larger than any practical boundary box, so the walkthrough
uses **virtual locomotion**: the MAP moves around the user, never the user's
tracking. The boundary is never left, so no recenter/passthrough takeover is
triggered by touring.

Press **A** (right remote) or **X** (left remote) to switch between
calibration mode and tour mode:

| Input | Action |
| --- | --- |
| Left stick | walk forward/back + strafe |
| Right stick ◄ ► | turn (the map rotates around you) |
| Right stick ▲ ▼ | elevate up/down |
| Hold trigger | auto-walk forward at walking pace |
| Squeeze / A / X | back to calibration mode |

Notes:
- Turning rotates the map about the user's head — the XR rig stays at
  identity, which is why tracking/boundary stay undisturbed.
- The calibration watchdog is paused during tour mode; returning to
  calibration mode re-verifies the remotes within ~2 s.