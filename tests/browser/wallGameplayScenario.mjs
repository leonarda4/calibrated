import assert from 'node:assert/strict';
import path from 'node:path';

/** Actual main.ts wiring, scene transforms and current desktop player position. */
export async function runWallGameplayScenario(page, output) {
  const paused = await page.evaluate(async () => {
    const { experience, wallBlocker, splats, scene, camera, controls } = window.__debug;
    const experienceUpdate = experience.update, wallUpdate = wallBlocker.update;
    const savedCamera = camera.position.toArray(), savedTarget = controls.target.toArray(), damping = controls.enableDamping;
    experience.update = () => {}; wallBlocker.update = () => wallUpdate(0); controls.enableDamping = false;
    const near = (a, b, name) => { if (Math.abs(a - b) > 1e-7) throw new Error(`${name}: ${a} vs ${b}`); };
    const ensure = (ok, message) => { if (!ok) throw new Error(message); };
    const player = (x, z) => {
      camera.position.set(x, 1.7, z); controls.target.set(x, 1.3, z - 3); controls.update(); camera.updateMatrixWorld(true);
    };
    player(0, 2);
    ensure(experience.startTestScenarioPreview(), 'Gameplay preview could not start.');
    ensure(!wallBlocker.snapshot().visible && wallBlocker.snapshot().gameplayCue === 'waitingTurn', 'Wall appeared at calibration.');
    let elapsed = 0, completedAt = null, previousZ = -8, locked = null;
    const advanceTo = end => {
      while (elapsed < end - 1e-9) {
        const dt = Math.min(.05, end - elapsed), phase = experience.installation.snapshot().phase;
        experienceUpdate(dt); elapsed += dt;
        if (phase === 'rotating' && experience.installation.snapshot().phase === 'reversed') completedAt = elapsed;
        wallUpdate(dt);
        const wall = wallBlocker.snapshot();
        if (wall.approach.active || wall.visible) {
          const object = splats.getSplatScene(wall.sceneIndex);
          const rotation = object.getWorldQuaternion(object.quaternion.clone()).toArray();
          if (!locked) locked = { queries: wall.alignmentQueries, width: wall.width, rotation };
          near(wall.alignmentQueries, locked.queries, 'Moving wall queried hallway sections again');
          near(wall.width, locked.width, 'Moving wall changed width');
          rotation.forEach((value, i) => near(value, locked.rotation[i], 'Moving wall changed world heading'));
          ensure(wall.trajectoryLocked, 'Moving wall has no locked trajectory.');
          near(wall.baseWorld[1], 0, 'Wall floor');
          ensure(wall.baseWorld[2] >= previousZ - 1e-7 && wall.baseWorld[2] >= -8 - 1e-7 && wall.baseWorld[2] <= -2 + 1e-7,
            'Wall reversed or crossed its -8..-2 bounds.');
          previousZ = wall.baseWorld[2];
        }
      }
    };
    advanceTo(10.1); ensure(!wallBlocker.snapshot().visible, 'First box revealed the wall.');
    scene.updateMatrixWorld(true);
    const box = scene.getObjectByName('installation-box'), boxPose = box.matrixWorld.toArray();
    advanceTo(15.1); ensure(experience.installation.snapshot().phase === 'rotating' && !wallBlocker.snapshot().visible, 'Wall appeared during rotation.');
    advanceTo(20.2);
    ensure(completedAt !== null && experience.installation.snapshot().secondBox.visible, 'Turn/second box did not complete.');
    ensure(!wallBlocker.snapshot().visible, 'Second box revealed or teleported the wall.');
    advanceTo(completedAt + 1.999); ensure(!wallBlocker.snapshot().visible, 'Wall appeared before two seconds after rotation.');
    advanceTo(completedAt + 2);
    ensure(wallBlocker.snapshot().motion === 'entering', 'Wall did not appear at the post-turn deadline.');
    ensure(wallBlocker.snapshot().status.includes('sliding in'), 'Automatic entry reports the wrong visibility status.');
    near(wallBlocker.snapshot().baseWorld[2], -8, 'First appearance Z');
    advanceTo(elapsed + 1.3);
    ensure(wallBlocker.snapshot().motion === 'visible', 'Wall side entry did not finish.');
    const initialZ = wallBlocker.snapshot().baseWorld[2];
    const centerX = wallBlocker.snapshot().baseWorld[0];
    const [{ createHallwaySections }, { getSourceCenters }, THREE] = await Promise.all([
      import('/src/experience/hallwaySection.ts'), import('/src/viewer/splatViewer.ts'),
      import('/node_modules/.vite/deps/three.js'),
    ]);
    const section = createHallwaySections({ scanRoot: splats, getCenters: () => getSourceCenters(splats) }).at(initialZ);
    ensure(section.ok, 'Current hallway walls were not independently available.');
    near(centerX, section.centerWorld[0], 'Moving wall is off the corrected hallway centre');
    const wallScene = splats.getSplatScene(wallBlocker.snapshot().sceneIndex);
    const rendered = new THREE.Matrix4().multiplyMatrices(splats.matrixWorld, wallScene.matrix);
    const corners = [];
    for (const x of [-1.05, 1.05]) for (const z of [-.25, .25]) {
      corners.push(new THREE.Vector3(x, 0, z).applyMatrix4(rendered));
    }
    const signed = (plane, p) => plane.normal[0] * (p.x - plane.point[0]) + plane.normal[2] * (p.z - plane.point[2]);
    for (const plane of [section.wallPlanes.left, section.wallPlanes.right]) {
      ensure(Math.min(...corners.map(p => signed(plane, p))) <= 1e-7,
        'Rendered wall leaves a gap before a fitted hallway wall.');
    }
    near(wallScene.scale.x * 2.1, wallBlocker.snapshot().width, 'Rendered width differs from clearance footprint');
    player(centerX, -6.8);
    advanceTo(elapsed + 2);
    const held = wallBlocker.snapshot();
    ensure(held.approach.waitingFor === 'player', 'Wall failed to pause near the player.');
    near(held.baseWorld[2], -7.8, 'Full-thickness clearance stop');
    advanceTo(elapsed + 5); near(wallBlocker.snapshot().baseWorld[2], held.baseWorld[2], 'Wall drifted while waiting');
    player(centerX, -6.7); advanceTo(elapsed + 1);
    near(wallBlocker.snapshot().baseWorld[2], held.baseWorld[2], 'Wall ignored the resume hysteresis');
    player(centerX, -6.8);
    window.__wallGameplay = { experienceUpdate, wallUpdate, savedCamera, savedTarget, damping, advanceTo,
      now: () => elapsed, completedAt, initialZ, centerX, boxPose, near, ensure, player, held, locked };
    return { completedTurnSeconds: completedAt, firstAppearanceSeconds: completedAt + 2, initialZ: -8,
      waitingZ: held.baseWorld[2], playerZ: -6.8, clearanceFromSurface: .75, secondBoxDidNotForceFinish: true };
  });
  try {
    await page.screenshot({ path: path.join(output, 'wall-player-wait.png'), fullPage: true });
    const finished = await page.evaluate(() => {
      const { experience, wallBlocker, splats, scene } = window.__debug;
      const t = window.__wallGameplay;
      t.player(t.centerX, 2); t.advanceTo(t.now() + 1);
      t.near(wallBlocker.snapshot().baseWorld[2], -7.5, 'Resume speed/catch-up');
      const resumedZ = wallBlocker.snapshot().baseWorld[2];
      t.player(t.centerX, resumedZ - .5); t.advanceTo(t.now() + 1);
      t.near(wallBlocker.snapshot().baseWorld[2], resumedZ, 'Close player behind caused a retreat');
      t.player(t.centerX, 2); t.advanceTo(t.now() + 25);
      const final = wallBlocker.snapshot();
      t.near(final.baseWorld[2], -2, 'Final world Z'); t.near(final.positionWorld[2], -2, 'Rendered final Z');
      t.ensure(!final.approach.active, 'Wall did not hold at -2.');
      scene.updateMatrixWorld(true);
      t.ensure(JSON.stringify(scene.getObjectByName('installation-box').matrixWorld.toArray()) === JSON.stringify(t.boxPose), 'Wall moved the fixed box.');
      const mesh = splats.viewer.splatMesh, saved = window.__wallResources;
      t.ensure(mesh.material === saved.material && mesh.geometry === saved.geometry && splats.viewer.sortWorker === saved.worker, 'Gameplay rebuilt shared resources.');
      // The pictured Show/Hide button must replay the same default action as
      // the completed desktop preview, not inherit its last position as a draft.
      document.getElementById('experience-show-wall').click(); t.wallUpdate(1.25);
      t.ensure(wallBlocker.snapshot().placementSource === 'fitted', 'Hide silently authored a legacy wall position.');
      document.getElementById('experience-show-wall').click();
      t.near(wallBlocker.snapshot().baseWorld[2], -8, 'Manual button differs from preview start');
      t.ensure(wallBlocker.snapshot().approach.active && wallBlocker.snapshot().trajectoryLocked, 'Manual button skipped the preview movement.');
      t.near(wallBlocker.snapshot().width, final.width, 'Manual button differs from preview width');
      // Queue another completed-turn cue, occupy its entry, then clear it.
      experience.prepareForCalibration(); wallBlocker.startGameplay(); wallBlocker.turnCompleted(); t.wallUpdate(0);
      t.player(t.centerX, -8); t.experienceUpdate(.05); t.wallUpdate(2);
      t.ensure(!wallBlocker.snapshot().visible && wallBlocker.snapshot().gameplayCue === 'waitingPlayer', 'Entry crossed the player.');
      const entryQueries = wallBlocker.snapshot().alignmentQueries;
      t.wallUpdate(10); t.ensure(!wallBlocker.snapshot().visible, 'Occupied entry timed out into visibility.');
      t.near(wallBlocker.snapshot().alignmentQueries, entryQueries, 'Waiting entry refitted its route.');
      t.player(t.centerX, 2); t.experienceUpdate(.05); t.wallUpdate(.05);
      t.ensure(wallBlocker.snapshot().visible, 'Entry did not resume once clear.');
      t.near(wallBlocker.snapshot().baseWorld[2], -8, 'Deferred entry changed start Z');
      experience.prepareForCalibration(); t.wallUpdate(100);
      t.ensure(!wallBlocker.snapshot().visible && !wallBlocker.snapshot().approach.active, 'Recovery revived the wall.');
      wallBlocker.startGameplay(); wallBlocker.turnCompleted(); t.wallUpdate(0); t.wallUpdate(1);
      experience.prepareForCalibration(); t.wallUpdate(100);
      t.ensure(!wallBlocker.snapshot().visible && wallBlocker.snapshot().gameplayCue === null, 'Recovery revived a pending delay.');
      wallBlocker.startGameplay(); wallBlocker.turnCompleted(); wallBlocker.stopTravel(); t.wallUpdate(100);
      t.ensure(!wallBlocker.snapshot().visible && wallBlocker.snapshot().gameplayCue === null, 'Manual Stop failed to cancel the pending cue.');
      const rootPosition = splats.position.clone(), rootRotation = splats.quaternion.clone();
      try {
        const yaw = splats.quaternion.clone().setFromAxisAngle(splats.position.clone().set(0, 1, 0), .25);
        splats.quaternion.premultiply(yaw); splats.updateMatrixWorld(true);
        wallBlocker.startGameplay(); wallBlocker.turnCompleted(); t.wallUpdate(0); t.wallUpdate(2);
        t.ensure(wallBlocker.snapshot().motion === 'entering', 'Oblique wall did not enter.');
        for (let i = 0; i < 5; i++) {
          t.wallUpdate(.25); t.near(wallBlocker.snapshot().positionWorld[2], -8, 'Oblique entry crossed the hard start limit');
        }
        wallBlocker.hide();
        for (let i = 0; i < 4; i++) {
          t.wallUpdate(.25); t.near(wallBlocker.snapshot().positionWorld[2], -8, 'Oblique exit retreated behind the start');
        }
      } finally {
        wallBlocker.reset(); splats.position.copy(rootPosition); splats.quaternion.copy(rootRotation); splats.updateMatrixWorld(true);
      }
      wallBlocker.useFittedPosition();
      return { resumedZ, finalZ: final.positionWorld[2], originalSpeed: final.approach.speed,
        fixedBoxUnchanged: true, resourcesReused: true, occupiedEntryWaits: true,
        recoveryCancelsPendingAndVisible: true, stopCancelsPending: true, obliqueSideSlidesHoldWorldZ: true,
        fixedWidthAndHeading: true, noSectionQueriesAfterReveal: true, desktopButtonMatchesPreview: true };
    });
    assert.equal(finished.finalZ, -2);
    return { ...paused, ...finished };
  } finally {
    await page.evaluate(() => {
      const t = window.__wallGameplay;
      if (!t) return;
      const { experience, wallBlocker, camera, controls } = window.__debug;
      experience.update = t.experienceUpdate; wallBlocker.update = t.wallUpdate;
      camera.position.set(...t.savedCamera); controls.target.set(...t.savedTarget); controls.update(); controls.enableDamping = t.damping;
      delete window.__wallGameplay;
    });
  }
}
