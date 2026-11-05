import assert from 'node:assert/strict';

/** Synthetic calibration boundary on the real main.ts adapter; no XR session. */
export async function runWallRouteFrameScenario(page) {
  const result = await page.evaluate(async () => {
    const { experience, wallBlocker: wall, splats, renderer, camera, controls, broom, floorHole } = window.__debug;
    const { BROOM } = await import('/src/viewer/broomConfig.ts');
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { ACTIVE_SCAN } = await import('/src/viewer/scanAsset.ts');
    const { scanOriginForStart } = await import('/src/viewer/scanPlacement.ts');
    const authored = new THREE.Matrix4().compose(
      new THREE.Vector3(...scanOriginForStart(ACTIVE_SCAN.startPoint, ACTIVE_SCAN.rotation)),
      new THREE.Quaternion(...ACTIVE_SCAN.rotation), new THREE.Vector3(1, 1, 1));
    const update = experience.update, wallUpdate = wall.update;
    const cameraPosition = camera.position.clone(), target = controls.target.clone(), damping = controls.enableDamping;
    const savedPosition = splats.position.clone(), savedRotation = splats.quaternion.clone();
    const near = (a, b, message) => { if (Math.abs(a - b) > 1e-6) throw new Error(`${message}: ${a} vs ${b}`); };
    const ensure = (ok, message) => { if (!ok) throw new Error(message); };
    experience.update = () => {}; wall.update = () => {}; controls.enableDamping = false;
    const results = [];
    try {
      for (const yaw of [Math.PI, Math.PI / 2, -.63]) {
        experience.prepareForCalibration();
        const frame = new THREE.Matrix4().makeRotationY(yaw).setPosition(3, 0, -4);
        frame.clone().multiply(authored).decompose(splats.position, splats.quaternion, splats.scale);
        splats.updateMatrixWorld(true);
        // Only the synchronous successful-fit callback sees this inert XR flag.
        // No renderer update or runtime/session creation occurs while it is set.
        renderer.xr.isPresenting = true;
        try { experience.calibrated(); } finally { renderer.xr.isPresenting = false; }
        experience.scenario.cancel('Synthetic route test owns the wall clock.');
        const actualFrame = new THREE.Matrix4().fromArray(wall.snapshot().routeToWorld);
        actualFrame.elements.forEach((v, i) => near(v, frame.elements[i], 'Live fit did not set the wall frame'));
        const firstBoxState = experience.installation.snapshot(), firstBox = firstBoxState.config;
        const expectedEnd = firstBoxState.placementSource === 'unplaced' ? 2.5
          : new THREE.Vector3(firstBox.centerX, firstBox.floorY, firstBox.centerZ).applyMatrix4(frame.clone().invert()).z;
        const farPlayerZ = expectedEnd + 3;
        const look = looking => {
          const base = wall.snapshot().baseWorld;
          controls.target.copy(base ? new THREE.Vector3(base[0], base[1] + 1.3, base[2])
            : new THREE.Vector3(0, 1.3, -8).applyMatrix4(frame));
          if (!looking) controls.target.multiplyScalar(-1).addScaledVector(camera.position, 2);
          controls.update(); camera.updateMatrixWorld(true);
          update(0); // Publish current position AND viewing direction through main.ts.
        };
        const player = (z, looking = false) => {
          camera.position.copy(new THREE.Vector3(0, 1.7, z).applyMatrix4(frame));
          look(looking);
        };
        const advance = seconds => {
          let remaining = seconds;
          while (remaining > 1e-9) {
            const dt = Math.min(.05, remaining);
            update(0); wallUpdate(dt); remaining -= dt;
          }
        };
        player(-8, false);
        wall.turnCompleted(); advance(1); wall.stopTravel(); advance(3);
        ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === null, 'Mapped pending cue revived after Stop');
        document.getElementById('experience-show-wall').click();
        ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === 'waitingPlayer', 'Mapped occupied entry was not blocked');
        document.getElementById('experience-show-wall').click();
        ensure(wall.snapshot().gameplayCue === null, 'Button failed to cancel a pending manual reveal');
        document.getElementById('experience-show-wall').click();
        ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === 'waitingPlayer', 'Manual button bypassed the occupied entry guard');
        const blockedQueries = wall.snapshot().alignmentQueries;
        wall.cancelGameplay(); advance(.5);
        ensure(wall.snapshot().gameplayCue === 'waitingPlayer', 'Scenario cancellation erased a manual reveal');
        near(wall.snapshot().alignmentQueries, blockedQueries, 'Manual wait refitted the entry');
        player(farPlayerZ, false); advance(.05);
        ensure(wall.snapshot().motion === 'visible' && !wall.snapshot().animating, `Mapped wall did not appear instantly: ${wall.snapshot().status}`);
        near(wall.snapshot().offset, 0, 'Mapped reveal retained a side-slide offset');
        const entry = new THREE.Vector3(...wall.snapshot().baseWorld).applyMatrix4(frame.clone().invert());
        near(entry.z, -8, 'Mapped entry side'); near(entry.y, 0, 'Mapped floor');
        const fixedQueries = wall.snapshot().alignmentQueries, fixedHeading = wall.snapshot().yaw, fixedWidth = wall.snapshot().width;
        player(-6.8, false); advance(2);
        near(wall.snapshot().approach.z, -7.8, 'Mapped physical player clearance');
        ensure(wall.snapshot().approach.waitingFor === 'player', 'Mapped wall missed the player');
        const scene = splats.getSplatScene(wall.snapshot().sceneIndex);
        const rendered = new THREE.Matrix4().multiplyMatrices(splats.matrixWorld, scene.matrix);
        const renderedBase = new THREE.Vector3().applyMatrix4(rendered);
        ensure(renderedBase.distanceTo(new THREE.Vector3(...wall.snapshot().positionWorld)) < 1e-6,
          'Actual rendered pose differs from world diagnostics');
        player(farPlayerZ, false); advance(.5);
        near(wall.snapshot().approach.z, -7.3, 'Mapped unseen movement speed');
        look(true); advance(.7);
        near(wall.snapshot().approach.z, -6.6, 'Mapped wall ignored its seven-tenths look-back delay');
        advance(5.1);
        near(wall.snapshot().approach.z, -6.6, 'Mapped watched wall did not stop after its delay');
        ensure(wall.snapshot().visible && wall.snapshot().arrival.phase === 'idle' && !floorHole.snapshot().open,
          'Five seconds of watching before arrival incorrectly completed the encounter');
        look(false); advance(.5);
        near(wall.snapshot().approach.z, -6.1, 'Mapped unseen movement speed changed after a pause');
        look(true); advance(.7); advance(1);
        near(wall.snapshot().approach.z, -5.4, 'Mapped wall ignored repeated look-back stopping');
        look(false); advance(expectedEnd - wall.snapshot().approach.z + .1);
        near(wall.snapshot().approach.z, expectedEnd, 'Mapped endpoint did not match the actual first box');
        near(wall.snapshot().alignmentQueries, fixedQueries, 'Mapped motion queried or adjusted the frozen trajectory');
        near(wall.snapshot().yaw, fixedHeading, 'Mapped motion changed the frozen heading');
        near(wall.snapshot().width, fixedWidth, 'Mapped motion changed the frozen width');
        ensure(wall.snapshot().gaze.stage === 'arrival' && wall.snapshot().arrival.phase === 'idle' && wall.snapshot().visible,
          'Mapped unseen endpoint did not wait for a final look');
        const final = new THREE.Vector3(...wall.snapshot().positionWorld).applyMatrix4(frame.clone().invert());
        near(final.z, expectedEnd, 'Actual mapped endpoint');
        look(true); advance(4.9);
        ensure(wall.snapshot().arrival.phase === 'idle' && floorHole.snapshot().open,
          'Mapped endpoint must conceal an open hole while waiting for five continuous seconds of gaze');
        look(false); advance(.1); near(wall.snapshot().gaze.lookSeconds, 0, 'Mapped endpoint dwell did not reset');
        const finalWorld = wall.snapshot().positionWorld;
        const autoWidth = wall.snapshot().width;
        document.getElementById('experience-show-wall').click();
        ensure(wall.snapshot().motion === 'hidden', 'Mapped wall did not hide instantly');
        ensure(!document.getElementById('experience-show-wall').disabled, 'Mapped wall Show button stayed disabled after exit');
        ensure(wall.snapshot().placementSource === 'fitted', 'Hide wrote a legacy manual override.');
        look(true); document.getElementById('experience-show-wall').click();
        ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === 'waitingLookAway',
          'VR manual button revealed a wall while watched');
        const waitingQueries = wall.snapshot().alignmentQueries;
        advance(1); ensure(!wall.snapshot().visible, 'A watched manually armed wall appeared later');
        near(wall.snapshot().alignmentQueries, waitingQueries, 'Waiting for look-away refitted the wall');
        look(false); advance(.05);
        ensure(wall.snapshot().motion === 'visible' && !wall.snapshot().animating, 'VR manual look-away did not reveal instantly');
        near(wall.snapshot().offset, 0, 'VR manual look-away used a side slide');
        near(wall.snapshot().approach.z, -8, 'VR manual button starts at the wrong station');
        near(wall.snapshot().width, autoWidth, 'VR button and scheduled width differ');
        advance(1); near(wall.snapshot().approach.z, -7, 'VR manual unseen movement speed differs');
        look(true); advance(.7); advance(1);
        near(wall.snapshot().approach.z, -6.3, 'VR manual look-back stopping differs');
        look(false); advance(.5); near(wall.snapshot().approach.z, -5.8, 'VR manual unseen resume differs');

        // The other pictured buttons use this same calibrated hallway frame.
        document.getElementById('experience-show-broom').click(); broom.update();
        ensure(broom.snapshot().visible, `Mapped broom failed: ${broom.snapshot().status}`);
        const broomMatrix = new THREE.Matrix4().multiplyMatrices(splats.matrixWorld, splats.getSplatScene(BROOM.sceneIndex).matrix);
        const broomBase = new THREE.Vector3(...BROOM.sourceBase).applyMatrix4(broomMatrix);
        const broomRoute = broomBase.clone().applyMatrix4(frame.clone().invert());
        near(broomRoute.z, 6, 'VR broom used legacy absolute world Z'); near(broomRoute.y, 0, 'VR broom floor');
        ensure(broomBase.distanceTo(new THREE.Vector3(...broom.snapshot().baseWorld)) < 1e-6, 'Broom diagnostics differ from rendered pose');
        document.getElementById('experience-show-broom').click();
        ensure(broom.show(), 'Canonical broom action failed'); broom.update();
        ensure(new THREE.Vector3(...broom.snapshot().baseWorld).distanceTo(broomBase) < 1e-6, 'Broom button differs from canonical action');
        broom.reset();

        document.getElementById('experience-floor-hole').click();
        const hole = floorHole.snapshot(); ensure(hole.open, `Mapped floor failed: ${hole.status}`);
        const attached = window.__debug.hallwayCut.snapshot();
        ensure(attached.visible && !attached.error, 'Mapped floor did not reveal its connected hallway');
        ensure(hole.worldCorners.every(corner => attached.mouthWorld.some(point => new THREE.Vector3(...point)
          .distanceTo(new THREE.Vector3(...corner)) < 1e-7)), 'Calibrated hallway mouth differs from the hole corners');
        for (let i = 0; i < 4; i++) {
          const corner = new THREE.Vector3(...hole.worldCorners[i]).applyMatrix4(frame.clone().invert());
          near(corner.z, i < 2 ? hole.startZ : hole.endZ, 'VR floor used legacy absolute world Z'); near(corner.y, 0, 'VR floor height');
        }
        const clipFrame = splats.viewer.splatMesh.material.uniforms.uFloorHoleWorldToRoute.value;
        clipFrame.elements.forEach((v, i) => near(v, frame.clone().invert().elements[i], 'Floor shader ignored the calibrated hallway frame'));
        document.getElementById('experience-floor-hole').click();
        ensure(floorHole.show(), 'Canonical floor action failed');
        floorHole.snapshot().worldCorners.forEach((p, i) => ensure(new THREE.Vector3(...p).distanceTo(new THREE.Vector3(...hole.worldCorners[i])) < 1e-6,
          'Floor button differs from canonical action'));
        // Read actual floor fragments with a rotated/translated camera, not
        // just the shader matrix. Legacy world-Z clipping fails this probe.
        const holeMidpoint = (hole.startZ + hole.endZ) / 2;
        camera.position.copy(new THREE.Vector3(0, 1.6, hole.endZ + 3).applyMatrix4(frame));
        controls.target.copy(new THREE.Vector3(0, .15, holeMidpoint).applyMatrix4(frame)); controls.update(); camera.updateMatrixWorld(true);
        window.__debug.scene.updateMatrixWorld(true);
        const viewer = splats.viewer;
        const settle = async () => {
          let timer;
          try { await Promise.race([viewer.sortPromise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Mapped floor sort timed out.')), 30000);
          })]); } finally { clearTimeout(timer); }
        };
        viewer.update(renderer, camera); await settle(); viewer.splatMesh.updateTransforms();
        await viewer.runSplatSort(true, true); await settle();
        const probe = () => {
          viewer.update(renderer, camera); renderer.render(window.__debug.scene, camera);
          const gl = renderer.getContext(), bytes = new Uint8Array(4);
          const point = new THREE.Vector3(0, 0, holeMidpoint).applyMatrix4(frame).project(camera);
          gl.readPixels(Math.floor((point.x + 1) * gl.drawingBufferWidth / 2), Math.floor((point.y + 1) * gl.drawingBufferHeight / 2),
            1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          return Array.from(bytes.slice(0, 3));
        };
        const cut = splats.getSplatScene(window.__debug.hallwayCut.snapshot().sceneIndex);
        const connectedPixel = probe();
        const cutVisible = cut.visible; cut.visible = false;
        const openPixel = probe(); cut.visible = cutVisible;
        floorHole.close(); const closedPixel = probe();
        ensure(openPixel.every(v => v >= 253) && closedPixel.some(v => v > 25) && closedPixel.some(v => v < 230),
          `Mapped floor shader does not cut/restore the actual floor: ${openPixel}/${closedPixel}`);
        ensure(connectedPixel.some(v => v > 25) && connectedPixel.some(v => v < 230),
          `The calibrated cutout is absent through the aperture: ${connectedPixel}`);
        floorHole.close(); wall.reset();
        // A deliberate authoring edit is shared too, rather than secretly
        // ignored by the scheduled reveal while the button uses another pose.
        player(farPlayerZ);
        const authoredPoint = new THREE.Vector3(.15, .05, -5.5).applyMatrix4(frame);
        ensure(wall.setPosition(authoredPoint.toArray()), 'Explicit wall authoring failed');
        for (const endpoint of ['start', 'end']) {
          ensure(wall.inspectEndpoint(endpoint), 'Explicit wall endpoint inspection failed');
          ensure(new THREE.Vector3(...wall.snapshot().positionWorld).distanceTo(authoredPoint) < 1e-6,
            'Endpoint inspection changed an authored XYZ coordinate');
        }
        wall.reset(); look(false);
        document.getElementById('experience-show-wall').click(); advance(.1);
        ensure(new THREE.Vector3(...wall.snapshot().positionWorld).distanceTo(authoredPoint) < 1e-6, 'Button ignored explicit authoring');
        wall.reset(); look(false); ensure(wall.runSequence(), 'Canonical inspected sequence failed'); advance(.1);
        ensure(new THREE.Vector3(...wall.snapshot().positionWorld).distanceTo(authoredPoint) < 1e-6, 'Canonical sequence ignored explicit authoring');
        ensure(!wall.snapshot().approach.active, 'Authored zero-length sequence unexpectedly moved');
        wall.reset(); wall.useFittedPosition();
        results.push({ yaw, entryWorld: entry.applyMatrix4(frame).toArray(), finalWorld,
          occupiedEntryBlocked: true, playerPauseRouteZ: -7.8, renderedPoseVerified: true,
          gazeUsesCalibratedFrame: true, firstLookRequired: false, instantUnseenReveal: true,
          lookBackStopSeconds: .7, approachSpeed: 1, endpointLookSeconds: 5, firstBoxEndpointRouteZ: expectedEnd,
          manualWallMatchesCanonicalRoute: true, broomRouteZ: broomRoute.z, floorCornersUseSameFrame: true, buttonApiParity: true,
          manualEntryWaitsAndResumes: true, manualPendingCanCancel: true,
          explicitAuthoringMatchesCanonicalSequence: true, openFloorPixel: openPixel, closedFloorPixel: closedPixel });
      }
    } finally {
      renderer.xr.isPresenting = false;
      experience.prepareForCalibration();
      splats.position.copy(savedPosition); splats.quaternion.copy(savedRotation); splats.updateMatrixWorld(true);
      wall.setRouteFrame(); wall.useFittedPosition();
      experience.update = update; wall.update = wallUpdate;
      camera.position.copy(cameraPosition); controls.target.copy(target); controls.update();
      controls.enableDamping = damping;
    }
    return results;
  });
  assert.equal(result.length, 3);
  return { syntheticCalibrations: result, realXrSession: false };
}
