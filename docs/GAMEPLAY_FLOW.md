# Gameplay flow and audio draft

The soundtrack uses the supplied local WAV files. A fresh successful live calibration starts a new game; the desktop preview runs the same authored sequence with a timed first turn. The times below are the initial draft, measured from the successful fit or desktop-preview start. User-dependent phases can take longer. Once audio is enabled, an active unmuted game has ambience or a transition underneath wall movement, speech and other effects until the final white ending deliberately replaces every layer with one solo recording. Native media loops and crossfades continue over long render frames; desktop visual clocks freeze those stalled frames instead of cancelling the soundtrack. The outgoing bed stays audible until its incoming replacement actually starts. Explicit Stop/reset/mute and calibration/tracking/session recovery retain their cancellation authority.

## Phase timeline

| Phase | Desktop autoplay time | Live trigger | What happens and estimated duration |
| --- | --- | --- | --- |
| Hallway exploration | 0–20 s | Automatic after the fit | Ambience 1 starts. At +1 s, play “Welcome to the hallway.” Occasional footsteps and faint box knocks sit over the music until Transition 1. |
| First box | +8 s | Automatic | Reveal the prepared first box with a short box-moving effect and “Try to step on the box.” Its rise takes 1.5 s. Reserve at least 5 s after the prompt before accepting the live box trigger; scheduled/playing speech can extend that wait. |
| First transition anticipation | +20 s | A valid headset enters or is above the fully raised first-box footprint after the prompt slot | Crossfade Ambience 1 into Transition 1. Entry latches the 2 s countdown before the visible turn; leaving the footprint afterward does not undo it. STOP or tracking/calibration recovery still cancels it. Live exploration therefore lasts at least the prompt slot and as long as the participant needs; autoplay uses about 20 s. |
| Room turns 180° | +22–26 s | Automatic after anticipation | The scan turns over 4 s around the fixed first box. The tracked rig and first box stay fixed. Transition 1 uses a 9 s excerpt, from +20 to +29 s; Ambience 2 fades in from about +27.8 s. Play the turn commentary after the turn completes. |
| Second box | +27 s | Automatic, 5 s after actual turn onset | Reveal the second box 10 cm inward from its wall with another short moving-box effect. Its rise takes 1.5 s. A delayed live turn shifts its reveal with it. |
| Sit instruction | Second-box rise completion; desktop about +28.5 s | Actual fully appeared second box | Queue the complete `SitDownOnTheBox.wav` recording once, asking the participant to sit. Earlier turn speech finishes naturally. Manual Show uses the same completed-rise hook. |
| Wall appearance | Player-dependent, after the second box has fully risen | Enter the 2 m-long hallway section centred on the second box, spanning the fitted walls and floor-to-ceiling height | Arm immediately; reveal at hallway Z=-8 on look-away or after 5 continuous seconds watching its spawn direction, with no slide-in. Player entry clearance still takes priority. Begin the existing approach, including its 0.7 s watched stopping allowance. Manual Show/Run share this gate. |
| Classroom instruction | Actual wall appearance +5 s | Successful reveal, independent of subsequent motion/gaze pauses | Request `GoBackToTheClassRoom.wav` once. Sitting/arming, look-away waiting, blocked entry and endpoint inspection do not start this clock. Speech queues rather than truncating an earlier recording. Wall cancellation and recovery clear the deadline. |
| Second transition anticipation | About +33 s | Automatic, 4.5 s after the second box finishes rising | Crossfade into a 6 s excerpt of Transition 2, anticipating the flicker by 2 s. |
| Lights flicker | About +35–36 s | Automatic, 6.5 s after the second box finishes rising | Flicker for 1 s with the light sound, then hold at 30% brightness. Transition 2 continues afterward; Ambience 3 fades in from about +37.8 s and is fully in place at +39 s. |
| Wall approach | Variable; about 10.5 s of translation for the default 10.5 m route, plus waits | Move while unseen; looking back allows exactly 0.7 s before stopping | Travel at 1 m/s from hallway Z=-8 toward the first box's captured station, approximately Z=2.5, centred between fitted walls. No watched introductory travel. The trajectory, heading and width stay fixed; player clearance overrides motion and no waiting budget accumulates. Rumbling fades in over 0.2 s and fades out during the same 0.7 s look-back delay. |
| Hole prepares and reveals behind the wall | During approach, before player passage | The actual opaque wall conceals all four prepared aperture corners | Prepare its near edge 1 m beyond the captured final wall endpoint opposite approach, extend 2.60 m and freeze both fitted wall edges. Once the actual opaque wall conceals all four aperture corners from the current valid viewer, glitch the floor and connected hallway in over 0.4 s. The opening is independent of player position and crossing direction. Ambience or the current transition keeps playing. |
| Wall disappearance | Player-dependent | After final arrival, look continuously for 5 s; or genuinely pass through the finite wall footprint at any route position | Prearrival looking does not count. Freeze and glitch the wall away over 0.55 s while retaining the prepared opening and cutout join. Looking away resets the final dwell. Passage never relocates the hole. The current ambience/transition continues. |
| Third transition anticipation | Variable | After Transition 2 finishes, a current valid headset is above the open hole's actual fitted footprint | Start a 7 s excerpt of Transition 3 once. After its 2 s anticipation, begin the four-second visual world turn. |
| World turns into the cutout | Entry +2 to +6 s | Automatic after anticipation | Ease the entire authored environment through 90 degrees about the cutout's floor edge. Play `RoomTilting.wav` over the music only while the rendered environment actually rotates. Its floor finishes on the real floor, ceiling above it and depth horizontal; the tracked viewpoint stays fixed. Hold the exact final pose until a valid outward crossing. |
| Broom appears in the added hallway | First quarter-turn completion +2 s | Once per game | Glitch the preloaded broom in over 0.55 s, centred four metres beyond this entrance with bristles on its floor. Its actual successful reveal queues the complete `CLEANTHEROOM.wav` speech on the first glitch-in frame. Later returns/reentries preserve its state rather than replaying it. |
| Broom disappears | Proximity entry +2 s | Current valid headset above its invisible 2 m x 2 m footprint, while the added hallway is fully upright | Latch the delay at entry, then glitch out over 0.55 s. Leaving the footprint does not reset the countdown. No visible trigger mesh or additional story/music cue is added. |
| Distant side-wall fractures | Actual broom glitch-out completion | Once per game, after the broom is fully gone | Trigger ten seeded semi-random spots, five per side, progressing from far to near at 0.6–1.1 s intervals. Each supplied fracture plays for 1.8 s with one `RumblingSound01.wav` excerpt. Manual Hide does not trigger them. |
| Added hallway disintegrates locally | Each individual blast onset | That site's local damage starts with its blast | Grow an irregular three-dimensional patch of splat/fog loss over about 3 s per site. Uneven cavities and surviving Gaussian detail replace a uniform end plane. Affect only the added corridor until the ending return; preserve the current user area and route back to the opening. |
| Return through the vertical opening | Variable | Current head motion crosses the fitted vertical aperture from inside the cutout toward the original side | Smoothly undo the quarter-turn over 4 s about the same captured hinge, restoring the exact pre-quarter-turn presentation. `RoomTilting.wav` follows this actual return motion. Once automatic collapse has armed the ending, both original hallway ends already appear damaged during this return, and further hole entry is blocked. |
| Repeat the hole turn before the ending return | Variable | Return before automatic collapse is armed, clear the horizontal footprint by 10 cm, then enter it again | Repeat the 2 s anticipation and 4 s quarter-turn. Preserve the captured opening and hinge without replaying Transition 3 or story cues. |
| Original dimension relights | Ending return endpoint +0 to +1 s | Actual completed return after automatic collapse | Start the dimension clock at zero. Reverse the irregular lighting flicker from current brightness to full brightness over 1 s, using `light_flicker.mp3`, then hold. |
| Entire environment glitches out | Ending return endpoint +5 to +6 s | Five full seconds in the restored original dimension | Glitch all authored content away over 1 s with the same light-flicker sound. This finale intentionally removes the previously protected surroundings too. |
| White ending and final voice | Ending return endpoint +6 s | Global glitch completes | Hold opaque white and call `finishReality` once: stop every previous music, effect and speech layer and play the complete 6.710979 s `WhatIsReality.wav` alone. |
| Fallback ending without return | Last explosion ends +5 s, OR within 1 m inside the live far-end headset boundary | After automatic collapse, unless original return arrival won first | Glitch globally over 1 s with the light sound, then opaque white and the same full solo voice once. Keep the current viewpoint and VR session; exclude side/return edges and stale/manual bounds. |
| Fourth ambience | After the first Transition 3 | Automatic | Crossfade into looping Ambience 4 through walking and return, until the final solo ending replaces it. Movement comes from physical head/body motion; no camera translation or scale change is added. |

