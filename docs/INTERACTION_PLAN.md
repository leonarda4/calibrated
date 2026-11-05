# Interaction plan

Current flow: every successful live calibration reenables and starts the full narrated game from the beginning. Disabling **Gameplay after calibration** enables manual diagnostics for the current run; the next calibration restores the full game. Delivery remains Windows Chrome -> SteamVR/OpenXR -> Steam Link -> Quest 3. The scan placement in [scanAsset.ts](../src/viewer/scanAsset.ts) is user-adjusted and protected: changing this flow does not change that file or the calibration landmarks.

## Gameplay sequence

Timing starts at the successful fit callback, during the existing one-second scan reveal. The supplied soundtrack begins with Ambience 1. Desktop autoplay gives about 20 s of exploration before Transition 1 and starts the four-second turn 2 s later. Live VR uses the actual headset-above-box trigger after the announcement slot, with the same 2 s musical anticipation. The second box follows actual turn onset by 5 s. See [gameplay flow](GAMEPLAY_FLOW.md) for the complete timing table, automatic/user triggers, transition excerpts and tuneable files.

| Time / trigger | Action and supplied audio |
| --- | --- |
| +0 s | Ambience 1; intermittent exploration footsteps and faint box knocks before Transition 1. |
| +1 s | Welcome to the hallway. |
| +8 s | Reveal first box with a brief moving-box sound and step-on instruction. |
| Desktop +20 s; live eligible headset entry | Transition 1 starts, followed by a latched 2 s countdown. Live entry requires the fully raised first box, five seconds since its prompt and no scheduled/playing first-box speech. Leaving the footprint afterward does not cancel this countdown; STOP/recovery does. |
| Desktop +22 s; live anticipation +2 s | Start the four-second room turn. Transition 1 continues afterward, fading into Ambience 2. |
| Actual turn completion | Play turn commentary. |
| Five seconds after actual turn onset (desktop +27 s) | Reveal second box with its moving-box effect. |
| Second box finishes its 1.5 s rise | Queue `SitDownOnTheBox.wav` once; ask the participant to sit on it. |
| One second after actual turn completion | First box glitches out in place over 0.55 s; its logical pivot stays fixed. |
| Current headset above the fully raised second box, then looking away | Reveal the wall unseen at hallway Z=-8 when entry is clear; retain its existing movement/gaze and player-clearance rules. |
| Actual wall appearance +5 s | Queue `GoBackToTheClassRoom.wav` once. Waiting to sit/look away or paused wall motion does not replace the appearance deadline. |
| Second box settled +4.5 s (desktop about +33 s) | Transition 2 starts, anticipating flicker by 2 s. |
| Second box settled +6.5 s (desktop about +35 s) | One second of light flicker and local effect; hold 30% brightness. Transition 2 fades into Ambience 3 afterward. |
| Wall fully conceals the prepared opening | Glitch the fixed floor opening and connected hallway in over 0.4 s while the wall remains opaque; concealment may occur during approach. |
| Wall endpoint plus 5 s continuous gaze, or a genuine passage through the wall | Glitch the stationary wall away over 0.55 s. The prepared opening keeps its wall-relative position. |
| After Transition 2 finishes, current valid headset above the open fitted hole | Start Transition 3 once; after 2 s, ease the complete visual environment through 90 degrees over 4 s. Hinge on the cutout floor edge so it finishes level, with the corridor horizontal and the tracked viewpoint unchanged. Hold until a valid outward crossing while music continues into Ambience 4. |
| Automatic broom finishes its proximity-triggered glitch out | Once per game, trigger ten semi-random fracture spots, five per side, progressing from far to near at 0.6–1.1 s intervals. Each 1.8 s burst starts its own growing three-second patch of irregular splat/fog disappearance and one supplied rumble excerpt. Preserve the user and full route back; manual Hide does not start the cue. |
| At 90 degrees, cross the vertical opening from inside the cutout toward the original side | Smoothly restore the exact pre-quarter-turn presentation over 4 s about the same hinge. Once automatic collapse has armed the ending, damage at both original hallway ends is visible during this return and further hole entry is blocked. The tracked viewpoint stays fixed. |
| Before the ending return, clear the returned horizontal footprint by 10 cm and reenter | Repeat the 2 s lead and 4 s quarter-turn without replaying the story or Transition 3. |
| Ending return actually completes | Start a new dimension clock at zero. Reverse irregular flicker to full brightness over 1 s with `light_flicker.mp3`, then hold. |
| Ending return endpoint +5 s | Glitch the entire authored environment away over 1 s with the same light-flicker sound. |
| Ending return endpoint +6 s | Hold opaque white. `finishReality` stops previous music, effects and speech and plays the complete 6.710979 s `WhatIsReality.wav` once alone. |

