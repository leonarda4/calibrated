# Choose a headset recording workflow

Provider: codex; source: user; session: 01a1a6da-d275-77d1-a07d-d7de5edf5883.

Original local record: \\?\C:\Users\user\.codex\sessions\2026\11\04\rollout-2026-11-04T14-58-41-01a1a6da-d275-77d1-a07d-d7de5edf5883.jsonl.

Created: 2026-11-04T13:58:41.016Z. Export snapshot: 2026-11-05T11:08:59.327Z.

This transcript contains stored user-facing user/assistant messages, with image links. System/developer prompts, tool payloads and internal reasoning are omitted. Credential-shaped strings are redacted. A delegated thread's user-role messages may be inherited context or instructions from another agent.

<a id="message-1"></a>

## 1. user · 2026-11-04T13:59:35.282Z

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
  <current_date>2026-11-04</current_date>
  <timezone>Europe/Zurich</timezone>
  <filesystem><workspace_roots><root>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry><entry access="write"><path>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated</path></entry><entry access="write"><special>:slash_tmp</special></entry><entry access="write"><special>:tmpdir</special></entry><entry access="read"><path>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated\.git</path></entry><entry access="read"><path>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated\.agents</path></entry><entry access="read"><path>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated\.codex</path></entry><entry access="read"><path>C:\Users\user\Documents\Hallway_Project\02_Git\calibrated\.aws</path></entry></file_system></permission_profile></filesystem>
</environment_context>

<a id="message-2"></a>

## 2. user · 2026-11-04T13:59:35.294Z

<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>

<a id="message-3"></a>

## 3. user · 2026-11-04T13:59:35.307Z

# Context from my IDE setup:

## Active file: src/calibration/landmarks.ts

## Open tabs:
- landmarks.ts: src/calibration/landmarks.ts
- scanAsset.ts: src/viewer/scanAsset.ts
- Pasted text.txt: c:\Users\user\.codex\attachments\d35cc99d-bff6-4c23-862e-b78af88ec115\Pasted text.txt
- main.ts: src/main.ts
- movementBoundary.ts: src/xr/movementBoundary.ts

## My request:
lets think about how do we record the experience the best? would it be possible to record from the headset or do i stream the view and screen record the screen or what


<a id="message-4"></a>

## 4. assistant · 2026-11-04T13:59:38.577Z

I’ll check the project’s XR setup and the current headset recording options, then suggest a practical way to capture the experience.

<a id="message-5"></a>

## 5. assistant · 2026-11-04T14:00:24.423Z

The project is currently rendering on the PC through SteamVR and streaming to the Quest. That makes a PC recording of SteamVR’s headset view the strongest starting point. I’d also film the person in the real hallway, so viewers can see how their physical movement relates to the virtual scene.

<a id="message-6"></a>

## 6. assistant · 2026-11-04T14:02:23.471Z

Yes—both are possible. **For our current SteamVR → Steam Link → Quest setup, I’d record on the PC with OBS, plus film the person in the real hallway with a phone.**

You have three options:

| Method | My take |
|---|---|
| **Record directly on Quest** | Convenient for quick captures. Quest has **Camera → Record Video**, but we should test that it captures Steam Link’s picture and audio correctly. [Recording instructions](https://support.microsoft.com/en-us/windows/experience/compatibility/about-windows-mixed-reality-link) |
| **Record SteamVR’s view with OBS** | My preferred starting point: controllable framing, audio and recording quality, with the file saved directly on the PC. |
| **Cast Quest to a screen, then record** | Possible, but adds another streaming step when the scene is already being rendered on the PC. |

For the OBS approach:

1. Open SteamVR’s menu and select **Display VR View**. Start with a single-eye view for a normal video; compare the blended both-eyes option if the framing feels too narrow. [Valve’s VR View documentation](https://store.steampowered.com/news/posts/?appids=250820&enddate=1570553186&feed=steam_community_announcements)
2. In OBS, add **Window Capture** and select that VR View window. [OBS instructions](https://obsproject.com/kb/window-capture-sources)
3. Add **Chrome’s application audio** separately so the narration and sound effects are included. Add a microphone only if you want spoken reactions. [OBS audio guide](https://obsproject.com/kb/application-audio-capture-guide)
4. I’d initially try **1080p at 60 fps with a hardware encoder**, then reduce recording settings if headset performance suffers.

For documenting *this* experience, the phone footage matters: the headset view shows the virtual events, while the external shot shows the person walking through the physical hallway. A deliberate hand wave visible in both recordings gives you a synchronization point for editing.

Before a full take, make a **30-second test and play it back**, checking framing, narration, the flicker sound and headset smoothness. The PC recording captures the view before wireless delivery, so it won’t reveal every streaming glitch the wearer might see.
