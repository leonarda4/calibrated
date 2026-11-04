// Isolate original Gaussian splats without resampling or compression.
// Both source and derived asset remain private under public/splats/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { Quaternion } from 'three';
import { WALL_SECTION } from '../src/viewer/wallSectionConfig.ts';

const DEFAULT_SOURCE = 'public/splats/hallway3/hallway3_0.ply';
const DEFAULT_OUTPUT = `public${WALL_SECTION.modelUrl}`;
const RAW_TO_LOCAL = new Quaternion(-.5, -.5, -.5, .5);
const BACK_ROTATION = new Quaternion(0, 1, 0, 0);

/** Only SH0 is accepted: rotating higher SH requires rotating its coefficients. */
function parseHeader(file) {
  const marker = file.subarray(0, 65536).indexOf('end_header');
  if (marker < 0) throw new Error('No bounded PLY header.');
  const start = file.indexOf('\n', marker) + 1;
  const text = file.subarray(0, start).toString('ascii');
  if (!/^format binary_little_endian 1\.0\r?$/m.test(text)) throw new Error('Expected binary little-endian PLY.');
  const properties = [...text.matchAll(/^property float (\S+)\r?$/gm)].map(m => m[1].trim());
  const count = Number(/^element vertex (\d+)\r?$/m.exec(text)?.[1]);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('No nonempty vertex element.');
  const offset = Object.fromEntries(properties.map((name, i) => [name, i * 4]));
  for (const name of ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']) {
    if (!(name in offset)) throw new Error(`Missing float property ${name}.`);
  }
  if (properties.some(name => name.startsWith('f_rest_'))) throw new Error('This crop transform supports SH0 only.');
  const stride = properties.length * 4;
  if (start < 1 || start + count * stride !== file.length) throw new Error('Unexpected PLY body layout.');
  return { text, start, count, offset, stride };
}

