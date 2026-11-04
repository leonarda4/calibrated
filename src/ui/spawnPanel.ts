// Desktop raw-coordinate inspection. Moving the scan keeps its current heading.

const ids = ['spawn-x', 'spawn-y', 'spawn-z'] as const;

export function bindSpawnPanel(
  apply: (point: [number, number, number]) => void,
  initial: [number, number, number] = [0, 0, 0],
): { refresh(point: readonly [number, number, number], editable: boolean, visible?: boolean): void } {
  // prefill the inputs from the committed START_POINT (single source of truth)
  for (const [i, id] of ids.entries()) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = String(initial[i]);
  }
  const inputs = ids.map(id => document.getElementById(id) as HTMLInputElement | null);
  const panel = document.getElementById('spawn-panel');
  const handler = () => {
    if (inputs.some(el => !el || el.disabled || el.value.trim() === '')) return;
    const point = inputs.map(el => Number(el!.value)) as [number, number, number];
    if (point.every(Number.isFinite)) apply(point);
  };
  for (const id of ids) {
    document.getElementById(id)?.addEventListener('input', handler);
    document.getElementById(id)?.addEventListener('change', handler);
  }
  return {
    refresh(point, editable, visible = true) {
      if (panel) panel.style.display = visible ? '' : 'none';
      for (const input of inputs) if (input) input.disabled = !editable;
      // Do not replace a partially typed number or move the text cursor.
      if (inputs.some(input => input && input === document.activeElement)) return;
      inputs.forEach((input, axis) => {
        const value = String(Number(point[axis].toFixed(6)));
        if (input && input.value !== value) input.value = value;
      });
    },
  };
}
