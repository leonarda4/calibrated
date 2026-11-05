import { Matrix4, Vector3 } from 'three';

export const HALLWAY_CUT = {
  modelUrl: '/splats/hallway-cut/hallway3-cut.ply',
  metadataUrl: '/splats/hallway-cut/hallway3-cut.ply.meta.json',
  sceneIndex: 5,
  // Visible source floor to ceiling, excluding the extraction's shell allowance.
  openingHeight: 2.60,
} as const;

export type Point3 = readonly [number, number, number];
export interface CutOpening {
  origin: Point3;
  across: Point3;
  up: Point3;
  along: Point3;
  width: number;
  height: number;
}
export interface HoleMouth {
  open: boolean;
  floorY: number;
  startZ: number;
  endZ: number;
  nearBounds: number[] | null;
  farBounds: number[] | null;
  routeToWorld: number[];
}

/** Source coordinates stay in the private asset/sidecar, not the authored scan. */
export function cutOpeningFromMetadata(value: unknown): CutOpening {
  const data = value as { cutPlane?: {pointRaw?: Point3; normalRaw?: Point3}; floorFit?: {normalRaw?: Point3}; walls?: {width?: number} };
  const origin = data?.cutPlane?.pointRaw, along = data?.cutPlane?.normalRaw, up = data?.floorFit?.normalRaw;
  if (![origin, along, up].every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) ||
    !Number.isFinite(data?.walls?.width) || data.walls!.width! < .75 || data.walls!.width! > 4.2) {
    throw new Error('Hallway cutout metadata has no valid source opening. Regenerate the separate crop.');
  }
  const forward = new Vector3(...along!), vertical = new Vector3(...up!);
  if (Math.abs(forward.length() - 1) > 1e-5 || Math.abs(vertical.length() - 1) > 1e-5 || Math.abs(forward.dot(vertical)) > 1e-5) {
    throw new Error('Hallway cutout metadata needs an orthogonal floor and cut plane.');
  }
  return { origin: [...origin!], along: forward.toArray(), up: vertical.toArray(),
    across: new Vector3().crossVectors(forward, vertical).normalize().toArray(), width: data.walls!.width!, height: HALLWAY_CUT.openingHeight };
}

export function rawToCutOpening(source: CutOpening): Matrix4 {
  const [a, u, f, p] = [source.across, source.up, source.along, source.origin];
  return new Matrix4().set(
      a[0], a[1], a[2], -new Vector3(...a).dot(new Vector3(...p)),
      u[0], u[1], u[2], -new Vector3(...u).dot(new Vector3(...p)),
      f[0], f[1], f[2], -new Vector3(...f).dot(new Vector3(...p)), 0, 0, 0, 1,
  );
}

/** Bilinear mouth mapping: handles all four corners of a tapered opening. */
export function cutoutPlacement(source: CutOpening, hole: HoleMouth, secondBoxRoute?: Point3 | null) {
  if (!hole.nearBounds || !hole.farBounds || ![hole.floorY, hole.startZ, hole.endZ, ...hole.nearBounds, ...hole.farBounds, ...hole.routeToWorld].every(Number.isFinite) ||
    hole.endZ <= hole.startZ || hole.nearBounds.length !== 2 || hole.farBounds.length !== 2 ||
    hole.nearBounds[1] <= hole.nearBounds[0] || hole.farBounds[1] <= hole.farBounds[0] || hole.routeToWorld.length !== 16) {
    throw new Error('The hallway cutout needs the actual fitted hole corners.');
  }
  const near = hole.nearBounds, far = hole.farBounds, length = hole.endZ - hole.startZ;
  const distance = (bounds: number[], z: number) => secondBoxRoute
    ? ((bounds[0] + bounds[1]) / 2 - secondBoxRoute[0]) ** 2 + (z - secondBoxRoute[2]) ** 2 : 0;
  if (secondBoxRoute && !secondBoxRoute.every(Number.isFinite)) throw new Error('The second box position must be finite.');
  const floorAtEnd = !secondBoxRoute || distance(far, hole.endZ) <= distance(near, hole.startZ);
  const sign = floorAtEnd ? 1 : -1;
  const sFor = (height: number) => floorAtEnd ? 1 - height / source.height : height / source.height;
  const map = (openingPoint: Vector3): Vector3 => {
    const s = sFor(openingPoint.y), t = .5 + sign * openingPoint.x / source.width;
    const left = near[0] + s * (far[0] - near[0]), right = near[1] + s * (far[1] - near[1]);
    return new Vector3(left + (right - left) * t, hole.floorY - openingPoint.z, hole.startZ + s * length);
  };
  const derivative = (p: Vector3): Matrix4 => {
    const s = sFor(p.y), t = .5 + sign * p.x / source.width, ds = -sign / source.height;
    const nearWidth = near[1] - near[0], widthDelta = far[1] - far[0] - nearWidth;
    return new Matrix4().set(sign * (nearWidth + s * widthDelta) / source.width,
      (far[0] - near[0] + t * widthDelta) * ds, 0, 0,
      0, 0, -1, 0,
      0, length * ds, 0, 0,
      0, 0, 0, 1);
  };
  // The renderer/sorter gets the tangent affine frame; the vertex shader applies
  // the small taper correction and its exact Gaussian covariance Jacobian.
  const midpoint = new Vector3(0, source.height / 2, 0), affine = derivative(midpoint);
  affine.setPosition(map(midpoint).sub(midpoint.clone().applyMatrix4(affine)));
  const rawToOpening = rawToCutOpening(source), routeToWorld = new Matrix4().fromArray(hole.routeToWorld);
  return { floorAtEnd, sign, map, derivative, rawToOpening, routeToWorld,
    sourceToWorld: routeToWorld.clone().multiply(affine).multiply(rawToOpening),
    mapRaw: (raw: Vector3) => map(raw.clone().applyMatrix4(rawToOpening)).applyMatrix4(routeToWorld),
    mouthWorld: [new Vector3(-source.width/2,0,0), new Vector3(source.width/2,0,0),
      new Vector3(-source.width/2,source.height,0), new Vector3(source.width/2,source.height,0)]
      .map(p => map(p).applyMatrix4(routeToWorld).toArray()),
  };
}
