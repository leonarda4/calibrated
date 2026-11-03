// Offline private-asset preparation, using the same renderer version as the app.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

const HELP = `Usage: node [--max-old-space-size=8192] scripts/prepare-scan.mjs input.ply [output.ksplat]
  --inspect                 Print header metadata only; never load the scan body
  --compression=0|1|2       Default 1 (bucket-quantized positions, FP16 scale/rotation/SH)
  --alpha=1..255            Default 1; retain all nonzero 8-bit opacity splats
  --sh=0|1|2               Default: preserve the source degree (reject unsupported degree 3)
  --force                   Replace existing output and its private metadata
Outputs remain private; .ksplat and .meta.json files must stay ignored.`;

export async function inspectPly(file) {
  const handle = await fs.open(file, 'r');
  try {
    const bytes = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const marker = bytes.subarray(0, bytesRead).indexOf(Buffer.from('end_header'));
    if (marker < 0) throw new Error('PLY header exceeds the bounded 64 KiB read, or is invalid.');
    const header = bytes.subarray(0, marker).toString('ascii');
    if (!header.startsWith('ply\n') && !header.startsWith('ply\r\n')) throw new Error('Not a PLY file.');
    if (!/^format binary_little_endian 1\.0\r?$/m.test(header)) {
      throw new Error('This preparer expects a binary little-endian INRIA PLY.');
    }
    const count = /^element vertex (\d+)\r?$/m.exec(header);
    if (!count || !Number.isSafeInteger(Number(count[1])) || Number(count[1]) < 1) {
      throw new Error('PLY has no valid nonempty vertex element.');
    }
    const properties = [...header.matchAll(/^property float (\S+)\r?$/gm)].map((m) => m[1].trim());
    for (const field of ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'rot_0']) {
      if (!properties.includes(field)) throw new Error(`Unsupported PLY: missing float property ${field}.`);
    }
    const restCount = properties.filter((p) => /^f_rest_\d+$/.test(p)).length;
    const degree = restCount === 0 ? 0 : restCount === 9 ? 1 : restCount === 24 ? 2 : restCount === 45 ? 3 : -1;
    if (degree < 0) throw new Error(`Unsupported SH property count: ${restCount}.`);
    return {
      vertexCount: Number(count[1]), sphericalHarmonicsDegree: degree,
      bytes: (await handle.stat()).size,
      trainingAntialiasCompensation: 'unknown',
    };
  } finally {
    await handle.close();
  }
}

function integerOption(value, allowed, name) {
  const number = Number(value);
  if (value.trim() === '' || !Number.isInteger(number) || !allowed(number)) {
    throw new Error(`Invalid ${name}. Run with --help for accepted values.`);
  }
  return number;
}

export async function prepareScan(input, output, options = {}) {
  if (path.resolve(input) === path.resolve(output)) throw new Error('Input and output must differ.');
  if (path.extname(output).toLowerCase() !== '.ksplat') throw new Error('Output must have the .ksplat extension.');
  const info = await inspectPly(input);
  const compression = integerOption(String(options.compression ?? 1), (n) => n >= 0 && n <= 2, 'compression');
  const alpha = integerOption(String(options.alpha ?? 1), (n) => n >= 1 && n <= 255, 'alpha');
  const sh = integerOption(String(options.sh ?? info.sphericalHarmonicsDegree), (n) => n >= 0 && n <= 2, 'SH degree');
  if (sh > info.sphericalHarmonicsDegree) throw new Error('Cannot invent SH coefficients absent from the source.');
  const metadataFile = `${output}.meta.json`;
  if (!options.force) {
    for (const file of [output, metadataFile]) {
      try {
        await fs.access(file);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      throw new Error('An output file already exists; use --force only to replace prepared outputs.');
    }
  }
  const started = performance.now();
  const fileData = await fs.readFile(input);
  // A Node Buffer may reference a larger backing allocation. Slice the exact file.
  const sourceBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
  const splatArray = GaussianSplats3D.PlyParser.parseToUncompressedSplatArray(sourceBuffer, sh);
  const generator = GaussianSplats3D.SplatBufferGenerator.getStandardGenerator(alpha, compression);
  const result = generator.generateFromUncompressedSplatArray(splatArray);
  const compressedBytes = Buffer.from(result.bufferData);
  const metadata = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    renderer: '@mkkellogg/gaussian-splats-3d@0.4.7',
    sourceSha256: createHash('sha256').update(fileData).digest('hex'),
    source: info,
    output: { bytes: compressedBytes.byteLength, splatCount: result.getSplatCount(), sphericalHarmonicsDegree: sh },
    compressionLevel: compression,
    alphaRemovalThreshold: alpha,
    coordinateTransform: 'identity; raw coordinates retained, metric normalization remains in the application',
    // Standard generator's 5-unit blocks / 32767 offset range, rounded to nearest.
    positionQuantizationStepRawUnits: compression === 0 ? 0 : 5 / (2 * 32767),
    elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(3)),
    requiresPhysicalRevalidation: true,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, compressedBytes, { flag: options.force ? 'w' : 'wx' });
  await fs.writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, { flag: options.force ? 'w' : 'wx' });
  return metadata;
}

async function main(args) {
  if (args.includes('--help') || args.length === 0) { console.log(HELP); return; }
  const positional = [];
  const options = {};
  for (const arg of args) {
    if (arg === '--inspect') options.inspect = true;
    else if (arg === '--force') options.force = true;
    else if (/^--(compression|alpha|sh)=/.test(arg)) {
      const [key, value] = arg.slice(2).split('=');
      options[key] = value;
    } else if (arg.startsWith('--')) throw new Error('Unknown option. Run with --help.');
    else positional.push(arg);
  }
  if (positional.length < 1 || positional.length > 2) throw new Error('Supply one input and, optionally, one output.');
  const [input, suppliedOutput] = positional;
  if (options.inspect) { console.log(JSON.stringify(await inspectPly(input), null, 2)); return; }
  const output = suppliedOutput ?? input.replace(/\.ply$/i, '') + '.ksplat';
  console.log('Preparing local KSPLAT (source remains unchanged)...');
  console.log(JSON.stringify(await prepareScan(input, output, options), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(`Scan preparation failed: ${error.message}`); process.exitCode = 1; });
}
