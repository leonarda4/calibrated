// src/ui: operator panel to pick the start point BEFORE entering VR.
// Moves the map around the player (scan root only), so no physical walking
// is required to position the spawn.

const ids = ['spawn-x', 'spawn-y', 'spawn-z'] as const;

export function bindSpawnPanel(apply: (point: [number, number, number]) => void): void {
  const read = (id: string): number => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    const v = el ? parseFloat(el.value) : NaN;
    return Number.isFinite(v) ? v : 0;
  };
  const handler = () => apply([read(ids[0]), read(ids[1]), read(ids[2])]);
  for (const id of ids) {
    document.getElementById(id)?.addEventListener('input', handler);
    document.getElementById(id)?.addEventListener('change', handler);
  }
}