The clock calls the same guarded placement/reveal actions as the buttons. Both box placements are prepared successfully before showing the first box or playing its cue. A scenario placement/action failure stops and disarms the game, with no half-started visible box. Manual action and placement controls wait while the test runs; STOP and Reset remain available. Stalled frames, new calibration, changed scan placement, VR session change or tracking/focus loss cancel further actions and audio. Recovery requires a fresh calibration. Calibration preparation cancels previous audio and effects; each successful live fit starts one new welcome and a zeroed clock regardless of the previous phase or checkbox choice. Disabling the test cancels it and restores manual controls for that run. **Preview gameplay on desktop** resets the visual baseline and runs without granting a physical fit. See [audio setup](VOICE_SETUP.md) for supplied local clips and playback. No speech service or API key is required.

Local audio retains successfully decoded clips but discards failed fetch/decode results so later games can retry. Audio still needs an initial operator gesture. A previously enabled context may resume from suspension with a 500 ms bound; cancellation prevents the pending resume or download from playing an old cue. After the five-second minimum, the live turn also waits for the first-box lead's actual scheduled/playing end, so a delayed audio resume cannot truncate it; pending/failed downloads, suspended audio and mute do not hold the turn. Explicit mute remains in force across recalibration. Missing clips or browser audio permission still require operator attention, and these recovery paths do not establish audible Steam Link delivery.

## Operator sequence

The prop buttons manually trigger the same actions used by gameplay. Wall, broom, second box and floor opening share one calibrated horizontal hallway frame: desktop stations equal world coordinates, while live VR maps them through the current successful fit. The wall defaults from hallway Z=-8 toward the first box's captured station, approximately Z=2.5; the broom uses Z=6. Prepare the hole before player passage, with its near edge 1 m beyond the fixed wall endpoint opposite approach and 2.60 m length farther along that side. Fit both walls once and keep those corners, the cutout and later hinge fixed; player position and crossing direction never relocate them. The actual wall must conceal all four corners before the 0.4 s hole/cutout glitch-in. The second box keeps its prepared station while refitting wall contact. World XYZ can differ after VR calibration. Hide does not save a wall coordinate: default Show manually arms the same unseen instant reveal and fixed route as Run, preview and VR. Set wall position or manual travel/Stop creates a page override honoured by all triggers; Use start position clears it. All paths share fitting, width, gaze/player guards and recovery; the broom remains independently triggered.

Both boxes use the supplied `public/splats/WoodenBox.ply`, preloaded hidden in the hallway's shared renderer. Their source orientation is corrected upright. **Show box** and **Show second box** rise from below their floor over 1.5 seconds with ease in/out; manual **Hide box** and **Hide second box** descend beneath it over the same duration. Both standing bases are on their logical floor anchors with no extra visual lift. The floor clips the submerged splats. Buttons wait for a transition to finish; a hidden or rising first box cannot trigger headset entry. One second after the actual turn completes, the first box automatically glitches out over 0.55 seconds: horizontal bands jitter and chunks disappear at its standing pose, then its scene hides. This automatic exit never lowers the visible box or moves its anchor/pivot. It also runs with manual turns and narration disabled. Explicit Show can restore the box afterward; recovery cancels pending/active effects. The second box follows the current fitted wall at its prepared longitudinal station and stays visible until manual Hide or recovery.

1. Load the hallway scan. For a headset run, enter VR and complete the existing controller calibration first. Desktop use requires neither a headset nor a calibration fit.
2. Click **Show box** in Chrome. The app estimates the hallway centre at the selected cross-section and prepares the hidden second box before showing the first upright **0.36 x 0.36 x 0.43 m** box with its bottom on **local-floor Y = 0**, matching the cyan origin/grid reference. Failed preparation keeps the first box hidden.
3. Review the centering and second-box placement messages. If the first wall fit is weak, use **Pick two floor edges**; their midpoint supplies X/Z on floor Y = 0. To refine the second box's approximate guide, open placement details and choose **Pick second-box floor line**, then click its visible floor line once in the PC view before rotating.
4. Click **Rotate hallway 180°** when ready. The second placement's longitudinal station and physical wall side are prepared before the turn. The visual hallway turns smoothly over **four seconds** around the first box's vertical axis. The first box and tracked camera, hands and controllers remain fixed in their original XR frame.
5. When the turn finishes, click **Show second box**. This separate button refits that station against the current rotated hallway and places one whole footprint edge on the selected fitted wall. In the live narrated test the same action runs five seconds after turn onset; desktop preview uses +27 seconds.
6. **STOP** freezes a turn and invalidates live alignment. **Reset baseline** restores the saved hallway transform. Reset, fresh calibration, stop and session changes clear the prepared/visible second box. Headset use requires fresh calibration after an interruption or operator stop; resetting alone does not restore acceptance.

