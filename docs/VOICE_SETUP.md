# Voices and tracked hands

The browser plays local audio. ElevenLabs runs only when the operator explicitly executes the asset-generation script. There is no runtime API key, network synthesis, or speech synthesis fallback that might change the performance during a session.

The narrated test is enabled by default and starts after each successful VR calibration. It welcomes the participant immediately, shows the first box at +10 seconds, waits for the headset to enter the shown first box footprint to start the turn, and reveals the second box five seconds after turn onset. Each action has a centred female lead whisper plus two quieter side echoes, each only one or two related words. Disable **Narrated test after calibration** for manual controls; **Preview narrated test on desktop** retains the 10/15/20-second timing without granting a headset fit.

The 24 current narration MP3s and the light-flicker sound are included in Git.
Classmates can run and build immediately without an ElevenLabs account or API
key. The steps below are optional, for deliberately regenerating narration.

## Generate the voice clips (optional)

Use Node 22.18 or newer. Open the ignored `.env.local` in the repository root (beside `package.json`, not inside `docs/`) and paste your key after `=`:

```dotenv
ELEVENLABS_API_KEY=
```

Do not prefix these variables with `VITE_`. Do not paste a real key into committed files, the UI, a URL, or a command that will be saved to shared history. Existing process environment values take precedence over `.env.local`.

That is the only required setting. The generator chooses voices available to your account using [List voices](https://elevenlabs.io/docs/api-reference/voices/search); allow voice-list and text-to-speech access on your key. It uses distinct voices when available, reusing them when the account exposes fewer than three. For optional custom choices, set `ELEVENLABS_VOICE_LEAD`, `ELEVENLABS_VOICE_LEFT` and `ELEVENLABS_VOICE_RIGHT`. The default model is `eleven_v3`; `ELEVENLABS_MODEL_ID` is an optional override. The side takes use `[whispering]`. Follow the official [speech endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) and [voice prompting guidance](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices) when tuning the delivery, then audition the output.

```powershell
npm.cmd run voices:generate
```

Use `npm.cmd` in Windows PowerShell if script execution is disabled; it avoids the blocked `npm.ps1` wrapper without changing the execution policy. On other platforms, use `npm`.

For just the four new test lines, run:

```powershell
npm.cmd run voices:generate -- --cue scenarioWelcome --cue scenarioBox --cue scenarioTurn --cue scenarioSeat
```

Run this after adding the key, then reload the browser. These filters make twelve sequential speech requests; generating every cue makes up to 24. A voice-list lookup is needed when required voice IDs are omitted. Only roles present in the selected clips need voice IDs. Existing non-empty clips are skipped. `npm.cmd run voices:generate -- --dry-run` makes no API calls; `--cue badge --force` deliberately regenerates that cue's three layers and consumes API usage again. Requests are bounded and never retried automatically. Audio is MP3 at 44.1 kHz / 128 kbps. The generator logs request counts, input-character counts, output paths and redacted errors; it does not log keys, voice IDs or API response bodies.

On 2026-11-03 the local generation attempt was rejected: voice discovery reported missing `voices_read`, and a direct speech request also returned HTTP 401. No new scenario MP3s were created. Correct the local key/account access before expecting spoken narration; timing remains available with PC transcripts.

If voice listing reports missing `voices_read` access, open **Developers â†’ API Keys â†’ (â€¦) â†’ Edit** in ElevenLabs and enable **Voices: Read** for that key. Speech generation also needs **Text to Speech** access. Save the key settings and rerun the command; the local key value does not need to change when only its permissions change. See [ElevenLabs API-key setup](https://elevenlabs.io/docs/help-center/technical/how-do-i-authorize-myself-using-an-api-key). An invalid or expired key instead needs replacement in the root `.env.local`. HTTP 401 alone does not distinguish these cases; the generator uses recognized service error details and keeps the response private.

Generated narration lives under `public/audio/generated/`. The current lead/left/right MP3s are intentionally tracked for sharing; local `.env.local` and all API credentials remain ignored. Vite copies the included clips into `dist` when building, so playback requires no synthesis requests. Regeneration changes shared audio assets; review the resulting clips before committing them.

## Playback

The first page pointer/key gesture, including clicking **Enter VR**, unlocks Web Audio and preloads the four test clips. **ENABLE VOICES** is available if the browser still blocks audio. **PREVIEW VOICE** auditions the older layered cue. Narrative captions never appear in the headset, including when audio is muted, missing, blocked or unsupported. Cue transcripts and audio status remain on the PC; calibration and interruption/recovery instructions remain in the headset. Listen through the intended Steam Link audio route. The four test cues use one centred lead; older audition cues retain whisper takes at 0.85 and 1.8 seconds with lower gains and left/right panning. New cues cancel prior speech, so audition that the box line finishes within its five-second slot.

The cue text, roles, gains, pans, delays and optional duration limit are in [voiceCues.ts](../src/audio/voiceCues.ts). All generated layers request `[whispering]` delivery, repeated between lead sentences; captions retain the spoken words without delivery tags. Lead gain is 0.40, with the brief left/right echoes at 0.045/0.035 before the shared master gain. The v3 generator uses Creative stability (0) to give delivery tags more influence; the saved female lead voice is retained. The box line speeds up only when needed to fit 4.7 seconds before the next cue; shorter clips stay at natural speed. Audition intelligibility and pitch after generation. Changes to generation text need regeneration; mix/timing changes only need a browser reload. Playback uses cached decoded local clips. A new cue cancels the previous cue, including future scheduled layers; STOP, interruption, mute, and disposal cancel audio. If a lead clip is missing, its whisper layers are suppressed so the instruction is never replaced by a whisper-only cue. Its transcript stays on the PC.

## Hand capability on the active PC route

The app requests optional WebXR `hand-tracking`. Steam Link, SteamVR/OpenXR, and Chrome must expose hand sources **and actual joint poses** for the feature to work. A controller profile containing the word `hand`, a pinch button, or a tracked controller ray is not proof of joint availability. Native Meta system hands belong to the headset compositor and cannot be enabled or imported by this PC WebXR page.

The app bundles the standard generic WebXR skinned hand models used by Three.js, served locally from `public/hands/`. They have no runtime CDN dependency. Native Meta compositor hands cannot be enabled by this page; these local white skinned hands are the web-compatible representation. Hands remain visual tracking inputs; the current manual Show box / Rotate hallway sequence has no orb or contact trigger. Missing or emulated poses remove hand contact data. Losing a hand does not itself invalidate hallway registration.

`meshPath: '/hands/'` selects the bundled `left.glb` and `right.glb`, with the 25 WebXR joint names and skeleton convention used by the installed Three.js r180 `XRHandMeshModel`. Keep the assets and their licences together. An unavailable or incompatible mesh retains the local joint/bone fallback. Mesh materials are unlit so they remain visible in the splat scene without lights. Rendering and contact must still be verified on actual Steam Link hardware.

The generic models come from [WebXR Input Profiles Assets](https://github.com/immersive-web/webxr-input-profiles/tree/main/packages/assets/profiles/generic-hand), under the package's MIT licence, Copyright (c) 2019 Amazon. See [bundled asset provenance and hashes](../public/hands/README.md) and [licence](../licenses/webxr-input-profiles-MIT.txt). The hand-model scenario in `npm run check` produces a desktop screenshot using the actual skinned files with synthetic joint poses; it does not establish hardware hand-tracking availability.

See [interaction plan](INTERACTION_PLAN.md), [headset setup](HEADSET_SETUP.md), and [calibration](CALIBRATION.md) for the physical preparation and active runtime route.
