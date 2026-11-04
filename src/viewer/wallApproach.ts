export type PlayerPosition = readonly [number, number, number] | null;
export interface WallClearance {
  player: PlayerPosition;
  centerX: number;
  halfWidth: number;
  halfDepth: number;
  clearance: number;
  resumeExtra: number;
}

/** Horizontal footprint: headset height never excludes the player's body. */
export function wallEntryBlocked(player: PlayerPosition, bounds: {
  minX: number; maxX: number; minZ: number; maxZ: number;
}, margin: number): boolean {
  if (!player || !player.every(Number.isFinite)) return true;
  return player[0] >= bounds.minX - margin && player[0] <= bounds.maxX + margin &&
    player[2] >= bounds.minZ - margin && player[2] <= bounds.maxZ + margin;
}

/** One-way route-Z trajectory. Player waits never accrue catch-up movement. */
export class WallApproach {
  private startZ = 8;
  private z = 8;
  private targetZ = 2;
  private speed = .3;
  private state: 'idle' | 'moving' | 'waiting' | 'complete' = 'idle';
  private waitingFor: 'player' | 'tracking' | null = null;

  snapshot() { return { startZ: this.startZ, z: this.z, targetZ: this.targetZ, speed: this.speed,
    active: this.state === 'moving' || this.state === 'waiting', state: this.state, waitingFor: this.waitingFor }; }

  start(startZ: number, targetZ: number, speed: number): void {
    if (![startZ, targetZ, speed].every(Number.isFinite) || speed <= 0) {
      throw new Error('Wall approach requires finite Z coordinates and positive speed.');
    }
    this.startZ = this.z = startZ; this.targetZ = targetZ; this.speed = speed;
    this.waitingFor = null; this.state = startZ === targetZ ? 'complete' : 'moving';
  }

  update(deltaSeconds: number, space: WallClearance): void {
    if (!this.snapshot().active || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const { player, centerX, halfWidth, halfDepth, clearance, resumeExtra } = space;
    if (!player || !player.every(Number.isFinite)) {
      this.state = 'waiting'; this.waitingFor = 'tracking'; return;
    }
    const margin = clearance + (this.waitingFor === 'player' ? resumeExtra : 0);
    if (Math.abs(player[0] - centerX) <= halfWidth + margin && Math.abs(player[2] - this.z) <= halfDepth + margin) {
      this.state = 'waiting'; this.waitingFor = 'player'; return;
    }
    const direction = Math.sign(this.targetZ - this.startZ) || 1;
    const current = direction * this.z, target = direction * this.targetZ;
    const proposed = Math.min(target, current + this.speed * deltaSeconds);
    let next = proposed;
    // Sweep the whole step. An obstructed player can stop progress, never
    // force a retreat or be crossed to catch up after a paused frame.
    if (Math.abs(player[0] - centerX) <= halfWidth + clearance && direction * player[2] >= current) {
      next = Math.min(next, direction * player[2] - halfDepth - clearance);
    }
    next = Math.max(direction * this.startZ, current, next);
    const stoppedByPlayer = next < target && (next < proposed - 1e-9 || next <= current + 1e-9);
    this.z = direction * next;
    this.waitingFor = stoppedByPlayer ? 'player' : null;
    this.state = next >= target ? 'complete' : stoppedByPlayer ? 'waiting' : 'moving';
  }

  cancel(): void { this.state = 'idle'; this.waitingFor = null; }
}
