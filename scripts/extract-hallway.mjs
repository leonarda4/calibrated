// A separate, private hallway object. No runtime scene or placement is changed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { ACTIVE_SCAN } from '../src/viewer/scanAsset.ts';
import { scanOriginForStart } from '../src/viewer/scanPlacement.ts';
import { estimateHallwayCenter } from '../src/experience/hallwayCenter.ts';

const DEFAULT_SOURCE = 'public/splats/hallway3/hallway3_0.ply';
const DEFAULT_OUTPUT = 'public/splats/hallway-cut/hallway3-cut.ply';
// Match the reference opening beside FoodTech, beyond the near side-room door.
const DEFAULT_STATION = 20.4;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function readPly(file) {
  const marker = file.subarray(0, 65536).indexOf('end_header\n');
  const crlf = file.subarray(0, 65536).indexOf('end_header\r\n');
  const end = marker >= 0 ? marker + 11 : crlf >= 0 ? crlf + 12 : -1;
  if (end < 0) throw new Error('Expected a bounded PLY header.');
  const header = file.subarray(0, end).toString('ascii');
  if (!/^ply\r?\nformat binary_little_endian 1\.0\r?$/m.test(header)) throw new Error('Expected binary little-endian PLY.');
  const elements = [...header.matchAll(/^element (\S+) (\d+)\r?$/gm)];
  if (elements.length !== 1 || elements[0][1] !== 'vertex') throw new Error('Expected only a vertex element.');
  const properties = [...header.matchAll(/^property (.+)\r?$/gm)].map(match => match[1].trim());
  if (properties.some(property => !/^float \S+$/.test(property))) throw new Error('Expected float vertex properties.');
  const names = properties.map(property => property.slice(6));
  if (new Set(names).size !== names.length) throw new Error('Duplicate vertex property.');
  const count = Number(elements[0][2]), stride = names.length * 4;
  if (!Number.isSafeInteger(count) || count < 1 || end + count * stride !== file.length) throw new Error('Invalid vertex count or PLY body length.');
  const offsets = Object.fromEntries(names.map((name, i) => [name, i * 4]));
  for (const name of ['x', 'y', 'z', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']) {
    if (!(name in offsets)) throw new Error(`Missing Gaussian property ${name}.`);
  }
  const centers = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++) {
    const value = file.readFloatLE(end + i * stride + offsets[['x', 'y', 'z'][axis]]);
    if (!Number.isFinite(value)) throw new Error(`Nonfinite position at vertex ${i}.`);
    centers[i * 3 + axis] = value;
  }
  return { header, end, count, stride, offsets, centers };
}

