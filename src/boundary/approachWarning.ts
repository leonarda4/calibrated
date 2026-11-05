import { normalizeBoundary, type Point3 } from './geometry.ts';

export const BOUNDARY_VOICE = Object.freeze({ triggerMetres: .5, rearmMetres: .75, cooldownSeconds: 8,
  movementMetres: .02, approachMetres: .01, maxFrameSeconds: .5, maxSpeedMetresPerSecond: 3,
  endNormalMinDot: Math.SQRT1_2 });

function horizontalDirection(direction: Point3 | null | undefined): Point3 | null {
  if (!direction || direction.length !== 3 || !direction.every(Number.isFinite)) return null;
  const length = Math.hypot(direction[0], direction[2]);
  return length > 1e-8 ? [direction[0] / length, 0, direction[2] / length] : null;
}

/** Signed finite-segment distance, positive inside the complete polygon.
 * With a hallway axis, measure only edges facing either longitudinal end.
 */
export function boundaryClearance(position: Point3, perimeter: readonly Point3[], hallwayForward?: Point3,
  end: 'both' | 'forward' = 'both'): number | null {
  if (!position.every(Number.isFinite) || position.length !== 3 || perimeter.length < 3) return null;
  const axis = horizontalDirection(hallwayForward);
  if ((hallwayForward !== undefined || end === 'forward') && !axis) return null;
  let inside = false, squared = Infinity, twiceArea = 0;
  const [x, , z] = position;
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i], b = perimeter[(i + 1) % perimeter.length];
    if (a.length !== 3 || b.length !== 3 || ![...a, ...b].every(Number.isFinite)) return null;
    twiceArea += (a[0] - perimeter[0][0]) * (b[2] - perimeter[0][2]) - (b[0] - perimeter[0][0]) * (a[2] - perimeter[0][2]);
  }
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i], b = perimeter[(i + 1) % perimeter.length];
    if (a.length !== 3 || b.length !== 3 || ![...a, ...b].every(Number.isFinite)) return null;
    const dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz;
    const t = length > 1e-14 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length)) : 0;
    const normalDot = axis && length > 1e-14 ? (dz * axis[0] - dx * axis[2]) * Math.sign(twiceArea) / Math.sqrt(length) : 0;
    if (!axis || (length > 1e-14 && (end === 'forward' ? normalDot : Math.abs(normalDot)) >= BOUNDARY_VOICE.endNormalMinDot - 1e-9)) {
      squared = Math.min(squared, (x - a[0] - t * dx) ** 2 + (z - a[2] - t * dz) ** 2);
    }
    if ((a[2] > z) !== (b[2] > z) && x < a[0] + dx * (z - a[2]) / dz) inside = !inside;
  }
  if (!Number.isFinite(squared) || Math.abs(twiceArea) <= 1e-6) return null;
  const distance = Math.sqrt(squared);
  return distance < 1e-8 ? 0 : inside ? distance : -distance;
}

type Sample = { position: Point3; distance: number };
type BoundaryFrame = { live: boolean; points: readonly Point3[]; head: Point3 | null; hallwayForward?: Point3 | null };