// Small dependency-free PNG encoder for a private source-elevation preview.
function encodePng(width, height, rgb) {
  const crc = new Uint32Array(256);
  for (let i = 0; i < crc.length; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    crc[i] = value;
  }
  const chunk = (name, data) => {
    const type = Buffer.from(name), bytes = Buffer.concat([type, data]);
    let sum = 0xffffffff;
    for (const value of bytes) sum = crc[(sum ^ value) & 255] ^ (sum >>> 8);
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length); type.copy(result, 4); data.copy(result, 8);
    result.writeUInt32BE((sum ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row++) rgb.copy(raw, row * (width * 3 + 1) + 1, row * width * 3, (row + 1) * width * 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function elevationPreview(body, header, count) {
  const width = 420, height = Math.round(WALL_SECTION.height * 200), sums = new Float64Array(width * height * 4);
  const get = (i, name) => body.readFloatLE(i * header.stride + header.offset[name]);
  for (let i = 0; i < count; i++) {
    const x = get(i, 'x'), y = get(i, 'y'), alpha = 1 / (1 + Math.exp(-get(i, 'opacity')));
    const col = Math.floor((x / WALL_SECTION.width + .5) * width), row = Math.floor((1 - y / WALL_SECTION.height) * height);
    const color = [0,1,2].map(c => Math.max(0, Math.min(255, (.5 + .28209479177387814 * get(i, `f_dc_${c}`)) * 255)));
    // This is an elevation of original centres, not a fabricated texture.
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const px = col + dx, py = row + dy;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const at = (py * width + px) * 4, weight = alpha / (1 + dx * dx + dy * dy);
      for (let c = 0; c < 3; c++) sums[at + c] += color[c] * weight;
      sums[at + 3] += weight;
    }
  }
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = sums[i * 4 + 3] ? sums[i * 4 + c] / sums[i * 4 + 3] : 25;
  return encodePng(width, height, rgb);
}

export async function extractWall(source = DEFAULT_SOURCE, output = DEFAULT_OUTPUT, { force = false } = {}) {
  if (path.resolve(source) === path.resolve(output)) throw new Error('Source and output must differ.');
  const file = await fs.readFile(source), header = parseHeader(file);
  const kept = [], [cx, cy, floor] = WALL_SECTION.sourceRawCenter;
  const xCells = Math.round(WALL_SECTION.width * 10), yCells = Math.round(WALL_SECTION.height * 10);
  const occupied = new Uint8Array(xCells * yCells), bounds = [[Infinity,Infinity,Infinity], [-Infinity,-Infinity,-Infinity]];
  let opaqueCount = 0;
  const read = (at, name) => file.readFloatLE(at + header.offset[name]);
  const rotation = new Quaternion();
  for (let i = 0; i < header.count; i++) {
    const at = header.start + i * header.stride;
    const x = read(at, 'y') - cy, y = read(at, 'z') - floor, z = read(at, 'x') - cx;
    if (![x,y,z].every(Number.isFinite) || Math.abs(x) > WALL_SECTION.width / 2 || y < 0 || y > WALL_SECTION.height || Math.abs(z) > WALL_SECTION.sourceDepth / 2) continue;
    const vertex = Buffer.from(file.subarray(at, at + header.stride));
    const write = (name, value) => vertex.writeFloatLE(value, header.offset[name]);
    write('x', x); write('y', y); write('z', z);
    if (['nx', 'ny', 'nz'].every(name => name in header.offset)) {
      write('nx', read(at, 'ny')); write('ny', read(at, 'nz')); write('nz', read(at, 'nx'));
    }
    // INRIA quaternion properties are W,X,Y,Z. Premultiply the full Gaussian
    // orientation; changing centres alone would corrupt its anisotropic shape.
    rotation.set(read(at, 'rot_1'), read(at, 'rot_2'), read(at, 'rot_3'), read(at, 'rot_0'));
    if (!Number.isFinite(rotation.lengthSq()) || rotation.lengthSq() < 1e-12) throw new Error(`Invalid Gaussian quaternion at source vertex ${i}.`);
    rotation.normalize().premultiply(RAW_TO_LOCAL);
    write('rot_0', rotation.w); write('rot_1', rotation.x); write('rot_2', rotation.y); write('rot_3', rotation.z);
    kept.push(vertex);
    if (read(at, 'opacity') >= 0) {
      opaqueCount++;
      occupied[Math.min(xCells - 1, Math.floor((x + WALL_SECTION.width / 2) * 10)) + xCells * Math.min(yCells - 1, Math.floor(y * 10))] = 1;
    }
  }
  if (kept.length < 1000) throw new Error('Crop has too few splats; inspect scan identity and crop coordinates.');
  // Keep both slabs at full source thickness. Rotate the second copy about up
  // so its good +Z face points outward toward -Z; never mirror or flatten it.
  const faces = [[], []];
  for (const vertex of kept) for (let face = 0; face < 2; face++) {
    const copy = Buffer.from(vertex), sign = face === 0 ? 1 : -1;
    const get = name => vertex.readFloatLE(header.offset[name]);
    const write = (name, value) => copy.writeFloatLE(value, header.offset[name]);
    const xyz = [sign * get('x'), get('y'), sign * (get('z') + WALL_SECTION.faceOffset)];
    ['x', 'y', 'z'].forEach((name, axis) => {
      write(name, xyz[axis]);
      bounds[0][axis] = Math.min(bounds[0][axis], xyz[axis]);
      bounds[1][axis] = Math.max(bounds[1][axis], xyz[axis]);
    });
    if (face === 1) {
      if (['nx', 'ny', 'nz'].every(name => name in header.offset)) {
        write('nx', -get('nx')); write('nz', -get('nz'));
      }
      rotation.set(get('rot_1'), get('rot_2'), get('rot_3'), get('rot_0')).premultiply(BACK_ROTATION);
      write('rot_0', rotation.w); write('rot_1', rotation.x); write('rot_2', rotation.y); write('rot_3', rotation.z);
    }
    faces[face].push(copy);
  }
  const count = kept.length * 2;
  const body = Buffer.concat(faces.flat()), outputHeader = Buffer.from(header.text.replace(/element vertex \d+/, `element vertex ${count}`));
  const data = Buffer.concat([outputHeader, body]);
  const metadata = {
    schemaVersion: 2, sourceScanId: WALL_SECTION.sourceScanId,
    sourceSha256: createHash('sha256').update(file).digest('hex'),
    sourceVertexCount: header.count, sourceCropVertexCount: kept.length, outputVertexCount: count, outputBytes: data.length,
    sourceRawBottomCenter: WALL_SECTION.sourceRawCenter,
    sourceRawYRange: [cy - WALL_SECTION.width / 2, cy + WALL_SECTION.width / 2],
    sourceRawZRange: [floor, floor + WALL_SECTION.height],
    objectDimensions: { width: WALL_SECTION.width, height: WALL_SECTION.height, depth: WALL_SECTION.depth },
    faces: { count: 2, splatsPerFace: kept.length, sourceDepth: WALL_SECTION.sourceDepth,
      gap: WALL_SECTION.faceGap, centerOffsets: [WALL_SECTION.faceOffset, -WALL_SECTION.faceOffset],
      backRotationXYZW: BACK_ROTATION.toArray(), sameSceneAndTransform: true },
    objectCenterBounds: bounds,
    objectTransform: 'Crop (rawY-20.8, rawZ+1.45, rawX-0.9); front translated +faceOffset along Z; back is front rotated 180 degrees about Y. Positions, normals and full Gaussian orientations rotated; scales unchanged.',
    compressionLevel: 0, resampled: false, sphericalHarmonicsDegree: 0,
    sourceSelection: 'Visually door-free continuous left wall; densest 2.10 m interval on a 0.10 m search grid inside rawY 16.25..22.75. Full original SH0 splats retained inside crop; graffiti preserved.',
    opaqueSplatCount: opaqueCount * 2,
    occupiedTenCentimetreCells: occupied.reduce((sum, value) => sum + value, 0), totalTenCentimetreCells: occupied.length,
    heightEvidence: 'Source elevation inspected above the horizontal band at raw Z +0.95. Continuous wall ends at +1.15: opaque counts per 2.5 cm bin are 123/81/81/101/109/44 at Z +1.000/+1.025/+1.050/+1.075/+1.100/+1.125, then 5/1 at +1.150/+1.175. Retain wall from existing raw floor -1.45 to +1.15. Scan-derived height; physical metric dimensions remain unverified.',
    physicalValidation: 'NOT TESTED',
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  if (!force) {
    for (const destination of [output, `${output}.meta.json`, `${output}.preview.png`]) {
      try { await fs.access(destination); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw new Error('Derived output already exists; use --force to replace only the crop.');
    }
  }
  await fs.writeFile(output, data);
  await fs.writeFile(`${output}.meta.json`, `${JSON.stringify(metadata, null, 2)}\n`);
  // Preview only the outward front, not two overlapping mirrored elevations.
  await fs.writeFile(`${output}.preview.png`, elevationPreview(body, header, kept.length));
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), positional = args.filter(arg => !arg.startsWith('--'));
  if (args.some(arg => arg.startsWith('--') && arg !== '--force') || positional.length > 2) {
    console.error('Usage: node scripts/extract-wall.mjs [source.ply] [output.ply] [--force]'); process.exitCode = 1;
  } else {
    extractWall(positional[0], positional[1], { force: args.includes('--force') })
      .then(metadata => console.log(JSON.stringify(metadata, null, 2)))
      .catch(error => { console.error(`Wall extraction failed: ${error.message}`); process.exitCode = 1; });
  }
}
