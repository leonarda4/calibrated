import type { WallBlocker } from '../viewer/wallBlocker';

/** PC wall placement and movement; coordinates describe its bottom centre. */
export function bindWallControl(wall: WallBlocker, blockReason: () => string | null) {
  const host = document.getElementById('experience-wall-control');
  if (!host) throw new Error('Wall control container is missing.');
  const events = new AbortController();
  host.innerHTML = `
    <button id="experience-show-wall" type="button" style="width:100%">Show wall</button>
    <p id="experience-wall-status" aria-live="polite"></p>
    <p id="experience-wall-coordinate" style="font-variant-numeric:tabular-nums"></p>
    <details id="experience-wall-settings">
      <summary>Wall position &amp; motion</summary>
      <p>Bottom-centre XYZ · world metres. Forward moves away from the hallway start.</p>
      <div class="experience-fields">
        <label>Wall X <input id="experience-wall-x" aria-label="Wall base X" type="number" step="0.05"></label>
        <label>Wall Y <input id="experience-wall-y" aria-label="Wall base Y" type="number" step="0.05"></label>
        <label>Wall Z <input id="experience-wall-z" aria-label="Wall base Z" type="number" step="0.05"></label>
      </div>
      <div class="experience-row">
        <button id="experience-wall-apply" type="button">Set wall position</button>
        <button id="experience-wall-fit" type="button">Use start position</button>
      </div>
      <p id="experience-wall-placement-source"></p>
      <div class="experience-fields">
        <label>Travel ± m <input id="experience-wall-distance" aria-label="Wall travel metres" type="number" value="1" min="0.01" max="10" step="0.1"></label>
        <label>Speed m/s <input id="experience-wall-speed" aria-label="Wall speed metres per second" type="number" value="0.15" min="0.01" max="1" step="0.05"></label>
      </div>
      <div class="experience-row">
        <button id="experience-wall-forward" type="button">Move forward</button>
        <button id="experience-wall-backward" type="button">Move back</button>
      </div>
      <div class="experience-row">
        <button id="experience-wall-loop" type="button">Back &amp; forth</button>
        <button id="experience-wall-stop" type="button">Stop motion</button>
      </div>
      <p>Back &amp; forth repeats around the starting point with smooth turns. Speed is its maximum speed. Positions last for this page.</p>
    </details>
  `;
  const find = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#experience-wall-${id}`)!;
  const button = host.querySelector<HTMLButtonElement>('#experience-show-wall')!;
  const status = find('status'), coordinate = find('coordinate');
  const fields = ['x', 'y', 'z'].map(id => find<HTMLInputElement>(id));
  const distance = find<HTMLInputElement>('distance'), speed = find<HTMLInputElement>('speed');
  let dirty = false;
  let lastRender = '';
  const refresh = () => {
    const state = wall.snapshot();
    const reason = blockReason();
    const displayed = state.positionWorld ?? state.baseWorld;
    const text = displayed ? `${state.visible ? 'Wall now' : 'Wall standing position'}: [${displayed.map(n => n.toFixed(3)).join(', ')}] m`
      : 'Wall coordinate available after loading or showing the wall.';
    if (coordinate.textContent !== text) coordinate.textContent = text;
    if (!dirty && state.baseWorld) fields.forEach((field, i) => {
      if (document.activeElement !== field) field.value = state.baseWorld![i].toFixed(3);
    });
    const key = JSON.stringify([state.phase, state.motion, state.travel.mode, state.approach.active, state.status, state.placementSource, reason]);
    if (key === lastRender) return;
    lastRender = key;
    const active = state.motion === 'visible';
    button.textContent = state.motion === 'entering' ? 'Sliding in…'
      : state.motion === 'exiting' ? 'Sliding out…' : active ? 'Hide wall' : 'Show wall';
    button.setAttribute('aria-pressed', String(state.visible));
    button.disabled = state.phase !== 'ready' || state.animating || (!active && reason !== null);
    button.title = state.animating ? 'Wait for the wall to finish sliding'
      : active ? 'Slide the wall out to the right' : reason ?? 'Slide the 210 cm wall in from the left';
    status.textContent = state.status;
    const editable = state.phase === 'ready' && !state.animating && reason === null;
    for (const input of [...fields, distance, speed]) input.disabled = !editable;
    find<HTMLButtonElement>('apply').disabled = !editable;
    find<HTMLButtonElement>('fit').disabled = !editable;
    for (const id of ['forward', 'backward', 'loop']) find<HTMLButtonElement>(id).disabled = !editable || !active;
    find<HTMLButtonElement>('stop').disabled = !state.travel.moving && !state.approach.active && state.gameplayCue === null;
    find('placement-source').textContent = state.placementSource === 'manual' ? 'Custom position for this page.' : 'Hallway route: Z = -8 → -2. Follows VR calibration; pauses near the player.';
  };
  const click = (element: HTMLElement, action: () => void) => element.addEventListener('click', action, { signal: events.signal });
  button.addEventListener('click', () => { wall.toggle(); }, { signal: events.signal });
  for (const field of fields) field.addEventListener('input', () => { dirty = true; }, { signal: events.signal });
  click(find('apply'), () => {
    const point = fields.map(field => field.value === '' ? NaN : Number(field.value)) as [number, number, number];
    if (wall.setPosition(point)) { dirty = false; refresh(); }
  });
  click(find('fit'), () => { if (wall.useFittedPosition()) { dirty = false; refresh(); } });
  for (const mode of ['forward', 'backward', 'loop'] as const) click(find(mode), () => {
    wall.startTravel(mode, distance.value === '' ? NaN : Number(distance.value), speed.value === '' ? NaN : Number(speed.value));
  });
  click(find('stop'), () => { wall.stopTravel(); });
  const unsubscribe = wall.subscribe(refresh);
  refresh();
  return {
    refresh,
    dispose() { unsubscribe(); events.abort(); host.replaceChildren(); },
  };
}
