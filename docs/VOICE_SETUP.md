# Voices and tracked hands

The browser plays local audio. ElevenLabs runs only when the operator explicitly executes the asset-generation script. There is no runtime API key, network synthesis, or speech synthesis fallback that might change the performance during a session.

## Generate the voice clips

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

Run this once after adding the key, then reload the browser. A complete generation makes up to 12 sequential speech requests, plus a voice-list lookup when voice IDs are omitted. Existing non-empty clips are skipped. `npm.cmd run voices:generate -- --dry-run` makes no API calls; `--cue badge --force` deliberately regenerates that cue's three layers and consumes API usage again. Requests are bounded and never retried automatically. Audio is MP3 at 44.1 kHz / 128 kbps. The generator logs request counts, input-character counts, output paths and redacted errors; it does not log keys, voice IDs or API response bodies.

If voice listing reports missing `voices_read` access, open **Developers → API Keys → (…) → Edit** in ElevenLabs and enable **Voices: Read** for that key. Speech generation also needs **Text to Speech** access. Save the key settings and rerun the command; the local key value does not need to change when only its permissions change. See [ElevenLabs API-key setup](https://elevenlabs.io/docs/help-center/technical/how-do-i-authorize-myself-using-an-api-key). An invalid or expired key instead needs replacement in the root `.env.local`. HTTP 401 alone does not distinguish these cases; the generator uses recognized service error details and keeps the response private.

Generated files live under ignored `public/audio/generated/`. Keep those files on the installation PC. A source checkout has no spoken cues until they are generated. Check the ignored-file rule before sharing a build; Vite copies local public assets into `dist` when building.

## Playback

Click **ENABLE VOICES** once to allow Web Audio, then **PREVIEW VOICE**. Narrative captions never appear in the headset, including when audio is muted, missing, blocked or unsupported. Cue transcripts and audio status remain on the PC; calibration and interruption/recovery instructions remain in the headset. Listen with the same headset/output route intended for Steam Link and confirm that the imperative words remain understandable. The readable lead is centred; whisper takes enter 0.85 and 1.8 seconds later with lower gains and left/right panning. Each contains short repetitions. This is a conservative initial mix, pending an actual headphone audition.

The cue text, roles, gains, pans, and delays are in [voiceCues.ts](../src/audio/voiceCues.ts). Changes to generation text need regeneration; changes to gain/pan/delay only need a browser reload. Playback uses cached decoded local clips. A new cue cancels the previous cue, including future scheduled layers; STOP, interruption, mute, and disposal cancel audio. If a lead clip is missing, its whisper layers are suppressed so the instruction is never replaced by a whisper-only cue. Its transcript stays on the PC.

## Hand capability on the active PC route

The app requests optional WebXR `hand-tracking`. Steam Link, SteamVR/OpenXR, and Chrome must expose hand sources **and actual joint poses** for the feature to work. A controller profile containing the word `hand`, a pinch button, or a tracked controller ray is not proof of joint availability. Native Meta system hands belong to the headset compositor and cannot be enabled or imported by this PC WebXR page.

The app bundles the standard generic WebXR skinned hand models used by Three.js, served locally from `public/hands/`. They have no runtime CDN dependency. Native Meta compositor hands cannot be enabled by this page; these local white skinned hands are the web-compatible representation. Only valid current-frame `index-finger-tip` poses can collect the orb. Missing or emulated poses immediately remove contact authority. Losing a hand does not itself invalidate hallway registration.

`meshPath: '/hands/'` selects the bundled `left.glb` and `right.glb`, with the 25 WebXR joint names and skeleton convention used by the installed Three.js r180 `XRHandMeshModel`. Keep the assets and their licences together. An unavailable or incompatible mesh retains the local joint/bone fallback. Mesh materials are unlit so they remain visible in the splat scene without lights. Rendering and contact must still be verified on actual Steam Link hardware.

The generic models come from [WebXR Input Profiles Assets](https://github.com/immersive-web/webxr-input-profiles/tree/main/packages/assets/profiles/generic-hand), under the package's MIT licence, Copyright (c) 2019 Amazon. See [bundled asset provenance and hashes](../public/hands/README.md) and [licence](../licenses/webxr-input-profiles-MIT.txt). The hand-model scenario in `npm run check` produces a desktop screenshot using the actual skinned files with synthetic joint poses; it does not establish hardware hand-tracking availability.

See [interaction plan](INTERACTION_PLAN.md), [headset setup](HEADSET_SETUP.md), and [calibration](CALIBRATION.md) for the physical preparation and active runtime route.