For the wall mismatch after flipping, open **Flipped hallway wall alignment**. The default is **0 cm**, so the turn adds no sideways shift. Optional positive values shift right when facing down the original hallway; negative values shift left. Apply a number or nudge by 1 cm. The shift eases in during the turn, leaving the original calibrated view and first box fixed. The broom and second box use the corrected hallway's current fitted sections at their explicit stations and follow the correction. The wall fits its whole route once before entry and keeps that trajectory fixed through subsequent corrections; hide/show fits a new route. The hole fits the current walls at its relocated interval when opened, then retains its captured bounds through later corrections. Normal gameplay keeps the wall and second box hidden through the turn. After the turn and narrated test finish, further adjustments preview immediately. **Zero** removes the correction. Mid-turn/STOP/tracking interruptions block edits. Reset restores the original scan transform and retains only the page's chosen draft amount for the next turn. A local shift cannot correct differing hallway widths or wall angles; verify both real walls before treating the reversed view as aligned.

Both wooden-box appearances sit on the floor with no added height offset. Their dimensions remain metric; refitting the second box does not move the first box's trigger volume or pivot.

With the narrated test disabled for the current run, Show box and Show second box remain operator actions. The shown first box still triggers a turn from headset position once its rise finishes; Rotate hallway is also available. Every fresh live calibration restores the full narrated sequence. There is no orb collection or support/placement checkbox. A completed turn requires reset before another turn. Both boxes default to **0.36 x 0.36 x 0.43 m**; the first box's dimensions remain editable, while the second box keeps those fixed dimensions.

## Lights out

The PC **Lights out / Lights on** button fades all scanned hallway/prop colors between normal brightness and the selected dark-mode brightness over 0.65 seconds. The default is **30% brightness**. Use the **Dark-mode brightness** slider from **0% (black)** to **100% (normal)** to choose the manual effect; the percentage appears beside it. While lights are out, adjustments preview immediately. With lights on, adjustments only configure the next manual activation. The browser remembers the manually chosen brightness through refresh and recovery; activation and alignment are never restored from this preference. Lighting is baked into these splats, so the effect multiplies rendered RGB; it does not change opacity, calibration fades, geometry or scan placement. Calibration/recovery instructions and tracked hands retain their normal appearance.

The second box's completed floor rise starts a 6.5-second wait, followed by one second of irregular, diminishing relights and a hold at exactly **30% brightness**. Transition 2 starts 2 s before the flicker, then fades into Ambience 3 afterward. This follows actual settled visibility in both manual and gameplay paths. The original local `public/audio/light_flicker.mp3` remains synchronized with actual flicker; only its first second plays, at 16% gain, with an 80 ms fade-in and 200 ms fade-out. A missing/blocked effect cannot delay the visual cue or play late. Hiding the box before the deadline cancels the pending cue. Manual lighting/brightness commands override the automatic cue for that appearance.

The system control is `hallwayLighting.setLightsOut(true)` / `hallwayLighting.setLightsOut(false)` on the instance created in [main.ts](../src/main.ts); it returns whether the command was accepted. `setLightsOutBrightness(value)` accepts a finite value from 0 to 1 and updates an active preview immediately. Repeated activation commands do not restart a fade, and reversing direction starts from the current brightness. The instance is also available through the existing local `window.__debug.hallwayLighting` hook. There is no controller, hand or direct headset-position lighting binding; the slider supports standard PC keyboard adjustment when focused. The PC operator/system can use it during a turn.

It starts with lights on. Activation waits for scene readiness and, in live XR, a current calibration and visible headset tracking. Turning lights on remains available for recovery. STOP, Reset baseline, calibration preparation, new/ended sessions and tracking/reference-space/focus interruptions immediately restore normal brightness, stop the sound and cancel pending/active fades or flicker; later frames cannot revive that appearance's cue. A genuinely new second-box reveal can arm a fresh cue. The shared shader is prepared before startup readiness, and toggles reuse existing render resources. Headset sound level, stereo appearance and comfort remain separate hardware checks.

## Extracted wall object

**Check wall start** and **Check wall end** show the actual frozen simulation endpoints and hold the wall still without arming gaze disappearance or opening the hole. The paired readout gives bottom-centre positions in current world metres; hallway Z starts at -8 and ends at the first box's captured hallway station, approximately 2.5 with the current profile. The end centre matches the fitted wall-to-wall midpoint at that station. **Run wall sequence** and **Show wall** manually arm the same unseen instant reveal, approach, disappearance and hole placement used in desktop preview and VR. **Hide wall** removes it immediately. Endpoint checks do not author a custom placement. Existing player-clearance and live calibration/tracking guards apply.

