import { Matrix4, Vector3 } from 'three';
import { HoleWorldRotation, type HoleTurnGeometry } from './holeWorldRotation.ts';
import { DEFAULT_INSTALLATION_CONFIG, type Position3 } from './flow.ts';
import { isHeadsetInBox } from './boxTrigger.ts';

export const BROOM_ENCOUNTER = Object.freeze({ depth: 4, revealDelay: 2, exitDelay: 2, glitchSeconds: .55,
  width: 2, depthSize: 2,
  height: DEFAULT_INSTALLATION_CONFIG.boxHeight });
type Phase = 'idle' | 'waitingReveal' | 'glitchingIn' | 'visible' | 'waitingExit' | 'glitchingOut' | 'complete' | 'cancelled';

/** Canonical pose follows the added corridor; final pose supplies its upright trigger. */
export function broomCutoutPlacement(hole: HoleTurnGeometry, finalPresentation: Matrix4) {
  const turn = new HoleWorldRotation();
  if (!turn.start(hole)) throw new Error('The broom needs a captured metric opening.');
  for (let step = 0; step < 8; step++) turn.update(.5, true);
  const expected = turn.matrix();
  if (!finalPresentation.elements.every((value, index) => Number.isFinite(value) && Math.abs(value - expected.elements[index]) < 1e-7)) {
    throw new Error('The broom requires the completed upright hallway turn.');
  }
  const route = new Matrix4().fromArray(hole.routeToWorld), end = hole.floorSide === 'end';
  const bounds = end ? hole.farBounds! : hole.nearBounds!, z = end ? hole.endZ : hole.startZ;
  const mouth = new Vector3((bounds[0] + bounds[1]) / 2, hole.floorY, z).applyMatrix4(route);
  const base = new Vector3((bounds[0] + bounds[1]) / 2, hole.floorY - BROOM_ENCOUNTER.depth, z)
    .applyMatrix4(route).applyMatrix4(finalPresentation);
  const forward = new Vector3(0, -1, 0).transformDirection(finalPresentation.clone().multiply(route));
  const up = new Vector3(0, 1, 0), right = new Vector3().crossVectors(up, forward).normalize();
  const upright = new Matrix4().makeBasis(right, up, forward).setPosition(base);
  return { canonical: finalPresentation.clone().invert().multiply(upright), upright,
    entranceWorld: mouth.applyMatrix4(finalPresentation).toArray() };
}

/** One encounter per game; no renderer, timers, input fallback or audio ownership. */
export class BroomEncounter {
  private phase: Phase = 'idle';
  private elapsed = 0;
  private pose: ReturnType<typeof broomCutoutPlacement> | null = null;

  arm(hole: HoleTurnGeometry, finalPresentation: Matrix4): boolean {
    if (this.phase !== 'idle') return false;
    try { this.pose = broomCutoutPlacement(hole, finalPresentation); }
    catch { this.cancel(); return false; }
    this.phase = 'waitingReveal'; this.elapsed = 0;
    return true;
  }
  reset(): void { this.phase = 'idle'; this.elapsed = 0; this.pose = null; }
  cancel(): void { this.phase = 'cancelled'; this.elapsed = 0; }

  update(seconds: number, eligible: boolean, position: Position3 | null, upright: boolean): void {
    if (['idle', 'complete', 'cancelled'].includes(this.phase)) return;
    if (!eligible || !Number.isFinite(seconds) || seconds < 0 || seconds > .5 ||
      !position || position.length !== 3 || !position.every(Number.isFinite)) { this.cancel(); return; }
    if (seconds === 0) return;
    if (this.phase === 'visible') {
      const local = new Vector3(...position).applyMatrix4(this.pose!.upright.clone().invert()).toArray();
      if (upright && isHeadsetInBox(local, { ...DEFAULT_INSTALLATION_CONFIG, centerX: 0, centerZ: 0, floorY: 0,
        boxWidth: BROOM_ENCOUNTER.width, boxDepth: BROOM_ENCOUNTER.depthSize, boxHeight: BROOM_ENCOUNTER.height }, 0)) {
        this.phase = 'waitingExit'; this.elapsed = 0;
      }
      return;
    }
    this.elapsed += seconds;
    const duration = this.phase === 'waitingReveal' ? BROOM_ENCOUNTER.revealDelay
      : this.phase === 'waitingExit' ? BROOM_ENCOUNTER.exitDelay : BROOM_ENCOUNTER.glitchSeconds;
    if (this.elapsed + 1e-9 < duration) return;
    this.phase = this.phase === 'waitingReveal' ? 'glitchingIn' : this.phase === 'glitchingIn' ? 'visible'
      : this.phase === 'waitingExit' ? 'glitchingOut' : 'complete';
    this.elapsed = 0;
  }

  snapshot() {
    const visible = ['glitchingIn', 'visible', 'waitingExit', 'glitchingOut'].includes(this.phase);
    const progress = Math.min(1, this.elapsed / BROOM_ENCOUNTER.glitchSeconds);
    const status: Record<Phase, string> = {
      idle: 'Broom waits for the first turn into the added hallway.',
      waitingReveal: 'Broom will appear two seconds after the hallway turn.',
      glitchingIn: 'Broom appearing inside the added hallway.',
      visible: 'Broom four metres inside the added hallway. Approach it to continue.',
      waitingExit: 'Broom will disappear two seconds after your approach.',
      glitchingOut: 'Broom disappearing.', complete: 'Broom encounter complete.',
      cancelled: 'Broom encounter cancelled. Start a fresh game to repeat it.',
    };
    return { phase: this.phase, visible, status: status[this.phase], elapsedSeconds: this.elapsed,
      glitch: this.phase === 'glitchingIn' ? 1 - progress : this.phase === 'glitchingOut' ? progress : 0,
      canonicalMatrix: this.pose?.canonical.toArray() ?? null, uprightMatrix: this.pose?.upright.toArray() ?? null,
      entranceWorld: this.pose ? [...this.pose.entranceWorld] : null,
      triggerSize: [BROOM_ENCOUNTER.width, BROOM_ENCOUNTER.height, BROOM_ENCOUNTER.depthSize] };
  }
}
