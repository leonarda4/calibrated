// Floor-preserving content rotation, independent of rendering and device input.
export type Point3 = readonly [number, number, number];
export type Rotation4 = readonly [number, number, number, number];
export interface ContentTransform { position: Point3; quaternion: Rotation4; }

/** +metres moves right when looking from the start down the original hallway. */
export function hallwayTurnOffset(yaw: number, metres: number, hallwayYaw: number): Point3 {
  const amount = metres * Math.min(1, Math.max(0, yaw / Math.PI));
  if (amount === 0) return [0, 0, 0];
  return [-Math.cos(hallwayYaw) * amount, 0, Math.sin(hallwayYaw) * amount];
}

export function rotateContentAroundPivot(
  baseline: ContentTransform, pivot: Point3, yaw: number, lateralOffset = 0, hallwayYaw = 0,
): ContentTransform {
  const [x, y, z] = baseline.position;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const [qx, qy, qz, qw] = baseline.quaternion;
  const h = Math.sin(yaw / 2), w = Math.cos(yaw / 2);
  const offset = hallwayTurnOffset(yaw, lateralOffset, hallwayYaw);
  return {
    position: [pivot[0] + c * (x - pivot[0]) + s * (z - pivot[2]) + offset[0], y,
      pivot[2] - s * (x - pivot[0]) + c * (z - pivot[2]) + offset[2]],
    quaternion: [w * qx + h * qz, w * qy + h * qw, w * qz - h * qx, w * qw - h * qy],
  };
}
