// Floor-preserving content rotation, independent of rendering and device input.
export type Point3 = readonly [number, number, number];
export type Rotation4 = readonly [number, number, number, number];
export interface ContentTransform { position: Point3; quaternion: Rotation4; }

export function rotateContentAroundPivot(baseline: ContentTransform, pivot: Point3, yaw: number): ContentTransform {
  const [x, y, z] = baseline.position;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const [qx, qy, qz, qw] = baseline.quaternion;
  const h = Math.sin(yaw / 2), w = Math.cos(yaw / 2);
  return {
    position: [pivot[0] + c * (x - pivot[0]) + s * (z - pivot[2]), y,
      pivot[2] - s * (x - pivot[0]) + c * (z - pivot[2])],
    quaternion: [w * qx + h * qz, w * qy + h * qw, w * qz - h * qx, w * qw - h * qy],
  };
}
