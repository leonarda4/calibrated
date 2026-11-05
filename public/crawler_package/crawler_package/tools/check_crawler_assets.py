#!/usr/bin/env python3
"""Checks the crawler export before it goes into the app.

Usage (from the repo root, or anywhere):
    python3 tools/check_crawler_assets.py public/effects/crawler

Checks crawler_v4.glb and crawler_v4_anim.json against each other and against
what the crawler handoff expects. Plain Python 3, no packages needed.
Exit code 0 = all good, 1 = problems found.
"""
import json
import math
import os
import struct
import sys

EXPECTED_MESHES = {"crawler_body", "crawler_core"}
EXPECTED_ATTRS = {"POSITION": "VEC3", "NORMAL": "VEC3", "_FLUTTER": "SCALAR", "_S": "SCALAR",
                  "_PART": "SCALAR", "_TID": "SCALAR", "_PULL": "VEC3", "_RISE": "VEC3"}
TRACKS = ["progress", "arm_l", "arm_r", "lift_l", "lift_r", "twitch"]

problems = []
notes = []


def fail(msg):
    problems.append(msg)


def read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        fail("%s is not a glTF 2.0 binary file" % path)
        return None, None
    if length != len(data):
        fail("GLB header length %d does not match file size %d" % (length, len(data)))
    jlen, jtype = struct.unpack_from("<II", data, 12)
    gltf = json.loads(data[20:20 + jlen].decode("utf-8"))
    off = 20 + jlen
    blen, btype = struct.unpack_from("<II", data, off)
    return gltf, data[off + 8:off + 8 + blen]


def accessor_floats(gltf, binary, idx):
    acc = gltf["accessors"][idx]
    view = gltf["bufferViews"][acc["bufferView"]]
    comps = {"SCALAR": 1, "VEC3": 3}[acc["type"]]
    n = acc["count"] * comps
    return struct.unpack_from("<%df" % n, binary, view.get("byteOffset", 0) + acc.get("byteOffset", 0))


def check_glb(path):
    gltf, binary = read_glb(path)
    if gltf is None:
        return None
    names = {m["name"] for m in gltf.get("meshes", [])}
    if names != EXPECTED_MESHES:
        fail("meshes are %s, expected %s" % (sorted(names), sorted(EXPECTED_MESHES)))
    info = {}
    for mesh in gltf.get("meshes", []):
        prim = mesh["primitives"][0]
        attrs = prim["attributes"]
        missing = set(EXPECTED_ATTRS) - set(attrs)
        if missing:
            fail("%s is missing attributes %s" % (mesh["name"], sorted(missing)))
        counts = set()
        for name, kind in EXPECTED_ATTRS.items():
            if name not in attrs:
                continue
            acc = gltf["accessors"][attrs[name]]
            counts.add(acc["count"])
            if acc["type"] != kind or acc["componentType"] != 5126:
                fail("%s.%s should be float %s" % (mesh["name"], name, kind))
        if len(counts) > 1:
            fail("%s attributes have different vertex counts %s" % (mesh["name"], counts))
        idx = gltf["accessors"][prim["indices"]]
        if idx["count"] % 3:
            fail("%s index count is not a multiple of 3" % mesh["name"])
        pos = accessor_floats(gltf, binary, attrs["POSITION"])
        ys = pos[1::3]
        zs = pos[2::3]
        if min(ys) < -0.001:
            fail("%s has vertices below the floor (min y %.3f)" % (mesh["name"], min(ys)))
        parts = set(round(v) for v in accessor_floats(gltf, binary, attrs["_PART"]))
        nrm = accessor_floats(gltf, binary, attrs["NORMAL"])
        bad = sum(1 for i in range(0, len(nrm), 3)
                  if abs(math.sqrt(nrm[i] ** 2 + nrm[i + 1] ** 2 + nrm[i + 2] ** 2) - 1) > 0.01)
        if bad:
            fail("%s has %d normals that are not unit length" % (mesh["name"], bad))
        info[mesh["name"]] = {"points": counts.pop() if counts else 0,
                              "triangles": idx["count"] // 3,
                              "parts": sorted(parts), "zmin": min(zs), "zmax": max(zs)}
    if "crawler_body" in info and info["crawler_body"]["parts"] != [0, 1, 3]:
        fail("crawler_body should contain parts 0, 1, 3, found %s" % info["crawler_body"]["parts"])
    if "crawler_core" in info and info["crawler_core"]["parts"] != [2]:
        fail("crawler_core should contain part 2, found %s" % info["crawler_core"]["parts"])
    return info


