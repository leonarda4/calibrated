import type { InstallationConfig, Position3 } from './flow.ts';

/** The upright box footprint, extended upward to include a wearer above it. */
export function isHeadsetInBox(position: Position3, config: InstallationConfig, yaw: number): boolean {
  if (!position.every(Number.isFinite) || !Number.isFinite(yaw)) return false;
  const dx = position[0] - config.centerX;
  const dz = position[2] - config.centerZ;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const x = c * dx - s * dz;
  const z = s * dx + c * dz;
  return position[1] >= config.floorY &&
    Math.abs(x) <= config.boxWidth / 2 + 1e-9 &&
    Math.abs(z) <= config.boxDepth / 2 + 1e-9;
}
