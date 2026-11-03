import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Matrix3, Matrix4, Quaternion } from 'three';
import { extractWall } from '../scripts/extract-wall.mjs';
import { WALL_SECTION } from '../src/viewer/wallSectionConfig.ts';

// Deliberately reorder attributes so the crop cannot assume fixed byte offsets.
const fields = ['opacity', 'z', 'scale_2', 'x', 'rot_1', 'f_dc_2', 'ny', 'rot_0', 'y', 'nx', 'scale_0', 'f_dc_0', 'rot_3', 'nz', 'f_dc_1', 'rot_2', 'scale_1'];
const stride = fields.length * 4;
function fixture({ outside = false, higherSh = false, count = 1004 } = {}) {
  const names = higherSh ? [...fields, 'f_rest_0'] : fields;
  const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${names.map(name => `property float ${name}\n`).join('')}end_header\n`);
  const body = Buffer.alloc(count * names.length * 4);
  for (let i = 0; i < count; i++) {
    const values = {
      x: outside ? 10 : .90 + ((i % 5) - 2) * .02,
      y: 20.80 + ((i % 40) - 20) * .045,
      z: -1.45 + .05 + Math.floor((i % 1000) / 40) * .10,
      nx: .3, ny: -.2, nz: .8,
      f_dc_0: .234, f_dc_1: -.123, f_dc_2: .987,
      opacity: 2.7, scale_0: Math.log(.013), scale_1: Math.log(.082), scale_2: Math.log(.19),
      rot_0: .8, rot_1: .3, rot_2: .4, rot_3: .1, f_rest_0: 0,
    };
    if (!outside && i === 1000) values.y = 19.74; // left of the 2.10 m crop
    if (!outside && i === 1001) values.y = 21.86; // right of the crop
    if (!outside && i === 1002) values.z = -1.46; // below floor
    if (!outside && i === 1003) values.z = 1.16; // above full wall
    names.forEach((name, j) => body.writeFloatLE(values[name], (i * names.length + j) * 4));
  }
  return Buffer.concat([header, body]);
}
function vertices(file) {
  const marker = file.indexOf('end_header'), start = file.indexOf('\n', marker) + 1;
  const count = Number(/element vertex (\d+)/.exec(file.subarray(0, start).toString())[1]);
  const read = (i, name) => file.readFloatLE(start + i * stride + fields.indexOf(name) * 4);
  return { count, read };
}
async function temporaryFiles(t) {
  const base = path.resolve(os.tmpdir()), directory = await fs.mkdtemp(path.join(base, 'calibrated-wall-test-'));
  t.after(async () => {
    // Bound recursive cleanup to this test-owned temporary directory.
    assert.equal(path.dirname(path.resolve(directory)), base);
    assert.ok(path.basename(directory).startsWith('calibrated-wall-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { source: path.join(directory, 'synthetic.ply'), output: path.join(directory, 'wall.ply') };
}
function covariance(rotation, scales) {
  const axes = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(rotation));
  const diagonal = new Matrix3().set(scales[0] ** 2,0,0, 0,scales[1] ** 2,0, 0,0,scales[2] ** 2);
  return axes.clone().multiply(diagonal).multiply(axes.clone().transpose());
}

test('wall extraction clips a metric full-height section and preserves original appearance/covariance', async t => {
  const { source, output } = await temporaryFiles(t), original = fixture();
  await fs.writeFile(source, original);
  const metadata = await extractWall(source, output), result = await fs.readFile(output);
  const before = vertices(original), after = vertices(result);
  assert.equal(after.count, 1000);
  assert.equal(metadata.outputVertexCount, 1000);
  assert.deepEqual(metadata.objectDimensions, { width: 2.1, height: 2.6, depth: .24 });
  assert.equal(metadata.compressionLevel, 0);
  assert.equal(metadata.resampled, false);
  for (let i = 0; i < after.count; i++) {
    assert.ok(Math.abs(after.read(i, 'x')) <= WALL_SECTION.width / 2);
    assert.ok(after.read(i, 'y') >= 0 && after.read(i, 'y') <= WALL_SECTION.height);
    assert.ok(Math.abs(after.read(i, 'z')) <= WALL_SECTION.depth / 2);
    const expected = [before.read(i, 'y') - 20.8, before.read(i, 'z') + 1.45, before.read(i, 'x') - .9];
    ['x','y','z'].forEach((name, j) => assert.ok(Math.abs(after.read(i, name) - expected[j]) < 1e-6));
    for (const name of ['opacity', 'scale_0', 'scale_1', 'scale_2', 'f_dc_0', 'f_dc_1', 'f_dc_2']) assert.equal(after.read(i, name), before.read(i, name));
    assert.equal(after.read(i, 'nx'), before.read(i, 'ny'));
    assert.equal(after.read(i, 'ny'), before.read(i, 'nz'));
    assert.equal(after.read(i, 'nz'), before.read(i, 'nx'));
  }
  // Compare full anisotropic covariance after rotation, not only its quaternion.
  const qSource = new Quaternion(...['rot_1','rot_2','rot_3','rot_0'].map(name => before.read(0, name))).normalize();
  const qOutput = new Quaternion(...['rot_1','rot_2','rot_3','rot_0'].map(name => after.read(0, name))).normalize();
  const scales = ['scale_0','scale_1','scale_2'].map(name => Math.exp(before.read(0, name)));
  const permutation = new Matrix3().set(0,1,0, 0,0,1, 1,0,0);
  const expected = permutation.clone().multiply(covariance(qSource, scales)).multiply(permutation.clone().transpose());
  covariance(qOutput, scales).elements.forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) < 1e-8));
  assert.deepEqual(await fs.readFile(source), original, 'Original scan bytes changed.');
  await assert.rejects(extractWall(source, output), /already exists/);
  assert.deepEqual(await fs.readFile(output), result, 'Existing crop was replaced without --force.');
});

test('wall extraction rejects source overwrite, empty/unsupported scans and an empty crop', async t => {
  const { source, output } = await temporaryFiles(t);
  await fs.writeFile(source, fixture());
  await assert.rejects(extractWall(source, source), /must differ/);
  await fs.writeFile(source, fixture({ outside: true }));
  await assert.rejects(extractWall(source, output), /too few splats/);
  await assert.rejects(fs.access(output), /ENOENT/);
  await fs.writeFile(source, fixture({ higherSh: true }));
  await assert.rejects(extractWall(source, output), /SH0 only/);
  await fs.writeFile(source, fixture({ count: 0 }));
  await assert.rejects(extractWall(source, output), /nonempty vertex/);
});