Small frame-boundary differences are expected. Timers follow actual reveal/turn completion rather than assuming a real participant reaches every trigger on the desktop schedule. A frame pause longer than 0.5 s cancels the active timed sequence instead of catching up several physical events at once.

The hole turn is also available in manual open-hole mode without a running
soundtrack, using the same two-second lead and four-second motion. During a
running game it retains the Transition 2 completion gate. Entry uses the current
valid headset position projected into the fitted hole, or the desktop camera
outside XR; it does not claim to measure a foot contact. Once accepted, leaving
the footprint does not restart or reverse an active turn. Quintic easing has
zero velocity and acceleration at both endpoints. The floor-side hinge stays
fixed, so the new floor finishes at runtime floor height without moving the
camera. At 90 degrees the former floor opening is a vertical trapezoid. A swept
head segment must pass through its fitted edges from cutout interior to the
original side, with 8 cm of clearance on each side of the plane, to start the
four-second return. Starting outside requires entering the interior before
an outward crossing can qualify. Sideways travel outside the aperture and
standing near it do not count. Pose history is cleared at turn endpoints and
on interruption, so the rotating environment cannot trigger its own return.
Before the collapse-armed ending return, leave the returned horizontal footprint
expanded by 10 cm and reenter to start another two-second lead and four-second
turn. The return restores the presentation before the hole turn, including the
earlier 180-degree scan turn; it does not reset the game or replay its story/music.
Ambience 4 continues until the final solo ending. Once the ending return starts,
further entry is blocked; the physical crossing trigger itself is unchanged.
The opening and hinge remain captured, and prop/source edits require Reset
after the first hole turn. Close, STOP, reset, recalibration or tracking/session
recovery cancels either direction, restores the presentation baseline and
clears crossing/reentry history. A fresh calibration starts a new full game.

