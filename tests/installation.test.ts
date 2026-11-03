import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INSTALLATION_CONFIG, InstallationFlow, orbPosition, validOrbContact, type FingertipContact, type InstallationConfig } from '../src/experience/flow.ts';
import { rotateContentAroundPivot } from '../src/experience/rotation.ts';

const config = { ...DEFAULT_INSTALLATION_CONFIG, explorationSeconds: 1 };
const freshContact = (now = 1000): FingertipContact => ({ position: orbPosition(config), tracked: true, timestampMs: now });

function readyFlow() {
  const flow = new InstallationFlow(config);
  flow.setCalibrated();
  flow.confirmPlacement(true);
  assert.equal(flow.start(), true);
  flow.update(1, [], 1000);
  assert.equal(flow.snapshot().phase, 'badge');
  return flow;
}

test('real start requires fit and checked placement; preview never grants fit authority', () => {
  const flow = new InstallationFlow(config);
  assert.equal(flow.start(), false);
  flow.confirmPlacement(true);
  assert.equal(flow.start(), false);
  assert.equal(flow.start(true), true);
  assert.equal(flow.snapshot().calibrated, false);
  assert.deepEqual(flow.drainCues(), ['purpose']);
  flow.stop();
  assert.equal(flow.start(), false);
  flow.reset();
  assert.equal(flow.snapshot().calibrated, false);
  assert.equal(flow.snapshot().placementConfirmed, false);
});

test('fingertip contact requires fresh tracked finite actual position inside orb', () => {
  const contact = freshContact();
  assert.equal(validOrbContact(contact, config, 1000), true);
  assert.equal(validOrbContact(contact, config, 1101), false);
  assert.equal(validOrbContact(contact, config, 999), false);
  assert.equal(validOrbContact({ ...contact, tracked: false }, config, 1000), false);
  assert.equal(validOrbContact({ ...contact, emulatedPosition: true }, config, 1000), false);
  assert.equal(validOrbContact({ ...contact, position: [NaN, 2, -2] }, config, 1000), false);
  assert.equal(validOrbContact({ ...contact, position: [0, 0, -2] }, config, 1000), false);
  assert.equal(validOrbContact({ ...contact, timestampMs: NaN }, config, 1000), false);
  assert.equal(validOrbContact({ ...contact, position: [] } as unknown as FingertipContact, config, 1000), false);
  assert.equal(validOrbContact({ ...contact, position: undefined } as unknown as FingertipContact, config, 1000), false);
});

test('orb collection is stationary-gated, one-shot and finishes at exactly 180 degrees in four seconds', () => {
  const flow = readyFlow();
  assert.deepEqual(flow.drainCues(), ['purpose', 'badge']);
  flow.update(0.01, [freshContact()], 1000);
  assert.equal(flow.snapshot().phase, 'badge');
  flow.confirmStationary(true);
  flow.update(0.01, [freshContact()], 1000);
  assert.equal(flow.snapshot().phase, 'rotating');
  assert.deepEqual(flow.drainCues(), ['congratulations']);
  flow.update(2, [freshContact()], 1000);
  assert.equal(flow.snapshot().yaw, Math.PI / 2);
  flow.update(2, [freshContact()], 1000);
  assert.equal(flow.snapshot().phase, 'reversed');
  assert.equal(flow.snapshot().yaw, Math.PI);
  assert.deepEqual(flow.drainCues(), ['reversed']);
  flow.update(50, [freshContact()], 1000);
  assert.equal(flow.snapshot().yaw, Math.PI);
  assert.deepEqual(flow.drainCues(), []);
});

test('stop freezes a partial turn; invalidation clears authority and reset does not restore it', () => {
  const flow = readyFlow();
  flow.confirmStationary(true);
  flow.update(0.01, [freshContact()], 1000);
  flow.update(1, [], 1000);
  const before = flow.snapshot().yaw;
  flow.stop();
  flow.update(20, [freshContact()], 1000);
  assert.equal(flow.snapshot().yaw, before);
  flow.invalidate('Reference space changed');
  assert.equal(flow.snapshot().calibrated, false);
  assert.equal(flow.snapshot().placementConfirmed, false);
  assert.deepEqual(flow.drainCues(), []);
  flow.reset();
  assert.equal(flow.snapshot().yaw, 0);
  assert.equal(flow.snapshot().phase, 'idle');
  assert.equal(flow.start(), false);
});

