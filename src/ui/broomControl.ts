import type { Broom } from '../viewer/broom';

export function bindBroomControl(broom: Broom, blockReason: () => string | null) {
  const host = document.getElementById('experience-broom-control');
  if (!host) throw new Error('Broom control container is missing.');
  host.innerHTML = `<button id="experience-show-broom" type="button" style="width:100%">Show broom</button>
    <p id="experience-broom-status" aria-live="polite"></p>`;
  const button = host.querySelector<HTMLButtonElement>('button')!;
  const status = host.querySelector('p')!;
  let previous = '';
  const refresh = () => {
    const state = broom.snapshot(), reason = blockReason();
    const key = JSON.stringify([state, reason]);
    if (key === previous) return;
    previous = key;
    button.textContent = state.visible ? 'Hide broom' : 'Show broom';
    button.disabled = state.phase !== 'ready' || (!state.visible && reason !== null);
    button.setAttribute('aria-pressed', String(state.visible));
    button.title = state.visible ? 'Hide the broom' : reason ?? 'Stand the scanned broom at the hallway centre, hallway Z = 6 m';
    status.textContent = state.status;
  };
  button.addEventListener('click', () => { broom.toggle(); refresh(); });
  refresh();
  return { refresh };
}
