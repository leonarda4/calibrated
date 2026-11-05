# Gameplay audio and tracked hands

Gameplay now uses the supplied local music, speech and sound effects under `public/audio/BackgroundSounds/` and `public/audio/SoundFX/`. It does not need an ElevenLabs account, API key, generation command or runtime synthesis service. The earlier generated narration is retired from the gameplay path. Existing generated files are retained as historical assets; they are not the soundtrack for this flow.

The second box's completed rise requests `SoundFX/SitDownOnTheBox.wav` once. The current headset above that box still arms the wall's unseen appearance. Five seconds after its actual reveal, request `SoundFX/GoBackToTheClassRoom.wav`; arming and waiting for look-away/clearance do not start that deadline. Both use complete recordings and the existing speech queue without ducking the background. Earlier speech finishes before a queued line starts. Stop/reset, wall cancellation and calibration/tracking/session recovery cancel pending requests.

See [gameplay flow](GAMEPLAY_FLOW.md) for the phase table, automatic and user triggers, estimated durations and the audio-file mapping. The draft starts Ambience 1 after successful calibration, welcomes the participant one second later and plays the step-on instruction when the first box appears at +8 s. Desktop autoplay uses about 20 seconds of exploration. The three music transitions accompany the room turn, light flicker and headset-above-hole trigger; each begins before its visual cue. Ambience 4 follows the third transition and continues through repeated four-second turns into and back from the added hallway.

## Playback and tuning

Opening footsteps now suggest other people passing nearby: the two supplied
recordings alternate at irregular intervals, with varied supporting levels and
left/right movement. The first starts after 3–6 s; three-second passes have
2–5 s quiet gaps. This continues for a long live exploration and ends at the
first transition, including any active or pending pass. Mute/reset/recovery
cannot revive an old pass. Tune `GAMEPLAY_AUDIO.explorationFootsteps` in
[gameplayAudioConfig.ts](../src/audio/gameplayAudioConfig.ts); the music keeps
its existing level, and these cues are independent of the wearer's own steps.

The supplied `DangerZone01.wav` through `DangerZone04.wav` cycle as priority
boundary prompts: actual outward head motion within 0.5 m of the live headset
outline, 0.75 m retreat to rearm and an eight-second cooldown. They use the
normalized speech gain and replace the current story line promptly, preserving
queued future lines and the music level. Missing runtime bounds, old session
snapshots and the manual rectangle cannot trigger them. The movement panel
reports availability; thresholds are in
[approachWarning.ts](../src/boundary/approachWarning.ts). See the
[boundary flow](GAMEPLAY_FLOW.md#headset-boundary-voice) for cancellation and
headset validation limits.

The first page pointer/key gesture, including clicking Enter VR, enables local audio where the browser allows it. Use the audio panel's enable control if playback is still blocked. Mute cancels current and pending gameplay audio and remains set across recalibration. Unmuting does not replay an earlier cue. Reset, STOP, recalibration, session/tracking interruption and disposal cancel pending audio so an old download or decode cannot revive the previous game.

Music keeps its nominal level under speech and sound effects. Fixed per-file correction uses measured source levels to even out music and lift the quieter supplied speech; equal-power fades blend adjacent parts. Footsteps, knocks and brief box-moving effects sit lower. The moving-wall loop and short light-flicker sound retain their dedicated movement/effect timing. This is a draft mix: listen through the actual Steam Link output before choosing final gains.

The first actual automatic broom reveal queues the full supplied `SoundFX/CLEANTHEROOM.wav` on its first glitch-in frame. A successful manual Show also requests it; failed placement, an already visible broom and later visits to the same automatic encounter do not. The roughly 3.99 s recording plays at natural speed, waits behind any current line and does not lower or interrupt the music.

`SoundFX/RoomTilting.wav` supports actual angular movement during both directions of the hole turn, including later cycles and manual open-hole inspection. Its audible 0.5–4.5 s section loops at 0.22 supporting gain, with a 0.05 s attack and 0.08 s stop release. The two-second anticipation and held poses do not start this effect. Mute, closing the opening, STOP, reset, recalibration and tracking/session recovery cancel active or pending tilt playback; stale loading cannot restart it after motion has stopped. The background track keeps its separate continuity and recovery rules.

Tune phase times in [gameplayTiming.ts](../src/experience/gameplayTiming.ts), and clip paths, gains and music-transition settings in [gameplayAudioConfig.ts](../src/audio/gameplayAudioConfig.ts). [gameplayAudio.ts](../src/audio/gameplayAudio.ts) owns local playback and cancellation. These changes require a reload, not speech generation. Use desktop preview to review timing, then make a separate headset audio check.

Narrative transcripts and audio status remain on the PC. Calibration and interruption/recovery instructions remain in the headset. A scheduling test or muted browser run does not establish audible intelligibility, output routing or headset comfort.

## Hand capability on the active PC route

The app requests optional WebXR `hand-tracking`. Steam Link, SteamVR/OpenXR, and Chrome must expose hand sources **and actual joint poses** for the feature to work. A controller profile containing the word `hand`, a pinch button, or a tracked controller ray is not proof of joint availability. Native Meta system hands belong to the headset compositor and cannot be enabled or imported by this PC WebXR page.

The app bundles the standard generic WebXR skinned hand models used by Three.js, served locally from `public/hands/`. They have no runtime CDN dependency. These local white skinned hands are the web-compatible representation. Hands remain visual tracking inputs; the box trigger uses the headset footprint, not hand contact. Missing or emulated poses remove hand contact data. Losing a hand does not itself invalidate hallway registration.

`meshPath: '/hands/'` selects the bundled `left.glb` and `right.glb`, with the 25 WebXR joint names and skeleton convention used by the installed Three.js r180 `XRHandMeshModel`. Keep the assets and their licences together. An unavailable or incompatible mesh retains the local joint/bone fallback. Mesh materials are unlit so they remain visible in the splat scene without lights. Rendering and contact must still be verified on actual Steam Link hardware.

The generic models come from [WebXR Input Profiles Assets](https://github.com/immersive-web/webxr-input-profiles/tree/main/packages/assets/profiles/generic-hand), under the package's MIT licence, Copyright (c) 2019 Amazon. See [bundled asset provenance and hashes](../public/hands/README.md) and [licence](../licenses/webxr-input-profiles-MIT.txt). The hand-model scenario in `npm run check` produces a desktop screenshot using the actual skinned files with synthetic joint poses; it does not establish hardware hand-tracking availability.

See [interaction plan](INTERACTION_PLAN.md), [headset setup](HEADSET_SETUP.md), and [calibration](CALIBRATION.md) for physical preparation and the active runtime route.
