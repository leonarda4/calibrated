import assert from 'node:assert/strict';

/** Real main-loop/WebAudio wiring; the check browser mutes physical output. */
export async function runWallMovementScenario(page) {
  const initial = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { wallBlocker: wall, wallMovementAudio: sound, camera, controls, experience } = window.__debug;
    const saved = { camera: camera.position.toArray(), target: controls.target.toArray(), damping: controls.enableDamping };
    controls.enableDamping = false;
    const frame = new THREE.Matrix4().fromArray(wall.snapshot().routeToWorld);
    camera.position.copy(new THREE.Vector3(0, 1.6, 5).applyMatrix4(frame));
    const look = looking => {
      const state = wall.snapshot(), base = state.baseWorld ?? state.routeEndpoints?.start ?? [0, 0, -8];
      controls.target.set(base[0], base[1] + 1.3, base[2]);
      if (!looking) controls.target.multiplyScalar(-1).addScaledVector(camera.position, 2);
      controls.update(); camera.updateMatrixWorld(true); experience.update(0);
    };
    window.__wallMovementSmoke = { saved, sound, look };
    look(true);
    return { wall: wall.snapshot(), audio: sound.snapshot() };
  });
  const read = () => page.evaluate(() => ({ wall: window.__debug.wallBlocker.snapshot(),
    audio: window.__debug.wallMovementAudio.snapshot(), sameAudio: window.__debug.wallMovementAudio === window.__wallMovementSmoke.sound }));
  const look = value => page.evaluate(value => window.__wallMovementSmoke.look(value), value);
  try {
    assert.equal(initial.wall.visible, false); assert.equal(initial.audio.playing, false);
    await page.locator('#experience-show-wall').click();
    await page.waitForFunction(() => window.__debug.wallMovementAudio.snapshot().ready);
    const armed = await read();
    assert.equal(armed.wall.visible, false, 'looking toward the armed wall must prevent its appearance');
    assert.equal(armed.audio.playing, false);
    await look(false);
    await page.waitForFunction(() => {
      const { wallBlocker: wall, wallMovementAudio: sound } = window.__debug;
      return wall.snapshot().visible && wall.snapshot().moving && sound.snapshot().playing;
    });
    const moving = await read();
    assert.equal(moving.wall.motion, 'visible'); assert.equal(moving.wall.offset, 0);
    assert.equal(moving.sameAudio, true); assert.equal(moving.audio.gain, .35);
    assert.ok(Math.abs(moving.audio.sourceDuration - 10.24) < .001, 'real WebAudio must decode RumblingSound02.wav');
    await page.waitForTimeout(250);
    const beforeLook = await read();
    assert.ok(beforeLook.audio.currentGain > .3, 'unseen motion must finish the rumble fade-in');
    await look(true);
    await page.waitForFunction(() => window.__debug.wallMovementAudio.snapshot().fading);
    const fading = await read();
    assert.equal(fading.wall.moving, true, 'the rumble must fade while the wall is still moving');
    assert.ok(fading.audio.stopInSeconds > 0 && fading.audio.stopInSeconds <= .7);
    await page.waitForFunction(() => !window.__debug.wallBlocker.snapshot().moving && !window.__debug.wallMovementAudio.snapshot().playing);
    const waiting = await read();
    const travelled = waiting.wall.approach.z - beforeLook.wall.approach.z;
    assert.ok(Math.abs(travelled - .7 * waiting.wall.approach.speed) < .16,
      `look-back should retain about0.7s of travel, received ${travelled}m`);
    assert.equal(waiting.audio.currentGain, 0); assert.equal(waiting.sameAudio, true);
    assert.equal(waiting.wall.visible, true, 'stopping after0.7s must not consume the five-second gaze dwell');
    await look(false);
    await page.waitForFunction(() => window.__debug.wallMovementAudio.snapshot().playing);
    const resumed = await read();
    assert.ok(resumed.audio.playCount > moving.audio.playCount);
    await page.locator('#experience-show-wall').click();
    await page.waitForFunction(() => !window.__debug.wallBlocker.snapshot().visible && !window.__debug.wallMovementAudio.snapshot().playing);
    const hidden = await read();
    assert.equal(hidden.wall.motion, 'hidden'); assert.equal(hidden.wall.offset, 0);
    await look(false); await page.locator('#experience-show-wall').click();
    await page.waitForFunction(() => window.__debug.wallMovementAudio.snapshot().playing);
    await page.locator('#experience-stop').click();
    await page.waitForFunction(() => !window.__debug.wallBlocker.snapshot().visible && !window.__debug.wallMovementAudio.snapshot().playing);
    await page.locator('#experience-reset').click();
    const reset = await read();
    assert.equal(reset.audio.playing, false); assert.equal(reset.audio.moving, false); assert.equal(reset.sameAudio, true);
    return { clip: '/audio/SoundFX/RumblingSound02.wav', sourceDuration: moving.audio.sourceDuration,
      gain: moving.audio.gain, fadeInSeconds: .2, lookBackFadeSeconds: .7, actualLookBackTravel: travelled,
      instantUnseenReveal: true, realGestureDecodes: true, mainLoopMovementSound: true,
      soundFadesDuringTravel: true, gazeWaitSilent: true, immediateHideSilent: true,
      sameAudioInstance: true, stopCancels: true, resetSilent: true, physicalAudition: false };
  } finally {
    await page.evaluate(() => {
      const { wallBlocker: wall, wallMovementAudio: sound, camera, controls, experience } = window.__debug;
      const fixture = window.__wallMovementSmoke;
      wall.reset(); wall.useFittedPosition(); sound.stop();
      if (fixture) {
        camera.position.fromArray(fixture.saved.camera); controls.target.fromArray(fixture.saved.target);
        controls.update(); controls.enableDamping = fixture.saved.damping; camera.updateMatrixWorld(true);
      }
      experience.update(0); delete window.__wallMovementSmoke;
    });
  }
}
