// src/ui: PC operator panel for the Link route — the calibration is driven
// from the flat page while the person in the headset only places the remotes.

export interface OperatorPanel {
  setStatus(text: string): void;
  onCalibrateClick(handler: () => void): void;
}

export function bindOperatorPanel(): OperatorPanel {
  const statusEl = document.getElementById('calib-status') as HTMLElement | null;
  const btn = document.getElementById('calib-start') as HTMLButtonElement | null;
  return {
    setStatus(text: string) {
      if (statusEl) statusEl.innerHTML = text.replace(/\n/g, '<br/>');
    },
    onCalibrateClick(handler: () => void) {
      btn?.addEventListener('click', handler);
    },
  };
}