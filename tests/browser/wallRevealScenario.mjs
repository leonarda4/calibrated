import assert from 'node:assert/strict';
import path from 'node:path';

async function capture(page) {
  return page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { WALL_SECTION } = await import('/src/viewer/wallSectionConfig.ts');
    const { renderer, scene, camera, controls, splats, wallBlocker: wall, floorHole } = window.__debug;
    const state = wall.snapshot();
    const endpoint = state.routeEndpoints.end;
    const route = new THREE.Matrix4().fromArray(state.routeToWorld);
    const endRoute = new THREE.Vector3(...endpoint).applyMatrix4(route.clone().invert());
    camera.position.copy(new THREE.Vector3(endRoute.x, 1.55, endRoute.z + 3.8).applyMatrix4(route));
    controls.target.copy(new THREE.Vector3(endRoute.x, 1.1, endRoute.z).applyMatrix4(route));
    controls.update(); camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
    const settled = async promise => {
      let timer;
      try {
        await Promise.race([promise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Wall-reveal depth sort exceeded 45 seconds.')), 45000);
        })]);
      } finally { clearTimeout(timer); }
    };
    splats.viewer.update(renderer, camera);
    await settled(splats.viewer.sortPromise);
    splats.viewer.splatMesh.updateTransforms();
    await settled(splats.viewer.runSplatSort(true, true));
    await settled(splats.viewer.sortPromise);
    renderer.render(scene, camera);
    const gl = renderer.getContext(), point = new THREE.Vector3(...endpoint).add(new THREE.Vector3(0, 1.3, 0)).project(camera);
    const width = 120, height = 160;
    const x = Math.max(0, Math.min(gl.drawingBufferWidth - width, Math.round((point.x + 1) * gl.drawingBufferWidth / 2 - width / 2)));
    const y = Math.max(0, Math.min(gl.drawingBufferHeight - height, Math.round((point.y + 1) * gl.drawingBufferHeight / 2 - height / 2)));
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const floor = floorHole.snapshot();
    const middle = new THREE.Vector3(endRoute.x, 0, (floor.startZ + floor.endZ) / 2).applyMatrix4(route).project(camera);
    const floorPixel = new Uint8Array(4);
    const cut = splats.getSplatScene(window.__debug.hallwayCut.snapshot().sceneIndex), cutVisible = cut.visible;
    cut.visible = false; renderer.render(scene,camera);
    gl.readPixels(Math.floor((middle.x + 1) * gl.drawingBufferWidth / 2),
      Math.floor((middle.y + 1) * gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, floorPixel);
    cut.visible = cutVisible; renderer.render(scene,camera);
    const object = splats.getSplatScene(state.sceneIndex); object.updateMatrix();
    const matrix = new THREE.Matrix4().multiplyMatrices(splats.matrixWorld, object.matrix);
    const slabRouteZ = [];
    for (const x of [-WALL_SECTION.width / 2, WALL_SECTION.width / 2]) {
      for (const z of [-WALL_SECTION.depth / 2, WALL_SECTION.depth / 2]) {
        slabRouteZ.push(new THREE.Vector3(x, 0, z).applyMatrix4(matrix).applyMatrix4(route.clone().invert()).z);
      }
    }
    return { state, floor, pixels: [...pixels], floorPixel: [...floorPixel.slice(0, 3)],
      slabRouteZ, matrix: matrix.toArray() };
  });
}

