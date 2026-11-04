import type { HallwayLighting } from '../viewer/hallwayLighting';

export const LIGHTING_BRIGHTNESS_STORAGE_KEY = 'hallway-lights-out-brightness';

/** PC operator button only; never added to the XR scene or input handlers. */
export function bindLightingControl(lighting: HallwayLighting, blockReason: () => string | null) {
  const host = document.getElementById('experience-lighting-control');
  if (!host) throw new Error('Lighting control container is missing.');
  try {
    const saved = localStorage.getItem(LIGHTING_BRIGHTNESS_STORAGE_KEY);
    if (saved !== null && saved.trim() !== '') lighting.setLightsOutBrightness(Number(saved));
  } catch { /* appearance controls still work when browser storage is unavailable */ }
  host.innerHTML = `<button id="experience-lights-out" type="button" style="width:100%">Lights out</button>
    <label for="experience-lights-brightness" style="justify-content:space-between">Dark-mode brightness
      <output id="experience-lights-brightness-value" for="experience-lights-brightness"></output></label>
    <input id="experience-lights-brightness" type="range" min="0" max="100" step="1" style="width:100%;margin:0"
      aria-describedby="experience-lights-brightness-help">
    <p id="experience-lights-brightness-help">0% black · 100% normal. Adjust with lights out to preview.</p>
    <p id="experience-lighting-status" aria-live="polite"></p>`;
  const button = host.querySelector<HTMLButtonElement>('button')!;
  const slider = host.querySelector<HTMLInputElement>('input')!;
  const output = host.querySelector('output')!;
  const status = host.querySelector('#experience-lighting-status')!;
  let previous = '';
  const refresh = () => {
    const { ready, lightsOut, lightsOutBrightness, fading, flickering, cuePhase } = lighting.snapshot();
    const percent = Math.round(lightsOutBrightness * 100);
    const reason = blockReason();
    const key = JSON.stringify([ready, lightsOut, lightsOutBrightness, fading, flickering, cuePhase, reason]);
    if (key === previous) return;
    previous = key;
    button.textContent = lightsOut ? 'Lights on' : 'Lights out';
    button.setAttribute('aria-pressed', String(lightsOut));
    button.disabled = !ready || (!lightsOut && reason !== null);
    button.title = lightsOut ? 'Restore normal hallway brightness' : reason ?? 'Darken the hallway';
    slider.value = String(percent);
    slider.disabled = !ready;
    slider.setAttribute('aria-valuetext', `${percent}% brightness`);
    output.textContent = `${percent}%`;
    status.textContent = !ready ? 'Lighting control is loading.' : flickering ? 'Lights flickering…' : cuePhase === 'waiting'
      ? 'Second box visible. Lights will flicker shortly.' : lightsOut
      ? (fading ? 'Dimming the hallway…' : `Lights out · ${percent}% brightness.`)
      : (fading ? 'Restoring hallway lights…' : reason ?? 'Lights on.');
  };
  button.addEventListener('click', () => { lighting.toggle(); refresh(); });
  slider.addEventListener('input', () => {
    const value = Number(slider.value) / 100;
    if (lighting.setLightsOutBrightness(value)) {
      try { localStorage.setItem(LIGHTING_BRIGHTNESS_STORAGE_KEY, String(value)); }
      catch { /* preview remains available without persistence */ }
    }
    previous = ''; refresh();
  });
  refresh();
  return { refresh };
}
