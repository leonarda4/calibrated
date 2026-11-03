import type { Installation, InstallationConfig } from '../experience/installation.ts';

export interface ExperiencePanelOptions {
  isPresenting(): boolean;
  onStartGesture?(): void;
  /** Choose opposite floor edges at the hallway's longitudinal midpoint. */
  onPickCenter?(): void;
  /** Coordinator also cancels any calibration timer/capture in progress. */
  onStop?(): void;
}

/** PC-only operator surface. Preview never supplies contact authority to XR. */
export function bindExperiencePanel(installation: Installation, options: ExperiencePanelOptions) {
  const events = new AbortController();
  const style = document.createElement('style');
  style.textContent = `
    #experience-panel { position:fixed; top:76px; right:12px; width:310px; z-index:12;
      max-height:calc(100vh - 235px); overflow:auto; box-sizing:border-box; padding:12px;
      background:rgba(14,19,25,.94); border:1px solid #526270; border-radius:8px;
      font:12px/1.45 system-ui,sans-serif; color:#e5edf2; }
    #experience-panel h2 { font-size:14px; margin:0 0 6px; }
    #experience-panel p { color:#bac7d2; margin:6px 0; }
    #experience-panel .experience-row { display:flex; flex-wrap:wrap; gap:6px; margin:7px 0; }
    #experience-panel button { cursor:pointer; border:1px solid #61717e; border-radius:4px;
      background:#293a47; color:#f1f6fa; padding:6px 8px; font:inherit; }
    #experience-panel button:disabled { opacity:.4; cursor:default; }
    #experience-panel #experience-stop { background:#9a3037; border-color:#db6370; font-weight:bold; }
    #experience-panel input[type=number] { width:65px; background:#13232d; color:#f0f5f9;
      padding:3px; border:1px solid #506574; border-radius:3px; }
    #experience-panel label { display:flex; gap:6px; align-items:center; margin:5px 0; }
    #experience-panel .experience-fields label { justify-content:space-between; }
    #experience-panel summary { cursor:pointer; color:#e6cb86; margin:8px 0; }
    #experience-panel #experience-phase { color:#f5d58c; font-weight:600; }
    #experience-panel #experience-error { color:#ffaab2; }
    #experience-panel .experience-caption { border-left:2px solid #8cabbc; padding-left:8px; }
  `;
  document.head.appendChild(style);
  const panel = document.createElement('section');
  panel.id = 'experience-panel';
  panel.setAttribute('aria-label', 'Installation operator controls');
  panel.innerHTML = `
    <h2>Purpose / education</h2>
    <div id="experience-phase">Awaiting calibration</div>
    <p id="experience-status" class="experience-caption" aria-live="polite"></p>
    <p id="experience-hand-status">Hands: capability not checked yet</p>
    <p id="experience-audio-status">Voices: local clips pending</p>
    <details id="experience-placement">
      <summary id="experience-placement-label">Draft placement · metres</summary>
      <p>Hallway width starts at a provisional 2.10 m. Pick opposite floor edges at the hallway's longitudinal midpoint, then check the real box. Approximate values do not establish alignment.</p>
      <button id="experience-pick-center" type="button">Pick two floor edges</button>
      <p id="experience-clearance"></p>
      <div class="experience-fields"></div>
      <button id="experience-apply" type="button">Apply placement</button>
    </details>
    <label><input id="experience-placement-check" type="checkbox"> Physical box, floor and midpoint checked</label>
    <div class="experience-row">
      <button id="experience-start" type="button">Start in headset</button>
      <button id="experience-preview" type="button">Desktop preview</button>
    </div>
    <label><input id="experience-stationary" type="checkbox"> Wearer supported and stationary on box</label>
    <div class="experience-row">
      <button id="experience-reveal" type="button">Reveal badge · preview</button>
      <button id="experience-collect" type="button">Touch orb · preview</button>
    </div>
    <div class="experience-row">
      <button id="experience-stop" type="button">STOP</button>
      <button id="experience-reset" type="button">Reset baseline · wearer still</button>
    </div>
    <p id="experience-error" role="alert"></p>
  `;
  document.body.appendChild(panel);

  const find = <T extends HTMLElement>(id: string): T => panel.querySelector<T>(`#${id}`)!;
  const status = find('experience-status');
  const phase = find('experience-phase');
  const error = find('experience-error');
  const start = find<HTMLButtonElement>('experience-start');
  const preview = find<HTMLButtonElement>('experience-preview');
  const reveal = find<HTMLButtonElement>('experience-reveal');
  const collect = find<HTMLButtonElement>('experience-collect');
  const stationary = find<HTMLInputElement>('experience-stationary');
  const checked = find<HTMLInputElement>('experience-placement-check');
  const apply = find<HTMLButtonElement>('experience-apply');
  const pickCenter = find<HTMLButtonElement>('experience-pick-center');
  let configDirty = false;
  const fields = new Map<keyof InstallationConfig, HTMLInputElement>();
  const labels: [keyof InstallationConfig, string, string][] = [
    ['centerX', 'Centreline X', '0.05'], ['centerZ', 'Centreline Z', '0.05'], ['floorY', 'Floor Y', '0.01'],
    ['hallwayWidth', 'Hallway width', '0.01'],
    ['boxWidth', 'Box width', '0.01'], ['boxDepth', 'Box depth', '0.01'], ['boxHeight', 'Box height', '0.01'],
    ['orbHeight', 'Orb height above floor', '0.05'], ['orbRadius', 'Orb radius', '0.01'],
    ['explorationSeconds', 'Explore seconds', '1'], ['rotationSeconds', 'Turn seconds', '0.5'],
  ];
  const initial = installation.snapshot().config;
  for (const [key, labelText, step] of labels) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.id = `experience-${key}`;
    input.type = 'number';
    input.step = step;
    input.value = String(initial[key]);
    input.addEventListener('input', () => {
      configDirty = true;
      installation.confirmPlacement(false);
    }, { signal: events.signal });
    fields.set(key, input);
    label.append(input);
    panel.querySelector('.experience-fields')!.appendChild(label);
  }

  const act = (callback: () => void): void => {
    error.textContent = '';
    try { callback(); } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); }
  };
  const click = (id: string, callback: () => void): void => {
    find(id).addEventListener('click', () => act(callback), { signal: events.signal });
  };
  click('experience-apply', () => {
    const config = { ...installation.snapshot().config };
    for (const [key, field] of fields) config[key] = field.value === '' ? Number.NaN : Number(field.value);
    configDirty = false;
    try { installation.configure(config); } catch (cause) { configDirty = true; throw cause; }
  });
  click('experience-pick-center', () => { if (!options.isPresenting()) options.onPickCenter?.(); });
  checked.addEventListener('change', () => installation.confirmPlacement(checked.checked), { signal: events.signal });
  stationary.addEventListener('change', () => installation.confirmStationary(stationary.checked), { signal: events.signal });
  click('experience-start', () => {
    if (!options.isPresenting()) return;
    options.onStartGesture?.();
    installation.start(false);
  });
  click('experience-preview', () => {
    if (options.isPresenting()) return;
    options.onStartGesture?.();
    installation.start(true);
  });
  click('experience-reveal', () => { if (!options.isPresenting()) installation.previewAdvance(); });
  click('experience-collect', () => { if (!options.isPresenting()) installation.simulateCollection(); });
  click('experience-stop', () => {
    if (options.onStop) options.onStop();
    else installation.invalidate('Operator stop. Stay still; recalibrate before continuing.');
  });
  click('experience-reset', () => installation.reset());

  const unsubscribe = installation.subscribe(snapshot => {
    const presenting = options.isPresenting();
    const active = ['exploring', 'badge', 'rotating'].includes(snapshot.phase);
    const mayStart = ['idle', 'ready'].includes(snapshot.phase);
    phase.textContent = `${snapshot.preview ? 'DESKTOP PREVIEW · ' : ''}${snapshot.phase.toUpperCase()}` +
      (snapshot.phase === 'rotating' ? ` · ${(snapshot.yaw * 180 / Math.PI).toFixed(0)}°` : '');
    status.textContent = snapshot.status;
    checked.checked = snapshot.placementConfirmed;
    checked.disabled = configDirty || active || snapshot.phase === 'reversed';
    stationary.checked = snapshot.stationaryConfirmed;
    stationary.disabled = snapshot.phase !== 'badge' && snapshot.phase !== 'rotating';
    find('experience-placement-label').textContent = configDirty ? 'Unsaved placement · apply changes' :
      snapshot.placementConfirmed ? 'Placement checked · metres' : 'Draft placement · metres';
    find('experience-clearance').textContent = `Side clearance if centred: ${((snapshot.config.hallwayWidth - snapshot.config.boxWidth) / 2).toFixed(2)} m each. Check against the real walls.`;
    start.disabled = configDirty || !presenting || !mayStart || !snapshot.calibrated || !snapshot.placementConfirmed;
    preview.disabled = configDirty || presenting || !mayStart;
    reveal.disabled = presenting || !snapshot.preview || snapshot.phase !== 'exploring';
    collect.disabled = presenting || !snapshot.preview || snapshot.phase !== 'badge' || !snapshot.stationaryConfirmed;
    const editable = !active && snapshot.phase !== 'reversed' && snapshot.yaw === 0;
    apply.disabled = !editable;
    pickCenter.disabled = !options.onPickCenter || presenting || !editable || configDirty;
    for (const input of fields.values()) input.disabled = !editable;
    if (!configDirty) for (const [key, input] of fields) input.value = String(snapshot.config[key]);
  });

  return {
    setHandStatus(text: string) { find('experience-hand-status').textContent = text; },
    setAudioStatus(text: string) { find('experience-audio-status').textContent = text; },
    dispose() { unsubscribe(); events.abort(); panel.remove(); style.remove(); },
  };
}
