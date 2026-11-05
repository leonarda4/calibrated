# Floor fog v3: up to 80 cm tall, rolling billows over a dense ground layer.
# Build, preview and export in one script.
#
# Run in Houdini's Python Shell with:
#   exec(open(hou.text.expandString("$HOME/Desktop/calibrated_fx/fog_package/tools/floor_fog_v3.py")).read())
#
# First run: builds /obj/floor_fog_v3 (preview + bake branch) and exports.
# Later runs: keeps your sliders, updates the code, and re-exports.
# Writes to ~/Desktop/calibrated_fx/fog_package/public/effects/fog/:
#   floor_fog_v3_density.bin   raw 8-bit density, x fastest, then y, then z
#   floor_fog_v3_density.json  size, voxel size, axes, tiling, slider values
# It never deletes or changes your older fog networks.

import hou
import json
import os

GEO_NAME = "floor_fog_v3"
OUT_DIR = hou.text.expandString("$HOME/Desktop/calibrated_fx/fog_package/public/effects/fog")
FILE_BASE = "floor_fog_v3_density"
HALLWAY_W = 2.1     # preview box width (m)
TILE_X = 2.4        # baked tile, across (m)
TILE_Z = 6.0        # baked tile, along (m)
DIVISIONS = 400     # along the longest axis (6 m) -> 1.5 cm voxels

# The fog look, shared by the animated preview and the tileable bake.
# Returns (local fog top height, raw puff value, ground layer amount).
FOG_FUNC = """vector fogparts(vector P; float swirl, pf, dmin, dmax, vstretch) {
    vector w = curlnoise(P * set(0.6, 1.0, 0.3)) * swirl;
    vector q = P + w;
    // rolling surface: the fog reaches different heights in different places
    float top = fit(noise(set(q.x * 0.7, 0, q.z * 0.35)), 0.3, 0.7, dmin, dmax);
    // billowy puffs, a little taller than wide so they read as rising smoke
    float b = 0;
    float amp = 0.5;
    vector f = q * set(pf, pf / vstretch, pf);
    for (int i = 0; i < 4; i++) {
        b += amp * abs(noise(f) * 2 - 1);
        f *= 2.03;
        amp *= 0.5;
    }
    return set(top, b, 0);
}
"""

PREVIEW_SNIPPET = FOG_FUNC + """float t = @Time * chf("speed");
vector p = @P + set(t * 0.02, 0, t * 0.06);
vector m = fogparts(p, chf("swirl"), chf("puff_freq"), chf("depth_min"), chf("depth_max"),
                    chf("vertical_stretch"));
float top = m.x;
float puff = fit(m.y, chf("gap_low"), chf("gap_high"), 0, 1);
float body = 1 - smooth(top * chf("top_softness"), top, @P.y);
float ground = chf("ground_layer") * (1 - smooth(0.0, 0.15, @P.y));   // dense floor layer
float ends = 1 - smooth(2.4, 3.0, abs(@P.z));                           // preview only
@density = clamp((body * puff + ground * puff) * ends * chf("density_scale"), 0, 1);
"""

BAKE_SNIPPET = FOG_FUNC + """float swirl = ch("../fog_density/swirl");
float pf    = ch("../fog_density/puff_freq");
float dmin  = ch("../fog_density/depth_min");
float dmax  = ch("../fog_density/depth_max");
float vs    = ch("../fog_density/vertical_stretch");
float glo   = ch("../fog_density/gap_low");
float ghi   = ch("../fog_density/gap_high");
float soft  = ch("../fog_density/top_softness");
float gl    = ch("../fog_density/ground_layer");
float LX = chf("tile_x");
float LZ = chf("tile_z");
// blend four shifted copies so the block repeats seamlessly in X and Z
float u = clamp((@P.x + LX * 0.5) / LX, 0, 1);
float v = clamp((@P.z + LZ * 0.5) / LZ, 0, 1);
vector a = fogparts(@P,                  swirl, pf, dmin, dmax, vs);
vector b = fogparts(@P - set(LX, 0, 0),  swirl, pf, dmin, dmax, vs);
vector c = fogparts(@P - set(0, 0, LZ),  swirl, pf, dmin, dmax, vs);
vector d = fogparts(@P - set(LX, 0, LZ), swirl, pf, dmin, dmax, vs);
vector m = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
float top = m.x;
float puff = fit(m.y, glo, ghi, 0, 1);
float body = 1 - smooth(top * soft, top, @P.y);
float ground = gl * (1 - smooth(0.0, 0.15, @P.y));
// stored without density_scale; the app applies it
@density = clamp(body * puff + ground * puff, 0, 1);
"""

