import type { Installation } from '../experience/installation.ts';

/** Operator-only appearance correction, independent of box placement fields. */
export function bindRotationOffsetControl(parent: HTMLElement, installation: Installation, options: {
  canAdjust(): boolean;
  apply(metres: number): boolean;
}) {
  const events = new AbortController();
  parent.innerHTML = `
    <details id="experience-flip-alignment">
      <summary>Flipped hallway wall alignment</summary>
      <p>Shift the hallway sideways after the flip. − left / + right, facing down the original hallway. The first box stays fixed; hallway objects follow the walls.</p>
      <label>Offset <input id="experience-flip-offset" type="number" min="-100" max="100" step="1" value="0"> cm</label>
      <div class="experience-row">
        <button id="experience-flip-left" type="button">−1 cm</button>
        <button id="experience-flip-right" type="button">+1 cm</button>
        <button id="experience-flip-apply" type="button">Apply offset</button>
        <button id="experience-flip-zero" type="button">Zero</button>
      </div>
      <p id="experience-flip-offset-status" aria-live="polite"></p>
      <p id="experience-flip-offset-error" role="alert"></p>
    </details>
  `;
  const input = parent.querySelector<HTMLInputElement>('#experience-flip-offset')!;
  const status = parent.querySelector<HTMLElement>('#experience-flip-offset-status')!;
  const error = parent.querySelector<HTMLElement>('#experience-flip-offset-error')!;
  const buttons = Array.from(parent.querySelectorAll<HTMLButtonElement>('button'));
  let dirty = false;
  const allowed = () => {
    const state = installation.snapshot();
    return options.canAdjust() && state.phase !== 'rotating' && state.phase !== 'stopped';
  };
  const render = () => {
    const state = installation.snapshot();
    input.disabled = !allowed();
    buttons.forEach(button => { button.disabled = input.disabled; });
    if (!dirty) input.value = String(Math.round(state.rotationOffsetMetres * 10000) / 100);
    const amount = `${(state.rotationOffsetMetres * 100).toFixed(1)} cm`;
    status.textContent = state.phase === 'stopped' ? 'Offset frozen. Reset and restore calibration before adjusting.'
      : state.phase === 'rotating' ? `Blending toward ${amount}. Wait for the turn to finish before adjusting.`
      : state.phase === 'reversed' ? `Applied: ${amount}. Check both real walls at the box before continuing.`
      : `Next flip: ${amount}. The original hallway alignment stays unchanged.`;
  };
  const apply = (centimetres: number) => {
    error.textContent = '';
    try {
      if (!allowed() || !options.apply(centimetres / 100)) {
        throw new Error('Finish the turn/test and restore visible tracking and calibration before adjusting.');
      }
      dirty = false;
    } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); }
    render();
  };
  const value = () => input.value.trim() === '' ? NaN : Number(input.value);
  input.addEventListener('input', () => { dirty = true; }, { signal: events.signal });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); apply(value()); }
  }, { signal: events.signal });
  const click = (id: string, action: () => void) => parent.querySelector(`#${id}`)!
    .addEventListener('click', action, { signal: events.signal });
  click('experience-flip-apply', () => apply(value()));
  click('experience-flip-left', () => apply(Math.round((value() - 1) * 100) / 100));
  click('experience-flip-right', () => apply(Math.round((value() + 1) * 100) / 100));
  click('experience-flip-zero', () => apply(0));
  const unsubscribe = installation.subscribe(render);
  return { refresh: render, dispose() { unsubscribe(); events.abort(); parent.replaceChildren(); } };
}
