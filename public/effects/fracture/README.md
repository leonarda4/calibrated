# Fracture animation

Prepare the supplied `public/fracture_nowall.abc` locally with:

```powershell
node scripts/prepare-fracture.mjs
```

The output is `public/effects/fracture/fracture.glb` plus `fracture.meta.json`.
Both derivatives are Git-ignored. Repeat with `--force` to replace only those
outputs. The original Alembic is read without modification. No installed DCC,
conversion service, Python package, account, or network request is required.

The bounded Node converter supports the inspected Blender4.1/Alembic1.8 Ogawa
profile:42 static polygon fragments and300 uniform full-matrix transform samples
at30fps. Unsupported topology changes, transform operations, property layouts,
nonfinite data, excessive input sizes, and non-rigid fragment samples fail with
an error. Camera, Light, and the unrelated static `Wall_left` are excluded;
the42 actual `Dissolve_left_cell` objects supply all rendered debris.

Polygon triangulation preserves indexed geometry, source face-varying normals,
and indexed UV seams. No geometry or animation is invented. Alembic supplies no
PBR material, so the GLB contains one neutral rough material for the runtime to
tint. Its root applies a rigid bottom-centre translation and180-degree Y turn:
the initial panel occupies local XY, up is +Y, and the panel faces +Z. Original
debris travels in both normal directions; runtime clipping must keep its
rendering inside the intended effect region. Geometry remains in its original units; the initial panel is
approximately7.938m wide,4.111m high, and1.032m thick. Runtime placement/scaling
belongs to the effect controller.

The single clip is named `fracture`. Its300 source samples begin at source
time1/30s and end at10s; the GLB uses relative time0..9.9667s. The sidecar records
initial/all-frame bounds, original/output SHA256, source and seam-split vertex
counts, triangle/track counts, uniform timing, and a suggested strong-motion
window. `activeWindow` currently covers relative0.1667..2.4667s; rendering this
window over1.8s uses a time scale of approximately1.2778. The later source frames
remain available and retain their original tumbling/drift rather than being
silently removed.

Preparation verifies all fragments with the pinned Three.js GLTFLoader, then
samples the loaded AnimationMixer at the initial pose, strongest impact,
suggested window end, and final pose. Those168 loaded world matrices must match
the source rigid transforms within2e-5 before output is written. This checks the
derived asset; it does not establish XR performance, physical clearance, or the
runtime effect's protected-region clipping.
