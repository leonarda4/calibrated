# References and attribution

Reviewed 2026-10-29. Online support and APIs can change; pin dependencies and record the tested runtime during implementation. Research is not a hardware test.

## Source kit

[leonarda4/photolipsia-agentic-kit](https://github.com/leonarda4/photolipsia-agentic-kit), inspected at commit [`49d501e551e4e2a1e2c96af3a95666ac32e97dff`](https://github.com/leonarda4/photolipsia-agentic-kit/tree/49d501e551e4e2a1e2c96af3a95666ac32e97dff), forked from Max Rheiner's `xohm/photolipsia-agentic-kit`.

Adapted ideas: shared `AGENTS.md`, the `CLAUDE.md` bridge, persistent `ai/strategy.md`, small plan/build/check/log steps, a browser report plus screenshot, and ignored scan assets. Relevant originals: [agent rules](https://github.com/leonarda4/photolipsia-agentic-kit/blob/49d501e551e4e2a1e2c96af3a95666ac32e97dff/02-splat-viewer/AGENTS.md), [viewer guide](https://github.com/leonarda4/photolipsia-agentic-kit/blob/49d501e551e4e2a1e2c96af3a95666ac32e97dff/guides/02-splat-viewer-alone.md), [teacher setup](https://github.com/leonarda4/photolipsia-agentic-kit/blob/49d501e551e4e2a1e2c96af3a95666ac32e97dff/docs/teacher-setup.md).

Changes for Calibrated: physical registration and recovery gates; wireless Windows baseline; separate human hardware evidence; real-scale XR; no miniature rig scaling or artificial locomotion. Tool-specific permission files and course account settings were not copied.

The kit's skeleton/code is MIT licensed, copyright 2026 Max Rheiner; its notice is retained in [licenses/photolipsia-MIT.txt](../licenses/photolipsia-MIT.txt). Its explanatory material is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), attributed above. These notices identify upstream terms and do not choose a blanket licence for all new project work.

## Technical evidence

| Primary source | What it informs |
| --- | --- |
| [Chromium XR platform support](https://chromium.googlesource.com/chromium/src/+/main/device/vr/) | Windows OpenXR support and the VR/AR distinction |
| [Meta Link development guide](https://developers.meta.com/vr/documentation/unity/unity-link/) | Windows support, Quest compatibility, active runtime; native feature settings do not prove browser exposure |
| [Meta PC requirements](https://www.meta.com/help/quest/articles/headsets-and-accessories/oculus-link/requirements-quest-link/) | Actual PC/GPU compatibility check |
| [Meta support's Air Link guidance](https://communityforums.atmeta.com/discussions/OtherTroubleshooting/3s-air-link-not-working/1345035/replies/1345046) | PC Ethernet and headset wireless topology recommendations; authored by Meta support |
| [Immersive Web VR sample](https://immersive-web.github.io/webxr-samples/immersive-vr-session.html) | Independent first runtime probe |
| [WebXR Device API](https://www.w3.org/TR/webxr/) | Coordinates, reference spaces, input poses, session lifecycle and reset semantics |
| [Meta browser mixed reality](https://developers.meta.com/vr/documentation/web/webxr-mixed-reality/) | Quest Browser capability branch; not evidence for PC Link parity |
| [Spark getting started](https://sparkjs.dev/docs/), [SplatMesh](https://sparkjs.dev/docs/splat-mesh/), [SparkRenderer](https://sparkjs.dev/docs/spark-renderer/) | Candidate rendering pipeline, asset transformations, and quality controls |
| [Umeyama: Least-Squares Estimation of Transformation Parameters Between Two Point Patterns](https://web.stanford.edu/class/cs273/refs/umeyama.pdf) | General rigid/similarity-fit reference for diagnostics; MVP constrains rotation to yaw |

Calibration workflow, milestones, and numerical acceptance targets are project proposals. They are not guarantees made by the hardware vendor or these sources.
