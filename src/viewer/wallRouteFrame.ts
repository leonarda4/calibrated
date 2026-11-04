import { Matrix3, Matrix4, Object3D, Vector3 } from 'three';

/** Map authored desktop stations into a session's calibrated horizontal space.
 * Floor height remains local-floor Y=0; no tracked rig or content is moved here.
 */
export function calibratedWallRoute(authoredScan: Matrix4, calibratedScan: Matrix4): Matrix4 {
  const delta = calibratedScan.clone().multiply(authoredScan.clone().invert());
  const e = delta.elements;
  const x = new Vector3(e[0], e[1], e[2]), y = new Vector3(e[4], e[5], e[6]);
  const z = new Vector3(e[8], e[9], e[10]);
  if (!e.every(Number.isFinite) || Math.abs(delta.determinant() - 1) > 1e-5 ||
      [x, y, z].some(axis => Math.abs(axis.length() - 1) > 1e-5) ||
      Math.abs(x.dot(z)) > 1e-5 || y.distanceTo(new Vector3(0, 1, 0)) > 1e-5) {
    throw new Error('The wall route requires a rigid, metric yaw calibration.');
  }
  delta.elements[13] = 0;
  return delta;
}

/** Geometry-only view of the scan in route coordinates; never added to a scene. */
export function createHallwayPlacementFrame(scanRoot: Object3D) {
  const toWorld = new Matrix4(), fromWorld = new Matrix4();
  const root = new Object3D();
  root.matrixAutoUpdate = false;
  root.updateWorldMatrix = () => {
    scanRoot.updateWorldMatrix(true, false);
    root.matrixWorld.multiplyMatrices(fromWorld, scanRoot.matrixWorld);
  };
  return {
    root,
    set(matrix = new Matrix4()) {
      // Validate callers too; setting a frame never grants calibration acceptance.
      toWorld.copy(calibratedWallRoute(new Matrix4(), matrix));
      fromWorld.copy(toWorld).invert();
      root.updateWorldMatrix(true, false);
    },
    worldPoint: (point: Vector3) => point.applyMatrix4(toWorld),
    routePoint: (point: Vector3) => point.applyMatrix4(fromWorld),
    routeVector: (vector: Vector3) => vector.applyMatrix3(new Matrix3().setFromMatrix4(fromWorld)),
    matrix: () => toWorld.toArray(),
  };
}

export type HallwayPlacementFrame = ReturnType<typeof createHallwayPlacementFrame>;
// Preserve the existing import for isolated wall-frame callers.
export const createWallRouteFrame = createHallwayPlacementFrame;
