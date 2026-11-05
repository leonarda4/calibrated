#!/usr/bin/env python3
"""Checks the v3 floor fog export.

Usage:
    python3 tools/check_fog_assets.py public/effects/fog

Plain Python 3, no packages. Exit code 0 = all good, 1 = problems found.
"""
import json
import os
import sys

problems = []


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else "public/effects/fog"
    bin_path = os.path.join(folder, "floor_fog_v3_density.bin")
    json_path = os.path.join(folder, "floor_fog_v3_density.json")
    for p in (bin_path, json_path):
        if not os.path.isfile(p):
            problems.append("missing file %s" % p)
    if problems:
        return report()
    meta = json.load(open(json_path))
    for key in ("resolution", "fogHeight", "boundsMin", "boundsMax", "meanDensityPerHeightLayer"):
        if key not in meta:
            problems.append("JSON is missing '%s'" % key)
    if problems:
        return report()
    nx, ny, nz = meta["resolution"]
    data = open(bin_path, "rb").read()
    if len(data) != nx * ny * nz:
        problems.append("bin has %d bytes, expected %d x %d x %d = %d"
                        % (len(data), nx, ny, nz, nx * ny * nz))
        return report()

    def at(i, j, k):
        return data[i + nx * (j + ny * k)] / 255.0

    # seams: difference across the wrap should be like a normal neighbour step
    def mean_abs(pairs):
        pairs = list(pairs)
        return sum(abs(a - b) for a, b in pairs) / max(len(pairs), 1)

    js = range(0, ny, max(1, ny // 8))
    seam_x = mean_abs((at(0, j, k), at(nx - 1, j, k)) for j in js for k in range(0, nz, 4))
    step_x = mean_abs((at(0, j, k), at(1, j, k)) for j in js for k in range(0, nz, 4))
    seam_z = mean_abs((at(i, j, 0), at(i, j, nz - 1)) for j in js for i in range(0, nx, 2))
    step_z = mean_abs((at(i, j, 0), at(i, j, 1)) for j in js for i in range(0, nx, 2))
    for name, seam, step in (("X", seam_x, step_x), ("Z", seam_z, step_z)):
        if seam > 3 * step + 0.01:
            problems.append("visible seam in %s (%.3f across the wrap vs %.3f normal)" % (name, seam, step))
    filled = sum(1 for b in data if b) / float(len(data))
    if filled < 0.05:
        problems.append("only %.0f%% of voxels contain fog; the export may be empty" % (filled * 100))
    layers = meta["meanDensityPerHeightLayer"]
    top = max([j for j, v in enumerate(layers) if v > 0.005] or [0])
    h = meta["fogHeight"]
    print("  %d x %d x %d voxels, fog height %.2f m, %.0f%% of voxels contain fog"
          % (nx, ny, nz, h, filled * 100))
    print("  mean density: %.3f at the floor, %.3f at half height, fog reaches about %.2f m"
          % (layers[0], layers[len(layers) // 2], (top + 1) * h / ny))
    print("  seams: X %.3f vs %.3f, Z %.3f vs %.3f (wrap vs normal step)"
          % (seam_x, step_x, seam_z, step_z))
    report()


def report():
    if problems:
        print("PROBLEMS:")
        for p in problems:
            print("  - " + p)
        sys.exit(1)
    print("OK: fog assets look consistent.")


if __name__ == "__main__":
    main()