const median = values => {
  const ordered = values.slice().sort((a, b) => a - b), middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

/** Balance floor sampling by occupied cells; trim scan noise and baseboards. */
export function fitFloor(centers, seed, halfWidth, halfWindow = 1.5) {
  const cells = new Map();
  for (let i = 0; i < centers.length; i += 3) {
    const x = centers[i] - seed[0], y = centers[i + 1] - seed[1], z = centers[i + 2];
    if (Math.abs(x) > halfWidth || Math.abs(y) > halfWindow || Math.abs(z - seed[2]) > .12) continue;
    const key = `${Math.floor(x / .05)},${Math.floor(y / .1)}`;
    const cell = cells.get(key) ?? [];
    cell.push([x, y, z]); cells.set(key, cell);
  }
  let points = [...cells.values()].map(cell => [median(cell.map(p => p[0])), median(cell.map(p => p[1])), median(cell.map(p => p[2]))]);
  if (points.length < 80) throw new Error('Insufficient floor coverage for an orthogonal cut.');
  let coefficients;
  for (let pass = 0; pass < 4; pass++) {
    let xx = 0, xy = 0, yy = 0, sx = 0, sy = 0, xz = 0, yz = 0, sz = 0;
    for (const [x, y, z] of points) {
      xx += x * x; xy += x * y; yy += y * y; sx += x; sy += y;
      xz += x * z; yz += y * z; sz += z;
    }
    const matrix = new Matrix3().set(xx, xy, sx, xy, yy, sy, sx, sy, points.length);
    if (Math.abs(matrix.determinant()) < 1e-8) throw new Error('Floor samples do not span a plane.');
    coefficients = new Vector3(xz, yz, sz).applyMatrix3(matrix.invert());
    if (pass === 3) break;
    const errors = points.map(([x, y, z]) => Math.abs(z - coefficients.x * x - coefficients.y * y - coefficients.z));
    const limit = Math.max(.012, Math.min(.05, median(errors) * 3));
    points = points.filter((_, i) => errors[i] <= limit);
    if (points.length < 80) throw new Error('Floor fit lost sufficient support.');
  }
  const normal = new Vector3(-coefficients.x, -coefficients.y, 1).normalize();
  const residual = Math.sqrt(points.reduce((sum, [x, y, z]) => sum +
    ((z - coefficients.x * x - coefficients.y * y - coefficients.z) * normal.z) ** 2, 0) / points.length);
  const span = [0, 1].map(axis => Math.max(...points.map(p => p[axis])) - Math.min(...points.map(p => p[axis])));
  if (residual > .03 || span[0] < halfWidth || span[1] < halfWindow || normal.z < .98) throw new Error('Floor fit is too uncertain.');
  return { normalRaw: normal.toArray(), pointRaw: [seed[0], seed[1], coefficients.z], residual, occupiedCells: points.length, span };
}

/** The cut contains the floor normal and corridor cross-axis. */
export function transversePlane(origin, floorNormal, along) {
  const point = new Vector3(...origin), up = new Vector3(...floorNormal), forward = new Vector3(...along);
  if (![...point.toArray(), ...up.toArray(), ...forward.toArray()].every(Number.isFinite)
    || up.length() < 1e-8 || forward.length() < 1e-8) throw new Error('Invalid cut frame.');
  up.normalize(); forward.addScaledVector(up, -forward.dot(up));
  if (forward.length() < 1e-8) throw new Error('Corridor direction is perpendicular to the floor.');
  forward.normalize();
  return { pointRaw: point.toArray(), normalRaw: forward.toArray(), constantRaw: -forward.dot(point), keep: 'signedDistance >= 0' };
}

/** Copy complete original records: no translation, rotation, resampling or compression. */
export function cropPly(file, plane, envelopePlanes = []) {
  const source = readPly(file), n = new Vector3(...plane.normalRaw);
  const planes = [plane, ...envelopePlanes];
  for (const boundary of planes) {
    const normal = new Vector3(...boundary.normalRaw);
    if (!Number.isFinite(boundary.constantRaw) || !normal.toArray().every(Number.isFinite) || Math.abs(normal.length() - 1) > 1e-8) throw new Error('Cut plane needs a finite unit normal.');
  }
  const kept = [], bounds = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  let minDistance = Infinity;
  for (let i = 0; i < source.count; i++) {
    const xyz = source.centers.subarray(i * 3, i * 3 + 3);
    const distance = n.x * xyz[0] + n.y * xyz[1] + n.z * xyz[2] + plane.constantRaw;
    if (distance < 0 || envelopePlanes.some(boundary => boundary.normalRaw.reduce((sum, value, axis) => sum + value * xyz[axis], boundary.constantRaw) < 0)) continue;
    minDistance = Math.min(minDistance, distance);
    for (let axis = 0; axis < 3; axis++) {
      bounds[0][axis] = Math.min(bounds[0][axis], xyz[axis]); bounds[1][axis] = Math.max(bounds[1][axis], xyz[axis]);
    }
    kept.push(file.subarray(source.end + i * source.stride, source.end + (i + 1) * source.stride));
  }
  if (!kept.length || kept.length === source.count) throw new Error('The cut must retain part of the source and remove part.');
  const header = source.header.replace(/^element vertex \d+/m, `element vertex ${kept.length}`)
    .replace(/end_header/, `comment crop_plane_raw ${plane.normalRaw.join(' ')} ${plane.constantRaw}\ncomment keep_signed_distance_greater_equal_zero\ncomment original_coordinates_and_gaussian_attributes_unchanged\nend_header`);
  return { file: Buffer.concat([Buffer.from(header, 'ascii'), ...kept]), sourceCount: source.count, outputCount: kept.length, boundsRaw: bounds, minSignedDistance: minDistance };
}

export async function extractHallway(source = DEFAULT_SOURCE, output = DEFAULT_OUTPUT, { station = DEFAULT_STATION, force = false } = {}) {
  if (path.resolve(source).toLowerCase() === path.resolve(output).toLowerCase()) throw new Error('Source and output must differ.');
  if (!Number.isFinite(station)) throw new Error('Station must be finite.');
  const file = await fs.readFile(source), { centers } = readPly(file);
  const rotation = new Quaternion(...ACTIVE_SCAN.rotation), inverse = rotation.clone().invert();
  const matrix = new Matrix4().compose(new Vector3(...scanOriginForStart(ACTIVE_SCAN.startPoint, ACTIVE_SCAN.rotation)), rotation, new Vector3(1, 1, 1));
  const seed = [ACTIVE_SCAN.startPoint[0], station, ACTIVE_SCAN.startPoint[2]];
  const fit = estimateHallwayCenter({ centers, modelMatrix: matrix.elements, seedRaw: seed, floorY: 0, longitudinalHalfWindow: 1.5 });
  if (!fit.ok) throw new Error(`Hallway fit failed: ${fit.reason}`);
  const floor = fitFloor(centers, fit.centerRaw, fit.width / 2 - .25);
  const directionRaw = new Vector3(...fit.directionWorld).applyQuaternion(inverse).toArray();
  const plane = transversePlane(floor.pointRaw, floor.normalRaw, directionRaw);
  const cutNormal = new Vector3(...plane.normalRaw), floorNormal = new Vector3(...floor.normalRaw);
  const across = new Vector3().crossVectors(cutNormal, floorNormal).normalize(), origin = new Vector3(...plane.pointRaw);
  // Keep the wall/floor/ceiling shell, excluding scanned rooms outside the corridor.
  // An 18 cm wall allowance preserves the original surface and its scan noise.
  const envelope = { wallAllowance: .18, halfWidth: fit.width / 2 + .18, belowFloor: .15, aboveFloor: 2.85 };
  const boundary = (normal, allowance) => ({ normalRaw: normal.toArray(), constantRaw: allowance - normal.dot(origin), keep: 'signedDistance >= 0' });
  const envelopePlanes = [boundary(across, envelope.halfWidth), boundary(across.clone().negate(), envelope.halfWidth),
    boundary(floorNormal, envelope.belowFloor), boundary(floorNormal.clone().negate(), envelope.aboveFloor)];
  const result = cropPly(file, plane, envelopePlanes);
  const metadata = {
    source: path.relative(process.cwd(), source).replaceAll('\\', '/'), sourceSha256: digest(file), sourceVertexCount: result.sourceCount,
    output: path.relative(process.cwd(), output).replaceAll('\\', '/'), outputSha256: digest(result.file), outputVertexCount: result.outputCount,
    outputBytes: result.file.length, removedVertexCount: result.sourceCount - result.outputCount,
    stationRawY: station, cutPlane: plane, envelope, clipPlanesRaw: [plane, ...envelopePlanes], floorFit: floor,
    walls: { width: fit.width, residual: fit.residual, evidence: fit.evidence, directionRaw,
      cutAngleErrorDegrees: [fit.wallPlanes.left, fit.wallPlanes.right].map(wall => {
        const normal = new Vector3(...wall.normal).applyQuaternion(inverse);
        return Math.asin(Math.min(1, Math.abs(cutNormal.dot(normal)))) * 180 / Math.PI;
      }) },
    floorOrthogonalityDot: cutNormal.dot(floorNormal), boundsRaw: result.boundsRaw, minSignedDistance: result.minSignedDistance,
    coordinates: 'Original raw PLY frame; use the same transform as the source to overlay it. No recentering.',
    compressionLevel: 0, resampled: false, gaussianRecordsUnchanged: true,
    edge: 'PLY crops Gaussian centres. Gaussian footprints remain naturally soft; exact visible clipping requires this sidecar plane in the renderer.',
    applicationIntegration: 'None. Existing hallway, placements and gameplay are unchanged.',
    screenshotPlacement: 'Approximate opening beside the FoodTech writing, beyond the near side-room door; keep the hallway beyond it.',
    physicalValidation: 'NOT TESTED; fit is scan appearance only.',
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  // Reserve BOTH destinations before writing, so a retry cannot clobber a prior asset.
  const handles = [], destinations = [output, `${output}.meta.json`];
  try {
    for (const destination of destinations) handles.push(await fs.open(destination, force ? 'w' : 'wx'));
    await handles[0].writeFile(result.file);
    await handles[1].writeFile(`${JSON.stringify(metadata, null, 2)}\n`);
  } finally { await Promise.all(handles.map(handle => handle.close())); }
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const stationIndex = args.indexOf('--station'), station = stationIndex >= 0 ? Number(args[stationIndex + 1]) : DEFAULT_STATION;
  if (stationIndex >= 0) args.splice(stationIndex, 2);
  const positional = args.filter(arg => arg !== '--force');
  if (positional.length > 2 || positional.some(arg => arg.startsWith('--')) || !Number.isFinite(station)) {
    console.error('Usage: node scripts/extract-hallway.mjs [source.ply] [output.ply] [--station rawY] [--force]'); process.exitCode = 1;
  } else extractHallway(positional[0], positional[1], { station, force: args.includes('--force') })
    .then(metadata => console.log(JSON.stringify(metadata, null, 2)))
    .catch(error => { console.error(`Hallway extraction failed: ${error.message}`); process.exitCode = 1; });
}
