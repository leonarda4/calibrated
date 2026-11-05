export interface HoleFootprint {
  open: boolean;
  floorY: number;
  startZ: number;
  endZ: number;
  nearBounds: readonly number[] | null;
  farBounds: readonly number[] | null;
}

/** Test the fitted trapezoid in the shared hallway frame, never a world AABB. */
export function headsetAboveHole(position: readonly number[] | null, hole: HoleFootprint): boolean {
  if (!hole.open || !position || position.length !== 3 || !position.every(Number.isFinite) ||
    !hole.nearBounds || !hole.farBounds || hole.nearBounds.length !== 2 || hole.farBounds.length !== 2 ||
    ![hole.floorY, hole.startZ, hole.endZ, ...hole.nearBounds, ...hole.farBounds].every(Number.isFinite) ||
    hole.endZ <= hole.startZ || hole.nearBounds[0] >= hole.nearBounds[1] || hole.farBounds[0] >= hole.farBounds[1] ||
    position[1] < hole.floorY || position[2] < hole.startZ || position[2] > hole.endZ) return false;
  const t = (position[2] - hole.startZ) / (hole.endZ - hole.startZ);
  const left = hole.nearBounds[0] + (hole.farBounds[0] - hole.nearBounds[0]) * t;
  const right = hole.nearBounds[1] + (hole.farBounds[1] - hole.nearBounds[1]) * t;
  return left < right && position[0] >= left && position[0] <= right;
}

/** Require a deliberate horizontal exit before a returned visitor can re-enter. */
export function headsetClearOfHole(position: readonly number[] | null, hole: HoleFootprint, margin = .1): boolean {
  if (!position || position.length !== 3 || !position.every(Number.isFinite) || !Number.isFinite(margin) || margin < 0) return false;
  const middleZ = (hole.startZ + hole.endZ) / 2;
  const middleX = ((hole.nearBounds?.[0] ?? NaN) + (hole.nearBounds?.[1] ?? NaN) +
    (hole.farBounds?.[0] ?? NaN) + (hole.farBounds?.[1] ?? NaN)) / 4;
  if (!headsetAboveHole([middleX, hole.floorY, middleZ], hole)) return false;
  if (position[2] < hole.startZ - margin || position[2] > hole.endZ + margin) return true;
  const t = Math.max(0, Math.min(1, (position[2] - hole.startZ) / (hole.endZ - hole.startZ)));
  const left = hole.nearBounds![0] + (hole.farBounds![0] - hole.nearBounds![0]) * t;
  const right = hole.nearBounds![1] + (hole.farBounds![1] - hole.nearBounds![1]) * t;
  return position[0] < left - margin || position[0] > right + margin;
}

/** One latched anticipation and visual quarter-turn per armed entry. */
export function createHoleTransition(options: { leadSeconds: number; onAnticipate(): void; onTransition?(): void }) {
  let phase: 'idle' | 'anticipating' | 'triggered' | 'cancelled' = 'idle';
  let elapsed = 0;
  return {
    reset() { phase = 'idle'; elapsed = 0; },
    update(deltaSeconds: number, eligible: boolean, inside: boolean) {
      if (phase === 'triggered' || phase === 'cancelled') return;
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 || deltaSeconds > .5 || !eligible) {
        if (phase === 'anticipating') phase = 'cancelled';
        return;
      }
      if (deltaSeconds === 0) return;
      if (phase === 'idle') {
        if (!inside) return;
        phase = 'anticipating'; elapsed = 0;
        options.onAnticipate();
        return;
      }
      elapsed += deltaSeconds;
      if (elapsed + 1e-9 >= options.leadSeconds) {
        phase = 'triggered'; options.onTransition?.();
      }
    },
    snapshot: () => ({ phase, remainingSeconds: phase === 'anticipating' ? Math.max(0, options.leadSeconds - elapsed) : null,
      visualImplemented: true }),
  };
}
