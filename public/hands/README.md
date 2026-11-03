# Bundled WebXR hands

`left.glb` and `right.glb` are the public `generic-hand` skinned models from `@webxr-input-profiles/assets@1.0`, the same source used by the installed Three.js r180 `XRHandMeshModel` and `OculusHandModel`. They are generic WebXR hands, not the native Meta compositor's system-hand rendering.

Downloaded 2026-11-03 from:

- [left.glb](https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/left.glb)
- [right.glb](https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/right.glb)
- [upstream package licence](https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/LICENSE.md)

MIT License, Copyright (c) 2019 Amazon. The unmodified licence is included as [LICENSE.txt](LICENSE.txt) for built-site redistribution and [webxr-input-profiles-MIT.txt](../../licenses/webxr-input-profiles-MIT.txt) in the repository's licence directory.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| left.glb | 94572 | bc67783144944ea1cda54d9247885825ea5fb9d4651469fe7d00be517a5c2b87 |
| right.glb | 94004 | 291790c14f7f88a7f9bd35330c47392ed8e8d395ae6728f4bb7089f1bc1f2b96 |

Both GLB v2 models have the standard 25 WebXR joints as siblings under an identity `Armature` node. The adapter assigns current reference-space positions and orientations directly to those joints, matching r180's pose convention. It replaces the original lit material with a neutral unlit material because the splat viewer does not require lights. Missing joint poses fall back to the local joint/bone visual; missing or emulated fingertip poses have no contact authority.

The hand-model scenario in `npm run check` renders these actual models with synthetic joints and writes `.check/hands.png` and `.check/hands-report.json`. This desktop check does not establish Steam Link joint availability or hardware tracking accuracy.
