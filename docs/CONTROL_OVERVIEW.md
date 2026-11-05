# Interaction control overview

Delays are relative to the named event. Footprint triggers track the headset, not sitting or foot contact.

## Main flow

| Trigger | Action |
| --- | --- |
| **Enter VR** → front trigger or **CALIBRATE** | **7 s** to place LEFT controller on A, RIGHT on B. |
| Both calibration measurements acquired | Reveal hallway; start gameplay/Ambience 1. Missing data: trigger/pinch to CONFIRM; **3 failures or 30 s** returns to READY. |
| Successful calibration **+1 s** | “Welcome to the hallway.” |
| Calibration **+8 s** | First box rises **1.5 s**; moving-box sound; “Try to step on the box.” |
| Headset above raised first box; prompt at least **5 s** old and speech finished | Transition 1 → **2 s** lead → **180° turn over 4 s**. |
| 180° turn completes | Turn commentary; **1 s later**, first box glitches away over **0.55 s**. |
| Turn onset **+5 s** | Second box rises **1.5 s**, **10 cm inward from its wall**, with moving-box sound. |
| Second box finishes rising | Queue “Sit down on the box.” |
| Second box settled **+4.5 s / +6.5 s** | Transition 2 / **1 s** light flicker → **30% brightness**. |
| Enter the **2 m-long section centred on the raised second box**, wall-to-wall and floor-to-ceiling | Arm immediately. Look away OR watch the spawn direction continuously for **5 s** → wall appears at **Z = −8**, if clear, and starts moving. |
| Actual wall appearance **+5 s** | Queue “Go back to the classroom.” |
| Wall unseen | Move toward first-box station (**Z ≈ 2.5**) at **1 m/s**, with rumbling. |
| Look back / look away | Stop after **0.7 s** / resume. Player buffer: **75 cm**, plus **15 cm** to resume. |
| Wall hides all four hole corners | Opening/connected hallway glitch in over **0.4 s**. |
| **5 s continuous gaze after wall arrival**, OR pass through wall | Wall glitches away over **0.55 s**. Look away resets gaze timer. |
| Headset above open hole; Transition 2 finished | Transition 3 → **2 s** lead → **90° turn over 4 s**, with tilt sound. |
| First 90° turn completes **+2 s** | Broom glitches in **0.55 s**, **4 m** inside; “Clean the room” at reveal onset. |
| Headset enters the **2 m × 2 m area centred on the broom**; hallway fully upright | **2 s** delay → **0.55 s** glitch out. Leaving does not cancel. |
| Automatic broom disappears | **10 fractures**, five/side, far to near; **0.6–1.1 s** spacing, **1.8 s** bursts/rumble, **3 s** local disappearance, then **8 s** uneven island fade. Protect user/return route. |
| Cross vertical opening outward toward original hallway | **4 s** return with tilt sound; fracture progress pauses. After automatic collapse arms the ending, both original ends already appear damaged during return; protect user **±4 m** longitudinally, opening and available bounds. |
| Before the ending return, clear returned hole footprint by **10 cm**, then reenter | **2 s** lead → **4 s** inward turn; no replayed broom/story/Transition 3. Further entry is blocked once the ending return starts. |
| Ending return completes | Start time zero: **1 s** reverse irregular relight to full brightness, with the same light-flicker sound. |
| Ending return endpoint **+5 to +6 s** | Glitch **all authored content** away over **1 s**, intentionally removing the protected area too; same light-flicker sound. |
| Ending return endpoint **+6 s** | Opaque white. Stop prior audio and play full **6.710979 s** `WhatIsReality.wav` once alone. |
| No earlier return arrival: last explosion animation ends **+5 s**, OR user gets **within 1 m inside the live far-end headset boundary** | Start the same **1 s** global glitch/light sound immediately, then white and the full solo final voice. Side/return edges and stale/manual outlines cannot trigger it. First ending wins; viewpoint stays fixed and VR stays active. |

## Ongoing triggers

| Trigger / condition | Action |
| --- | --- |
| Exploration before Transition 1 | Random footsteps and faint box knocks. |
| Music | **Ambience 1 → T1 → Ambience 2 → T2 → Ambience 3 → T3 → Ambience 4**; continues under speech/effects until the final solo ending. |
| Approach either hallway-end headset edge in its **inside 0–0.5 m** strip | Priority danger voice; side edges/outside stay silent. Leaving the strip cancels speech; **0.75 m** retreat rearms, **8 s** cooldown. Requires live headset bounds and the calibrated hallway direction. |
| Hallways visible, including turns | Half-height fog and full-height mist at added-hallway depth **5–33 m**; original hallway has no mist. |

Ordinary speech queues; boundary warnings take priority. The final solo ending
stops both. Before its return, damage affects only the added hallway; the
ending deliberately extends it to both original ends. STOP/reset/calibration/
tracking recovery cancels the ending; a fresh game rearms. Hardware acceptance
remains pending.

## Operator controls

| Control | Use |
| --- | --- |
| **ENABLE AUDIO / Mute / PREVIEW SPEECH** | Enable, mute or audition sound. |
| **Gameplay after calibration** | Disable for manual checks; fresh calibration reenables. |
| **Preview gameplay on desktop** | T1 **+20 s**, turn **+22 s**, second box **+27 s**; camera drives later triggers. |
| **Show / Hide boxes**, **Rotate hallway 180°** | Manual reveal/turn; Hide lowers boxes into floor. |
| **Show / Hide wall**, **Run wall sequence** | Arm the same look-away / **5 s** reveal, or hide/cancel. |
| **Check wall start/end**, **Wall position & motion** | Static inspection; XYZ, start position, forward/back, loop, stop. |
| **Open / Close floor hole**, **Show / Hide broom** | Manual inspection; broom Show queues cleaning voice, Hide does not trigger fractures. |
| **Lights out/on**, brightness; **Flipped hallway wall alignment**; **Mist** visibility/strength | Manual lighting, optional lateral correction (**0 cm default**) and atmosphere overrides. |
| **STOP / Reset baseline** | Cancel run/disarm alignment / restore pre-turn scene; live play needs recalibration. |
| Tracking/focus/reference interruption | Cancel run; restored view → front trigger or **CALIBRATE**. Ended session → **Enter VR** first. |

Details: [gameplay flow](GAMEPLAY_FLOW.md), [interaction plan](INTERACTION_PLAN.md), [calibration](CALIBRATION.md).