Check wall start/end, Run wall sequence, Show, desktop preview and VR share the frozen route from -8 to the first box's captured hallway station, approximately Z=2.5. Anchor the straight line at that section's fitted wall-distance midpoint and size its constant width across both walls and full slab depth. Endpoint checks are static; Show/Run manually arm the unseen instant reveal. Capture hole geometry once from passage position/direction or the wall-relative fallback, with its near edge 1 m beyond that selected origin and 2.60 m length farther along the chosen direction. Its walls, connected cutout and later hinge stay frozen, and neither box moves.

## Distant added-hallway collapse

Missing splats and exposed void show the same opaque white world background as
the floor opening and loading/faded scan frames. This color change preserves
the local damage pattern, surviving splats, fog behavior and protected return.

The collapse clock starts only after the automatic broom finishes its actual
0.55 s glitch out. Ten spots give five on each side, with a fresh per-game seed
varying wall insets, heights, depths, patch shapes and 0.6–1.1 s intervals.
The order moves from the far crop toward the protected near area. Each 1.8 s
burst immediately starts that site's loss at zero strength, growing irregular
local cavities over about three seconds. Some Gaussians disappear while others
remain at the same depths, including asymmetric floor/ceiling remnants. After
the last patch matures, those islands dissolve unevenly over another eight
seconds until the distant corridor is white void. The near transition stays
ragged; protection below overrides all removal. There is no planar wipe.
The seeded schedule and patch ages remain captured through return.
These are tunable first-trial values in
[hallwayCollapse.ts](../src/experience/hallwayCollapse.ts), not physical-clearance
or comfort certification. Burst depths adapt to the available crop length;
they are not placed at fixed XR world coordinates. The captured opening frame
preserves their side walls and depth through calibration yaw, taper and return.

