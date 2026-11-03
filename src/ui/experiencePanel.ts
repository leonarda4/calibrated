import type { Installation, InstallationConfig } from '../experience/installation.ts';

export interface ExperiencePanelOptions {
  isPresenting(): boolean;
  isScanReady?(): boolean;
  isPlacementPending?(): boolean;
  onReset?(): void;
  onShowBox(): void;
  onRotate(): void;
  /** Choose opposite floor edges at the hallway's longitudinal midpoint. */
  onPickCenter?(): void;
  /** Coordinator also cancels any calibration timer/capture in progress. */
  onStop?(): void;
}

/** Manual PC controls. The coordinator owns XR-fit and centering guards. */
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
    #experience-panel .experience-row { display:flex; flex-wrap:wrap; gap:6px; margin:9px 0; }
    #experience-panel button { cursor:pointer; border:1px solid #61717e; border-radius:4px;
      background:#293a47; color:#f1f6fa; padding:7px 9px; font:inherit; }
    #experience-panel button:disabled { opacity:.4; cursor:default; }
    #experience-panel #experience-show-box, #experience-panel #experience-rotate { flex:1; font-weight:600; }
    #experience-panel #experience-stop { background:#9a3037; border-color:#db6370; font-weight:bold; }
    #experience-panel input[type=number] { width:65px; background:#13232d; color:#f0f5f9;
      padding:3px; border:1px solid #506574; border-radius:3px; }
    #experience-panel label { display:flex; gap:6px; align-items:center; margin:5px 0; }
    #experience-panel .experience-fields label { justify-content:space-between; }
    #experience-panel summary { cursor:pointer; color:#e6cb86; margin:8px 0; }
    #experience-panel #experience-phase { color:#f5d58c; font-weight:600; }
    #experience-panel #experience-error { color:#ffaab2; }
    #experience-panel .experience-status { border-left:2px solid #8cabbc; padding-left:8px; }
  `;
  document.head.appendChild(style);
  const panel = document.createElement('section');
  panel.id = 'experience-panel';
  panel.setAttribute('aria-label', 'Hallway operator controls');
  panel.innerHTML = `
    <h2>Hallway controls</h2>
    <div id="experience-phase">Ready</div>
    <p id="experience-status" class="experience-status" aria-live="polite"></p>
    <div class="experience-row">
      <button id="experience-show-box" type="button">Show box</button>
      <button id="experience-rotate" type="button">Rotate hallway 180°</button>
    </div>
    <p id="experience-centering-status">Show the box first, then rotate the hallway when ready.</p>
    <div class="experience-row">
      <button id="experience-stop" type="button">STOP</button>
      <button id="experience-reset" type="button">Reset baseline</button>
    </div>
    <details id="experience-placement">
      <summary id="experience-placement-label">Box placement · metres</summary>
      <p>Review the box position and dimensions below. You can also pick opposite floor edges at the hallway's longitudinal midpoint.</p>
      <p id="experience-placement-source"></p>
      <p>Fields use current XR world coordinates in metres.</p>
      <button id="experience-pick-center" type="button">Pick two floor edges</button>
      <p id="experience-clearance"></p>
      <div class="experience-fields"></div>
      <button id="experience-apply" type="button">Apply placement</button>
      <p id="experience-hand-status"></p>
      <p id="experience-audio-status"></p>
    </details>
    <p id="experience-error" role="alert"></p>
  `;
  document.body.appendChild(panel);

  const find = <T extends HTMLElement>(id: string): T => panel.querySelector<T>(`#${id}`)!;
  const status = find('experience-status');
  const phase = find('experience-phase');
  const error = find('experience-error');
  const showBox = find<HTMLButtonElement>('experience-show-box');
  const rotate = find<HTMLButtonElement>('experience-rotate');
  const apply = find<HTMLButtonElement>('experience-apply');
  const pickCenter = find<HTMLButtonElement>('experience-pick-center');
  let configDirty = false;
  let refresh = (): void => {};
  const fields = new Map<keyof InstallationConfig, HTMLInputElement>();
  const labels: [keyof InstallationConfig, string, string][] = [
    ['centerX', 'Box centre X', '0.05'], ['centerZ', 'Box centre Z', '0.05'], ['floorY', 'Floor Y (local-floor)', '0.01'],
    ['hallwayWidth', 'Hallway width', '0.01'],
    ['boxWidth', 'Box width', '0.01'], ['boxDepth', 'Box depth', '0.01'], ['boxHeight', 'Box height', '0.01'],
    ['rotationSeconds', 'Turn seconds', '0.5'],
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
    if (key === 'floorY') {
      input.readOnly = true;
      input.title = 'The calibrated local-floor plane is y=0. Showing the box uses that floor.';
    }
    input.addEventListener('input', () => {
      configDirty = true;
      refresh();
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
  click('experience-show-box', () => {
    if (options.isScanReady?.() === false) { error.textContent = 'Wait for the hallway scan to finish loading.'; return; }
    options.onShowBox();
  });
  click('experience-rotate', () => options.onRotate());
  click('experience-stop', () => {
    if (options.onStop) options.onStop();
    else installation.invalidate('Operator stop. Stay still; recalibrate before continuing.');
  });
  click('experience-reset', () => options.onReset ? options.onReset() : installation.reset());

  const renderPanel = (snapshot: ReturnType<Installation['snapshot']>): void => {
    const presenting = options.isPresenting();
    const scanReady = options.isScanReady?.() !== false;
    const placementPending = options.isPlacementPending?.() === true;
    const phaseName: string = snapshot.phase;
    const turning = phaseName === 'rotating';
    const mayShow = ['idle', 'ready', 'box'].includes(phaseName) && snapshot.yaw === 0;
    const editable = !turning && !['exploring', 'badge', 'reversed'].includes(phaseName) && snapshot.yaw === 0;
    phase.textContent = phaseName === 'box' ? 'BOX VISIBLE' : phaseName.toUpperCase();
    if (turning) phase.textContent += ` · ${(snapshot.yaw * 180 / Math.PI).toFixed(0)}°`;
    status.textContent = snapshot.status;
    showBox.disabled = !scanReady || configDirty || !mayShow || placementPending;
    showBox.title = scanReady ? 'Show the box using the current hallway placement' : 'Wait for the hallway scan to finish loading';
    rotate.disabled = !scanReady || configDirty || phaseName !== 'box' || placementPending;
    rotate.title = phaseName === 'box' ? 'Turn only the visual hallway; keep the real box fixed' : 'Show the box before rotating the hallway';
    find('experience-placement-label').textContent = configDirty ? 'Unsaved placement · apply changes' : 'Box placement · metres';
    find('experience-clearance').textContent = `Side clearance if centred: ${((snapshot.config.hallwayWidth - snapshot.config.boxWidth) / 2).toFixed(2)} m each.`;
    find('experience-placement-source').textContent = snapshot.placementSource === 'unplaced'
      ? 'No box location is set. Show box to centre it, apply the fields below, or pick two floor edges.'
      : snapshot.placementSource === 'default-ply'
        ? snapshot.defaultPlyBase
          ? `Box bottom centre from PLY: [${snapshot.defaultPlyBase.join(', ')}]. Height extends upward from this floor point.`
          : `Box mesh centre from PLY: [${snapshot.defaultPlyCenter?.join(', ')}].`
        : snapshot.placementSource === 'picked-scan' ? 'Box base from picked scan floor edges.' : 'Manual XR-world placement.';
    apply.disabled = !editable;
    pickCenter.disabled = !options.onPickCenter || presenting || !editable || configDirty;
    for (const input of fields.values()) input.disabled = !editable;
    if (!configDirty) for (const [key, input] of fields) input.value = String(snapshot.config[key]);
  };
  refresh = () => renderPanel(installation.snapshot());
  const unsubscribe = installation.subscribe(renderPanel);

  return {
    setPlacementStatus(text: string) { find('experience-centering-status').textContent = text; },
    setHandStatus(text: string) { find('experience-hand-status').textContent = text; },
    setAudioStatus(text: string) { find('experience-audio-status').textContent = text; },
    dispose() { unsubscribe(); events.abort(); panel.remove(); style.remove(); },
  };
}