Wall route coordinates match desktop world coordinates. A successful live calibration maps them through the session's hallway yaw and horizontal origin, frozen before the artistic turn, so SteamVR's tracking axes cannot swap the approach side. Floor Y stays zero. Player poses and entry/clearance checks use this same route frame; displayed and manually entered XYZ stay in actual world metres. Every new fit replaces the frame, including with narration disabled; recovery still requires fresh calibration.

The hallway and Git LFS tracked uncompressed `public/splats/wall-section/wall-section.ply` load together in one startup batch. The wall stays hidden, its shader is warmed, and operator controls wait for readiness. Gameplay arms the reveal only when a current valid headset is above the fully raised second-box footprint, using the same yaw-aligned upward footprint rule as the first box. Arming latches until the player looks away from the wall's direction and its standing footprint is clear; elapsed time after the turn does not reveal it. **Show wall** and **Run wall sequence** are manual ways to arm that same wait. It then appears instantly at **hallway Z=-8**, without a slide-in, and begins its unseen approach at **1 m/s**. Before reveal, fit five supported sections to lock one straight centreline through the first box's captured hallway station, approximately Z=2.5. Anchor its endpoint at that section's normalized wall-distance midpoint, then size one constant width across both walls and the full slab depth, with 1 cm overlap for scan noise. Heading, width and trajectory remain frozen during motion, waits and later scan corrections. A new reveal or explicit authoring action fits again. Reuse preloaded geometry, textures, material and sorter; unsupported fits leave it hidden and explain the failure.

The wall moves only while the player is **not looking**; there is no watched introductory travel. Looking back permits exactly **0.7 s** before stopping, splitting a frame that crosses that deadline. Looking away resumes movement without catch-up. Gaze uses the current valid XR headset forward ray or desktop inspection camera toward the wall centre in three dimensions: **45 degrees to enter looking, 50 degrees to remain looking**. Missing/invalid gaze blocks movement and resets the continuous-look disappearance dwell. Show/Run, desktop preview and live VR share this state machine.

The supplied local `/audio/SoundFX/RumblingSound02.wav` preloads and loops at **35% gain** during actual wall translation. Motion starts with a **0.2-second fade-in**. On look-back, its fade-out starts immediately and lasts the same **0.7 s** as the movement stopping delay, ending when the wall stops rather than adding a sound tail afterward. Proximity waits, a standing endpoint, invalid/paused frames, Stop and recovery silence it; reset, recalibration and tracking/session interruption cancel pending audio without late playback. It is independent of narration. Wall movement and other effects never stop or duck the active background ambience/transition; the music uses its own continuous media clock and crossfades.

The automatic route has hard hallway bounds from **Z=-8 to the captured first-box station** and only increases Z. Its full-thickness rendered footprint keeps **75 cm** from the current valid headset position, with another **15 cm** required before resuming. This guard overrides gaze permission: constrain every swept step before it crosses the player buffer, using the next point on the fixed line and unchanged wall width. The wall waits on either side and never retreats. The player can deliberately walk through it; a valid head segment through its finite footprint triggers disappearance instead of pushing the player or moving the wall backward. A miss beside the wall, proximity alone, invalid/stale poses or a large pose jump must not count. Appearance waits if the standing footprint is occupied. Desktop preview uses the inspection camera as the player. These head-position visual guards do not certify body clearance or physical collisions.

Open **Wall position & motion** to edit bottom-centre **X/Y/Z in current world metres**, then click **Set wall position**. Its live coordinate appears above the controls. Placement works hidden or visible and never reveals a hidden wall automatically. **Use start position** restores hallway Z=-8. Explicit position/movement/Stop commands override the script and cancel a pending reveal. Manual coordinates last for this page in scan space, so hide/show retains them and a fresh rigid calibration reprojects them. The default sequence uses the fitted route from -8 to the captured first-box station; a deliberate standing override is retained until Use start position clears it. Hide alone never creates an override. These controls grant no alignment acceptance.

**Move forward** travels away from the hallway start; **Move back** travels toward it. Each moves by **Travel** at the selected **Speed**, then stops. **Back & forth** repeats smoothly between plus/minus Travel around its starting point, with Speed as the maximum speed. Defaults are **1 m** and **0.15 m/s**; travel is limited to 10 m and speed to 1 m/s. **Stop motion** freezes the coordinate and makes it the next standing position; Hide also cancels motion. New motion begins from the current location. Reset, calibration, STOP and session/tracking recovery cancel movement and hide the wall without automatic revival. These controls reuse the preloaded wall and leave hallway/rig transforms and both boxes untouched.

