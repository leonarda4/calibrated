# Add post-calibration test scenario

Provider: codex; source: user; session: 01a1a262-cf5a-7af1-854f-4c916caf29ce.

Original local record: \\?\C:\Users\user\.codex\sessions\2026\11\03\rollout-2026-11-03T18-09-07-01a1a262-cf5a-7af1-854f-4c916caf29ce.jsonl.

Created: 2026-11-03T17:09:07.038Z. Export snapshot: 2026-11-05T11:08:59.327Z.

This transcript contains stored user-facing user/assistant messages, with image links. System/developer prompts, tool payloads and internal reasoning are omitted. Credential-shaped strings are redacted. A delegated thread's user-role messages may be inherited context or instructions from another agent.

<a id="message-1"></a>

## 1. user · 2026-11-03T17:09:07.754Z

# AGENTS.md instructions for C:\Users\user\Documents\Hallway_Project\02_Git\calibrated

<INSTRUCTIONS>
# Rules for coding agents

## Start here

Read `ai/strategy.md`, then the relevant sections of `docs/PROJECT_PLAN.md`, `docs/CALIBRATION.md`, and `docs/VALIDATION.md`.

This repository is in active implementation (viewer, XR session, calibration; hardware-validated on the Quest Browser and SteamVR/Steam Link routes). Continue through the agreed work without asking for a new “go” after every step, but keep the plan/build/check/log loop and record decisions in `ai/strategy.md`.

## Work loop

0. **Git and network operations:** Never push, pull, or fetch. Commits are local only.
   Before publishing anything, **ask the user** — they push and pull manually via
   GitHub Desktop. Never trigger credential prompts or other network authentication.

1. Record the current task and acceptance criteria in `ai/strategy.md`.
2. Build one reviewable step at a time. Keep modules small and separate calibration mathematics from rendering and device input.
3. Run the checks relevant to the change. Once implemented, use `npm test` for logic and `npm run check` for desktop browser behavior. These commands do not exist during the planning phase.
4. Read generated reports and inspect screenshots before describing them. Repair failures, then record the outcome and next step in `ai/strategy.md`.
5. Distinguish automated checks, desktop visual checks, and tests performed on the real PC/Quest/hallway. Never report a hardware milestone as passed from a browser screenshot or simulated pose.

For documentation changes, check consistency and relative links; do not create application tests just to test prose. Keep generated `.check/` results unedited.

## Calibration invariants

- In calibrated mode, one XR unit is one metre. The parent rig for the tracked camera and controllers stays at identity; transform the scan root into XR space.
- No joystick locomotion, teleportation, artificial turning, or user-scale control in calibrated mode.
- Fit explicitly paired physical/scan landmarks. A controller grip pose is not the physical probe tip; account for its measured offset.
- Keep validation landmarks separate from fit landmarks. Report fit residuals and held-out errors separately.
- Recenter, reference-space reset, viewer-tracking interruption, changed scan data, or a new session invalidate acceptance and require the recovery procedure. Invalid controller poses block active capture; loss of an unused controller alone does not invalidate alignment.
- A saved transform is a candidate for revalidation, never evidence of present alignment. Splats provide appearance, not certified wall geometry or collision protection.

## Scope and tools

`src/viewer/scanAsset.ts` contains manually adjusted scan placement. Do not modify this file, including rotation, start point, camera or anchors, without explicit user permission. Configure calibration landmarks in `src/calibration/landmarks.ts` instead; tests must accommodate the manual asset settings.

Use existing project conventions and verify current APIs against the pinned dependencies. Routine reversible changes and dependency choices inside the authorized task do not need separate permission; record material architectural changes. Ask when missing information prevents a sound decision.

Do not change agent model, provider, credentials, or permission defaults as part of ordinary project work. Never print secrets. Do not dump large scan binaries into agent context; inspect metadata or use purpose-built processing when the task requires it. Keep private scans and calibration captures out of Git.

Use bounded checks where possible. When a development server is needed, track its process and stop it when finished unless the user needs it left running. Report blockers with evidence and continue independent work when possible.

## Provenance

Adapted from the Photolipsia agentic kit's small-step plan/build/check/log workflow. See `docs/REFERENCES.md` for source and licensing details.

