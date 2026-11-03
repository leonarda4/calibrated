import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INSTALLATION_CONFIG, InstallationFlow, type FingertipContact, type InstallationConfig } from '../src/experience/flow.ts';
import { rotateContentAroundPivot } from '../src/experience/rotation.ts';

const config = { ...DEFAULT_INSTALLATION_CONFIG };
const contact: FingertipContact = { position: [0, 2.1, 0], tracked: true, timestampMs: 1000 };
const fittedBox = () => {
  const flow = new InstallationFlow(config);
  flow.setCalibrated();
  assert.equal(flow.showBox(false), true);
  return flow;
};

test('live manual Show box requires a fit; desktop preview never grants calibration authority', () => {
  const flow = new InstallationFlow(config);
  assert.equal(flow.rotateHallway(), false);
  assert.equal(flow.showBox(false), false);
  assert.equal(flow.showBox(true), true);
  assert.equal(flow.snapshot().phase, 'box');
  assert.equal(flow.snapshot().calibrated, false);
  assert.equal(flow.snapshot().placementConfirmed, false);
  flow.invalidate('Synthetic interruption');
  flow.reset();
  assert.equal(flow.showBox(false), false);
});

test('elapsed time, fingertips, support flags and legacy collection calls cannot advance the manual box', () => {
  const flow = fittedBox();
  const before = flow.snapshot();
  flow.update(1000, [contact], 1000);
  flow.confirmStationary(true);
  flow.previewAdvance();
  assert.equal(flow.simulateCollection(), false);
  assert.equal(flow.snapshot().phase, 'box');
  assert.equal(flow.snapshot().yaw, 0);
  assert.equal(flow.snapshot().elapsedSeconds, before.elapsedSeconds);
  assert.deepEqual(flow.drainCues(), []);
});

test('only manual Rotate starts one smooth four-second turn without attestation or hand input', () => {
  const flow = fittedBox();
  assert.equal(flow.snapshot().stationaryConfirmed, false);
  assert.equal(flow.snapshot().placementConfirmed, false);
  assert.equal(flow.rotateHallway(), true);
  assert.equal(flow.rotateHallway(), false);
  assert.equal(flow.showBox(true), false);
  flow.update(2, [], 1000);
  assert.equal(flow.snapshot().phase, 'rotating');
  assert.equal(flow.snapshot().yaw, Math.PI / 2);
  flow.update(2, [], 1000);
  assert.equal(flow.snapshot().phase, 'reversed');
  assert.equal(flow.snapshot().yaw, Math.PI);
  flow.update(1000, [contact], 1000);
  assert.equal(flow.snapshot().yaw, Math.PI);
  assert.equal(flow.rotateHallway(), false);
  assert.deepEqual(flow.drainCues(), []);
});

test('static box placement remains editable but a turn locks its pivot until reset', () => {
  const flow = new InstallationFlow(config);
  flow.showBox(true);
  flow.configure({ ...config, centerX: 1.5, centerZ: -2, floorY: 0.2 });
  assert.equal(flow.snapshot().phase, 'box');
  assert.equal(flow.snapshot().preview, true);
  assert.equal(flow.snapshot().config.centerX, 1.5);
  assert.equal(flow.showBox(true), true);
  assert.equal(flow.rotateHallway(), true);
  assert.throws(() => flow.configure({ ...config, centerX: 4 }));
  flow.update(4);
  assert.throws(() => flow.configure(config));
  flow.reset();
  flow.configure(config);
  assert.equal(flow.snapshot().phase, 'idle');
});

test('STOP freezes a partial turn; invalidation and reset cannot restore live fit authority', () => {
  const flow = fittedBox();
  flow.rotateHallway();
  flow.update(1);
  const yaw = flow.snapshot().yaw;
  flow.stop();
  flow.update(20, [contact], 1000);
  assert.equal(flow.snapshot().yaw, yaw);
  assert.equal(flow.rotateHallway(), false);
  flow.invalidate('Reference space changed');
  flow.reset();
  assert.equal(flow.snapshot().phase, 'idle');
  assert.equal(flow.snapshot().yaw, 0);
  assert.equal(flow.snapshot().calibrated, false);
  assert.equal(flow.showBox(false), false);
});

test('bad geometry is rejected, while manual box height is independent of removed orb geometry', () => {
  assert.throws(() => new InstallationFlow({ ...config, boxHeight: NaN }));
  assert.throws(() => new InstallationFlow({ ...config, boxWidth: -1 }));
  assert.throws(() => new InstallationFlow({ ...config, rotationSeconds: 0 }));
  assert.throws(() => new InstallationFlow({ ...config, hallwayWidth: 0 }));
  assert.throws(() => new InstallationFlow({ ...config, hallwayWidth: config.boxWidth }));
  const missingFloor = { ...config } as Partial<InstallationConfig>;
  delete missingFloor.floorY;
  assert.throws(() => new InstallationFlow(missingFloor as InstallationConfig));
  assert.doesNotThrow(() => new InstallationFlow({ ...config, boxHeight: 2.5 }));
});

test('invalid frame deltas never advance the manual turn', () => {
  const flow = fittedBox();
  flow.rotateHallway();
  const before = flow.snapshot();
  for (const dt of [NaN, Infinity, -1, 0]) flow.update(dt, [contact], 1000);
  assert.deepEqual(flow.snapshot(), before);
  flow.update(0.1);
  assert.ok(flow.snapshot().yaw > 0);
});

test('reset permits a new deliberate turn without accumulating yaw or automatic cues', () => {
  const flow = fittedBox();
  flow.rotateHallway();
  flow.update(4);
  flow.reset();
  assert.equal(flow.snapshot().yaw, 0);
  assert.equal(flow.snapshot().phase, 'ready');
  assert.equal(flow.showBox(false), true);
  assert.equal(flow.rotateHallway(), true);
  flow.update(4);
  assert.equal(flow.snapshot().yaw, Math.PI);
  assert.deepEqual(flow.drainCues(), []);
});

test('world yaw preserves floor height and pivot and derives from an unchanged baseline', () => {
  const base = { position: [7, 0.25, -3] as const, quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const };
  const pivot = [2, -1, 4] as const;
  const turned = rotateContentAroundPivot(base, pivot, Math.PI);
  assert.ok(Math.abs(turned.position[0] + 3) < 1e-12);
  assert.equal(turned.position[1], base.position[1]);
  assert.ok(Math.abs(turned.position[2] - 11) < 1e-12);
  const atPivot = rotateContentAroundPivot({ ...base, position: [pivot[0], 1.5, pivot[2]] }, pivot, 0.8);
  assert.deepEqual(atPivot.position, [2, 1.5, 4]);
  assert.deepEqual(rotateContentAroundPivot(base, pivot, Math.PI), turned);
  assert.deepEqual(rotateContentAroundPivot(base, pivot, 0), base);
  assert.deepEqual(base.position, [7, 0.25, -3]);
});