Keep the entire corridor prefix from the opening to at least 6 m fully visible.
Enlarge it to the greatest observed user depth plus 2 m; optional current live
or explicitly supplied manual bounds can enlarge it to their farthest depth
plus 1 m. Missing bounds do not block the effect or create a fog dependency.
The prefix never shrinks during the game. If the user approaches damaged space,
restore the enlarged prefix and retain it, including the complete route back.
Protection overrides each patch's monotonic growth; suppress bursts
or removal where no distant space remains. The opening and return trigger stay
intact. Original hallway scene0 remains unaffected until the collapse-armed
ending return described below.

While the hallway is returning or restored, pause the collapse clock and retain
its existing local damage. Earlier return/reentry cycles resume without
replaying the broom, bursts or story; the collapse-armed ending return blocks
another entry. Reuse preloaded assets
and fixed render buffers/materials; do not edit source PLY data or rebuild the
shared splat sorter. Close, STOP, reset, recalibration, tracking/session recovery
or invalid/stalled frames cancel the cue and removal. Reset or a fresh game
rearms it. Review the actual fracture animation and darkening on the headset
before treating the first-trial timing as accepted.

The supplied `public/fracture_nowall.abc` is converted offline by
[prepare-fracture.mjs](../scripts/prepare-fracture.mjs) into
`public/effects/fracture/fracture.glb` and its
[metadata](../public/effects/fracture/fracture.meta.json). The compact GLB retains
42 animated fragment meshes and 300 transform samples at 30 fps; the converter
omits the source camera, light and static wall. Metadata records source/output
hashes and the suggested active animation window, played within each 1.8 s
burst. The runtime preloads this asset and reuses its actor pool. Recreate the
derivatives with `node scripts/prepare-fracture.mjs`; replacing existing derived
files requires `--force`. The original Alembic and scans remain unchanged.
The source debris travels in both directions; runtime placement faces each
panel inward and clips its debris to the added corridor and protected depths.

Each actual blast ID plays one supporting 1.8 s excerpt from 0.75 s into
`RumblingSound01.wav`, with a 30 ms attack and 250 ms release through the shared
gameplay audio context/master, at nominal gain 0.36 before source normalization.
Decoded audio is reused and overlaps the other
blasts without lowering music. Pause, mute and recovery stop it without
replaying missed starts; Reset clears IDs for the next game. Audible balance
and Steam Link routing still need a headset audition.

## Damaged return and white ending

Only actual automatic broom-completion collapse arms this ending. On the next
physical return, organic damage at both longitudinal ends of the original
hallway is already visible while the environment rotates back. Keep the area
within 4 m along either side of the current user, the captured opening and
available physical bounds intact; enlarge that protected interval as needed.
This intentionally extends damage beyond the added corridor only at the ending
return. Source data, metric geometry and tracked camera/controller rig stay fixed.

The actual completed return starts a new clock at zero. Over its first second,
reverse the earlier irregular flicker from captured current brightness to full
light using the same `light_flicker.mp3`, then hold full brightness. At exactly
five seconds from this endpoint, glitch the entire authored environment out
over one second with that sound. At six seconds, all authored content is gone
and the opaque white background remains. `finishReality` stops the previous
soundtrack, effects, warnings and queued speech, then plays the complete
6.710979 s `WhatIsReality.wav` once alone, at its original speed. The global
finale deliberately removes the previously protected area too.

