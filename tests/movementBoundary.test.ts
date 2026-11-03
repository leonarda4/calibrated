import test from 'node:test';
import assert from 'node:assert/strict';
import { manualRectangle, normalizeBoundary, transformBoundary, type Point3 } from '../src/boundary/geometry.ts';
import { setupMovementBoundary } from '../src/xr/movementBoundary.ts';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const POLYGON: Point3[] = [[-1, 0, -2], [1, 0, -2], [1, 0, 2], [-1, 0, 2]];

class Signals {
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, callback: () => void) {
    const handlers = this.listeners.get(type) ?? new Set();
    handlers.add(callback); this.listeners.set(type, handlers);
  }
  removeEventListener(type: string, callback: () => void) { this.listeners.get(type)?.delete(callback); }
  emit(type: string) { for (const callback of this.listeners.get(type) ?? []) callback(); }
}

class BoundaryReference extends Signals {
  boundsGeometry = POLYGON.map(([x, y, z]) => ({ x, y, z, w: 1 }));
}

async function settle() { await Promise.resolve(); await Promise.resolve(); }

function setup(request?: () => Promise<XRReferenceSpace>) {
  const bounded = new BoundaryReference();
  const active = new Signals();
  const requested: string[] = [];
  const session = Object.assign(new Signals(), {
    visibilityState: 'visible',
    requestReferenceSpace(type: string) {
      requested.push(type);
      return request ? request() : Promise.resolve(bounded as unknown as XRReferenceSpace);
    },
  });
  const xr = Object.assign(new Signals(), {
    isPresenting: false,
    session: null as typeof session | null,
    activeReference: active,
    getSession() { return this.session as unknown as XRSession | null; },
    getReferenceSpace() { return this.activeReference as unknown as XRReferenceSpace; },
  });
  const notifications: string[] = [];
  const boundary = setupMovementBoundary({ xr } as unknown as Parameters<typeof setupMovementBoundary>[0], {
    onChange(state) { notifications.push(state.status); },
  });
  const start = async () => {
    xr.session = session; xr.isPresenting = true; xr.emit('sessionstart');
    await settle();
  };
  const end = () => { xr.session = null; xr.isPresenting = false; xr.emit('sessionend'); };
  const frame = (options: { matrix?: number[]; viewer?: 'missing' | 'emulated'; relative?: 'missing' | 'emulated' | 'throw'; headX?: number } = {}) => ({
    getViewerPose(space: XRReferenceSpace) {
      assert.equal(space, xr.activeReference);
      return options.viewer === 'missing' ? null : {
        emulatedPosition: options.viewer === 'emulated',
        transform: { position: { x: options.headX ?? 2, y: 1.7, z: -3 } },
      };
    },
    getPose(space: XRReferenceSpace, base: XRReferenceSpace) {
      assert.equal(space, bounded); assert.equal(base, xr.activeReference);
      if (options.relative === 'throw') throw new Error('current pose unavailable');
      return options.relative === 'missing' ? null : {
        emulatedPosition: options.relative === 'emulated', transform: { matrix: options.matrix ?? IDENTITY },
      };
    },
  }) as unknown as XRFrame;
  return { boundary, bounded, active, xr, session, start, end, frame, requested, notifications };
}

test('manual rectangle uses metre dimensions and yaw without changing the supplied centre/floor', () => {
  const points = manualRectangle({ centerX: 3, centerZ: -5, width: 2, depth: 4, yawDegrees: 90, floorY: 0.2 });
  const expected: Point3[] = [[1, 0.2, -4], [1, 0.2, -6], [5, 0.2, -6], [5, 0.2, -4]];
  points.forEach((point, i) => point.forEach((value, j) => assert.ok(Math.abs(value - expected[i][j]) < 1e-12)));
  assert.throws(() => manualRectangle({ centerX: 0, centerZ: 0, width: 0, depth: 4, yawDegrees: 0, floorY: 0 }));
  assert.throws(() => manualRectangle({ centerX: 0, centerZ: NaN, width: 2, depth: 4, yawDegrees: 0, floorY: 0 }));
});

test('perimeter normalization retains concave edges, removes a closing duplicate and rejects empty area/nonfinite data', () => {
  const concave: Point3[] = [[0, 0, 0], [3, 0, 0], [3, 0, 3], [1, 0, 1], [0, 0, 3]];
  assert.deepEqual(normalizeBoundary([...concave, concave[0]]), concave);
  assert.deepEqual(concave[3], [1, 0, 1], 'an inward edge must not become an enclosing rectangle');
  assert.equal(normalizeBoundary([]), null);
  assert.equal(normalizeBoundary([[0, 0, 0], [1, 0, 1], [2, 0, 2]]), null);
  assert.equal(normalizeBoundary([[0, 0, 0], [1, 0, 0], [NaN, 0, 1]]), null);
  assert.equal(normalizeBoundary([[0, 0, 0], [1, 0, 0], []] as unknown as Point3[]), null);
});

test('boundary transformation maps bounded-floor into active space with column-major yaw/translation', () => {
  const matrix = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 3, 0.2, -5, 1];
  assert.deepEqual(transformBoundary(POLYGON, matrix), [[1, 0.2, -4], [1, 0.2, -6], [5, 0.2, -6], [5, 0.2, -4]]);
  assert.deepEqual(POLYGON, [[-1, 0, -2], [1, 0, -2], [1, 0, 2], [-1, 0, 2]], 'source points stay unchanged');
  assert.equal(transformBoundary(POLYGON, [...IDENTITY.slice(0, 15), NaN]), null);
  assert.equal(transformBoundary(POLYGON, IDENTITY.slice(0, 15)), null);
  assert.equal(transformBoundary(POLYGON, [...IDENTITY.slice(0, 15), 2]), null);
});