The object copies 33,437 original splats from the door-free graffiti wall near raw X = 0.90, Y = 19.75–21.85. This is the densest 2.10 m interval on a 0.10 m search grid within the visually clean wall stretch Y = 16.25–22.75. The wall height is 2.60 m, retaining the continuous scanned wall from raw Z = -1.45 to +1.15, including the upper wall above the horizontal band at +0.95. These are scan-derived dimensions; physical metric validation remains separate. Positions, normals and Gaussian orientation are rotated into a bottom-centred object frame; colour, scale and opacity remain original with no resampling or compression. Recreate the local asset with `npm run scan:extract-wall`; an existing crop requires the explicit `-- --force` option. Source fingerprint and crop evidence are included in the adjacent tracked metadata. Source/crop and placement settings live in [wallSectionConfig.ts](../src/viewer/wallSectionConfig.ts), independently of the protected manual scan placement.

Both outward sides show the good scanned face. A second full-thickness copy is rotated 180 degrees about up and baked into the same asset (66,874 splats total). The two 24 cm slabs have a 2 cm gap, making the authored total depth 50 cm; original Gaussian scales are preserved. Both faces share one scene and bottom-centre coordinate, so every slide, travel command and gameplay animation moves them together. Recreate an older single-face derivative with `npm run scan:extract-wall -- --force`.

The copy shares the hallway's splat sorter so foreground/background blending respects depth. A scene-specific rectangular shader clip confines Gaussian tails to each authored 2.10 by 2.60 m face at its own depth. X scale is set once to span both walls across the fitted route and full slab; height remains 2.60 m and total depth 50 cm. Per-eye inward-face culling prevents the poor reverse side blending through the outward good copy. Both faces move as one object on the frozen line; heading and width remain constant. Tracking axes and first box stay fixed, and source-only centres continue supplying landmarks/prop fits. Reset, calibration, Stop and tracking/session interruption cancel armed reveals and hide the wall; a late turn/box callback cannot revive an interrupted cue. A fresh enabled gameplay sequence after calibration is an explicit new start. This visual obstruction adds no physical collision geometry.

## Scanned broom

The first completed hole quarter-turn starts one automatic encounter per game.
Wait two seconds, then glitch the broom in over 0.55 s at the added corridor's
centre, four metres past its entrance, with its bristles on the newly level
floor. Its placement comes from the frozen mouth, floor side and calibrated
turn frame, including either direction; it does not use the manual Z6 station.
When a current valid headset enters the invisible 36 x 36 cm footprint above
its base while this hallway is upright, latch a two-second delay, then glitch
it out over 0.55 s. Leaving after entry does not change that deadline. The
existing box convention extends the footprint upward for the wearer's head;
there is no rendered trigger mesh. Pitch/return carries the broom with its
hallway; repeated visits preserve its state without replaying it. Close/Hide,
STOP, invalid/stalled frames and recovery cancel pending and active effects.
Only Reset or a new game/calibration rearms the encounter.

The actual first successful glitch-in frame queues the complete supplied
`CLEANTHEROOM.wav` speech. A successful hidden-to-visible manual Show also
requests it. Repeated visible frames, an already shown broom, failed placement
and later visits to the automatic encounter do not replay it. It uses the
existing speech queue, so current lines finish and the background music keeps
its level.

Its actual completed glitch out starts ten fracture spots, five on each side
of the added hallway. A fresh game seed varies heights, wall insets, depths,
patch shapes and 0.6–1.1 s gaps while preserving a far-to-near progression.
The supplied fracture animation lasts 1.8 s per burst. At each onset, its local
area starts losing splats and fog gradually over about three seconds, leaving
irregular cavities and surviving detail between them. There is no uniform
end plane or whole-corridor wipe during this collapse stage. Each actual blast starts one short
`RumblingSound01.wav` excerpt beneath the existing music. These first-trial
values are tunable, not physical clearance guarantees. Preserve the full
opening-to-user corridor prefix: at least 6 m, expanding permanently to the
greatest user depth plus 2 m and, when supplied, optional boundary depth plus
1 m. Protection restores newly approached space and suppresses conflicting
bursts/removal. Boundary data is optional and never gates the fixed fog.
Only the added corridor is affected before the ending return; original scene0
stays intact until that branch. The near area and return aperture/trigger stay
protected. Return pauses the clock while keeping local damage, and earlier
visits do not replay cues. The collapse-armed ending return blocks another
entry. Preloaded source assets and fixed
render buffers/materials/sorter are reused. Close, STOP, reset, recalibration,
tracking/session recovery or invalid/stalled frames cancel the collapse; Reset
or a fresh game rearms it. Hardware appearance and comfort remain untested.