/** Actual operator endpoints, final gaze/glitch and shared calibrated frame. */
export async function runWallRevealScenario(page, output) {
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const [{ createHallwaySections }, { getSourceCenters }, { createHallwayPlacementFrame }] = await Promise.all([
      import('/src/experience/hallwaySection.ts'), import('/src/viewer/splatViewer.ts'), import('/src/viewer/wallRouteFrame.ts'),
    ]);
    const { experience, wallBlocker: wall, floorHole, splats, camera, controls } = window.__debug;
    const mesh = splats.viewer.splatMesh;
    const saved = { experienceUpdate: experience.update, wallUpdate: wall.update, floorUpdate: floorHole.update,
      camera: camera.position.clone(), target: controls.target.clone(), damping: controls.enableDamping,
      position: splats.position.clone(), quaternion: splats.quaternion.clone(), scale: splats.scale.clone(),
      route: new THREE.Matrix4().fromArray(wall.snapshot().routeToWorld),
      resources: { material: mesh.material, geometry: mesh.geometry, textures: mesh.splatDataTextures,
        worker: splats.viewer.sortWorker, source: mesh.splatDataTextures.baseData.centers } };
    experience.update = () => {}; wall.update = () => {}; floorHole.update = () => {}; controls.enableDamping = false;
    experience.prepareForCalibration(); experience.setCalibrationActive(false);
    const ensure = (ok, message) => { if (!ok) throw new Error(message); };
    const near = (a, b, label) => ensure(Math.abs(a - b) < 1e-6, `${label}: ${a} versus ${b}`);
    const routePoint = point => new THREE.Vector3(...point).applyMatrix4(new THREE.Matrix4().fromArray(wall.snapshot().routeToWorld).invert());
    const player = (looking = true) => {
      const matrix = new THREE.Matrix4().fromArray(wall.snapshot().routeToWorld);
      camera.position.copy(new THREE.Vector3(0, 1.7, 6).applyMatrix4(matrix));
      const base = wall.snapshot().baseWorld ?? wall.snapshot().routeEndpoints?.start;
      const target = base ? new THREE.Vector3(...base).add(new THREE.Vector3(0, 1.3, 0))
        : new THREE.Vector3(0, 1.3, -8).applyMatrix4(matrix);
      controls.target.copy(target);
      if (!looking) controls.target.multiplyScalar(-1).addScaledVector(camera.position, 2);
      controls.update(); camera.updateMatrixWorld(true); saved.experienceUpdate(0);
    };
    const advance = seconds => {
      for (let remaining = seconds; remaining > 1e-9;) {
        const dt = Math.min(.05, remaining); saved.experienceUpdate(dt); saved.wallUpdate(dt); saved.floorUpdate(dt); remaining -= dt;
      }
    };
    const checkEndpointCenter = () => {
      const state = wall.snapshot(), endpoint = routePoint(state.routeEndpoints.end);
      const placement = createHallwayPlacementFrame(splats); placement.set(new THREE.Matrix4().fromArray(state.routeToWorld));
      const fitted = createHallwaySections({ scanRoot: placement.root, getCenters: () => getSourceCenters(splats) }).at(endpoint.z);
      ensure(fitted.ok, 'Final station lacks independently supported opposing walls');
      near(endpoint.x, fitted.centerWorld[0], 'Frozen endpoint is not exactly centred between fitted walls');
      const signedDistance = plane => plane.normal.reduce((sum, value, axis) => sum + value * (endpoint.getComponent(axis) - plane.point[axis]), 0);
      const left = signedDistance(fitted.wallPlanes.left), right = signedDistance(fitted.wallPlanes.right);
      near(left, right, 'Endpoint has unequal normalized wall distances');
      return { route: endpoint.toArray(), leftWallDistance: left, rightWallDistance: right };
    };
    const runToEnd = () => {
      player(false); let elapsed = 0;
      while (wall.snapshot().approach.state !== 'complete' && elapsed < 40) { advance(.05); elapsed += .05; }
      ensure(wall.snapshot().approach.state === 'complete', 'Unseen wall did not reach its first-box endpoint');
      ensure(wall.snapshot().visible && wall.snapshot().arrival.phase === 'idle' && floorHole.snapshot().open,
        'The final wall must conceal its prepared opening before disappearance');
    };
    const revealHole = () => {
      player(true); advance(4.95);
      ensure(floorHole.snapshot().open && wall.snapshot().arrival.phase === 'idle', 'Final gaze triggered before five seconds');
      advance(.05);
      ensure(wall.snapshot().visible && wall.snapshot().arrival.phase === 'glitching' && floorHole.snapshot().open,
        'Five-second final gaze did not retain the prepared hole before the glitch');
      near(wall.snapshot().arrival.progress, 0, 'First glitch frame must retain the standing pose');
    };
    window.__wallReveal = { saved, ensure, near, player, advance, routePoint, checkEndpointCenter, runToEnd, revealHole };
    player();
  });
  try {
    const inspections = [];
    for (const endpoint of ['start', 'end']) {
      await page.locator(`#experience-wall-inspect-${endpoint}`).click();
      const inspected = await page.evaluate(async endpoint => {
        const THREE = await import('/node_modules/.vite/deps/three.js');
        const { wallBlocker: wall, floorHole, splats, renderer, scene, camera, controls } = window.__debug, t = window.__wallReveal;
        const before = wall.snapshot();
        t.ensure(before.visible && !before.approach.active && !floorHole.snapshot().open, `${endpoint} inspection did not hold a static wall`);
        before.positionWorld.forEach((v, i) => t.near(v, before.routeEndpoints[endpoint][i], 'Actual inspected endpoint'));
        const object = splats.getSplatScene(before.sceneIndex); object.updateMatrix();
        const actualBase = new THREE.Vector3().applyMatrix4(new THREE.Matrix4().multiplyMatrices(splats.matrixWorld, object.matrix));
        before.positionWorld.forEach((v, i) => t.near(v, actualBase.getComponent(i), 'World readout differs from rendered wall'));
        const endCenter = t.checkEndpointCenter(); t.advance(6);
        wall.snapshot().positionWorld.forEach((v, i) => t.near(v, before.positionWorld[i], 'Endpoint inspection drifted'));
        t.ensure(!floorHole.snapshot().open, 'Static inspection must not run the five-second gameplay dwell');
        t.near(wall.snapshot().alignmentQueries, before.alignmentQueries, 'Inspection refitted its locked route');
        const matrix = new THREE.Matrix4().fromArray(before.routeToWorld), route = t.routePoint(before.positionWorld);
        camera.position.copy(new THREE.Vector3(route.x, 1.55, route.z + 3.8).applyMatrix4(matrix));
        controls.target.copy(new THREE.Vector3(route.x, 1.2, route.z).applyMatrix4(matrix)); controls.update();
        camera.updateMatrixWorld(true); scene.updateMatrixWorld(true); splats.viewer.update(renderer, camera); await splats.viewer.sortPromise;
        splats.viewer.splatMesh.updateTransforms(); await splats.viewer.runSplatSort(true, true); await splats.viewer.sortPromise; renderer.render(scene, camera);
        return { endpoint, positionWorld: before.positionWorld, routeEndpoints: before.routeEndpoints, width: before.width,
          endpointCenter: endCenter, held: true, noFloorCue: true };
      }, endpoint);
      inspections.push(inspected); await page.screenshot({ path: path.join(output, `wall-route-${endpoint}.png`), fullPage: true });
    }
    await page.evaluate(() => window.__wallReveal.player(true));
    await page.locator('#experience-wall-run').click();
    const checkedRouteRun = await page.evaluate(inspected => {
      const { wallBlocker: wall, floorHole } = window.__debug, t = window.__wallReveal, state = wall.snapshot();
      t.ensure(!state.visible && state.gameplayCue === 'waitingLookAway', 'Run bypassed the unseen reveal rule');
      for (const endpoint of ['start', 'end']) state.routeEndpoints[endpoint].forEach((v, i) =>
        t.near(v, inspected.routeEndpoints[endpoint][i], 'Run changed its checked route'));
      t.runToEnd(); const arrived = wall.snapshot();
      return { routeEndpoints: arrived.routeEndpoints, endpointCenter: t.checkEndpointCenter(),
        preparedCorners: floorHole.snapshot().worldCorners, concealedBeforePassage: floorHole.snapshot().open };
    }, inspections[1]);
    const concealed = await capture(page);
    assert.equal(concealed.state.arrival.phase, 'idle'); assert.equal(concealed.state.visible, true);
    assert.equal(concealed.floor.open, true, 'The opening must already exist before passage or final gaze');
    assert.ok(concealed.floorPixel.some(value => value > 25) && concealed.floorPixel.some(value => value < 230),
      'The intact wall must cover the projected floor opening with visible contrast against the white void');
    await page.screenshot({ path: path.join(output, 'wall-hole-concealed.png'), fullPage: true });
    const finalGaze = await page.evaluate(() => {
      const { wallBlocker: wall, floorHole } = window.__debug, t = window.__wallReveal;
      const preparedCorners = floorHole.snapshot().worldCorners;
      t.player(true); t.advance(2); t.ensure(wall.snapshot().arrival.phase === 'idle', 'Old two-second dwell still removes the wall');
      t.player(false); t.advance(.1); t.player(true); t.advance(4.95);
      t.ensure(wall.snapshot().arrival.phase === 'idle', 'Interrupted final looks accumulated'); t.advance(.05);
      t.ensure(floorHole.snapshot().open && wall.snapshot().arrival.phase === 'glitching', 'Completed five-second final dwell did not glitch');
      const hole = floorHole.snapshot(), endCenter = t.checkEndpointCenter();
      t.ensure(JSON.stringify(hole.worldCorners) === JSON.stringify(preparedCorners), 'Final gaze moved the prepared hole');
      t.near(endCenter.route[2] - hole.endZ, 1, 'Hole must begin1m beyond the final wall');
      t.near(hole.endZ - hole.startZ, 2.6, 'Fitted hole changed length');
      return { endpointCenter: endCenter, finalLookSeconds: 5,
        lookAwayRestartsDwell: true, unseenArrivalHolds: true, holeStartZ: hole.startZ, holeEndZ: hole.endZ };
    });
    const before = await capture(page);
    assert.equal(before.floor.open, true);
    assert.ok(Math.abs((Math.min(...before.slabRouteZ) + Math.max(...before.slabRouteZ)) / 2 - before.floor.endZ - 1) < 1e-6,
      'The new opening must begin1m past the actual rendered wall centre');
    assert.ok(Math.min(...before.slabRouteZ) > before.floor.endZ, 'The entire thick slab must remain beyond the opening');
    await page.screenshot({ path: path.join(output, 'wall-arrival-before.png'), fullPage: true });
    await page.evaluate(() => window.__wallReveal.advance(.275)); const during = await capture(page);
    assert.equal(during.state.arrival.phase, 'glitching'); assert.deepEqual(during.matrix, before.matrix);
    const changed = before.pixels.reduce((sum, value, i) => sum + (i % 4 !== 3 && Math.abs(value - during.pixels[i]) > 10 ? 1 : 0), 0);
    assert.ok(changed > 100, `Glitch did not change rendered wall pixels: ${changed}`);
    await page.screenshot({ path: path.join(output, 'wall-arrival-during.png'), fullPage: true });
    await page.evaluate(() => window.__wallReveal.advance(.4)); const after = await capture(page);
    assert.equal(after.state.arrival.phase, 'hidden'); assert.equal(after.state.visible, false); assert.equal(after.floor.open, true);
    assert.ok(after.floorPixel.every(value => value >= 253)); assert.deepEqual(after.matrix, before.matrix);
    await page.screenshot({ path: path.join(output, 'wall-arrival-after.png'), fullPage: true });
    await page.locator('#experience-reset').click();
    await page.evaluate(() => {
      const { wallBlocker: wall, floorHole } = window.__debug, t = window.__wallReveal;
      t.advance(5); t.ensure(!wall.snapshot().visible && !floorHole.snapshot().open, 'Reset revived the sequence');
      t.player(false); t.ensure(wall.runSequence(), 'Manual restart failed'); t.runToEnd(); t.revealHole();
    });
    await page.locator('#experience-wall-settings').evaluate(element => { element.open = true; });
    await page.locator('#experience-wall-stop').click();
    await page.evaluate(() => {
      const { wallBlocker: wall, floorHole } = window.__debug, t = window.__wallReveal;
      const stopped = wall.snapshot(); t.advance(1);
      t.ensure(stopped.visible && wall.snapshot().visible && wall.snapshot().arrival.phase === 'idle' && !floorHole.snapshot().open,
        'Stop motion did not retain the standing wall and cancel its hole/glitch');
      wall.reset(); wall.useFittedPosition(); t.player(false); t.ensure(wall.runSequence(), 'Global-STOP fixture failed'); t.runToEnd(); t.revealHole();
    });
    await page.locator('#experience-stop').click();
    await page.evaluate(() => {
      const { wallBlocker: wall, floorHole } = window.__debug, t = window.__wallReveal; t.advance(5);
      t.ensure(!wall.snapshot().visible && !floorHole.snapshot().open && wall.snapshot().arrival.phase === 'idle', 'STOP revived an old glitch/hole');
    });
    await page.locator('#experience-reset').click();
    const failedHoleRetainsWall = await page.evaluate(() => {
      const { wallBlocker: wall, floorHole, splats } = window.__debug, t = window.__wallReveal;
      const data = splats.viewer.splatMesh.splatDataTextures.baseData, original = data.centers;
      try {
        t.player(false); t.ensure(wall.runSequence(), 'Floor failure fixture could not start');
        // The path is already fitted, but hidden floor preparation has not
        // taken its first visible update yet. Fail that preparation boundary.
        data.centers = new Float32Array([0, 0, 0]); t.advance(20); t.player(true); t.advance(6);
        t.ensure(wall.snapshot().visible && wall.snapshot().arrival.phase === 'idle' && !floorHole.snapshot().open,
          'Failed floor placement hid/glitched the wall');
        t.advance(6); t.ensure(wall.snapshot().visible && !floorHole.snapshot().open, 'Failed floor queued a late disappearance');
      } finally { data.centers = original; wall.reset(); floorHole.reset(); }
      return true;
    });
    const mapped = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { ACTIVE_SCAN } = await import('/src/viewer/scanAsset.ts');
      const { scanOriginForStart } = await import('/src/viewer/scanPlacement.ts');
      const { experience, renderer, splats, wallBlocker: wall, floorHole } = window.__debug, t = window.__wallReveal, results = [];
      const authored = new THREE.Matrix4().compose(new THREE.Vector3(...scanOriginForStart(ACTIVE_SCAN.startPoint, ACTIVE_SCAN.rotation)),
        new THREE.Quaternion(...ACTIVE_SCAN.rotation), new THREE.Vector3(1, 1, 1));
      for (const yaw of [Math.PI / 2, -.63]) {
        experience.prepareForCalibration(); experience.setCalibrationActive(false);
        const frame = new THREE.Matrix4().makeRotationY(yaw).setPosition(3, 0, -4);
        frame.clone().multiply(authored).decompose(splats.position, splats.quaternion, splats.scale); splats.updateMatrixWorld(true);
        renderer.xr.isPresenting = true; try { experience.calibrated(); } finally { renderer.xr.isPresenting = false; }
        experience.scenario.cancel('Synthetic arrival test owns the clock.'); t.player();
        for (const endpoint of ['start', 'end']) {
          const button = document.getElementById(`experience-wall-inspect-${endpoint}`), deadline = performance.now() + 3000;
          while (button.disabled && performance.now() < deadline) await new Promise(requestAnimationFrame);
          t.ensure(!button.disabled, 'Mapped endpoint button stayed disabled'); button.click();
          const state = wall.snapshot(); t.ensure(state.visible && !state.approach.active, 'Mapped inspection did not hold a visible wall');
          state.positionWorld.forEach((v, i) => t.near(v, state.routeEndpoints[endpoint][i], 'Mapped actual endpoint'));
        }
        wall.reset(); floorHole.reset(); t.player(false); t.ensure(wall.runSequence(), 'Mapped route could not start'); t.runToEnd(); t.revealHole();
        const arrival = wall.snapshot(), hole = floorHole.snapshot(), center = t.checkEndpointCenter();
        t.near(t.routePoint(arrival.positionWorld).z, center.route[2], 'Mapped final station');
        t.near(center.route[2] - hole.endZ, 1, 'Mapped hole lost its1m gap'); t.near(hole.endZ - hole.startZ, 2.6, 'Mapped hole length');
        t.advance(.75); t.ensure(!wall.snapshot().visible && floorHole.snapshot().open, 'Mapped glitch did not leave the opening');
        results.push({ yaw, endpoint: arrival.positionWorld, endpointCenter: center, holeWorldCorners: hole.worldCorners });
      }
      const mesh = splats.viewer.splatMesh, r = t.saved.resources;
      t.ensure(mesh.material === r.material && mesh.geometry === r.geometry && mesh.splatDataTextures === r.textures &&
        splats.viewer.sortWorker === r.worker && mesh.splatDataTextures.baseData.centers === r.source, 'Sequence replaced shared resources/source');
      return results;
    });
    return { inspections, checkedRouteRun: { ...checkedRouteRun, ...finalGaze }, changedColorChannels: changed,
      holeConcealedBeforePassage: true, concealedFloorPixel: concealed.floorPixel,
      staticGlitchPose: true, opensBeforeGlitch: true,
      holeRemainsAfterGlitch: true, resetCancels: true, stopCancels: true, stopMotionCancelsArrival: true,
      failedHoleRetainsWall, resourcesStable: true, mappedSyntheticCalibration: mapped };
  } finally {
    await page.evaluate(() => {
      const t = window.__wallReveal; if (!t) return;
      const { experience, wallBlocker: wall, floorHole, splats, camera, controls } = window.__debug;
      experience.prepareForCalibration(); experience.setCalibrationActive(false);
      splats.position.copy(t.saved.position); splats.quaternion.copy(t.saved.quaternion); splats.scale.copy(t.saved.scale); splats.updateMatrixWorld(true);
      wall.setRouteFrame(t.saved.route); floorHole.reset();
      experience.update = t.saved.experienceUpdate; wall.update = t.saved.wallUpdate; floorHole.update = t.saved.floorUpdate;
      camera.position.copy(t.saved.camera); controls.target.copy(t.saved.target); controls.update(); controls.enableDamping = t.saved.damping;
      delete window.__wallReveal;
    });
  }
}

