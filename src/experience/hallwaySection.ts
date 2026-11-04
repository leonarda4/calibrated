import { Matrix4, Vector3, type Object3D } from 'three';
import { estimateHallwayCenter, measureWallDistances, type HallwayCenterResult, type HallwayWallPlanes } from './hallwayCenter.ts';

const BUCKET_METRES = 0.25;
const MAX_SECTIONS = 64;
const MIN_FORWARD_Z = 0.25;
type Success = Extract<HallwayCenterResult, { ok: true }>;

/** Appearance-based wall sections in the current metric scan frame. */
export function createHallwaySections(options: {
  scanRoot: Object3D;
  getCenters(): Float32Array | undefined;
  floorY?: number;
}) {
  const floorY = options.floorY ?? 0;
  const cache = new Map<number, HallwayCenterResult>();
  const inverse = new Matrix4(), point = new Vector3(), direction = new Vector3();
  let pose: number[] = [];
  let source: { buffer: ArrayBufferLike; byteOffset: number; length: number } | null = null;
  let previousCenterRaw: [number, number, number] | null = null;
  let fitCount = 0;
  const emptyEvidence = () => ({ scannedPoints: 0, eligiblePoints: 0, occupiedCells: 0 });
  const fail = (reason: string, evidence = emptyEvidence()): HallwayCenterResult => ({ ok: false, reason, evidence });
  const copyPlanes = (planes: HallwayWallPlanes): HallwayWallPlanes => ({
    left: { ...planes.left, point: [...planes.left.point], normal: [...planes.left.normal] },
    right: { ...planes.right, point: [...planes.right.point], normal: [...planes.right.normal] },
  });
  const evidenceCopy = (evidence: HallwayCenterResult['evidence']) => ({
    ...evidence, ...(evidence.left ? { left: { ...evidence.left } } : {}),
    ...(evidence.right ? { right: { ...evidence.right } } : {}),
  });
  const atExactZ = (fit: Success, worldZ: number): HallwayCenterResult => {
    const walls = fit.wallPlanes, left = walls.left, right = walls.right;
    // Equal signed distances to the independently normalised wall planes:
    // (nL-nR) dot p = nL dot pL - nR dot pR.
    const nx = left.normal[0] - right.normal[0];
    if (Math.abs(nx) < MIN_FORWARD_Z * 2 || Math.abs(fit.directionWorld[2]) < MIN_FORWARD_Z) {
      return fail('The hallway is too transverse to world Z for this section.', evidenceCopy(fit.evidence));
    }
    const constant = left.normal.reduce((sum, value, axis) => sum + value * left.point[axis], 0)
      - right.normal.reduce((sum, value, axis) => sum + value * right.point[axis], 0);
    const x = (constant - (left.normal[1] - right.normal[1]) * floorY
      - (left.normal[2] - right.normal[2]) * worldZ) / nx;
    const centerWorld: [number, number, number] = [x, floorY, worldZ];
    if (!centerWorld.every(Number.isFinite)) return fail('The hallway section exceeds finite world coordinates.', evidenceCopy(fit.evidence));
    const measured = measureWallDistances(walls, centerWorld);
    const width = measured.left + measured.right;
    if (Math.min(measured.left, measured.right) <= 0 || width < .75 || width > 4.2) {
      return fail('The requested section lies outside supported opposing walls.', evidenceCopy(fit.evidence));
    }
    const centerRaw = point.set(...centerWorld).applyMatrix4(inverse).toArray() as [number, number, number];
    return { ...fit, centerWorld, centerRaw, directionWorld: [...fit.directionWorld],
      wallPlanes: copyPlanes(walls), width, clearanceLeft: measured.left, clearanceRight: measured.right,
      evidence: evidenceCopy(fit.evidence) };
  };
  const seedOnHint = (z: number): number | null => {
    if (!previousCenterRaw) return null;
    point.set(...previousCenterRaw).applyMatrix4(options.scanRoot.matrixWorld);
    return point.x + (z - point.z) * direction.x / direction.z;
  };
  const fitBucket = (centers: Float32Array, z: number): HallwayCenterResult => {
    const estimate = (x: number) => {
      fitCount++;
      const seedRaw = point.set(x, floorY, z).applyMatrix4(inverse).toArray() as [number, number, number];
      return estimateHallwayCenter({ centers, modelMatrix: pose, seedRaw, floorY });
    };
    const hint = seedOnHint(z);
    let result = estimate(hint ?? 0);
    if (result.ok) return result;
    // A calibrated hallway can be translated away from world X=0. Search for
    // a nearby real wall sample and try inward seeds; every accepted result
    // still requires the estimator's two independently supported walls.
    let candidateX: number | null = null, nearest = Infinity;
    for (let index = 0; index < centers.length; index += 3) {
      point.set(centers[index], centers[index + 1], centers[index + 2]).applyMatrix4(options.scanRoot.matrixWorld);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)
        || point.y < floorY + .4 || point.y > floorY + 1.8) continue;
      const distance = Math.abs(point.z - z);
      if (distance < nearest && distance <= .5) { nearest = distance; candidateX = point.x; }
      if (distance < 1e-5) break;
    }
    if (candidateX !== null) {
      for (const metres of [.5, -.5, 1.25, -1.25]) {
        const x = candidateX + metres / direction.z;
        if (Math.abs(x - (hint ?? 0)) < 1e-6) continue;
        result = estimate(x);
        if (result.ok) return result;
      }
    }
    return result;
  };
  return {
    at(worldZ: number): HallwayCenterResult {
      if (!Number.isFinite(worldZ) || !Number.isFinite(floorY)) return fail('Hallway section coordinates must be finite.');
      const centers = options.getCenters();
      if (!centers?.length || centers.length % 3 !== 0) return fail('Wait for valid original hallway centres before fitting a section.');
      options.scanRoot.updateWorldMatrix(true, false);
      const matrix = options.scanRoot.matrixWorld.elements;
      if (matrix.some(value => !Number.isFinite(value)) || Math.abs(matrix[3]) > 1e-9
        || Math.abs(matrix[7]) > 1e-9 || Math.abs(matrix[11]) > 1e-9 || Math.abs(matrix[15] - 1) > 1e-9) {
        return fail('Hallway sections need a finite affine scan transform.');
      }
      const scale = options.scanRoot.getWorldScale(new Vector3());
      if (![scale.x, scale.y, scale.z].every(value => Number.isFinite(value) && Math.abs(value - 1) < 1e-6)
        || Math.abs(options.scanRoot.matrixWorld.determinant() - 1) > 1e-6) {
        return fail('Hallway sections require the metric scan scale.');
      }
      direction.set(matrix[4], matrix[5], matrix[6]);
      const horizontalLength = Math.hypot(direction.x, direction.z);
      if (horizontalLength < 1e-9 || Math.abs(direction.y) > horizontalLength * .2
        || Math.abs(direction.z / horizontalLength) < MIN_FORWARD_Z) {
        return fail('The hallway is too transverse to world Z for this section.');
      }
      direction.y = 0; direction.normalize();
      const changedSource = source?.buffer !== centers.buffer || source.byteOffset !== centers.byteOffset || source.length !== centers.length;
      if (changedSource || pose.length !== 16 || matrix.some((value, index) => value !== pose[index])) {
        cache.clear();
        if (changedSource) previousCenterRaw = null;
        source = { buffer: centers.buffer, byteOffset: centers.byteOffset, length: centers.length };
        pose = [...matrix];
      }
      inverse.copy(options.scanRoot.matrixWorld).invert();
      const bucket = Math.round(worldZ / BUCKET_METRES);
      let fit = cache.get(bucket);
      if (!fit) {
        fit = fitBucket(centers, bucket * BUCKET_METRES);
        cache.set(bucket, fit);
        if (cache.size > MAX_SECTIONS) cache.delete(cache.keys().next().value!);
        if (fit.ok) previousCenterRaw = [...fit.centerRaw];
      }
      return fit.ok ? atExactZ(fit, worldZ) : { ...fit, evidence: evidenceCopy(fit.evidence) };
    },
    clear() { cache.clear(); pose = []; previousCenterRaw = null; },
    snapshot() { return { cachedSections: cache.size, fits: fitCount, bucketMetres: BUCKET_METRES }; },
  };
}