**Show broom** reveals the original local `public/splats/broooooommm.ply`, upright with its bristles on the floor at **hallway Z exactly 6 m**. Its lateral position is the current transformed hallway's fitted centre at that station, so it follows the flipped hallway and its alignment correction. It does not become a turn pivot or change either box placement. **Hide broom** removes it. No box reveal is required first; an unsupported current section leaves the broom hidden and explains the failure.

The 9,676 source splats load hidden with the hallway/wall in a single shared build; toggles do not fetch, rebuild or allocate another sorter. Source rotation and translation preserve the original Gaussian shape and scale, with an approximate centre-to-centre length of 1.46 m. Only hallway scene0 supplies calibration and wall-fit centres. Live XR requires the existing fresh-fit/visible-tracking guard. STOP, reset, calibration preparation and tracking/session interruptions hide the broom. Physical scale, floor contact and alignment remain unverified.

## Floor opening

**Open floor hole** previews the same opening prepared by the wall sequence. Its near edge is **1 m beyond the captured final wall centre opposite approach**, extending another **2.60 m**; increase the offset only if needed to stay beyond the full wall slab plus 5 cm. With the usual final station Z=2.5 this is approximately **Z=-1.1 to 1.5**. Fit both current walls at those stations once, forming a trapezoid if width/centre changes, and freeze its corners before the player passes through the wall. A passage never recaptures the player's position or reverses the opening. Hidden preparation does not remove floor pixels or reveal the connected hallway. While the wall is still opaque, project every fitted aperture corner through its actual full-thickness face from the current valid viewer: all intersections must lie inside the wall rectangle with a small overlap. As soon as that complete concealment holds, glitch the floor and cutout in over **0.4 s**, potentially during approach. Unknown poses, a viewer inside/behind the slab or uncovered corners keep it hidden. No per-frame fitting adjusts the opening. The calibrated frame maps it into VR, floor Y remains zero, and the same captured geometry defines the downward hallway join and later turn hinge. Both boxes stay fixed. Manual **Open floor hole** explicitly previews it; **Close floor hole** restores the scan floor immediately.

**Five continuous seconds looking at the wall after it reaches its final standing position**, or a genuine finite head-segment passage through it at any route position triggers its disappearance. Only valid gaze after actual arrival counts toward those five seconds; looking away or invalid/stalled gaze resets the dwell. The hole has its own earlier concealment-gated reveal, so final gaze and passage do not choose its position or delay its preparation. Freeze the current wall pose and run its **0.55-second sliced jitter/dropout** without an extra opaque hold; retain the already prepared opening and connected hallway afterward. Player/tracking waits and manual Stop are not disappearance triggers. If floor placement fails, retain the opaque wall and report the failure. Manual Show/Run, narrated desktop preview and VR share these rules; static endpoint inspections do not arm them. STOP/reset/calibration/session/tracking recovery and explicit wall overrides cancel effects and close the hole without revival.

The shared splat shader clips floor fragments at those fitted edges, revealing the opaque white void below. The same white background fills scan gaps, disintegrated added-corridor areas and loading/fully faded frames on desktop and in VR, with output alpha 1. It preserves the source scan, side walls and added props; toggling requires no asset reload or shared-renderer rebuild. Opening captures the current corrected hallway walls and freezes those bounds; a fresh reveal can fit again. Live XR uses the existing fresh-calibration/visible-tracking guard. STOP, reset, calibration preparation and tracking/session interruptions close it without automatic reopening. This is a visual effect; physical floor and alignment still require their separate checks.

After the 90-degree turn, return uses the captured opening's rendered vertical trapezoid. The current head segment must cross inside its fitted edges from the cutout interior to the original side, with 8 cm of side hysteresis; a head starting outside must enter the interior first. Proximity, sideways travel outside the aperture and motion caused by the presentation turn cannot count. A valid crossing starts a four-second eased return to the exact presentation before the hole turn, preserving the earlier 180-degree scan turn. Before the collapse-armed ending return, clear the returned horizontal footprint expanded by 10 cm and reenter to repeat the two-second lead and four-second turn. Once the ending return starts, further entry is blocked. The opening/hinge remain frozen, Ambience 4 continues until the final solo ending, and later cycles do not replay Transition 3 or story cues. Prop/source authoring stays locked after the first transition until Reset. Close, STOP, reset, recalibration and tracking/session recovery cancel either direction and clear crossing/reentry history. Desktop and VR use the same geometry; hardware passage and comfort remain untested.