</INSTRUCTIONS>
<environment_context>
  <cwd>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated</cwd>
  <shell>powershell</shell>
  <current_date>2026-11-03</current_date>
  <timezone>Europe/Zurich</timezone>
  <filesystem><workspace_roots><root>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry><entry access="write"><path>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated</path></entry><entry access="write"><special>:slash_tmp</special></entry><entry access="write"><special>:tmpdir</special></entry><entry access="read"><path>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated\.git</path></entry><entry access="read"><path>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated\.agents</path></entry><entry access="read"><path>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated\.codex</path></entry><entry access="read"><path>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated\.aws</path></entry></file_system></permission_profile></filesystem>
</environment_context>

<a id="message-2"></a>

## 2. user · 2026-11-03T17:09:07.765Z

<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>

<a id="message-3"></a>

## 3. user · 2026-11-03T17:09:07.776Z

# Context from my IDE setup:

## Active file: src/calibration/landmarks.ts

## Open tabs:
- landmarks.ts: src/calibration/landmarks.ts
- scanAsset.ts: src/viewer/scanAsset.ts
- Pasted text.txt: c:\Users\user\.codex\attachments\d35cc99d-bff6-4c23-862e-b78af88ec115\Pasted text.txt
- main.ts: src/main.ts
- movementBoundary.ts: src/xr/movementBoundary.ts

## My request:
can you make a test scenario that starts right after calibration? I want the first button to show first box to be activated 10 seconds after calibration and make eleven labs voices narrate the experience&#x20;

- first they say: welcome, I hope you are calibrated to your new environment
- then after 10 seconds they say: well would you look at that, a box appeared... I wonder if it's real...
- then trigger the appear box like I pressed the button
- then after 5 seconds the rotating button is activated and they say: Whoosh, what just happened? while its turning
- Then after 5 seconds the second box appears like the button is pressed and they say: oh look there's your seat because you are late for class. 


<a id="message-4"></a>

## 4. assistant · 2026-11-03T17:09:10.504Z

I’ll check how calibration completion and the box controls work, then add the timed sequence and ElevenLabs narration. I’ll leave the manual scan placement unchanged.

<a id="message-5"></a>

## 5. assistant · 2026-11-03T17:10:21.944Z

The project already has an ElevenLabs clip generator and local audio playback. I’m setting the sequence to welcome at calibration completion, first box at 10 seconds, rotation at 15 seconds, and second box at 20 seconds, with a voice cue at each step. STOP, recalibration, or tracking loss will cancel it.

<a id="message-6"></a>

## 6. assistant · 2026-11-03T17:12:36.317Z

The sequence is wired in, with a desktop preview and an option to keep using manual controls. ElevenLabs rejected both voice lookup and speech generation with HTTP 401, so no new audio clips were created. I’m continuing the timing and cancellation checks; speech needs working ElevenLabs key access.

<a id="message-7"></a>

## 7. assistant · 2026-11-03T17:15:28.642Z

The first desktop check passed the full 10/15/20-second sequence and cancellation cases. I’m finishing two details: keeping the test turn at four seconds even if manual settings differ, and preventing a long box narration from being cut off by the next cue. The new clips still need ElevenLabs access and a headset audition.

<a id="message-8"></a>

## 8. assistant · 2026-11-03T17:18:32.899Z

The last regression test caught a real issue: changing the manual turn duration could also move the first box when rotation began. I fixed the placement logic so the box and pivot keep their chosen position. The full desktop check is running again with that case included.

<a id="message-9"></a>

## 9. assistant · 2026-11-03T17:19:31.229Z

Added the automatic scenario after calibration:

- **0 s:** Welcome narration.
- **10 s:** First box appears with narration.
- **15 s:** Four-second rotation with “Whoosh…”
- **20 s:** Second box appears with the seat narration.

**Preview narrated test on desktop** runs the sequence. STOP/reset cancels it.

108 logic tests, 24 desktop checks and build pass. Headset testing remains pending.

**Audio is blocked:** ElevenLabs rejected the saved key with HTTP 401; no new clips were generated. Enable **Voices: Read** and **Text to Speech**, then follow [voice setup](C:/Users/user/Documents/Hallway_Project/02_Git/calibrated/docs/VOICE_SETUP.md:25).
