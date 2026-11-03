import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { SplatBuffer } from '@mkkellogg/gaussian-splats-3d';
import { prepareScan } from '../scripts/prepare-scan.mjs';

function syntheticPly(points, degree = 0) {
  const rest = degree === 1 ? 9 : degree === 3 ? 45 : 0;
  const fields = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2',
    ...Array.from({ length: rest }, (_, i) => `f_rest_${i}`),
    'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${points.length}\n${fields.map((f) => `property float ${f}\n`).join('')}end_header\n`);
  const body = Buffer.alloc(points.length * fields.length * 4);
  points.forEach((point, index) => {
    const values = [...point, 0, 0, 0, 0.1, 0.2, 0.3, ...Array(rest).fill(0.025), 5, -2, -2, -2, 1, 0, 0, 0];
    values.forEach((value, field) => body.writeFloatLE(value, (index * fields.length + field) * 4));
  });
  return Buffer.concat([header, body]);
}

async function withScan(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'calibrated-scan-test-'));
  try { await run(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('offline conversion preserves raw coordinates and available SH; quantization stays bounded', async () => {
  await withScan(async (directory) => {
    const input = path.join(directory, 'synthetic.ply');
    const points = [[1.25, -4.12, 0.015], [-2.3, 0.5, 4.27], [9.1, 2.12, -8.31]];
    const original = syntheticPly(points, 1);
    await fs.writeFile(input, original);
    for (const compression of [0, 1]) {
      const output = path.join(directory, `c${compression}.ksplat`);
      const metadata = await prepareScan(input, output, { compression });
      const bytes = await fs.readFile(output);
      const result = new SplatBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      assert.equal(result.getSplatCount(), points.length);
      assert.equal(result.getMinSphericalHarmonicsDegree(), 1);
      const tolerance = compression === 0 ? 0.000001 : Math.sqrt(3) * metadata.positionQuantizationStepRawUnits / 2 + 0.000002;
      for (let index = 0; index < result.getSplatCount(); index++) {
        const centre = new THREE.Vector3();
        result.getSplatCenter(index, centre);
        const closest = Math.min(...points.map((p) => centre.distanceTo(new THREE.Vector3(...p))));
        assert.ok(closest <= tolerance, `raw centre changed by ${closest} (limit ${tolerance})`);
      }
    }
    assert.deepEqual(await fs.readFile(input), original, 'source must remain byte-for-byte unchanged');
  });
});

test('converter refuses invented SH, unsupported silent truncation, and accidental overwrite', async () => {
  await withScan(async (directory) => {
    const input = path.join(directory, 'synthetic.ply');
    const output = path.join(directory, 'synthetic.ksplat');
    const points = [[0.1, 0.2, 0.3], [1, 0.5, 2], [3, 2, 1]];
    await fs.writeFile(input, syntheticPly(points, 0));
    await assert.rejects(prepareScan(input, output, { sh: 1 }), /Cannot invent SH/);
    await prepareScan(input, output);
    await assert.rejects(prepareScan(input, output), /already exists/);
    await fs.writeFile(input, syntheticPly(points, 3));
    await assert.rejects(prepareScan(input, path.join(directory, 'sh3.ksplat')), /Invalid SH/);
  });
});