SLIDERS = [  # name, label, default, min, max
    ("fog_height", "Fog Box Height (m)", 0.8, 0.3, 1.5),
    ("depth_min", "Fog Depth Min (m)", 0.3, 0.0, 1.5),
    ("depth_max", "Fog Depth Max (m)", 0.8, 0.0, 1.5),
    ("top_softness", "Top Softness (0 soft .. 1 hard)", 0.3, 0.0, 0.9),
    ("ground_layer", "Ground Layer", 0.5, 0.0, 2.0),
    ("puff_freq", "Puff Frequency", 2.0, 0.5, 8.0),
    ("vertical_stretch", "Vertical Stretch", 1.25, 0.5, 3.0),
    ("gap_low", "Gaps (low)", 0.10, 0.0, 1.0),
    ("gap_high", "Gaps (high)", 0.45, 0.0, 1.0),
    ("swirl", "Swirl", 0.4, 0.0, 1.0),
    ("speed", "Speed", 1.0, 0.0, 5.0),
    ("density_scale", "Density Scale", 2.0, 0.0, 5.0),
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
    vol = geo.createNode("volume", "fog_volume")
    wr = geo.createNode("volumewrangle", "fog_density")
    wr.setInput(0, vol)
    ptg = wr.parmTemplateGroup()
    folder = hou.FolderParmTemplate("fog_controls", "Fog Controls")
    for name, label, default, lo, hi in SLIDERS:
        folder.addParmTemplate(hou.FloatParmTemplate(
            name, label, 1, default_value=(default,), min=lo, max=hi))
    ptg.append(folder)
    wr.setParmTemplateGroup(ptg)
    out = geo.createNode("null", "OUT_fog")
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
    for other in ("floor_fog", "floor_fog_v2", "fog_preview"):
        node = obj.node(other)
        if node is not None:
            node.setDisplayFlag(False)
    print("Built %s." % geo.path())
    return geo


def export(geo, height):
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
    fog = geo.node("fog_density")
    sliders = {name: fog.parm(name).eval() for name, _, _, _, _ in SLIDERS}
    # mean density per height layer, to see where the fog sits
    nx, ny, nz = res
    per_layer = []
    for j in range(ny):
        total = 0
        for k in range(0, nz, 4):
            row = (j + ny * k) * nx
            total += sum(data[row:row + nx])
        per_layer.append(round(total / (255.0 * nx * len(range(0, nz, 4))), 4))
    meta = {
        "file": FILE_BASE + ".bin",
        "encoding": "uint8, linear density 0..1 (value / 255), no density_scale applied",
        "order": "x fastest, then y, then z (matches THREE.Data3DTexture)",
        "resolution": list(res),
        "voxelSize": [(bbox.maxvec()[a] - bbox.minvec()[a]) / res[a] for a in range(3)],
        "boundsMin": list(bbox.minvec()),
        "boundsMax": list(bbox.maxvec()),
        "fogHeight": height,
        "axes": "metres, Y up from the floor, X across the hallway, Z along the hallway",
        "tiling": "seamless in X (period %.2f m) and Z (period %.2f m); not in Y" % (TILE_X, TILE_Z),
        "meanDensityPerHeightLayer": per_layer,
        "houdiniSliders": sliders,
        "source": "%s/bake_density, frame 1, Houdini %s" % (geo.path(), hou.applicationVersionString()),
    }
    with open(json_path, "w") as fh:
        json.dump(meta, fh, indent=2)
    nonzero = sum(1 for b in data if b > 0)
    print("Wrote %s (%.1f MB)" % (bin_path, len(data) / 1e6))
    print("Wrote %s" % json_path)
    print("Voxels with fog: %.0f%%" % (100.0 * nonzero / len(data)))
    top_layer = max([j for j, v in enumerate(per_layer) if v > 0.005] or [0])
    print("Fog reaches about %.2f m (mean density above 0.005)" % ((top_layer + 1) * height / ny))


def main():
    obj = hou.node("/obj")
    geo = obj.node(GEO_NAME)
    if geo is None:
        geo = build(obj)
    else:
        print("Found %s, keeping your sliders and updating the code." % geo.path())
    fog = geo.node("fog_density")
    height = fog.parm("fog_height").eval()
    size_volume(geo.node("fog_volume"), HALLWAY_W, height, TILE_Z)
    size_volume(geo.node("bake_volume"), TILE_X, height, TILE_Z)
    fog.parm("snippet").set(PREVIEW_SNIPPET)
    geo.node("bake_density").parm("snippet").set(BAKE_SNIPPET)
    export(geo, height)
    print("Press play to watch the preview. Tune the sliders on fog_density, then run again.")


main()
