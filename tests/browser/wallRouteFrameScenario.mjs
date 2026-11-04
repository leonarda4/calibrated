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
    const cameraPosition = camera.position.clone(), target = controls.target.clone();
    const savedPosition = splats.position.clone(), savedRotation = splats.quaternion.clone();
    const near = (a, b, message) => { if (Math.abs(a - b) > 1e-6) throw new Error(`${message}: ${a} vs ${b}`); };
    const ensure = (ok, message) => { if (!ok) throw new Error(message); };
    experience.update = () => {}; wall.update = () => {};
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
        const player = z => {
          camera.position.copy(new THREE.Vector3(0, 1.7, z).applyMatrix4(frame));
          update(0); // Publish actual world player position through main.ts.
        };
        player(-8);
        wall.turnCompleted(); wallUpdate(0); wallUpdate(2);
        ensure(!wall.snapshot().visible && wall.snapshot().gameplayCue === 'waitingPlayer', 'Mapped occupied entry was not blocked');
        player(2); wallUpdate(.01);
        ensure(wall.snapshot().motion === 'entering', `Mapped wall did not enter: ${wall.snapshot().status}`);
        const entry = new THREE.Vector3(...wall.snapshot().baseWorld).applyMatrix4(frame.clone().invert());
        near(entry.z, -8, 'Mapped entry side'); near(entry.y, 0, 'Mapped floor');
        wallUpdate(1.3);
        player(-6.8); wallUpdate(10);
        near(wall.snapshot().approach.z, -7.8, 'Mapped physical player clearance');
        ensure(wall.snapshot().approach.waitingFor === 'player', 'Mapped wall missed the player');
        const scene = splats.getSplatScene(wall.snapshot().sceneIndex);
        const rendered = new THREE.Matrix4().multiplyMatrices(splats.matrixWorld, scene.matrix);
        const renderedBase = new THREE.Vector3().applyMatrix4(rendered);
        ensure(renderedBase.distanceTo(new THREE.Vector3(...wall.snapshot().positionWorld)) < 1e-6,
          'Actual rendered pose differs from world diagnostics');
        player(2); wallUpdate(30);
        near(wall.snapshot().approach.z, -2, 'Mapped endpoint');
        const final = new THREE.Vector3(...wall.snapshot().positionWorld).applyMatrix4(frame.clone().invert());
        near(final.z, -2, 'Actual mapped endpoint');
        const autoWidth = wall.snapshot().width;
        document.getElementById('experience-show-wall').click(); wallUpdate(1.25);
        ensure(wall.snapshot().placementSource === 'fitted', 'Hide wrote a legacy manual override.');
        document.getElementById('experience-show-wall').click();
        near(wall.snapshot().approach.z, -8, 'VR manual button starts at the wrong station');
        near(wall.snapshot().width, autoWidth, 'VR button and scheduled width differ');
        wallUpdate(1.25); wallUpdate(2);
        near(wall.snapshot().approach.z, -7.4, 'VR manual button has different movement');

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
        for (let i = 0; i < 4; i++) {
          const corner = new THREE.Vector3(...hole.worldCorners[i]).applyMatrix4(frame.clone().invert());
          near(corner.z, i < 2 ? 3 : 5.6, 'VR floor used legacy absolute world Z'); near(corner.y, 0, 'VR floor height');
        }
        const clipFrame = splats.viewer.splatMesh.material.uniforms.uFloorHoleWorldToRoute.value;
        clipFrame.elements.forEach((v, i) => near(v, frame.clone().invert().elements[i], 'Floor shader ignored the calibrated hallway frame'));
        document.getElementById('experience-floor-hole').click();
        ensure(floorHole.show(), 'Canonical floor action failed');
        floorHole.snapshot().worldCorners.forEach((p, i) => ensure(new THREE.Vector3(...p).distanceTo(new THREE.Vector3(...hole.worldCorners[i])) < 1e-6,
          'Floor button differs from canonical action'));
        floorHole.close(); wall.reset();
        results.push({ yaw, entryWorld: entry.applyMatrix4(frame).toArray(), finalWorld: wall.snapshot().positionWorld,
          occupiedEntryBlocked: true, playerPauseRouteZ: -7.8, renderedPoseVerified: true,
          manualWallMatchesScheduled: true, broomRouteZ: broomRoute.z, floorCornersUseSameFrame: true, buttonApiParity: true });
      }
    } finally {
      renderer.xr.isPresenting = false;
      experience.prepareForCalibration();
      splats.position.copy(savedPosition); splats.quaternion.copy(savedRotation); splats.updateMatrixWorld(true);
      wall.setRouteFrame(); wall.useFittedPosition();
      experience.update = update; wall.update = wallUpdate;
      camera.position.copy(cameraPosition); controls.target.copy(target); controls.update();
    }
    return results;
  });
  assert.equal(result.length, 3);
  return { syntheticCalibrations: result, realXrSession: false };
}