If the participant has not returned first, start that same one-second global
glitch five seconds after the last explosion animation ends (not after residual
Gaussian clearing), or immediately within the inside one-metre strip of the
live headset boundary facing the distant added-hallway end. Side/return edges,
outside positions and stale/missing/manual bounds cannot trigger it. Use the
captured upright corridor direction, not gaze or original tracking axes. This
fallback skips the return/relight, keeps the current viewpoint and plays the
same solo final line once white is reached. A slow return does not postpone the
post-blast deadline; an original-hallway arrival before it retains the endpoint
relight/five-second sequence. The first ending wins and blocks portal changes;
later explosions cannot resume rumble over the final voice. Neither ends VR.

The return ending clock pauses outside the restored original phase. Repeated frames
or crossings cannot replay its final line. Close, STOP, reset, recalibration,
tracking/session recovery or invalid/stalled frames cancel the ending and its
audio without delayed revival; a fresh game rearms it. Desktop/VR share this
path. Timing, stereo, audible delivery and comfort remain pending hardware checks.

## Soundtrack and mix

### Headset-boundary voice

During visible tracked VR, moving outward in the **inside 0–0.50 m strip** of
the live headset boundary facing either hallway end requests one of
`DangerZone01.wav` through `DangerZone04.wav` in turn. Only finite perimeter
segments whose normals face within 45 degrees of either calibrated longitudinal
direction qualify. Side edges, central space and all positions outside the full
polygon stay silent; negative outside clearance cannot qualify. The physical
hallway axis comes from the frozen calibration frame, so visual room turns,
pitch and gaze cannot move these zones. Without that direction, prompts wait.
Stationary heads, turning in place, vertical head bob and walking along an edge
do not trigger it. Small motion below 2 cm is filtered.

One prompt is allowed per approach. Retreat to **0.75 m** clearance rearms it,
and an **8 s** cooldown prevents rapid repeats; expiry alone cannot speak while
stationary. The warning takes speech priority immediately, replacing a current
story line while retaining unstarted queued lines. It does not lower or stop
music. Leaving the half-metre strip cancels current/pending warning speech
immediately; the 0.75 m rearm margin still controls a new approach. Mute,
STOP/reset and lost/reset/session tracking also cancel it.

Only live headset-reported `bounded-floor` geometry is used, even when its
desktop outline is hidden. The enabled manual rectangle and last-session
snapshots never substitute for it. If Steam Link does not expose the outline,
the movement panel says **Boundary voice: no live headset outline available**
and does not invent a warning area. Tune thresholds/cooldown/motion filtering in
[approachWarning.ts](../src/boundary/approachWarning.ts); the recordings and
speech mix use [gameplayAudioConfig.ts](../src/audio/gameplayAudioConfig.ts).
Actual headset boundary availability and audible delivery remain hardware checks.

Music follows this order:

`Ambience_1 → Transition_1 → Ambience_2 → Transition_2 → Ambience_3 → Transition_3 → Ambience_4`

Ambiences loop until their transition. Music uses 1.2 s equal-power crossfades between parts and keeps its nominal level during speech and effects. Fixed per-file gain correction uses the measured source levels to even out music and lift the much quieter supplied speech; it does not turn music down when someone speaks. Moving-box sounds, footsteps and occasional knocks sit lower. The selected transition excerpts last 9 s, 6 s and 7 s; each begins 2 s before its associated visual change and continues beyond it. The draft still needs an audible pass through the intended Steam Link output.

The first-box and second-box appearance sounds use audible 1.5 s excerpts, starting 2.75 s into `BoxMoving01.wav` and 1.75 s into `BoxMoving03.wav`; the original recordings begin almost silently. During opening exploration, the two supplied footstep recordings alternate as nearby passing walkers: first after a random 3–6 s, then three-second excerpts separated by random 2–5 s quiet gaps. Each pass varies its level by 85–115% of the supporting footstep gain and moves from a random left/right side to the other. Footstep samples downmix to one passing source before stereo panning, keeping peak headroom. They continue if a live participant takes longer than autoplay; no missed passes catch up after a stall. Knocks keep their quiet 1.2 s excerpts at 10.5/18 s. Active and pending exploration sounds stop when Transition 1 starts. These sounds suggest other people walking; they do not infer the participant's foot contacts or match their gait.

