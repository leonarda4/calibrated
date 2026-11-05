# Crawler package: what to do

This folder is everything your teammate's agent needs to bring the crawler ghost into Calibrated. Two files are still missing, because they come from your Houdini export.

## 1. Export from Houdini

1. In Houdini, open the Python Shell and run (starting directly with `exec`):

   ```python
   exec(open(hou.text.expandString("$HOME/Desktop/calibrated_fx/crawler_package/tools/crawler_v4_fix2.py")).read())
   ```

   A copy of the script is in `tools/crawler_v4_fix2.py` here, in case the Downloads one is gone.
2. It writes `crawler_v4.glb` and `crawler_v4_anim.json` to `~/Desktop/calibrated_fx/`.
3. If it prints an error, send the error text to Claude.

## 2. Fill the package

Copy the files into this package:

| From `calibrated_fx` | To this package |
| --- | --- |
| `crawler_v4.glb` | `public/effects/crawler/` |
| `crawler_v4_anim.json` | `public/effects/crawler/` |
| `dust_sprite.png` (from the dust lesson) | `public/effects/dust/` |

Or tell Claude "the export is done" and Claude will copy and check them for you.

## 3. Check the files

In Terminal, from this folder:

```
python3 tools/check_crawler_assets.py public/effects/crawler
```

It should end with `OK: crawler assets look consistent.`

## 4. Hand it over

Give the whole folder to your teammate, together with `AGENT_TASK.md`. That file tells the agent the order of work, where each file goes in the repo, and which decisions it must ask you about:

- when the crawler plays (trigger)
- how close it may come (stop distance, at least 1.5 m from the tentacle tips)
- whether it turns with the hallway during the 180 degree turn
- sound
- the glow strength, compared against `reference/crawler_v4_target_look.png`
- whether the hallway dims while the crawler is out

The agent commits locally only. You push with GitHub Desktop, as usual.
