# Splat assets

Private Gaussian-splat scans of the hallway stay **local only** and are
excluded from Git by `.gitignore` (`*.ply` and friends are ignored).

The active source is `hallway3/hallway3_0.ply`, the original uncompressed
2,109,500-splat INRIA-style export. The source is required locally and is
never downloaded or committed by the app.

The optional wall object is `wall-section/wall-section.ply`. Generate it
with `npm run scan:extract-wall` after placing the active original source.
An existing crop requires `npm run scan:extract-wall -- --force` to replace
only the derivative. Its adjacent `.meta.json` records the source fingerprint,
crop dimensions and scan evidence; `.preview.png` shows its elevation.
The whole wall-section directory remains ignored.

The crop preserves the original Gaussian colours, opacity and scales and
rotates its positions, normals and Gaussian orientations into a reusable
bottom-centred object frame. It uses a door-free graffiti wall, 2.10 m wide
and 2.60 m high from the visible scan floor to wall top. Height and metric
registration still require physical verification. Configure the source crop
and cross-hallway station in `src/viewer/wallSectionConfig.ts`.

Deliberately public synthetic fixtures belong in `tests/fixtures/synthetic/`
instead, which is tracked.