The broom's “Clean the room” recording runs at its natural speed for about
3.99 s and waits behind any current speech. The tilt effect uses the audible
0.5–4.5 s section of `RoomTilting.wav`, with 0.05 s attack and 0.08 s release
when actual angular movement starts and stops. It plays on both four-second
rotation directions and every later cycle, beneath the unchanged music. It
does not begin during anticipation or restart from a late decode after the
motion has ended. Mute, close, STOP and recovery cancel pending playback.

| Supplied files | Use |
| --- | --- |
| `BackgroundSounds/Ambience_1.wav` … `Ambience_4.wav` | Four looping music phases |
| `BackgroundSounds/Transition_1.wav` … `Transition_3.wav` | Room turn, flicker and hole trigger |
| `SoundFX/Welcome To The Hallway.wav` | Welcome after calibration |
| `SoundFX/TryToStepOnTheBox.wav` | Instruction when the first box appears |
| `SoundFX/TryToFindTheBox.wav` | Available for manual audition; unassigned in the automatic gameplay sequence |
| `SoundFX/TheHallwayTurned.wav` | Turn commentary |
| `SoundFX/SitDownOnTheBox.wav` | Sit instruction after the second box finishes rising |
| `SoundFX/GoBackToTheClassRoom.wav` | Classroom instruction five seconds after actual wall appearance |
| `SoundFX/CLEANTHEROOM.wav` | Full queued speech when the broom actually appears, including a successful manual Show |
| `SoundFX/RoomTilting.wav` | Supporting effect during actual inward and return hole rotations, including repeated cycles |
| `SoundFX/DangerZone01.wav` … `DangerZone04.wav` | Priority voice when approaching within 0.5 m of the live headset perimeter |
| `SoundFX/BoxMoving01.wav`, `BoxMoving03.wav` | First and second box appearance |
| `SoundFX/Footsteps01.wav`, `Footsteps02.wav` | Intermittent pre-turn exploration sounds |
| `SoundFX/BoxBonking01.wav`, `BoxBonking03.wav` | Faint pre-turn knocks |
| `SoundFX/RumblingSound02.wav` | Movement-only wall loop at 0.35 gain, 0.2 s fade-in and 0.7 s look-back fade-out matching its stop |
| `SoundFX/RumblingSound01.wav` | One supporting 1.8 s excerpt per actual distant fracture blast |
| `light_flicker.mp3` | Lights-out flicker, ending return relight and final global glitch |
| `SoundFX/WhatIsReality.wav` | Complete 6.710979 s solo recording after the white ending |
| `SoundFX/BoxBonking02.wav`, `DoorOpenAndClose.wav`, `ScaryUndefinedNoise.wav` | Available but unassigned in this draft |

## Tweaking the draft

Edit the phase deadlines in [gameplayTiming.ts](../src/experience/gameplayTiming.ts) and the audio paths, mix and transition settings in [gameplayAudioConfig.ts](../src/audio/gameplayAudioConfig.ts). The playback implementation is [gameplayAudio.ts](../src/audio/gameplayAudio.ts). Reload after changing constants, then use the desktop gameplay preview to compare the sequence before a headset audition.

The endpoint-based 1 s relight, 5 s dimension wait and 1 s final glitch are in
[realityEnding.ts](../src/experience/realityEnding.ts).