/** Optional original-scan evidence; preserves the caller's installation state. */
export async function capturePrivateWallReveal(page, output) {
  const original = await page.evaluate(() => {
    const { camera, controls } = window.__debug;
    return { camera: camera.position.toArray(), target: controls.target.toArray(), damping: controls.enableDamping };
  });
  try {
    await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { wallBlocker: wall, floorHole, camera, controls, experience } = window.__debug;
      wall.arrivalPlacement();
      const state = wall.snapshot(), frame = new THREE.Matrix4().fromArray(state.routeToWorld);
      if (!state.routeEndpoints) throw new Error(`Original-scan wall route is unavailable: ${state.status}`);
      const endpoint = new THREE.Vector3(...state.routeEndpoints.end).applyMatrix4(frame.clone().invert());
      controls.enableDamping = false;
      camera.position.copy(new THREE.Vector3(endpoint.x, 1.55, endpoint.z + 3.8).applyMatrix4(frame));
      controls.target.copy(new THREE.Vector3(endpoint.x, 1.1, endpoint.z).applyMatrix4(frame));
      controls.update(); camera.updateMatrixWorld(true);
      experience.update(0); // Publish this current, clear desktop player position.
      const player = looking => {
        camera.position.copy(new THREE.Vector3(endpoint.x, 1.55, endpoint.z + 3.8).applyMatrix4(frame));
        controls.target.copy(new THREE.Vector3(endpoint.x, 1.1, endpoint.z + (looking ? 0 : 7.6)).applyMatrix4(frame));
        controls.update(); camera.updateMatrixWorld(true); experience.update(0);
      };
      const advance = seconds => {
        for (let remaining = seconds; remaining > 1e-9;) {
          const dt = Math.min(.05, remaining);
          experience.update(dt); wall.update(dt); floorHole.update(dt); remaining -= dt;
        }
      };
      window.__privateWallRevealClock = { player, advance, runToEnd() {
        player(false);
        let elapsed = 0;
        while (wall.snapshot().approach.state !== 'complete' && elapsed < 40) {
          if (wall.snapshot().gaze.stage === 'stealth') player(false);
          advance(.05); elapsed += .05;
        }
        if (wall.snapshot().approach.state !== 'complete' || !floorHole.snapshot().open || wall.snapshot().arrival.phase !== 'idle') {
          throw new Error('Original wall failed to conceal its prepared opening before passage.');
        }
        player(true); advance(4.95);
        if (wall.snapshot().arrival.phase !== 'idle') throw new Error('Original wall glitched before five seconds of gaze.');
        advance(.05);
      } };
    });
    const inspected = {};
    for (const endpoint of ['start', 'end']) {
      await page.locator(`#experience-wall-inspect-${endpoint}`).click({ timeout: 60000 });
      const state = await page.evaluate(() => window.__debug.wallBlocker.snapshot());
      assert.equal(state.visible, true, `Original-scan ${endpoint} inspection: ${state.status}`);
      assert.equal(state.approach.active, false);
      assert.ok(state.positionWorld && state.routeEndpoints);
      state.positionWorld.forEach((v, i) => assert.ok(Math.abs(v - state.routeEndpoints[endpoint][i]) < 1e-6));
      inspected[endpoint] = state.positionWorld;
    }
    await page.locator('#experience-wall-run').click({ timeout: 60000 });
    await page.evaluate(() => window.__privateWallRevealClock.runToEnd());
    const before = await capture(page);
    assert.equal(before.state.visible, true, before.state.status);
    assert.equal(before.state.arrival.phase, 'glitching'); assert.equal(before.state.arrival.progress, 0);
    assert.equal(before.floor.open, true, before.floor.status);
    assert.ok(Math.abs((Math.min(...before.slabRouteZ) + Math.max(...before.slabRouteZ)) / 2 - before.floor.endZ - 1) < 1e-6,
      'The original-scan opening must begin1m beyond the rendered wall centre.');
    assert.ok(Math.min(...before.slabRouteZ) > before.floor.endZ, 'The entire original slab must clear the opening.');
    before.state.positionWorld.forEach((v, i) => assert.ok(Math.abs(v - inspected.end[i]) < 1e-6));
    await page.screenshot({ path: path.join(output, 'private-wall-arrival-before.png'), fullPage: true, timeout: 60000 });
    await page.evaluate(() => window.__privateWallRevealClock.advance(.275));
    const during = await capture(page);
    assert.equal(during.state.arrival.phase, 'glitching');
    assert.deepEqual(during.matrix, before.matrix, 'Original-scan glitch moved the standing wall');
    assert.equal(during.floor.open, true);
    const changed = before.pixels.reduce((sum, value, i) => sum +
      (i % 4 !== 3 && Math.abs(value - during.pixels[i]) > 10 ? 1 : 0), 0);
    assert.ok(changed > 100, `Original-scan wall glitch did not change rendered pixels: ${changed}`);
    await page.screenshot({ path: path.join(output, 'private-wall-arrival-during.png'), fullPage: true, timeout: 60000 });
    await page.evaluate(() => window.__privateWallRevealClock.advance(.4));
    const after = await capture(page);
    assert.equal(after.state.visible, false); assert.equal(after.state.arrival.phase, 'hidden');
    assert.equal(after.floor.open, true);
    assert.deepEqual(after.matrix, before.matrix, 'Original-scan disappearance changed the endpoint pose');
    await page.screenshot({ path: path.join(output, 'private-wall-arrival-after.png'), fullPage: true, timeout: 60000 });
    return { inspected, positionWorld: before.state.positionWorld, width: before.state.width,
      holeStartZ: before.floor.startZ, holeEndZ: before.floor.endZ,
      wholeSlabGap: Math.min(...before.slabRouteZ) - before.floor.endZ,
      changedColorChannels: changed, fixedWallPose: true, opensWhileWallVisible: true, holeRemainsAfterGlitch: true };
  } finally {
    await page.evaluate(original => {
      const { wallBlocker: wall, floorHole, camera, controls, experience } = window.__debug;
      wall.reset(); floorHole.close();
      camera.position.fromArray(original.camera); controls.target.fromArray(original.target); controls.update();
      controls.enableDamping = original.damping;
      experience.update(0);
      delete window.__privateWallRevealClock;
    }, original);
  }
}