Play `RoomTilting.wav` beneath the music during actual angular movement in
each four-second inward or return leg, including repeated cycles and manual
open-hole mode. Its 0.5–4.5 s source section uses 0.22 supporting gain, a 0.05 s
attack at rendered motion and a 0.08 s release when motion stops. Anticipation
and held poses do not start this effect. Mute,
closing the opening, STOP, reset and tracking/calibration/session recovery
cancel active and pending playback without late revival. Music retains its
independent continuity and recovery behavior.

## Damaged return and ending

Actual automatic broom-completion collapse arms the ending. The existing
physical return trigger and four-second motion stay the same, but both ends
of original scene0 already have organic missing/surviving splats during that
return. Keep at least 4 m along either side of the user, plus the captured
opening and available physical bounds, protected; enlarge that interval as
the user moves in the original hallway. Source geometry and tracked rig stay
fixed. This is the deliberate exception to original-scene preservation.

Actual return completion starts the dimension clock at zero. During the first
second, reverse the earlier irregular lights-out flicker from captured current
brightness to full brightness, with the same `light_flicker.mp3`. Hold until
five seconds from that endpoint, then glitch the entire authored environment
out over one second with that sound. At six seconds, hold opaque white and
call `finishReality` once: stop the ordinary soundtrack, effects, warnings and
queued speech, and play the complete 6.710979 s `WhatIsReality.wav` alone at
normal speed. The global finale intentionally removes the protected area too.
Further hole entry is blocked once this ending return starts. STOP, reset,
close, calibration or tracking/session recovery cancels without late revival;
a fresh game rearms. Rendering and audio scheduling do not establish headset
stereo, registration, audible output or comfort; those checks remain pending.

## Hallway-centre estimate

Primary centring uses independently fitted left/right wall planes and solves equal normalized perpendicular distances at the chosen longitudinal station. The operator panel measures the final rendered box centre and actual turn pivot against those planes; manual off-centre edits therefore show an imbalance. Show box and the Rotate action re-centre the placement. The cyan desktop marker denotes the XR origin before Show box, then follows the box's true floor pivot. Model equality is numerical; scan appearance residuals still limit physical accuracy.

The box's horizontal edges align with the fitted world-space hallway direction. Two-edge placement uses the perpendicular of the picked wall-to-wall vector. A new calibration updates this heading once; box orientation stays fixed while the visual hallway turns. This changes neither the floor centre nor the turn pivot.

The current raw PLY seed is **[2, 21.1, -1.45]**, supplied from the user's screenshot. It locates the cross-section to inspect; it is not a surveyed box point or a measured midpoint of the whole hallway.

The centering operation fits opposing walls using nearby scan splat centres, transforms the estimated midpoint through the current scan root, and places the box base at local-floor Y = 0. Report the fit result on the operator panel. A weak or ambiguous fit leaves the two-floor-edge picker as the explicit fallback. The approximately **2.10 m** hallway width is a physical comparison input, not permission to stretch the scan.

The wall model is an estimate from appearance data. Neither a plausible fit nor a symmetric-looking view certifies physical wall geometry, collision clearance, the runtime's floor estimate, or touch accuracy. Inspect the real box and independent alignment landmarks before a physical run. The manual controls add no extra acceptance checkbox.

## Second-box floor-line guide

The approximate screenshot guide is raw PLY **[2.8, 23.3, -1.45]**. A local wall fit near raw Y = 23.3 and a bounded floor-colour-band check across three strips support a draft seam near **Y = 22.99**, giving the guide **[2.8, 22.99, -1.45]**. This is an appearance-based guide, not a surveyed line or a claim that the seam was detected exactly.

Initial preparation uses the floor-line guide and half the fixed box depth to choose the longitudinal station, approximately hallway-route Z4.57 with the current profile. The current selected wall's inward normal then places the centre one half box width from that plane, and its tangent sets the edge heading. Calibration changes the station's world projection; after the turn the prepared hallway-route Z station and physical wall side are retained while wall contact is refitted. Querying/refitting in this shared frame supports arbitrary live tracking yaw, including 90 degrees; displayed box XYZ and yaw remain world coordinates. The protected scan profile and A/B source points are unchanged.

The optional one-click floor-line picker refines this guide from the desktop before the turn. It requires the loaded scan and an idle/ready/first-box phase. Review its placement message and the real floor/wall before a physical run. Preparation retains the resulting hallway-route Z station and selected physical wall side. After the turn, on reveal and when the alignment offset changes, the second box refits to that side's current wall plane. Its inward normal sets the half-width clearance, and a whole footprint edge lies on the actual fitted plane even for slightly nonparallel walls. An unsupported refit hides the second box. The first box remains the fixed turn pivot throughout. The new virtual chair pose still needs comparison with the real chair next to the real wall.

