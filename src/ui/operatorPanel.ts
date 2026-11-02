// src/ui: PC operator panel for the Link route — the calibration is driven
// from the flat page while the person in the headset only places the remotes.
// The EDIT A/B button is the ONLY way to enable landmark re-picking; the
// idle state ignores scan clicks entirely.

export interface OperatorPanel {
  setStatus(text: string): void;
  onCalibrateClick(handler: () => void): void;
  onEditClick(handler: () => void): void;
  /** Reflect the landmark-edit state on the button (highlight while active). */
  setEditActive(active: boolean): void;
}

export function bindOperatorPanel(): OperatorPanel {
  const statusEl = document.getElementById('calib-status') as HTMLElement | null;
  const startBtn = document.getElementById('calib-start') as HTMLButtonElement | null;
  const editBtn = document.getElementById('calib-edit') as HTMLButtonElement | null;
  return {
    setStatus(text: string) {
      if (statusEl) statusEl.innerHTML = text.replace(/\n/g, '<br/>');
    },
    onCalibrateClick(handler: () => void) {
      startBtn?.addEventListener('click', handler);
    },
    onEditClick(handler: () => void) {
      editBtn?.addEventListener('click', handler);
    },
    setEditActive(active: boolean) {
      editBtn?.classList.toggle('active', active);
    },
  };
}