test('runtime adapter requests separate bounds, transforms live points and avoids head-only callback spam', async () => {
  const s = setup();
  try {
    assert.equal(s.boundary.snapshot().status, 'waiting');
    await s.start();
    assert.deepEqual(s.requested, ['bounded-floor']);
    const state = s.boundary.update(s.frame({ matrix: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 3, 0.2, -5, 1] }));
    assert.equal(state.status, 'live'); assert.equal(state.live, true);
    assert.deepEqual(state.points, [[1, 0.2, -4], [1, 0.2, -6], [5, 0.2, -6], [5, 0.2, -4]]);
    assert.deepEqual(state.head, [2, 1.7, -3]);
    assert.equal(s.xr.activeReference, s.active, 'the active local-floor reference must stay unchanged');
    s.boundary.update(s.frame());
    const notifications = s.notifications.length;
    assert.deepEqual(s.boundary.update(s.frame({ headX: 3 })).head, [3, 1.7, -3]);
    assert.equal(s.notifications.length, notifications);
  } finally { s.boundary.dispose(); }
});

test('missing/emulated/throwing current-frame poses immediately clear boundary and head', async () => {
  const s = setup();
  try {
    await s.start();
    for (const options of [{ viewer: 'missing' }, { viewer: 'emulated' }, { relative: 'missing' }, { relative: 'emulated' }, { relative: 'throw' }] as const) {
      assert.equal(s.boundary.update(s.frame()).live, true);
      const state = s.boundary.update(s.frame(options));
      assert.equal(state.status, 'paused'); assert.equal(state.live, false);
      assert.deepEqual(state.points, []); assert.equal(state.head, null);
    }
    assert.equal(s.boundary.update().status, 'paused');
    s.end();
    assert.equal(s.boundary.snapshot().status, 'waiting', 'invalidated data cannot become a last-session snapshot');
  } finally { s.boundary.dispose(); }
});

test('runtime bounds can be empty, malformed or unavailable without creating fabricated geometry', async () => {
  const s = setup();
  try {
    await s.start();
    for (const points of [[], [{ x: 0, y: 0, z: 0, w: 1 }],
      [{ x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 0, z: 0, w: 0 }, { x: 0, y: 0, z: 1, w: 1 }],
      [{ x: NaN, y: 0, z: 0, w: 1 }, { x: 1, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 1, w: 1 }]]) {
      s.bounded.boundsGeometry = points;
      const state = s.boundary.update(s.frame());
      assert.equal(state.status, 'unavailable'); assert.deepEqual(state.points, []);
    }
  } finally { s.boundary.dispose(); }
  const unsupported = setup(() => Promise.reject(new Error('NotSupportedError')));
  try {
    await unsupported.start();
    const state = unsupported.boundary.update(unsupported.frame());
    assert.equal(state.status, 'unavailable'); assert.deepEqual(state.points, []);
    assert.equal(unsupported.xr.isPresenting, true, 'missing bounds must not end the session');
  } finally { unsupported.boundary.dispose(); }
});

test('reference resets and hidden sessions hide old geometry until a fresh valid frame', async () => {
  const s = setup();
  try {
    await s.start(); s.boundary.update(s.frame());
    for (const reference of [s.active, s.bounded]) {
      reference.emit('reset');
      assert.equal(s.boundary.snapshot().status, 'paused');
      assert.deepEqual(s.boundary.snapshot().points, []);
      assert.equal(s.boundary.update(s.frame()).live, true);
    }
    s.session.visibilityState = 'hidden'; s.session.emit('visibilitychange');
    assert.equal(s.boundary.snapshot().status, 'paused');
    assert.equal(s.boundary.update(s.frame()).live, false);
    s.session.visibilityState = 'visible'; s.session.emit('visibilitychange');
    assert.equal(s.boundary.snapshot().live, false);
    assert.equal(s.boundary.update(s.frame()).live, true);
  } finally { s.boundary.dispose(); }
});

test('session end keeps only an explicitly stale snapshot; a fresh session clears it', async () => {
  const s = setup();
  try {
    await s.start(); s.boundary.update(s.frame()); s.end();
    const state = s.boundary.update();
    assert.equal(state.status, 'snapshot'); assert.equal(state.live, false);
    assert.deepEqual(state.points, POLYGON); assert.equal(state.head, null);
    assert.match(state.message, /not live/i);
    s.xr.session = s.session; s.xr.isPresenting = true; s.xr.emit('sessionstart');
    assert.deepEqual(s.boundary.snapshot().points, []);
    await settle();
    assert.equal(s.boundary.snapshot().live, false);
    assert.equal(s.boundary.update(s.frame()).live, true);
  } finally { s.boundary.dispose(); }
});

test('late boundary requests and detached listeners cannot resurrect an ended/disposed session', async () => {
  let resolve!: (reference: XRReferenceSpace) => void;
  const pending = new Promise<XRReferenceSpace>(done => { resolve = done; });
  const s = setup(() => pending);
  await s.start(); s.end();
  resolve(s.bounded as unknown as XRReferenceSpace); await settle();
  assert.equal(s.boundary.snapshot().status, 'waiting');
  assert.deepEqual(s.boundary.snapshot().points, []);
  s.boundary.dispose();
  s.xr.session = s.session; s.xr.isPresenting = true; s.xr.emit('sessionstart');
  assert.equal(s.boundary.snapshot().status, 'waiting');
  assert.deepEqual(s.requested, ['bounded-floor']);
});