| Setting | Draft value | Where to change it |
| --- | --- | --- |
| Welcome / first-box instruction times | 1 / 8 s | `GAMEPLAY_TIMING.welcomeSeconds`, `firstBoxSeconds` |
| Autoplay exploration / anticipation | 20 / 2 s | `GAMEPLAY_TIMING.explorationSeconds`, `transitionLeadSeconds` |
| Flicker after second-box rise / anticipation | 6.5 / 2 s | `GAMEPLAY_TIMING.flickerDelaySeconds`, `flickerLeadSeconds` |
| Transition excerpts | 9 / 6 / 7 s | `GAMEPLAY_AUDIO.transitionSeconds` |
| Excerpt start inside each recording | 0 / 0 / 0 s | `GAMEPLAY_AUDIO.transitionOffsetSeconds` |
| Box appearance excerpt length | 1.5 s | `GAMEPLAY_AUDIO.boxEffectSeconds` |
| Box 1 / box 2 excerpt offsets | 2.75 / 1.75 s | `GAMEPLAY_AUDIO.boxEffectOffsetSeconds` |
| Footstep / knock excerpt limits | 3 / 1.2 s | `GAMEPLAY_AUDIO.explorationFootstepSeconds`, `explorationBonkSeconds` |
| Crossfade | 1.2 s | `GAMEPLAY_AUDIO.crossfadeSeconds` |
| Music / speech gain | 0.65 / 1.3 | `GAMEPLAY_AUDIO.gains.music`, `speech` |
| Box / footsteps / knocks gain | 0.26 / 0.16 / 0.085 | `GAMEPLAY_AUDIO.gains.box`, `footsteps`, `bonk` |
| Tilt effect gain | 0.22 | `GAMEPLAY_AUDIO.gains.roomTilting` |
| Tilt source-loop interval | 0.5–4.5 s | `GAMEPLAY_AUDIO.roomTilting.loopStartSeconds`, `loopEndSeconds` |
| Tilt attack / release | 0.05 / 0.08 s | `GAMEPLAY_AUDIO.roomTilting.attackSeconds`, `releaseSeconds` |
| Broom speech | Complete recording, about 3.99 s | `GAMEPLAY_SPEECH.cleanRoom` |
| Shared gameplay master gain | 0.4 | `GAMEPLAY_AUDIO.gains.master` |
| Music RMS target / peak ceiling | 0.09 / 0.85 | `GAMEPLAY_AUDIO.normalization.musicRms`, `musicPeakCeiling` |
| Speech / supporting effect peak targets | 0.9 / 0.5 | `GAMEPLAY_AUDIO.normalization.speechPeak`, `effectPeak` |
| First random footsteps / quiet gap between passes | 3–6 / 2–5 s | `GAMEPLAY_AUDIO.explorationFootsteps.firstDelaySeconds`, `gapSeconds` |
| Footstep level variation / pan extent | 85–115% / 0.35–0.75 left/right | `GAMEPLAY_AUDIO.explorationFootsteps.gainRange`, `panExtent` |
| Knock timestamps | 10.5 / 18 s | `GAMEPLAY_AUDIO.explorationEvents` |

Gains are linear multipliers, not loudness percentages. `GAMEPLAY_SOURCE_LEVELS` in the audio config measures full ambiences and speech, plus the actual authored transition/effect excerpts. Remeasure after changing a recording, excerpt offset or duration. Excerpt durations include the outgoing fade; selecting a later source offset changes the excerpt without editing the original WAV. Background music streams locally so all long WAVs need not be decoded into memory together; short speech and effects are cached after decoding.

Tune music/effect gains first, then anticipation and crossfade lengths. The four music phases share a common nominal level, so changing speech volume does not lower the soundtrack. The existing wall and flicker audio modules have their own gains; their runtime cancellation follows the same recovery paths.

STOP, reset, a new calibration, tracking/reference-space/session interruption and page disposal cancel pending actions and sound. A successful fresh calibration starts the sequence from Ambience 1 again. Explicit mute persists. A saved fit never starts an accepted live game by itself.

## Review still needed

Automated checks can verify event order, cancellation, trigger geometry and audio scheduling. Desktop screenshots show the visual state. Audible balance, complete speech delivery, headset routing, physical alignment and comfort require separate testing on the PC → SteamVR → Steam Link → Quest route. Repeated quarter-turns and physical passage through the opening have not been accepted on hardware.

Related: [interaction plan](INTERACTION_PLAN.md), [audio setup](VOICE_SETUP.md), [calibration](CALIBRATION.md), and [validation](VALIDATION.md).
