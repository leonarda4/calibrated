export function bindVoicePanel(callbacks: {
  onUnlock: () => void;
  onMute: (muted: boolean) => void;
  onPreview?: () => void;
}) {
  const panel = document.createElement('details');
  panel.id = 'voice-panel';
  panel.open = false;
  Object.assign(panel.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: '40', width: 'min(320px, calc(100vw - 24px))',
    boxSizing: 'border-box', padding: '10px 12px', color: '#dbe3ec', background: 'rgba(13,18,24,.94)',
    border: '1px solid #526274', borderRadius: '8px', font: '12px/1.4 monospace',
  });
  panel.innerHTML = '<summary style="cursor:pointer">VOICES / LOCAL AUDIO</summary>' +
    '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
    '<button type="button" data-action="unlock">ENABLE VOICES</button>' +
    '<button type="button" data-action="preview">PREVIEW VOICE</button>' +
    '<label><input type="checkbox" data-action="mute">Mute</label></div>' +
    '<p data-role="status" aria-live="polite">Enable voices after generating local clips.</p>' +
    '<p data-role="caption"></p>';
  document.body.appendChild(panel);
  const unlock = panel.querySelector<HTMLButtonElement>('[data-action="unlock"]')!;
  const preview = panel.querySelector<HTMLButtonElement>('[data-action="preview"]')!;
  const mute = panel.querySelector<HTMLInputElement>('[data-action="mute"]')!;
  const status = panel.querySelector<HTMLParagraphElement>('[data-role="status"]')!;
  const caption = panel.querySelector<HTMLParagraphElement>('[data-role="caption"]')!;
  unlock.onclick = callbacks.onUnlock;
  mute.onchange = () => callbacks.onMute(mute.checked);
  preview.onclick = callbacks.onPreview ?? null;
  preview.disabled = !callbacks.onPreview;
  return {
    setStatus(text: string) { status.textContent = text; },
    setCaption(text: string) { caption.textContent = text; },
    dispose() { panel.remove(); },
  };
}
