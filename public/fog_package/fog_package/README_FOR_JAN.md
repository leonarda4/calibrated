# Fog v3 package (80 cm): what to do

## 1. Export from Houdini

In the Python Shell, run (starting directly with `exec`):

```python
exec(open(hou.text.expandString("$HOME/Desktop/calibrated_fx/fog_package/tools/floor_fog_v3.py")).read())
```

It builds `/obj/floor_fog_v3` next to your older fogs and writes the two fog files straight into `public/effects/fog/` in this package. Press play to watch the preview. To change the look, use the sliders on `floor_fog_v3/fog_density`, then run the same line again.

## 2. Check

Tell Claude "fog export done", or run in Terminal from this folder:

```
python3 tools/check_fog_assets.py public/effects/fog
```

## 3. Hand over

Give your teammate the whole folder. The agent reads `volumetric_fog_handoff.md` (the base spec) and then `FOG_V3_ADDENDUM.md` (what changes at 80 cm). Decisions for you are in the addendum: the box safety rules are now mandatory, and whether the fog should thin out around the crawler.
