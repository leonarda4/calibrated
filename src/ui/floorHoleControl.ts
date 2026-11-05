import type { FloorHole } from '../viewer/floorHole';

export function bindFloorHoleControl(hole: FloorHole, blockReason: () => string | null) {
  const host = document.getElementById('experience-floor-hole-control');
  if (!host) throw new Error('Floor opening control container is missing.');
  host.innerHTML = `<button id="experience-floor-hole" type="button" style="width:100%">Open floor hole</button>
    <p id="experience-floor-hole-status" aria-live="polite"></p>
    <p id="experience-hole-transition-status" aria-live="polite">Step above the open hole to turn the hallway.</p>`;
  const button = host.querySelector<HTMLButtonElement>('button')!;
  const status = host.querySelector('p')!;
  let previous = '';
  const refresh = () => {
    const state = hole.snapshot(), reason = blockReason();
    const key = JSON.stringify([state, reason]);
    if (key === previous) return;
    previous = key;
    button.textContent = state.open ? 'Close floor hole' : 'Open floor hole';
    button.disabled = state.phase !== 'ready' || (!state.open && reason !== null);
    button.setAttribute('aria-pressed', String(state.open));
    button.title = state.open ? 'Restore the floor' : reason ?? 'Open the hole behind the wall’s final position';
    status.textContent = state.status;
  };
  button.addEventListener('click', () => { hole.toggle(); refresh(); });
  refresh();
  const transitionStatus = host.querySelector('#experience-hole-transition-status')!;
  return { refresh, setTransitionStatus(phase: string, remainingSeconds: number | null, turn?: {phase:string; angleDegrees:number}, ending?:{phase:string}) {
    transitionStatus.textContent = ending?.phase === 'white' ? 'The environment is gone. Reset baseline to begin again.'
      : ending?.phase === 'glitching' ? 'The environment is glitching away.'
      : ending?.phase === 'relighting' ? 'Returned to the damaged hallway. The lights are coming back.'
      : ending?.phase === 'holding' ? 'Returned to the damaged hallway. The ending continues.'
      : turn?.phase === 'turning' ? `Hallway turning: ${turn.angleDegrees.toFixed(0)}° / 90°.`
      : turn?.phase === 'complete' ? 'Hallway horizontal. Walk back through the vertical opening to return.'
      : turn?.phase === 'returning' ? `Returning hallway: ${turn.angleDegrees.toFixed(0)}° / 90°.`
      : turn?.phase === 'original' && phase !== 'anticipating' ? 'Original hallway restored. Leave the hole, then step above it to turn again.'
      : turn?.phase === 'cancelled' ? 'Hallway turn cancelled. Reset and start a fresh game.'
      : phase === 'anticipating' ? `Hallway turn in ${(remainingSeconds ?? 0).toFixed(1)} seconds.`
      : phase === 'triggered' ? 'Hallway turn reached.'
      : phase === 'cancelled' ? 'Hole cue cancelled. Start a fresh game to rearm.'
      : 'Step above the open hole to turn the hallway.';
  } };
}
