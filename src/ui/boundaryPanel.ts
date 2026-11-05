import type { ManualRectangleConfig, Point3 } from '../boundary/geometry.ts';
import type { RuntimeBoundarySnapshot } from '../xr/movementBoundary.ts';

export interface BoundaryBoxMarker { centerX: number; centerZ: number; boxWidth: number; boxDepth: number; floorY: number; }

export function bindBoundaryPanel(initial: ManualRectangleConfig, callbacks: {
  onApply(config: ManualRectangleConfig): void;
  onManualVisibility(visible: boolean): void;
  onRuntimeVisibility(visible: boolean): void;
}) {
  const events = new AbortController();
  const panel = document.createElement('details');
  panel.id = 'movement-boundary-panel';
  panel.open = true;
  Object.assign(panel.style, {
    position: 'fixed', left: '12px', top: '48px', width: '260px', zIndex: '13',
    maxHeight: 'calc(100vh - 225px)', overflow: 'auto', boxSizing: 'border-box',
    padding: '10px', border: '1px solid #526270', borderRadius: '8px',
    background: 'rgba(14,19,25,.94)', color: '#e5edf2', font: '12px/1.4 system-ui,sans-serif',
  });
  panel.innerHTML = `
    <summary style="cursor:pointer;font-weight:600">Movement boundaries</summary>
    <p id="movement-boundary-status" aria-live="polite"></p>
    <p id="movement-boundary-voice-status" aria-live="polite">Boundary voice: waiting for live headset outline.</p>
    <canvas id="movement-boundary-map" width="480" height="320" aria-label="Top view of headset boundary and manual movement area" style="width:100%;height:160px;border:1px solid #344453;border-radius:4px"></canvas>
    <p style="margin:5px 0"><span style="color:#63dce9">Cyan: headset</span> · <span style="color:#ffc46c">Amber: manual</span><br>White dot: head · grey square: box</p>
    <label style="display:block"><input id="movement-runtime-visible" type="checkbox" checked> Show headset outline</label>
    <label style="display:block"><input id="movement-manual-visible" type="checkbox"> Show manual area</label>
    <details style="margin-top:6px"><summary style="cursor:pointer">Manual dimensions · metres</summary>
      <p>Draft work area in XR coordinates. Set its measured location and size; recheck after a new session or recenter. This changes the outline only.</p>
      <div id="movement-manual-fields"></div>
      <button id="movement-manual-apply" type="button">Apply manual area</button>
    </details>
    <p style="color:#9daebb;margin-bottom:0">Map is an operator reference. Voice uses live headset bounds only. System boundaries stay enabled.</p>
    <p id="movement-boundary-error" role="alert" style="color:#ffaab2;margin-bottom:0"></p>`;
  document.body.appendChild(panel);
  const find = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
  const fields = new Map<keyof ManualRectangleConfig, HTMLInputElement>();
  for (const [key, label] of [
    ['centerX', 'Centre X'], ['centerZ', 'Centre Z'], ['floorY', 'Floor Y'],
    ['width', 'Width'], ['depth', 'Depth'], ['yawDegrees', 'Rotation · degrees'],
  ] as const) {
    const row = document.createElement('label');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0' });
    row.textContent = label;
    const input = document.createElement('input');
    input.id = `movement-manual-${key}`;
    input.type = 'number'; input.step = key === 'yawDegrees' ? '1' : '0.05'; input.value = String(initial[key]);
    Object.assign(input.style, { width: '70px', background: '#13232d', color: '#f0f5f9', border: '1px solid #506574', borderRadius: '3px', padding: '3px' });
    fields.set(key, input); row.appendChild(input); find('movement-manual-fields').appendChild(row);
  }
  const error = find('movement-boundary-error');
  Object.assign(find('movement-manual-apply').style, { cursor: 'pointer', padding: '6px 8px', background: '#293a47', color: '#f1f6fa', border: '1px solid #61717e', borderRadius: '4px', font: 'inherit' });
  find('movement-manual-apply').addEventListener('click', () => {
    error.textContent = '';
    try {
      const config = { ...initial };
      for (const [key, field] of fields) config[key] = field.value === '' ? NaN : Number(field.value);
      callbacks.onApply(config);
    } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); }
  }, { signal: events.signal });
  const manualVisible = find<HTMLInputElement>('movement-manual-visible');
  const runtimeVisible = find<HTMLInputElement>('movement-runtime-visible');
  manualVisible.addEventListener('change', () => callbacks.onManualVisibility(manualVisible.checked), { signal: events.signal });
  runtimeVisible.addEventListener('change', () => callbacks.onRuntimeVisibility(runtimeVisible.checked), { signal: events.signal });
  const canvas = find<HTMLCanvasElement>('movement-boundary-map');
  const context = canvas.getContext('2d')!;
  return {
    setVoiceStatus(text: string) { find('movement-boundary-voice-status').textContent = text; },
    setManual(config: ManualRectangleConfig, visible: boolean) {
      manualVisible.checked = visible;
      for (const [key, input] of fields) input.value = String(config[key]);
    },
    setRuntimeVisible(visible: boolean) { runtimeVisible.checked = visible; },
    draw(runtime: RuntimeBoundarySnapshot, manual: readonly Point3[], showRuntime: boolean, box?: BoundaryBoxMarker, liveHead: Point3 | null = runtime.head) {
      find('movement-boundary-status').textContent = runtime.message;
      context.fillStyle = '#101824'; context.fillRect(0, 0, 480, 320);
      const runtimePoints = showRuntime ? runtime.points : [];
      const all: Point3[] = [...runtimePoints, ...manual];
      if (liveHead) all.push(liveHead);
      if (box) all.push([box.centerX - box.boxWidth / 2, box.floorY, box.centerZ - box.boxDepth / 2],
        [box.centerX + box.boxWidth / 2, box.floorY, box.centerZ + box.boxDepth / 2]);
      if (!runtimePoints.length && !manual.length) {
        context.fillStyle = '#a6b8c7'; context.font = '20px sans-serif'; context.textAlign = 'center';
        context.fillText('No boundary displayed', 240, 145);
        context.font = '16px sans-serif'; context.fillText('Connect VR or enable a manual area', 240, 180);
        return;
      }
      const minX = Math.min(...all.map(p => p[0])), maxX = Math.max(...all.map(p => p[0]));
      const minZ = Math.min(...all.map(p => p[2])), maxZ = Math.max(...all.map(p => p[2]));
      const scale = Math.min(420 / Math.max(maxX - minX, 0.5), 250 / Math.max(maxZ - minZ, 0.5));
      const project = (p: Point3) => [240 + (p[0] - (minX + maxX) / 2) * scale, 150 + (p[2] - (minZ + maxZ) / 2) * scale];
      const polygon = (points: readonly Point3[], color: string, dashed: boolean) => {
        if (!points.length) return;
        context.beginPath();
        points.forEach((point, i) => { const [x, y] = project(point); if (i === 0) context.moveTo(x, y); else context.lineTo(x, y); });
        context.closePath(); context.setLineDash(dashed ? [10, 6] : []); context.strokeStyle = color; context.lineWidth = 4; context.stroke(); context.setLineDash([]);
      };
      polygon(runtimePoints, '#63dce9', !runtime.live);
      polygon(manual, '#ffc46c', true);
      if (box) {
        const [x, y] = project([box.centerX, box.floorY, box.centerZ]);
        context.strokeStyle = '#aab8c7'; context.lineWidth = 2;
        context.strokeRect(x - box.boxWidth * scale / 2, y - box.boxDepth * scale / 2, box.boxWidth * scale, box.boxDepth * scale);
      }
      if (liveHead) {
        const [x, y] = project(liveHead); context.beginPath(); context.arc(x, y, 6, 0, Math.PI * 2); context.fillStyle = '#ffffff'; context.fill();
      }
      context.fillStyle = '#a6b8c7'; context.textAlign = 'left'; context.font = '16px sans-serif';
      context.fillText(`View span · ${(maxX - minX).toFixed(2)} × ${(maxZ - minZ).toFixed(2)} m`, 15, 305);
    },
    dispose() { events.abort(); panel.remove(); },
  };
}