## Coordinate and lifecycle contract

- Keep one XR unit = one metre, with the tracked camera/controller/hand parents at identity. Apply calibration and the artistic turn to the scan root only. Preserve the user-adjusted scan normalization and the separate A/B landmarks.
- Both boxes remain upright and metric in XR space. Each mesh centre is half its height above its floor contact. The first box alone supplies the turn pivot; preparing or revealing the second box does not change that pivot.
- Save the current calibrated scan transform before the turn. Compute each animated pose from that baseline and the current yaw, keeping the floor level and finishing at exactly 180 degrees without compounding transforms.
- A new fit, scan/start-point change, new session, reference-space reset, focus interruption, missing/emulated viewer tracking, or operator stop removes live alignment authority. Restore the baseline before another calibration. Recovery stays explicit; there is no automatic re-solving or persisted acceptance.
- STOP freezes the current visual pose. Reset is an explicit restoration while the wearer is still under operator guidance. Loss of an unused hand/controller alone does not invalidate hallway alignment.

The 180-degree reversal is an artistic divergence from calibrated alignment. An asymmetric reversed hallway may no longer match its real walls. Independent checks are required before further wall-touch exploration. The first physical box/turn trials remain supervised; desktop screenshots cannot establish spatial accuracy or comfort.

## Existing supporting features

Calibration remains the current title -> controller trigger or CALIBRATE -> seven-second placement -> fit/reveal flow. The committed raw A/B points are **A [2.99, 19.14, -1.41]** and **B [2.90, 18.16, -1.26]**, with LEFT on A and RIGHT on B. This manual interaction change does not edit them. See [calibration](CALIBRATION.md) and [headset setup](HEADSET_SETUP.md).

The desktop **Movement boundaries** panel remains an operator reference: cyan shows a runtime-reported bounded-floor polygon when available, and amber shows a manually configured rectangle. Its local-floor geometry stays outside the scan root, and it does not change the headset's boundary or restrict movement. Unsupported or stale runtime data is labelled accordingly.

Optional WebXR hand tracking and locally bundled generic skinned hands remain available when Steam Link, SteamVR and Chrome expose joint poses. Native Meta system hands are controlled by the headset. The supplied soundtrack and speech are documented in [audio setup](VOICE_SETUP.md). Both manual and gameplay box reveals use the brief moving-box effect; timed prompts and music belong to the gameplay sequence.

Hallway3 continues to load its original Git LFS PLY without compression. Preserve the classic XR layer workaround and existing quality controls. Rendering detail, reconstruction detail and streaming resolution remain separate factors; see [render quality](RENDER_QUALITY.md).

## Validation

Automated checks cover manual transitions and the desktop +1/+8/+20/+22/+27 audio/action clock, repeated live calibration restarts, the full announcement slot before headset entry, hidden preparation and post-turn refitting/reveal across translated calibration yaw, the exact four-second yaw, fixed first-box/tracked parents, wall-adjacent second-box placement, current-section prop alignment, baseline restoration, audio retry/cancellation and interruption invalidation. Run `npm test`, `npm run typecheck`, the bounded desktop `npm run check`, and `npm run build`. Read generated reports and inspect their screenshots.

Physical checks remain separate: verify the estimated/picked cross-section, both box locations and clearance, the second floor-line guide, local-floor height, held-out alignment errors, tracked hands, stereo delivery, the stationary turn, stepping down and streaming performance. No synthetic pose or browser screenshot is hardware acceptance.

Related: [project plan](PROJECT_PLAN.md), [validation protocol](VALIDATION.md), [strategy and decisions](../ai/strategy.md).

## Headset box trigger

The first box is a one-shot trigger while shown in a calibrated live session. Its fixed world-space, yaw-aligned footprint extends upward from its base without a height ceiling: the headset can be inside the box or directly above it. The box must finish rising, and the narrated game waits a full five seconds after its successful reveal action before accepting entry. Sideways proximity and positions below the base do not count. This measures head position, not foot contact or physical support. Only a finite, non-emulated pose from the current visible XR frame can trigger; desktop camera motion cannot. Calibration, tracking/focus loss, STOP and reset keep their existing guards. The trigger uses the shown placement without re-fitting or moving the pivot. The four-second turn retains smoothstep ease-in/out with zero endpoint speed, and the first box and tracked rig remain fixed. Completing a turn cannot retrigger until reset and Show box.
