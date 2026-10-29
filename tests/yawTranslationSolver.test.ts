// Synthetic tests for the yaw+translation solver. Ground truth is constructed
// analytically, so these are deterministic — no randomness on the happy path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  solveYawTranslation, composeCalibration, rotateVec3ByQuat, quatFromAxisAngleY,
  type LandmarkPair, type Vec3,
} from '../src/calibration/yawTranslationSolver.ts';

/** Apply p' = R_y(yaw)·p + t analytically (independent of the solver). */
function apply(p: Vec3, yaw: number, t: Vec3): Vec3 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [
    c * p[0] + s * p[2] + t[0],
    p[1] + t[1],
    -s * p[0] + c * p[2] + t[2],
  ];
}

test('exact recovery from two clean pairs', () => {
  const yaw = 37 * Math.PI / 180;
  const t: Vec3 = [1.2, -0.05, -3.4];
  const scanPoints: Vec3[] = [[0, 0, 0], [5, 1.5, -2]];
  const pairs: LandmarkPair[] = scanPoints.map((s) => ({ scan: s, measured: apply(s, yaw, t) }));
  const sol = solveYawTranslation(pairs);
  assert.ok(Math.abs(sol.yaw - yaw) < 1e-9, `yaw ${sol.yaw} vs ${yaw}`);
  for (const i of [0, 1, 2] as const) {
    assert.ok(Math.abs(sol.translation[i] - t[i]) < 1e-9, `t[${i}] ${sol.translation[i]} vs ${t[i]}`);
  }
  for (const r of sol.residuals) assert.ok(r < 1e-9, `residual ${r}`);
});

test('four clean pairs, yaw = 0 (pure translation)', () => {
  const t: Vec3 = [2, 0.1, -1];
  const scanPoints: Vec3[] = [[0, 0, 0], [3, 0, 1], [-1, 2, 4], [0.5, -1, -2]];
  const pairs: LandmarkPair[] = scanPoints.map((s) => ({ scan: s, measured: apply(s, 0, t) }));
  const sol = solveYawTranslation(pairs);
  assert.ok(Math.abs(sol.yaw) < 1e-9);
  assert.ok(sol.rmsResidual < 1e-9);
});

test('noisy pairs give small residuals and near-exact yaw', () => {
  const yaw = -1.1;
  const t: Vec3 = [0.3, 0, 2];
  const scanPoints: Vec3[] = [[0, 0, 0], [4, 1, 0], [-2, 0.5, 3], [1, -0.5, -3]];
  const noise = [0.008, -0.006, 0.007, -0.009]; // ±1 cm, fixed values
  const pairs: LandmarkPair[] = scanPoints.map((s, i) => {
    const m = apply(s, yaw, t);
    return { scan: s, measured: [m[0] + noise[i], m[1], m[2] - noise[i]] as Vec3 };
  });
  const sol = solveYawTranslation(pairs);
  assert.ok(Math.abs(sol.yaw - yaw) < 0.01, `yaw error ${(sol.yaw - yaw).toFixed(4)} rad`);
  assert.ok(sol.rmsResidual < 0.02, `rms ${sol.rmsResidual}`);
});

test('composition matches double application exactly', () => {
  const currentYaw = 0.3;
  const currentPos: Vec3 = [1, 2, 3];
  const calibYaw = 0.2;
  const calibT: Vec3 = [0.5, 0, -1];

  const composed = composeCalibration(
    { quaternion: quatFromAxisAngleY(currentYaw), position: currentPos },
    solveYawTranslation([
      { scan: [0, 0, 0], measured: apply([0, 0, 0], calibYaw, calibT) },
      { scan: [1, 0, 0], measured: apply([1, 0, 0], calibYaw, calibT) },
    ]),
  );

  // ground truth: take a scan-local point through current transform, then calibration
  const p: Vec3 = [0.7, 1.1, -0.4];
  const step1 = apply(rotateVec3ByQuat(p, quatFromAxisAngleY(currentYaw)), 0, currentPos);
  const expected = apply(step1, calibYaw, calibT);
  const actual = apply(rotateVec3ByQuat(p, composed.quaternion), 0, composed.position);
  for (const i of [0, 1, 2] as const) {
    assert.ok(Math.abs(expected[i] - actual[i]) < 1e-9, `axis ${i}: ${expected[i]} vs ${actual[i]}`);
  }
});

test('solver rejects fewer than two pairs', () => {
  assert.throws(() => solveYawTranslation([{ scan: [0, 0, 0], measured: [1, 0, 0] }]));
});