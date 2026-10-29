// src/ui: operator panel to pick the start point BEFORE entering VR.
// Moves the map around the player (scan root only), so no physical walking
// is required to position the spawn.

const ids = ['spawn-x', 'spawn-y', 'spawn-z'] as const;

export function bindSpawnPanel(
  apply: (point: [number, number, number]) => void,
  initial: [number, number, number] = [0, 0, 0],
): void {
  // prefill the inputs from the committed START_POINT (single source of truth)
  for (const [i, id] of ids.entries()) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = String(initial[i]);
  }
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