def check_json(path, info):
    with open(path) as fh:
        meta = json.load(fh)
    for key in ("phases", "path", "tracks", "motion", "look", "extentZ", "counts"):
        if key not in meta:
            fail("JSON is missing '%s'" % key)
    if problems:
        return meta
    ph = meta["phases"]
    rate = meta["tracks"].get("rate")
    expected = int(math.ceil(ph["endTime"] * rate)) + 1
    for name in TRACKS:
        vals = meta["tracks"].get(name)
        if vals is None:
            fail("track '%s' missing" % name)
            continue
        if len(vals) != expected:
            fail("track '%s' has %d samples, expected %d" % (name, len(vals), expected))
        if min(vals) < -0.05 or max(vals) > 1.05:
            fail("track '%s' leaves the 0..1 range (%.3f .. %.3f)" % (name, min(vals), max(vals)))
    prog = meta["tracks"].get("progress", [])
    if prog:
        if abs(prog[0]) > 1e-3 or abs(prog[-1] - 1) > 1e-3:
            fail("progress should go from 0 to 1 (got %.3f .. %.3f)" % (prog[0], prog[-1]))
        if any(b < a - 1e-4 for a, b in zip(prog, prog[1:])):
            fail("progress goes backwards somewhere")
    if not (0 < ph["bodyStart"] < ph["crawlEnd"] < ph["endTime"]):
        fail("phase times are out of order")
    for mesh, c in meta["counts"].items():
        if info and mesh in info and (c["points"] != info[mesh]["points"]
                                      or c["triangles"] != info[mesh]["triangles"]):
            fail("JSON counts for %s do not match the GLB" % mesh)
    if info and "crawler_body" in info:
        front = meta["extentZ"]["frontReach"]
        if abs(front - max(info[m]["zmax"] for m in info)) > 0.01:
            fail("extentZ.frontReach %.3f does not match the GLB (%.3f)"
                 % (front, max(info[m]["zmax"] for m in info)))
    a, b = meta["path"]["start"], meta["path"]["end"]
    dist = math.sqrt(sum((b[i] - a[i]) ** 2 for i in range(3)))
    notes.append("path %.2f m in %.1f s of crawling, stride %.2f m, everything gone at %.1f s"
                 % (dist, ph["crawlEnd"] - ph["bodyStart"] - ph["bodyEmerge"],
                    meta["path"]["actualStride"], ph["endTime"]))
    notes.append("front reach %.2f m ahead of the origin: stop distance must be measured from there"
                 % meta["extentZ"]["frontReach"])
    return meta


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else "public/effects/crawler"
    glb = os.path.join(folder, "crawler_v4.glb")
    js = os.path.join(folder, "crawler_v4_anim.json")
    for p in (glb, js):
        if not os.path.isfile(p):
            fail("missing file %s" % p)
    info = check_glb(glb) if os.path.isfile(glb) else None
    if os.path.isfile(js):
        check_json(js, info)
    if info:
        for name, i in info.items():
            notes.insert(0, "%s: %d points, %d triangles, parts %s"
                         % (name, i["points"], i["triangles"], i["parts"]))
    sprite = os.path.join(folder, "..", "dust", "dust_sprite.png")
    if not os.path.isfile(sprite):
        notes.append("note: %s not found (needed for halo and wisps)" % os.path.normpath(sprite))
    for n in notes:
        print("  " + n)
    if problems:
        print("PROBLEMS:")
        for p in problems:
            print("  - " + p)
        sys.exit(1)
    print("OK: crawler assets look consistent.")


if __name__ == "__main__":
    main()
