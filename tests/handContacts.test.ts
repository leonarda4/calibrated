import test from 'node:test';
import assert from 'node:assert/strict';
import { readFingerContacts } from '../src/xr/hands.ts';

const space = {} as XRReferenceSpace;
const tip = {} as XRJointSpace;
const source = (handedness = 'left') => ({
  handedness,
  hand: new Map([['index-finger-tip', tip]]),
}) as unknown as XRInputSource;
const pose = (overrides: Record<string, unknown> = {}) => ({
  emulatedPosition: false,
  transform: { position: { x: 1, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  radius: 0.008,
  ...overrides,
}) as unknown as XRJointPose;
const frame = (result: XRJointPose | undefined) => ({ getJointPose: () => result }) as unknown as XRFrame;

test('only real current-frame fingertip joints yield contacts; controller and pinch profiles do not', () => {
  const remote = { handedness: 'right', profiles: ['generic-hand-select'] } as unknown as XRInputSource;
  assert.deepEqual(readFingerContacts(frame(pose()), space, [source(), remote]), [
    { handedness: 'left', position: [1, 2, 3], radius: 0.008 },
  ]);
  assert.deepEqual(readFingerContacts(undefined, space, [source()]), []);
  assert.deepEqual(readFingerContacts(frame(pose()), null, [source()]), []);
  assert.deepEqual(readFingerContacts(frame(undefined), space, [source()]), []);
});

test('emulated, non-finite, invalid-radius and stale-frame poses have no authority', () => {
  assert.deepEqual(readFingerContacts(frame(pose({ emulatedPosition: true })), space, [source()]), []);
  const bad = pose({ transform: { position: { x: NaN, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } });
  assert.deepEqual(readFingerContacts(frame(bad), space, [source()]), []);
  assert.deepEqual(readFingerContacts(frame(pose({ radius: -1 })), space, [source()]), []);
  const ended = { getJointPose() { throw new Error('frame ended'); } } as unknown as XRFrame;
  assert.deepEqual(readFingerContacts(ended, space, [source()]), []);
});

test('the next frame cannot reuse an earlier contact; absent optional radius gets bounded default', () => {
  const tracked = frame(pose({ radius: undefined }));
  assert.equal(readFingerContacts(tracked, space, [source('right')])[0]?.radius, 0.008);
  assert.deepEqual(readFingerContacts(frame(undefined), space, [source('right')]), []);
  assert.equal(readFingerContacts(frame(pose({ radius: 1 })), space, [source()])[0]?.radius, 0.025);
});
