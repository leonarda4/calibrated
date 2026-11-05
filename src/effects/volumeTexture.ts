import * as THREE from 'three';
import type { Point3 } from '../viewer/hallwayCutPlacement.ts';

export interface VolumeMetadata {
  resolution: [number, number, number]; min: Point3; size: Point3; height: number; groundBoost: number;
}

/** Supplied exports may bound voxel centres instead of the outer voxel edges. */
export function volumeMetadata(value: unknown, bytes?: number): VolumeMetadata {
  const v = value as { resolution?: number[]; boundsMin?: number[]; boundsMax?: number[];
    fogHeight?: number; groundBoost?: number; order?: string; encoding?: string };
  if (![v?.resolution, v?.boundsMin, v?.boundsMax].every(a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)) ||
      !v.resolution!.every(n => Number.isSafeInteger(n) && n > 0 && n <= 1024) ||
      !v.boundsMax!.every((n,i) => n > v.boundsMin![i]) || !Number.isFinite(v.fogHeight) || v.fogHeight! <= 0 || v.fogHeight! > 8 ||
      !v.order?.startsWith('x fastest, then y, then z') || !v.encoding?.startsWith('uint8')) {
    throw new Error('The volume metadata must describe an X-fastest uint8 floor volume in metres.');
  }
  const resolution = [...v.resolution!] as [number, number, number], count = resolution.reduce((n,a) => n*a,1);
  const min = [...v.boundsMin!] as unknown as Point3, size = v.boundsMax!.map((n,i)=>n-min[i]) as unknown as Point3;
  const height = v.fogHeight!, tolerance = height / resolution[1] + 1e-5;
  if (min[1] < -1e-5 || min[1] > tolerance || v.boundsMax![1] > height+1e-5 || height-v.boundsMax![1] > tolerance ||
      (v.groundBoost !== undefined && (!Number.isFinite(v.groundBoost) || v.groundBoost < 0 || v.groundBoost > 4))) {
    throw new Error('The volume height must match its floor-anchored voxel bounds.');
  }
  if (count > 16_000_000 || (bytes !== undefined && bytes !== count)) throw new Error('The volume file size does not match its metadata.');
  return { resolution, min, size, height, groundBoost: v.groundBoost ?? 1 };
}

export async function loadVolume(metadataUrl: string, densityUrl: string, signal: AbortSignal) {
  const [metadata, binary] = await Promise.all([fetch(metadataUrl,{signal}), fetch(densityUrl,{signal})]);
  if (!metadata.ok || !binary.ok) throw new Error('The local volume texture could not be loaded.');
  const [json, data] = await Promise.all([metadata.json(), binary.arrayBuffer()]);
  const spec = volumeMetadata(json,data.byteLength);
  const texture = new THREE.Data3DTexture(new Uint8Array(data),...spec.resolution);
  texture.format=THREE.RedFormat; texture.type=THREE.UnsignedByteType;
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.wrapS=texture.wrapR=THREE.RepeatWrapping; texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.unpackAlignment=1; texture.needsUpdate=true;
  return {spec,texture};
}