/** Physical-space observations only; no timers, rendering, audio or fallback boundary. */
export function createBoundaryApproachWarning(options: { onWarning(): boolean; onCancel?(): void }) {
  let perimeter: Point3[] | null = null;
  let forward: Point3 | null = null;
  let previous: Point3 | null = null, anchor: Sample | null = null;
  let lastTime: number | null = null, warnedAt = -Infinity;
  let latched = false, approaching = false, inWarningStrip = false, distance: number | null = null, warnings = 0;
  let status: 'unavailable' | 'unoriented' | 'paused' | 'outside' | 'tracking' | 'near' | 'warned' = 'unavailable';
  const clearMotion = () => {
    previous = null; anchor = null; approaching = false; inWarningStrip = false; distance = null; latched = false;
    options.onCancel?.();
  };
  const samePerimeter = (points: readonly Point3[]) => perimeter?.length === points.length &&
    points.every((p, i) => p.length === 3 && p.every((v, j) => Number.isFinite(v) && Math.abs(v - perimeter![i][j]) < 1e-5));
  return {
    reset() {
      clearMotion(); perimeter = null; forward = null; lastTime = null; warnedAt = -Infinity; warnings = 0; status = 'unavailable';
    },
    update(now: number, frame: BoundaryFrame, enabled: boolean) {
      const dt = lastTime === null ? 0 : now - lastTime;
      if (!Number.isFinite(now) || now < 0 || dt < 0) {
        clearMotion(); lastTime = null; status = 'paused'; return;
      }
      lastTime = now;
      if (!enabled || !frame.live || !frame.head || frame.head.length !== 3 || !frame.head.every(Number.isFinite)) {
        clearMotion(); perimeter = null; forward = null; status = enabled ? 'unavailable' : 'paused'; return;
      }
      if (!samePerimeter(frame.points)) {
        clearMotion(); perimeter = normalizeBoundary(frame.points);
        if (!perimeter) { status = 'unavailable'; return; }
      }
      if (!perimeter) { status = 'unavailable'; return; }
      const nextForward = horizontalDirection(frame.hallwayForward);
      if (!nextForward) { clearMotion(); forward = null; status = 'unoriented'; return; }
      if (!forward || Math.abs(forward[0] * nextForward[0] + forward[2] * nextForward[2]) < 1 - 1e-10) clearMotion();
      forward = nextForward;
      const current = boundaryClearance(frame.head, perimeter, forward);
      if (current === null) { clearMotion(); status = 'unoriented'; return; }
      if (dt > BOUNDARY_VOICE.maxFrameSeconds || (previous && dt > 0 &&
        Math.hypot(frame.head[0] - previous[0], frame.head[2] - previous[2]) >
          BOUNDARY_VOICE.maxSpeedMetresPerSecond * dt + BOUNDARY_VOICE.movementMetres)) clearMotion();
      distance = current;
      const wasInStrip = inWarningStrip;
      inWarningStrip = current >= 0 && current <= BOUNDARY_VOICE.triggerMetres + 1e-9;
      if (wasInStrip && !inWarningStrip) options.onCancel?.();
      status = current < 0 ? 'outside' : inWarningStrip ? 'near' : 'tracking';
      if (current >= BOUNDARY_VOICE.rearmMetres - 1e-9) {
        if (latched) options.onCancel?.();
        latched = false;
      }
      const position: Point3 = [...frame.head];
      previous = position;
      if (!anchor) { anchor = { position, distance: current }; approaching = false; return; }
      if (dt === 0) { anchor = { position, distance: current }; approaching = false; return; }
      const travel = Math.hypot(position[0] - anchor.position[0], position[2] - anchor.position[2]);
      if (travel + 1e-9 < BOUNDARY_VOICE.movementMetres) return;
      const change = anchor.distance - current;
      approaching = change >= BOUNDARY_VOICE.approachMetres - 1e-9;
      // Accumulate a shallow outward approach instead of losing its small
      // normal component every time the wearer takes another tangential step.
      if (!approaching && change > -BOUNDARY_VOICE.approachMetres + 1e-9) return;
      anchor = { position, distance: current };
      if (approaching && !latched && inWarningStrip &&
        now - warnedAt >= BOUNDARY_VOICE.cooldownSeconds - 1e-9 && options.onWarning()) {
        latched = true; warnedAt = now; warnings++;
      }
      if (latched && inWarningStrip) status = 'warned';
    },
    snapshot: () => ({ status, distanceMetres: distance, approaching, latched, inWarningStrip, warnings,
      hallwayForward: forward ? [...forward] : null,
      triggerMetres: BOUNDARY_VOICE.triggerMetres, rearmMetres: BOUNDARY_VOICE.rearmMetres,
      cooldownSeconds: BOUNDARY_VOICE.cooldownSeconds }),
  };
}
