# Room mist package: what to do

## 1. Export from Houdini

In the Python Shell, run (starting directly with `exec`):

```python
exec(open(hou.text.expandString("$HOME/Desktop/calibrated_fx/mist_package/tools/room_mist_v1.py")).read())
```

It builds `/obj/room_mist_v1` (a 2.5 x 2.6 x 8 m mist block) and writes the two mist files into `public/effects/mist/` in this package. Press play to watch it drift.

To change the look, use the sliders on `room_mist_v1/mist_density`, then run the same line again:

- **Billow Scale**: smaller value = bigger, softer patches.
- **Layering**: higher = flatter, layered mist.
- **Thinnest Mist**: how clear the clearest spots get.
- **Contrast Low / High**: how strong the difference between patches is.
- **Wisp Streaks**: faint streaks along the hallway.
- **Denser Near Floor**: also used by the app.
- **Preview Density**: only for how thick it looks in Houdini.

## 2. Check

Tell Claude "mist export done", or run in Terminal from this folder:

```
python3 tools/check_volume_assets.py public/effects/mist room_mist_v1_density
```

## 3. Hand over

Give your teammate the whole folder; the agent starts with `ROOM_MIST_HANDOFF_v2.md`. Decisions for you: default density, when the mist is on, and whether it turns with the hallway.
