import assert from 'node:assert/strict';
import path from 'node:path';

/** Actual coordinator/player callbacks plus the same manual canonical wall path. */
export async function runWallGameplayScenario(page, output) {
  try {
    const waiting = await page.evaluate(async () => {
      const { experience, wallBlocker: wall, splats, scene, camera, controls, floorHole } = window.__debug;
      const experienceUpdate = experience.update, wallUpdate = wall.update;
      const saved = { experienceUpdate, wallUpdate, speech:experience.gameplayAudio.speech,
        camera: camera.position.toArray(), target: controls.target.toArray(), damping: controls.enableDamping };
      window.__wallGameplay={saved};
      experience.update = () => {}; wall.update = () => wallUpdate(0); controls.enableDamping = false;
      const ensure = (ok, message) => { if (!ok) throw new Error(message); };
      const near = (a, b, name) => ensure(Math.abs(a - b) < 1e-6, `${name}: ${a} versus ${b}`);
      const look = looking => {
        const state = wall.snapshot(), base = state.baseWorld ?? state.routeEndpoints?.start ?? [0, 0, -8];
        controls.target.set(base[0], base[1] + 1.3, base[2]);
        if (!looking) controls.target.multiplyScalar(-1).addScaledVector(camera.position, 2);
        if (controls.target.distanceToSquared(camera.position) < 1e-12) {
          controls.target.set(camera.position.x, camera.position.y, camera.position.z + (looking ? -1 : 1));
        }
        controls.update(); camera.updateMatrixWorld(true); experienceUpdate(0);
      };
      const player = (x, z, looking = false, height = 1.7) => { camera.position.set(x, height, z); look(looking); };
      let elapsed = 0, locked = null, previousZ = -8;
      const speechEvents=[];
      experience.gameplayAudio.speech=id=>speechEvents.push({id,at:elapsed,wallVisible:wall.snapshot().visible,
        seatSettled:experience.installation.snapshot().secondBox.reveal.motion==='visible'});
      const advance = seconds => {
        for (let remaining = seconds; remaining > 1e-9;) {
          const dt = Math.min(.05, remaining); elapsed += dt;experienceUpdate(dt); wallUpdate(dt); floorHole.update(dt); remaining -= dt;
          const state = wall.snapshot();
          if (state.visible || state.approach.active) {
            const object = splats.getSplatScene(state.sceneIndex), rotation = object.getWorldQuaternion(object.quaternion.clone()).toArray();
            if (!locked) locked = { queries: state.alignmentQueries, width: state.width, rotation };
            near(state.alignmentQueries, locked.queries, 'Visible wall queried hallway sections again');
            near(state.width, locked.width, 'Visible wall changed width');
            rotation.forEach((value, i) => near(value, locked.rotation[i], 'Visible wall changed heading'));
            ensure(state.trajectoryLocked, 'Moving wall lacks its frozen route');
            ensure(state.baseWorld[2] >= previousZ - 1e-7 && state.baseWorld[2] >= -8 - 1e-7 &&
              state.baseWorld[2] <= state.routeEndpoints.end[2] + 1e-7, 'Wall retreated or crossed its fixed route');
            near(state.offset, 0, 'Instant wall has a lateral slide offset'); previousZ = state.baseWorld[2];
          }
        }
      };
      const resetAssertions = () => { locked = null; previousZ = -8; };
      player(0, 8, true); ensure(experience.startTestScenarioPreview(), 'Preview could not start');
      ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === 'waitingSecondBox', 'Wall did not wait for the second-box trigger');
      advance(8.1); ensure(!wall.snapshot().visible, 'First box revealed the wall');
      scene.updateMatrixWorld(true); const boxPose = scene.getObjectByName('installation-box').matrixWorld.toArray();
      advance(14); ensure(experience.installation.snapshot().phase === 'rotating' && !wall.snapshot().visible, 'Wall appeared during the turn');
      advance(15);
      const second = experience.installation.snapshot().secondBox;
      ensure(second.visible && second.reveal.motion === 'visible' && second.base, 'Second box did not finish appearing');
      ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === 'waitingSecondBox', 'Elapsed time alone revealed the wall');
      ensure(speechEvents.filter(e=>e.id==='sitOnBox').length===1 && speechEvents.find(e=>e.id==='sitOnBox').seatSettled,
        'The supplied sit instruction must occur once after the second box finishes rising');
      ensure(!speechEvents.some(e=>e.id==='classroom'),'The classroom instruction played before wall appearance');
      const section = experience.hallwaySection(second.base[2]);
      ensure(section.ok, 'Second-box trigger needs supported hallway walls');
      player(section.centerWorld[0], second.base[2] + .8, true); advance(.05);
      ensure(Math.hypot(camera.position.x-second.base[0],camera.position.z-second.base[2])>.5,
        'Wide trigger fixture still stands on the box');
      ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === 'waitingLookAway', 'Hallway-section entry did not immediately arm a hidden wall');
      advance(1); ensure(!wall.snapshot().visible, 'Armed wall appeared while watched');
      ensure(!speechEvents.some(e=>e.id==='classroom'),'Waiting for look-away started the classroom prompt');
      look(false); advance(.05);
      const appeared = wall.snapshot();
      const appearedAt=elapsed;
      ensure(appeared.visible && appeared.motion === 'visible' && appeared.offset === 0, 'Look-away did not reveal the full wall instantly');
      ensure(appeared.baseWorld[2] >= -8 && appeared.baseWorld[2] < -7.9, 'Instant appearance skipped the start');
      near(appeared.approach.speed, 1, 'New wall speed');
      const firstBox = experience.installation.snapshot();
      near(appeared.routeEndpoints.end[2], firstBox.config.centerZ, 'Final station is not approximately the fixed first box');
      advance(1); const beforeLook = wall.snapshot().baseWorld[2];
      const preparedHole = floorHole.snapshot();
      ensure(preparedHole.prepared && preparedHole.locked && !preparedHole.open,
        'The future wall-relative opening must be prepared while still hidden.');
      near(preparedHole.endZ, appeared.routeEndpoints.end[2] - 1, 'Prepared hole is not1m beyond the final wall');
      look(true); advance(.35); const halfLook = wall.snapshot().baseWorld[2];
      near(halfLook - beforeLook, .35, 'First half of0.7s stop delay');
      advance(.35); const stoppedZ = wall.snapshot().baseWorld[2];
      near(stoppedZ - beforeLook, .7, 'Full0.7s stop delay');
      advance(.5); near(wall.snapshot().baseWorld[2], stoppedZ, 'Watched wall kept moving after0.7s');
      look(false); advance(.5); near(wall.snapshot().baseWorld[2], stoppedZ + .5, 'Unseen wall did not resume at1m/s');
      const centerX = wall.snapshot().baseWorld[0];
      player(centerX, -3.6, false); advance(2.299);
      ensure(!speechEvents.some(e=>e.id==='classroom'),'Classroom prompt arrived before five seconds of actual appearance');
      advance(.001);
      const classroom=speechEvents.filter(e=>e.id==='classroom');
      ensure(classroom.length===1 && classroom[0].wallVisible,'Wall appearance did not trigger the classroom instruction once');
      near(classroom[0].at-appearedAt,5,'Classroom instruction delay from actual wall appearance');
      advance(.7);
      const held = wall.snapshot();
      ensure(held.approach.waitingFor === 'player', 'Player clearance did not override gaze permission');
      near(held.baseWorld[2], -4.6, 'Full-thickness player clearance');
      advance(2); near(wall.snapshot().baseWorld[2], held.baseWorld[2], 'Waiting wall drifted');
      player(centerX, -3.5, false); advance(1); near(wall.snapshot().baseWorld[2], held.baseWorld[2], 'Player release ignored hysteresis');
      look(true); advance(5.2);
      ensure(wall.snapshot().visible && wall.snapshot().arrival.phase === 'idle' && !floorHole.snapshot().open,
        'Five seconds looking before the final position incorrectly removed the wall');
      look(false);
      window.__wallGameplay = { saved, ensure, near, look, player, advance, resetAssertions, centerX, boxPose, held, speechEvents,
        preparedCorners: preparedHole.worldCorners, now: () => elapsed };
      return { hallwaySectionArmsImmediately: true, triggerLengthMetres:2, timeAloneCannotReveal: true, watchedRevealWaits: true,
        instantUnseenReveal: true, lookBackStopSeconds: .7, waitingZ: held.baseWorld[2], clearanceFromSurface: .75,
        approachSpeed: appeared.approach.speed, firstBoxEndpoint: appeared.routeEndpoints.end[2],
        sitPromptAfterRise:true,classroomDelaySeconds:classroom[0].at-appearedAt };
    });
    await page.screenshot({ path: path.join(output, 'wall-player-wait.png'), fullPage: true });
    const finished = await page.evaluate(() => {
      const { experience, wallBlocker: wall, floorHole, splats, scene, camera } = window.__debug, t = window.__wallGameplay;
      t.player(t.centerX, 5, false); t.advance(1);
      t.near(wall.snapshot().baseWorld[2], t.held.baseWorld[2] + 1, 'Resume speed/catch-up');
      t.advance(12);
      const arrived = wall.snapshot(), end = arrived.routeEndpoints.end[2];
      t.near(arrived.baseWorld[2], end, 'Final fixed first-box station');
      const beforePass = floorHole.snapshot();
      t.ensure(arrived.visible && beforePass.open && arrived.arrival.phase === 'idle',
        'The arriving opaque wall must conceal an already revealed opening before passage or final gaze.');
      t.ensure(JSON.stringify(beforePass.worldCorners) === JSON.stringify(t.preparedCorners),
        'The prepared hole moved with the approaching wall.');
      t.look(true); t.advance(2); t.ensure(wall.snapshot().arrival.phase === 'idle' && floorHole.snapshot().open,
        'Wall disappeared at the obsolete2s gaze limit');
      t.look(false); t.advance(.1); t.near(wall.snapshot().gaze.lookSeconds, 0, 'Look-away did not reset disappearance dwell');
      t.look(true); t.advance(4.95); t.ensure(wall.snapshot().arrival.phase === 'idle', 'Interrupted looks accumulated toward5s');
      t.advance(.05); t.ensure(floorHole.snapshot().open && wall.snapshot().arrival.phase === 'glitching', 'Five continuous seconds did not begin glitch disappearance');
      const gazeHole = floorHole.snapshot();
      t.near(gazeHole.endZ, end - 1, 'Gaze hole edge must be1m past the standing wall');
      t.ensure(JSON.stringify(gazeHole.worldCorners) === JSON.stringify(beforePass.worldCorners), 'Final gaze relocated the hidden opening');
      t.advance(.6); t.ensure(!wall.snapshot().visible && floorHole.snapshot().open, 'Glitch failed to leave the fitted hole');
      scene.updateMatrixWorld(true);
      t.ensure(JSON.stringify(scene.getObjectByName('installation-box').matrixWorld.toArray()) === JSON.stringify(t.boxPose), 'Wall moved the fixed first box');
      const mesh = splats.viewer.splatMesh, saved = window.__wallResources;
      t.ensure(mesh.material === saved.material && mesh.geometry === saved.geometry && splats.viewer.sortWorker === saved.worker, 'Gameplay rebuilt shared resources');
      // The manual route has identical unseen appearance and no watched intro.
      t.resetAssertions(); t.look(true); document.getElementById('experience-show-wall').click();
      t.ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === 'waitingLookAway', 'Manual Show bypassed unseen appearance');
      t.look(false); t.advance(.05); t.ensure(wall.snapshot().visible && wall.snapshot().offset === 0, 'Manual Show did not use the instant shared path');
      t.advance(12); t.near(wall.snapshot().baseWorld[2], end, 'Manual route differs from preview endpoint');
      const passageHole = floorHole.snapshot();
      t.ensure(passageHole.open && wall.snapshot().arrival.phase === 'idle', 'The hole must exist before the player passes through.');
      t.near(passageHole.endZ, end - 1, 'Passage opening must already be1m beyond the wall');
      // positionWorld follows the actual frozen route directly; baseWorld has
      // an extra raw-scan round trip that can differ by a floating-point ulp.
      const passWall = wall.snapshot().positionWorld, passWallZ = passWall[2], passHeight = passWall[1] + 1.3;
      t.player(passWall[0], passWallZ + 1.2, false, passHeight); t.advance(.05);
      let crossingPlayerZ = null, coincidentCentreObserved = false;
      for (const offset of [1, .8, .6, .4, .2, 0, -.2, -.4, -.6, -.8, -1]) {
        const z = passWallZ + offset;
        t.player(passWall[0], z, false, passHeight);
        if (offset === 0) {
          // Keep the physical sample exactly coincident while retaining the
          // finite head orientation from the preceding small physical step.
          camera.position.set(passWall[0], passHeight, passWallZ); camera.updateMatrixWorld(true); t.saved.experienceUpdate(0);
        }
        t.advance(.05);
        if (offset === 0) {
          t.ensure(wall.snapshot().gaze.looking === null, `Coincident wall-centre gaze must be geometrically undefined: ${JSON.stringify({
            camera: camera.position.toArray(), routePosition: passWall, actualPosition: wall.snapshot().positionWorld, gaze: wall.snapshot().gaze,
          })}`);
          t.ensure(camera.position.x === passWall[0] && camera.position.y === passHeight && camera.position.z === passWallZ,
            'The current native desktop player sample missed the exact wall centre');
          coincidentCentreObserved = true;
        }
        if (wall.snapshot().arrival.phase === 'glitching') { crossingPlayerZ = z; break; }
      }
      t.ensure(crossingPlayerZ !== null, 'Walking through both wall faces did not start the glitch');
      t.ensure(coincidentCentreObserved, 'Passage did not include the exact centre sample');
      t.ensure(floorHole.snapshot().open, 'Passing through closed the prepared hole');
      t.near(floorHole.snapshot().endZ, end - 1, 'Passing through relocated the wall-relative hole');
      t.ensure(JSON.stringify(floorHole.snapshot().worldCorners) === JSON.stringify(passageHole.worldCorners),
        'Player passage must not move the captured opening');
      const passPose = wall.snapshot().baseWorld;
      t.advance(.6); t.ensure(!wall.snapshot().visible, 'Passage glitch did not hide the wall');
      wall.snapshot().baseWorld.forEach((v, i) => t.near(v, passPose[i], 'Passage glitch moved/retreated the wall'));
      experience.prepareForCalibration(); t.resetAssertions();
      t.player(t.centerX, -8, false); wall.show(); t.advance(.1);
      t.ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === 'waitingPlayer', 'Instant appearance crossed an occupied player');
      const queries = wall.snapshot().alignmentQueries; t.advance(2); t.near(wall.snapshot().alignmentQueries, queries, 'Occupied reveal refitted');
      t.player(t.centerX, 5, false); t.advance(.05); t.ensure(wall.snapshot().visible, 'Clear unseen entry failed to resume');
      experience.prepareForCalibration(); t.advance(2); t.ensure(!wall.snapshot().visible && !wall.snapshot().approach.active, 'Recovery revived wall motion');
      wall.startGameplay(); wall.turnCompleted(); t.advance(5);
      t.ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === 'waitingSecondBox', 'Turn callback revived the obsolete timed reveal');
      wall.triggerSecondBox(); wall.stopTravel(); t.advance(2);
      t.ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === null, 'Stop revived an armed hidden wall');
      return { finalZ: end, gazeSeconds: 5, continuousDwellRequired: true, playerPassageGlitches: true,
        passagePlayerZ: crossingPlayerZ, passageHoleEdge: passageHole.endZ, gazeHoleEdge: gazeHole.endZ,
        holePreparedBeforePassage: true, holeConcealedBeforeGlitch: true, passageNeverRelocatesHole: true,
        exactCentrePassage: coincidentCentreObserved,
        fixedBoxUnchanged: true, resourcesReused: true, frozenRoute: true, noRetreat: true,
        manualPreviewParity: true, occupiedEntryWaits: true, stopRecoveryCancel: true };
    });
    assert.equal(finished.gazeSeconds, 5);
    const watched = await page.evaluate(() => {
      const { experience, wallBlocker:wall }=window.__debug, t=window.__wallGameplay;
      experience.prepareForCalibration(); t.resetAssertions(); t.player(t.centerX,5,true);
      wall.show(); t.advance(4.999);
      t.ensure(!wall.snapshot().visible,'Watched hidden wall appeared before five seconds');
      t.advance(.001); const appeared=wall.snapshot();
      t.ensure(appeared.visible && appeared.motion==='visible','Five-second watching timeout did not reveal the wall');
      t.near(appeared.baseWorld[2],-8,'Watched reveal skipped the route start');
      t.advance(.1);
      t.ensure(wall.snapshot().moving && wall.snapshot().baseWorld[2]>-8,'Watched timeout did not start movement');
      return { watchedFallbackSeconds:5, watchedRevealStartsMoving:true, defaultLateralOffset:experience.installation.snapshot().rotationOffsetMetres };
    });
    await page.screenshot({path:path.join(output,'wall-watched-reveal.png'),fullPage:true});
    await page.evaluate(() => {
      const {experience,wallBlocker:wall}=window.__debug,t=window.__wallGameplay;
      t.advance(.6); const stopped=wall.snapshot().baseWorld[2]; t.advance(.5);
      t.near(wall.snapshot().baseWorld[2],stopped,'Watched reveal bypassed the existing stopping rule');
      experience.prepareForCalibration();t.resetAssertions();t.player(t.centerX,-7.6,true);
      wall.show();t.advance(5.1);
      t.ensure(!wall.snapshot().visible&&wall.snapshot().gameplayCue==='waitingPlayer','Watching timeout bypassed player clearance');
      t.player(t.centerX,5,true);t.advance(.05);t.ensure(wall.snapshot().visible,'Clearing occupied timed reveal did not resume');
      experience.prepareForCalibration();t.resetAssertions();t.player(t.centerX,5,true);wall.show();t.advance(4.9);
      wall.stopTravel();t.advance(5.1);t.ensure(!wall.snapshot().visible,'Stop revived a watched reveal');
    });
    return { ...waiting, ...finished, ...watched };
  } finally {
    await page.evaluate(() => {
      const t = window.__wallGameplay; if (!t) return;
      const { experience, wallBlocker: wall, camera, controls } = window.__debug;
      experience.prepareForCalibration(); experience.update = t.saved.experienceUpdate; wall.update = t.saved.wallUpdate;
      experience.gameplayAudio.speech=t.saved.speech;
      camera.position.fromArray(t.saved.camera); controls.target.fromArray(t.saved.target); controls.update(); controls.enableDamping = t.saved.damping;
      wall.useFittedPosition(); delete window.__wallGameplay;
    });
  }
}
