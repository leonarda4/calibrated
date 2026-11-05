# Room mist v1: soft haze filling the whole hallway, floor to ceiling.
# Build, preview and export in one script.
#
# Run in Houdini's Python Shell with:
#   exec(open(hou.text.expandString("$HOME/Desktop/calibrated_fx/mist_package/tools/room_mist_v1.py")).read())
#
# First run: builds /obj/room_mist_v1 (preview + bake branch) and exports.
# Later runs: keeps your sliders, updates the code, re-exports.
# Writes to ~/Desktop/calibrated_fx/mist_package/public/effects/mist/:
#   room_mist_v1_density.bin   raw 8-bit density variation, x fastest, then y, then z
#   room_mist_v1_density.json  size, voxel size, axes, tiling, slider values
# It never changes your fog networks.

import hou
import json
import os

GEO_NAME = "room_mist_v1"
OUT_DIR = hou.text.expandString("$HOME/Desktop/calibrated_fx/mist_package/public/effects/mist")
FILE_BASE = "room_mist_v1_density"
TILE_X = 2.5      # across (m): hallway plus a little through the walls
HEIGHT = 2.6      # floor to ceiling (m)
TILE_Z = 8.0      # along (m)
DIVISIONS = 160   # along the longest axis (8 m) -> 5 cm voxels; mist has no fine detail

# The mist look. Returns (soft billows, wisp streaks) for one position.
MIST_FUNC = """vector mistparts(vector P; float swirl, scale, flat) {
    vector w = curlnoise(P * 0.25) * swirl;
    vector q = (P + w) * scale;
    // soft billows, a little flattened so the mist lies in loose layers
    float base = 0;
    float amp = 0.5;
    vector f = q * set(1, flat, 1);
    for (int i = 0; i < 4; i++) {
        base += amp * noise(f);
        f *= 2.1;
        amp *= 0.5;
    }
    // faint streaks drifting along the hallway
    float streak = noise(q * set(1.5, 4.0, 0.4) + 7.3);
    return set(base, streak, 0);
}
float mistvalue(vector m; float floorv, lo, hi, wisp) {
    float d = fit(m.x, lo, hi, floorv, 1.0);
    d += wisp * smooth(0.55, 0.8, m.y);
    return clamp(d, 0, 1);
}
"""

PREVIEW_SNIPPET = MIST_FUNC + """float t = @Time * chf("speed");
vector p = @P + set(t * 0.03, 0, t * 0.08);
vector m = mistparts(p, chf("swirl"), chf("scale"), chf("flatten"));
float d = mistvalue(m, chf("min_density"), chf("contrast_low"), chf("contrast_high"), chf("wisps"));
// the app adds these two in the shader; shown here so the preview matches
float low = lerp(1.0, chf("ground_boost"), 1 - smooth(0.0, 1.2, @P.y));
@density = d * low * chf("preview_density");
"""

BAKE_SNIPPET = MIST_FUNC + """string n = "../mist_density/";
float swirl = ch(n + "swirl");
float sc    = ch(n + "scale");
float fl    = ch(n + "flatten");
float mn    = ch(n + "min_density");
float lo    = ch(n + "contrast_low");
float hi    = ch(n + "contrast_high");
float wi    = ch(n + "wisps");
float LX = chf("tile_x");
float LZ = chf("tile_z");
// blend four shifted copies so the block repeats seamlessly in X and Z
float u = clamp((@P.x + LX * 0.5) / LX, 0, 1);
float v = clamp((@P.z + LZ * 0.5) / LZ, 0, 1);
vector a = mistparts(@P,                  swirl, sc, fl);
vector b = mistparts(@P - set(LX, 0, 0),  swirl, sc, fl);
vector c = mistparts(@P - set(0, 0, LZ),  swirl, sc, fl);
vector d = mistparts(@P - set(LX, 0, LZ), swirl, sc, fl);
vector m = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
// stored as local variation 0..1; overall density and the ground boost are applied in the app
@density = mistvalue(m, mn, lo, hi, wi);
"""

SLIDERS = [  # name, label, default, min, max
    ("scale", "Billow Scale (1/m)", 0.6, 0.1, 3.0),
    ("flatten", "Layering (1 = round)", 1.6, 0.5, 4.0),
    ("min_density", "Thinnest Mist (0..1)", 0.35, 0.0, 1.0),
    ("contrast_low", "Contrast Low", 0.35, 0.0, 1.0),
    ("contrast_high", "Contrast High", 0.65, 0.0, 1.0),
    ("wisps", "Wisp Streaks", 0.25, 0.0, 1.0),
    ("swirl", "Swirl", 0.5, 0.0, 2.0),
    ("speed", "Drift Speed", 1.0, 0.0, 5.0),
    ("ground_boost", "Denser Near Floor (preview + app)", 1.6, 1.0, 4.0),
    ("preview_density", "Preview Density (preview only)", 0.15, 0.0, 1.0),
]


def set_parm(node, names, value):
    values = value if isinstance(value, tuple) else (value,)
    for name in names:
        tup = node.parmTuple(name)
        if tup is not None:
            try:
                tup.set(values)
                return True
            except Exception as err:
                print("Could not set %s on %s: %s" % (name, node.name(), err))
    print("NOT SET on %s: tried %s" % (node.name(), names))
    return False


def size_volume(vol, width, height, length):
    ok = set_parm(vol, ["name"], "density")
    ok &= set_parm(vol, ["size"], (width, height, length))
    ok &= set_parm(vol, ["t", "center"], (0.0, height * 0.5, 0.0))
    ok &= set_parm(vol, ["samplediv"], DIVISIONS)
    if not ok:
        print("Parameters on %s: %s" % (vol.name(), ", ".join(p.name() for p in vol.parms())))


