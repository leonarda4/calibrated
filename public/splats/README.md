# Splat assets

The user-approved runtime assets below are shared through **Git LFS**, allowing
classmates to build and run a clone. Other exports, experimental crops, generated
previews and private session data remain excluded by `.gitignore`.

| Shared file | Bytes | Purpose |
| --- | ---: | --- |
| `hallway3/hallway3_0.ply` | 143,446,489 | Original uncompressed hallway |
| `wall-section/wall-section.ply` | 4,547,916 | Prepared two-sided moving wall |
| `WoodenBox.ply` | 1,875,651 | Both installation boxes |
| `broooooommm.ply` | 658,382 | Scanned broom |

`wall-section/wall-section.ply.meta.json` is also tracked for crop provenance.
The 24 narration clips under `public/audio/generated/`, `public/audio/light_flicker.mp3`
and the hand models under `public/hands/` are included through ordinary Git.
Playback and builds need no ElevenLabs key. See [clone and build](../../README.md#build-and-run-on-another-computer).

The active source is `hallway3/hallway3_0.ply`, the original uncompressed
2,109,500-splat INRIA-style export. Git LFS supplies it when cloning; the app
loads the checked-out local file and never downloads it from a third-party host.

The wall object is `wall-section/wall-section.ply`. It is required alongside
the hallway source at startup and remains hidden until Show wall. The prepared
crop is included; `npm run scan:extract-wall` is only needed to recreate it.
An existing crop requires `npm run scan:extract-wall -- --force` to replace
only the derivative. Its adjacent `.meta.json` records the source fingerprint,
crop dimensions and scan evidence; `.preview.png` shows its elevation.
The preview remains ignored; the PLY and provenance metadata are shared.

The crop preserves the original Gaussian colours, opacity and scales and
rotates its positions, normals and Gaussian orientations into a reusable
bottom-centred object frame. It uses a door-free graffiti wall, 2.10 m wide
and 2.60 m high from the visible scan floor to wall top. Height and metric
registration still require physical verification. Configure the source crop
and route defaults in `src/viewer/wallSectionConfig.ts`. At runtime, only the
object's X scale changes to span the current rotated/offset hallway section;
height and depth retain their authored dimensions. The default post-turn
route now runs from hallway Z=-8 toward -2, with its existing player-clearance
and delayed-entry guards.

Both sides use the good outward face: 33,437 original splats per copy,
66,874 total in the same asset/scene. The rear copy is rotated 180 degrees
about up, with its full Gaussian covariance rotated too. Each copy retains
the original 24 cm crop depth, with a 2 cm gap (50 cm total authored depth).
No scales are flattened. Both copies share the bottom-centre origin and all
positioning/animations. The shader clips each face at its own rectangle and
culls the inward copy independently for each eye to avoid poor reverse-side
bleed-through. Regenerate an older single-sided crop with the force command
above; no additional scene or runtime download is required.

Deliberately public synthetic fixtures belong in `tests/fixtures/synthetic/`
instead, which is tracked.

The supplied `WoodenBox.ply` (27,577 SH0 splats, 1,875,651 bytes) is shared
at this exact path. Both installation boxes preload hidden with the hallway
and share its renderer/sorter. `src/viewer/woodenBox.ts` corrects source -Z
upward and removes its 19-degree footprint heading before fitting the existing
36 x 36 x 43 cm box dimensions. Show/Hide rises from and sinks below the floor;
standing bases have no extra lift. The first box remains the fixed turn pivot;
the second retains its prepared world-Z station and physical wall side while
refitting one whole edge to the current selected wall. The source PLY remains
unchanged. Physical dimensions and registration still need an on-site check.

The supplied broom is `broooooommm.ply` (9,676 SH0 splats, 658,382 bytes).
Keep the checked-out asset at this exact path. It loads unchanged with the hallway and
wall, hidden until **Show broom**. The app rotates it bristles-down and places
its base at the current fitted hallway centre / floor Y / world Z = 6 m, at
its original scale. It follows the rotated hallway's lateral correction at
that station. Its original source is shared through LFS; no replacement asset
is generated.
Authored normalization is in `src/viewer/broomConfig.ts`; current scale and
floor contact still require physical verification.

The separate hallway object is `hallway-cut/hallway3-cut.ply`. It retains the
far corridor beyond a single transverse cut near the reference's FoodTech
writing (raw Y approximately 20.4). Generate it with
`node scripts/extract-hallway.mjs`; `--station rawY` adjusts only the new crop
and `--force` replaces the derivative. Its retained Gaussian records and raw
coordinates are unchanged, so the source scan's transform places it correctly.
An orthogonal corridor envelope retains 18 cm beyond the fitted walls, 15 cm
below the fitted floor and 2.85 m above it, excluding exterior-room scan debris.
The adjacent `.meta.json` records the source hash, fitted floor/walls and exact
cut plane. PLY cropping selects centres; Gaussian footprints retain soft edges.
It is private, ignored by Git and **not loaded into the application**. Run
`node scripts/check-hallway-crop.mjs` for standalone desktop previews and
byte-for-byte checks in `.check/hallway-cut/`; this never starts an XR session.