test('preview simulation has no live contact authority and requires explicit preview support check', () => {
  const flow = new InstallationFlow(config);
  flow.start(true);
  flow.previewAdvance();
  flow.confirmStationary(true);
  flow.update(0.01, [freshContact()], 1000);
  assert.equal(flow.snapshot().phase, 'badge');
  assert.equal(flow.simulateCollection(), true);
  assert.equal(flow.simulateCollection(), false);
  const live = readyFlow();
  live.confirmStationary(true);
  assert.equal(live.simulateCollection(), false);
});

test('bad configuration is rejected and changing placement removes the prior confirmation', () => {
  assert.throws(() => new InstallationFlow({ ...config, boxHeight: NaN }));
  assert.throws(() => new InstallationFlow({ ...config, boxWidth: -1 }));
  assert.throws(() => new InstallationFlow({ ...config, orbHeight: 0.2 }));
  assert.throws(() => new InstallationFlow({ ...config, rotationSeconds: 0 }));
  assert.throws(() => new InstallationFlow({ ...config, hallwayWidth: 0 }));
  assert.throws(() => new InstallationFlow({ ...config, hallwayWidth: config.boxWidth }));
  const missingFloor = { ...config } as Partial<InstallationConfig>;
  delete missingFloor.floorY;
  assert.throws(() => new InstallationFlow(missingFloor as InstallationConfig));
  const flow = new InstallationFlow(config);
  flow.setCalibrated();
  flow.confirmPlacement(true);
  flow.configure({ ...config, centerX: 1.5 });
  assert.equal(flow.snapshot().placementConfirmed, false);
  assert.equal(flow.snapshot().calibrated, true);
  const live = readyFlow();
  assert.throws(() => live.configure({ ...config, centerX: 1.5 }));
  assert.equal(live.snapshot().phase, 'badge');
});

test('missing hand contacts pause collection without invalidating alignment; bad frame deltas do not advance time', () => {
  const flow = readyFlow();
  flow.confirmStationary(true);
  const before = flow.snapshot();
  for (const dt of [NaN, Infinity, -1, 0]) flow.update(dt, [freshContact()], 1000);
  assert.deepEqual(flow.snapshot(), before);
  flow.update(1, [], 1000);
  assert.equal(flow.snapshot().phase, 'badge');
  assert.equal(flow.snapshot().calibrated, true);
  flow.update(1, [freshContact(0)], 1000);
  assert.equal(flow.snapshot().phase, 'badge');
});

test('withdrawing placement or support confirmation immediately stops active authority', () => {
  const placement = readyFlow();
  placement.confirmPlacement(false);
  assert.equal(placement.snapshot().phase, 'stopped');
  assert.equal(placement.snapshot().placementConfirmed, false);
  const support = readyFlow();
  support.confirmStationary(true);
  support.update(0.1, [freshContact()], 1000);
  support.update(1, [], 1000);
  const yaw = support.snapshot().yaw;
  support.confirmStationary(false);
  support.update(5, [], 1000);
  assert.equal(support.snapshot().phase, 'stopped');
  assert.equal(support.snapshot().yaw, yaw);
});

test('world yaw preserves floor height and pivot, derives from the baseline without accumulating', () => {
  const base = { position: [7, 0.25, -3] as const, quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const };
  const pivot = [2, -1, 4] as const;
  const turned = rotateContentAroundPivot(base, pivot, Math.PI);
  assert.ok(Math.abs(turned.position[0] - (-3)) < 1e-12);
  assert.equal(turned.position[1], base.position[1]);
  assert.ok(Math.abs(turned.position[2] - 11) < 1e-12);
  // At the pivot, yaw changes orientation only. Pivot Y does not affect height.
  const atPivot = rotateContentAroundPivot({ ...base, position: [pivot[0], 1.5, pivot[2]] }, pivot, 0.8);
  assert.deepEqual(atPivot.position, [2, 1.5, 4]);
  assert.deepEqual(rotateContentAroundPivot(base, pivot, Math.PI), turned);
  assert.deepEqual(rotateContentAroundPivot(base, pivot, 0), base);
  assert.deepEqual(base.position, [7, 0.25, -3]);
});
