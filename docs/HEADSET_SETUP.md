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

The app-level safety net is independent of the boundary setting: the remotes
act as reference anchors and the watchdog re-solves the alignment whenever
the tracking origin is redefined. The old "Settings → Device → Tracking off"
trick is NOT an option — it disables 6DoF tracking entirely.

## Session start behaviour

Every VR session starts **from the beginning**: the scan sits at its default
transform and the calibration wizard opens at step 1/4. A page reload always
returns the app to this default state. The last calibration is stored
locally as a debugging record only — it is never applied automatically.

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

With remotes armed as references this is automatic: within ~1.5 s of resuming
(faster right after entering) the app re-solves from the remotes and glides
the correction in over ~0.5 s ("REALIGNING…" → "AUTO-RECALIBRATED"). A second
correction is rate-limited to one per 5 s — this is a loop guard, not a
delay; the first correction itself is immediate. Corrections larger than
3 m or 45° are refused (that means the remotes moved, not the tracking
origin) and the references are marked invalid until the remotes are
re-placed.

## Calibration quick reference

The landmark points A and B are **predefined** in
`src/calibration/landmarks.ts` (scan coordinates). Define them once with the
desktop picker: click on the scan in the PC browser — 1st click prints
point A, 2nd point B, further clicks alternate — and copy the printed
coordinates into the constants.

Then in VR the flow is placement-only:

| View | Action |
| --- | --- |
| scan with markers **A** (cyan) and **B** (orange) | put the **LEFT** remote on real spot A, the **RIGHT** remote on spot B |
| HUD (sticks to your view) | pull the trigger → solved and applied, fit errors shown |

The instruction HUD is parented to the camera, so it never drifts or hides
behind the scan. After calibration the message fades after ~4 s and only the
green **⟲ CALIBRATE** button remains — aim at it + trigger to recalibrate
(e.g. after the world shifted from leaving the boundary box). There is no
automatic re-arrangement: if the scan shifts after a boundary event,
re-place the remotes and pull the trigger again.

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