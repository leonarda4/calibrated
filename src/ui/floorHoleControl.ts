import type { FloorHole } from '../viewer/floorHole';

export function bindFloorHoleControl(hole: FloorHole, blockReason: () => string | null) {
  const host = document.getElementById('experience-floor-hole-control');
  if (!host) throw new Error('Floor opening control container is missing.');
  host.innerHTML = `<button id="experience-floor-hole" type="button" style="width:100%">Open floor hole</button>
    <p id="experience-floor-hole-status" aria-live="polite"></p>`;
  const button = host.querySelector<HTMLButtonElement>('button')!;
  const status = host.querySelector('p')!;
  let previous = '';
  const refresh = () => {
    const state = hole.snapshot(), reason = blockReason();
    const key = JSON.stringify([state, reason]);
    if (key === previous) return;
    previous = key;
    button.textContent = state.open ? 'Close floor hole' : 'Open floor hole';
    button.disabled = state.phase !== 'ready' || (!state.open && reason !== null);
    button.setAttribute('aria-pressed', String(state.open));
    button.title = state.open ? 'Restore the floor' : reason ?? 'Open a hole across the hallway width, starting at hallway Z = 3 m';
    status.textContent = state.status;
  };
  button.addEventListener('click', () => { hole.toggle(); refresh(); });
  refresh();
  return { refresh };
}
