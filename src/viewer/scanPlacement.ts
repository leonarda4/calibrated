import { Quaternion, Vector3 } from 'three';

/** Scan-root translation that maps a raw PLY floor anchor to the XR origin. */
export function scanOriginForStart(
  startPoint: readonly [number, number, number],
  rotation: readonly [number, number, number, number],
): [number, number, number] {
  if (![...startPoint, ...rotation].every(Number.isFinite)) throw new Error('Scan placement must contain finite coordinates.');
  const orientation = new Quaternion(...rotation);
  if (orientation.lengthSq() < 1e-12) throw new Error('Scan placement requires a valid rotation.');
  const anchor = new Vector3(...startPoint).applyQuaternion(orientation.normalize());
  return anchor.multiplyScalar(-1).toArray() as [number, number, number];
}
