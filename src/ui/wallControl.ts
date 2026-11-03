import type { WallBlocker } from '../viewer/wallBlocker';

/** One explicit PC operator action; async loading never owns show authority. */
export function bindWallControl(wall: WallBlocker, blockReason: () => string | null) {
  const host = document.getElementById('experience-wall-control');
  if (!host) throw new Error('Wall control container is missing.');
  const button = document.createElement('button');
  button.id = 'experience-show-wall';
  button.type = 'button';
  button.style.width = '100%';
  const status = document.createElement('p');
  status.id = 'experience-wall-status';
  status.setAttribute('aria-live', 'polite');
  host.append(button, status);
  let lastRender = '';
  const refresh = () => {
    const state = wall.snapshot();
    const reason = blockReason();
    const key = JSON.stringify([state.visible, state.requested, state.status, reason]);
    if (key === lastRender) return;
    lastRender = key;
    const active = state.visible || state.requested;
    button.textContent = state.visible ? 'Hide wall' : state.requested ? 'Cancel wall loading' : 'Show wall';
    button.setAttribute('aria-pressed', String(state.visible));
    button.disabled = !active && reason !== null;
    button.title = active ? 'Hide the wall across the hallway' : reason ?? 'Show the 210 cm scan wall across the hallway';
    status.textContent = state.status;
  };
  const click = () => { void wall.toggle(); };
  button.addEventListener('click', click);
  const unsubscribe = wall.subscribe(refresh);
  refresh();
  return {
    refresh,
    dispose() { unsubscribe(); button.removeEventListener('click', click); host.replaceChildren(); },
  };
}