def build(obj):
    geo = obj.createNode("geo", GEO_NAME)
    vol = geo.createNode("volume", "mist_volume")
    wr = geo.createNode("volumewrangle", "mist_density")
    wr.setInput(0, vol)
    ptg = wr.parmTemplateGroup()
    folder = hou.FolderParmTemplate("mist_controls", "Mist Controls")
    for name, label, default, lo, hi in SLIDERS:
        folder.addParmTemplate(hou.FloatParmTemplate(
            name, label, 1, default_value=(default,), min=lo, max=hi))
    ptg.append(folder)
    wr.setParmTemplateGroup(ptg)
    out = geo.createNode("null", "OUT_mist")
    out.setInput(0, wr)
    out.setDisplayFlag(True)
    out.setRenderFlag(True)

    bvol = geo.createNode("volume", "bake_volume")
    bake = geo.createNode("volumewrangle", "bake_density")
    bake.setInput(0, bvol)
    ptg = bake.parmTemplateGroup()
    tf = hou.FolderParmTemplate("tile_controls", "Tile")
    tf.addParmTemplate(hou.FloatParmTemplate("tile_x", "Tile X (m)", 1, default_value=(TILE_X,)))
    tf.addParmTemplate(hou.FloatParmTemplate("tile_z", "Tile Z (m)", 1, default_value=(TILE_Z,)))
    ptg.append(tf)
    bake.setParmTemplateGroup(ptg)
    bout = geo.createNode("null", "OUT_bake")
    bout.setInput(0, bake)
    geo.layoutChildren()
    print("Built %s." % geo.path())
    return geo


def export(geo):
    bake = geo.node("bake_density")
    hou.setFrame(1)
    g = bake.geometry()
    vols = [p for p in g.prims() if isinstance(p, hou.Volume)]
    if not vols:
        print("bake_density has no volume. Check it for a red error badge.")
        return
    vol = vols[0]
    res = tuple(vol.resolution())
    print("Bake resolution: %d x %d x %d" % res)
    values = vol.allVoxels()
    probes = [(1, 0, 0), (0, 1, 0), (0, 0, 1), (res[0] - 1, res[1] - 1, res[2] - 1)]
    xyz_ok = all(abs(values[i + res[0] * (j + res[1] * k)] - vol.voxel((i, j, k))) < 1e-6
                 for (i, j, k) in probes)
    if not xyz_ok:
        print("Reordering voxels (this takes a moment)...")
        values = [vol.voxel((i, j, k))
                  for k in range(res[2]) for j in range(res[1]) for i in range(res[0])]
    data = bytes(max(0, min(255, int(v * 255.0 + 0.5))) for v in values)

    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)
    bin_path = os.path.join(OUT_DIR, FILE_BASE + ".bin")
    json_path = os.path.join(OUT_DIR, FILE_BASE + ".json")
    with open(bin_path, "wb") as fh:
        fh.write(data)

    bbox = g.boundingBox()
    mist = geo.node("mist_density")
    sliders = {name: mist.parm(name).eval() for name, _, _, _, _ in SLIDERS}
    nx, ny, nz = res
    per_layer = []
    for j in range(ny):
        total = 0
        for k in range(0, nz, 2):
            row = (j + ny * k) * nx
            total += sum(data[row:row + nx])
        per_layer.append(round(total / (255.0 * nx * len(range(0, nz, 2))), 4))
    meta = {
        "file": FILE_BASE + ".bin",
        "encoding": "uint8, linear local mist variation 0..1 (value / 255); "
                    "overall density and ground boost are applied in the app",
        "order": "x fastest, then y, then z (matches THREE.Data3DTexture)",
        "resolution": list(res),
        "voxelSize": [(bbox.maxvec()[a] - bbox.minvec()[a]) / res[a] for a in range(3)],
        "boundsMin": list(bbox.minvec()),
        "boundsMax": list(bbox.maxvec()),
        "fogHeight": HEIGHT,
        "axes": "metres, Y up from the floor, X across the hallway, Z along the hallway",
        "tiling": "seamless in X (period %.2f m) and Z (period %.2f m); not in Y" % (TILE_X, TILE_Z),
        "meanDensityPerHeightLayer": per_layer,
        "groundBoost": sliders["ground_boost"],
        "houdiniSliders": sliders,
        "source": "%s/bake_density, frame 1, Houdini %s" % (geo.path(), hou.applicationVersionString()),
    }
    with open(json_path, "w") as fh:
        json.dump(meta, fh, indent=2)
    print("Wrote %s (%.2f MB)" % (bin_path, len(data) / 1e6))
    print("Wrote %s" % json_path)
    print("Mean variation: %.2f (0 = clear, 1 = full mist)" % (sum(data) / (255.0 * len(data))))


def main():
    obj = hou.node("/obj")
    geo = obj.node(GEO_NAME)
    if geo is None:
        geo = build(obj)
    else:
        print("Found %s, keeping your sliders and updating the code." % geo.path())
    size_volume(geo.node("mist_volume"), TILE_X, HEIGHT, TILE_Z)
    size_volume(geo.node("bake_volume"), TILE_X, HEIGHT, TILE_Z)
    geo.node("mist_density").parm("snippet").set(PREVIEW_SNIPPET)
    geo.node("bake_density").parm("snippet").set(BAKE_SNIPPET)
    export(geo)
    print("Press play to watch the preview. Tune the sliders on mist_density, then run again.")


main()
