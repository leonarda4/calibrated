// src/calibration: pure yaw + translation solver for landmark calibration.
// No rendering or device dependencies — Node's test runner executes this
// directly (tests/yawTranslationSolver.test.ts).
//
// Model: the XR runtime already enforces gravity and the floor plane
// (reference space 'local-floor'), so alignment needs only ONE rotational
// degree of freedom (yaw about world +Y) plus a translation:
//
//     p' = R_y(yaw) · p + t
//
// where p is the landmark's position in the CURRENT scan-root frame and
// p' is its physically measured position in XR space. The scan root is the
// only thing this transform may touch — never the camera/controller rig.

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number]; // x, y, z, w

export interface LandmarkPair {
  /** Landmark position in the current scan-root (world) frame, metres. */
  scan: Vec3;
  /** Physically measured position of the same landmark in XR space, metres. */
  measured: Vec3;
}

export interface YawTranslationSolution {
  /** Rotation about world +Y in radians. */
  yaw: number;
  /** Translation applied after the yaw rotation, metres. */
  translation: Vec3;
  /** Per-pair fit error in metres (distance after transform). */
  residuals: number[];
  /** Root-mean-square fit error in metres. */
  rmsResidual: number;
}

/**
 * Solve the yaw + translation that best aligns the scan landmarks with the
 * physically measured landmarks (least squares, closed form).
 * Requires at least 2 non-identical pairs.
 */
export function solveYawTranslation(pairs: LandmarkPair[]): YawTranslationSolution {
  const n = pairs.length;
  if (n < 2) throw new Error('calibration needs at least 2 landmark pairs');

  // centroids
  let sx = 0, sy = 0, sz = 0, mx = 0, my = 0, mz = 0;
  for (const p of pairs) {
    sx += p.scan[0]; sy += p.scan[1]; sz += p.scan[2];
    mx += p.measured[0]; my += p.measured[1]; mz += p.measured[2];
  }
  const sMeanX = sx / n, sMeanY = sy / n, sMeanZ = sz / n;
  const mMeanX = mx / n, mMeanY = my / n, mMeanZ = mz / n;

  // 2D Procrustes on the (x, z) plane about the centroids:
  // maximize  A·cos(yaw) + B·sin(yaw)
  //   A = Σ (m'x·s'x + m'z·s'z)
  //   B = Σ (m'x·s'z − m'z·s'x)
  let a = 0, b = 0;
  for (const p of pairs) {
    const sdx = p.scan[0] - sMeanX, sdz = p.scan[2] - sMeanZ;
    const mdx = p.measured[0] - mMeanX, mdz = p.measured[2] - mMeanZ;
    a += mdx * sdx + mdz * sdz;
    b += mdx * sdz - mdz * sdx;
  }
  const yaw = Math.atan2(b, a);

  // translation: t = mMean − R_y(yaw)·sMean  (y is untouched by yaw)
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const translation: Vec3 = [
    mMeanX - (c * sMeanX + s * sMeanZ),
    mMeanY - sMeanY,
    mMeanZ - (-s * sMeanX + c * sMeanZ),
  ];

  // per-pair residuals
  const residuals = pairs.map((p) => {
    const px = c * p.scan[0] + s * p.scan[2] + translation[0];
    const py = p.scan[1] + translation[1];
    const pz = -s * p.scan[0] + c * p.scan[2] + translation[2];
    const dx = px - p.measured[0], dy = py - p.measured[1], dz = pz - p.measured[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  });
  const rmsResidual = Math.sqrt(residuals.reduce((acc, r) => acc + r * r, 0) / n);

  return { yaw, translation, residuals, rmsResidual };
}

// ---------------------------------------------------------------------------
// Composition with the live scan-root transform
// ---------------------------------------------------------------------------

export interface ScanRootTransform {
  quaternion: Quat;
  position: Vec3;
}

export function quatFromAxisAngleY(angle: number): Quat {
  const h = angle / 2;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

/** Hamilton product a ⊗ b (rotation a applied AFTER b). */
export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotate v by quaternion q. */
export function rotateVec3ByQuat(v: Vec3, q: Quat): Vec3 {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Fold a calibration solution into the current scan-root transform:
 *   new = R_y(yaw) ∘ current  (with the translation composed accordingly)
 * The result is what to write onto the splat group: quaternion and position.
 */
export function composeCalibration(
  current: ScanRootTransform,
  solution: YawTranslationSolution,
): ScanRootTransform {
  const qYaw = quatFromAxisAngleY(solution.yaw);
  const rotatedPosition = rotateVec3ByQuat(current.position, qYaw);
  return {
    quaternion: quatMultiply(qYaw, current.quaternion),
    position: [
      rotatedPosition[0] + solution.translation[0],
      rotatedPosition[1] + solution.translation[1],
      rotatedPosition[2] + solution.translation[2],
    ],
  };
}