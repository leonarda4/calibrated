import type { WebGLRenderer } from 'three';
import { normalizeBoundary, transformBoundary, type Point3 } from '../boundary/geometry.ts';

export type BoundaryStatus = 'waiting' | 'requesting' | 'live' | 'unavailable' | 'paused' | 'snapshot';

export interface RuntimeBoundarySnapshot {
  status: BoundaryStatus;
  message: string;
  points: readonly Point3[];
  head: Point3 | null;
  live: boolean;
}

export interface MovementBoundaryOptions {
  onChange?(snapshot: RuntimeBoundarySnapshot): void;
}

const copyPoint = (point: Point3): Point3 => [point[0], point[1], point[2]];
const samePoints = (a: readonly Point3[], b: readonly Point3[]): boolean =>
  a.length === b.length && a.every((point, i) => point.every((value, j) => Math.abs(value - b[i][j]) < 1e-5));

/** Read-only diagnostic: never changes the renderer's active reference space or the rig. */
export function setupMovementBoundary(renderer: Pick<WebGLRenderer, 'xr'>, options: MovementBoundaryOptions = {}) {
  let state: RuntimeBoundarySnapshot = {
    status: 'waiting', message: 'Enter VR to read the runtime movement boundary.', points: [], head: null, live: false,
  };
  let session: XRSession | null = null;
  let bounded: XRBoundedReferenceSpace | null = null;
  let activeReference: XRReferenceSpace | null = null;
  let lastGood: readonly Point3[] | null = null;
  let requestFailure: string | null = null;
  let generation = 0;
  let disposed = false;

  const snapshot = (): RuntimeBoundarySnapshot => ({
    ...state, points: state.points.map(copyPoint), head: state.head ? copyPoint(state.head) : null,
  });
  const publish = (next: RuntimeBoundarySnapshot): void => {
    // Head position is returned fresh from update(), without firing a DOM/UI
    // notification for every millimetre of head motion.
    const changed = next.status !== state.status || next.message !== state.message ||
      next.live !== state.live || !samePoints(next.points, state.points);
    state = next;
    if (changed) options.onChange?.(snapshot());
  };
  const clear = (status: BoundaryStatus, message: string): void => {
    lastGood = null;
    publish({ status, message, points: [], head: null, live: false });
  };
  const onReset = (): void => clear('paused', 'Reference space or runtime boundary changed. Waiting for fresh tracking.');
  const onVisibility = (): void => {
    if (session?.visibilityState !== 'visible') clear('paused', 'Runtime boundary paused while the headset view is interrupted.');
  };
  const detach = (): void => {
    bounded?.removeEventListener('reset', onReset);
    activeReference?.removeEventListener('reset', onReset);
    session?.removeEventListener('visibilitychange', onVisibility);
    bounded = null;
    activeReference = null;
    session = null;
  };
  const startSession = (): void => {
    generation++;
    const requestGeneration = generation;
    detach();
    lastGood = null;
    requestFailure = null;
    session = renderer.xr.getSession();
    if (!session || !renderer.xr.isPresenting) {
      clear('waiting', 'Enter VR to read the runtime movement boundary.');
      return;
    }
    const requestedSession = session;
    session.addEventListener('visibilitychange', onVisibility);
    clear('requesting', 'Requesting the runtime movement boundary.');
    let request: Promise<XRReferenceSpace>;
    try { request = session.requestReferenceSpace('bounded-floor'); }
    catch {
      requestFailure = 'Movement boundary is unavailable from this runtime.';
      clear('unavailable', requestFailure);
      return;
    }
    void request.then(reference => {
      if (disposed || requestGeneration !== generation || session !== requestedSession ||
          renderer.xr.getSession() !== requestedSession || !renderer.xr.isPresenting) return;
      if (!('boundsGeometry' in reference)) {
        requestFailure = 'The runtime did not supply movement boundary geometry.';
        clear('unavailable', requestFailure);
        return;
      }
      bounded = reference as XRBoundedReferenceSpace;
      bounded.addEventListener('reset', onReset);
      clear('requesting', 'Waiting for a tracked frame to locate the runtime boundary.');
    }).catch(() => {
      if (disposed || requestGeneration !== generation || session !== requestedSession) return;
      requestFailure = 'Movement boundary is unavailable from this runtime.';
      clear('unavailable', requestFailure);
    });
  };
  const endSession = (): void => {
    generation++;
    const previous = lastGood?.map(copyPoint) ?? null;
    detach();
    lastGood = null;
    requestFailure = null;
    if (previous) publish({ status: 'snapshot', message: 'Last-session boundary snapshot. Not live; enter VR for current bounds.', points: previous, head: null, live: false });
    else clear('waiting', 'Enter VR to read the runtime movement boundary.');
  };
  renderer.xr.addEventListener('sessionstart', startSession);
  renderer.xr.addEventListener('sessionend', endSession);
  if (renderer.xr.isPresenting) startSession();

  return {
    snapshot,
    update(frame?: XRFrame): RuntimeBoundarySnapshot {
      if (disposed) return snapshot();
      if (!renderer.xr.isPresenting || !renderer.xr.getSession()) {
        if (session) endSession();
        return snapshot();
      }
      if (renderer.xr.getSession() !== session) startSession();
      if (session?.visibilityState !== 'visible') {
        onVisibility();
        return snapshot();
      }
      const reference = renderer.xr.getReferenceSpace();
      if (reference !== activeReference) {
        activeReference?.removeEventListener('reset', onReset);
        if (activeReference) onReset();
        activeReference = reference;
        activeReference?.addEventListener('reset', onReset);
      }
      if (!bounded) {
        clear(requestFailure ? 'unavailable' : 'requesting', requestFailure ?? 'Requesting the runtime movement boundary.');
        return snapshot();
      }
      if (!frame || !activeReference) {
        clear('paused', 'No current tracking frame for the runtime boundary.');
        return snapshot();
      }
      try {
        const viewer = frame.getViewerPose(activeReference);
        const position = viewer?.transform.position;
        if (!viewer || viewer.emulatedPosition || !position || ![position.x, position.y, position.z].every(Number.isFinite)) {
          clear('paused', 'Viewer tracking is unavailable; runtime boundary is paused.');
          return snapshot();
        }
        const pose = frame.getPose(bounded, activeReference);
        if (!pose || pose.emulatedPosition) {
          clear('paused', 'The runtime boundary cannot be located in the current tracking space.');
          return snapshot();
        }
        const rawPoints: Point3[] = [];
        for (const point of bounded.boundsGeometry) {
          if (![point.x, point.y, point.z, point.w].every(Number.isFinite) || Math.abs(point.w - 1) > 1e-5 || Math.abs(point.y) > 1e-5) {
            clear('unavailable', 'The runtime supplied invalid movement boundary geometry.');
            return snapshot();
          }
          rawPoints.push([point.x, point.y, point.z]);
        }
        const points = normalizeBoundary(rawPoints);
        if (!points) {
          clear('unavailable', 'The runtime movement boundary is empty or unavailable.');
          return snapshot();
        }
        const transformed = transformBoundary(points, pose.transform.matrix);
        if (!transformed) {
          clear('unavailable', 'The runtime boundary transform is invalid.');
          return snapshot();
        }
        lastGood = transformed;
        publish({ status: 'live', message: 'Live runtime-reported movement boundary.', points: transformed,
          head: [position.x, position.y, position.z], live: true });
      } catch {
        clear('paused', 'Runtime boundary tracking is temporarily unavailable.');
      }
      return snapshot();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      detach(); lastGood = null;
      renderer.xr.removeEventListener('sessionstart', startSession);
      renderer.xr.removeEventListener('sessionend', endSession);
      clear('waiting', 'Movement boundary display closed.');
    },
  };
}
