import assert from 'node:assert/strict';
import path from 'node:path';

async function pixels(page, eyeX = 0) {
  return page.evaluate(async eyeX => {
    const { Vector3 } = await import('/node_modules/.vite/deps/three.js');
    const { FLOOR_HOLE } = await import('/src/viewer/floorHole.ts');
    const { renderer, scene, camera, controls, splats, floorHole } = window.__debug;
    const state = floorHole.snapshot();
    const startZ = state.open ? state.startZ : FLOOR_HOLE.startZ;
    const endZ = state.open ? state.endZ : FLOOR_HOLE.startZ + FLOOR_HOLE.length;
    const middleZ = (startZ + endZ) / 2;
    const settled = async promise => {
      let timer;
      try {
        await Promise.race([promise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Floor-opening depth sort exceeded 45 seconds.')), 45000);
        })]);
      } finally { clearTimeout(timer); }
    };
    camera.position.set(eyeX, 1.6, endZ + 3); controls.target.set(eyeX, .15, middleZ); controls.update();
    camera.updateMatrixWorld(true);
    splats.viewer.update(renderer, camera);
    await settled(splats.viewer.sortPromise);
    await settled(splats.viewer.runSplatSort(true, true));
    await settled(splats.viewer.sortPromise);
    // The relocated floor is close to the PC-only cyan origin marker. It is
    // unrelated geometry above the cut and is hidden in actual XR; exclude it
    // from this floor-fragment comparison while retaining the strict RGB test.
    const marker = window.__debug.spawnMarker, markerVisible = marker.visible;
    marker.visible = false;
    // Isolate removal of the original floor; the connected corridor is tested
    // separately through actual rendered aperture comparisons.
    const cut = splats.getSplatScene(window.__debug.hallwayCut.snapshot().sceneIndex), cutVisible = cut.visible;
    cut.visible = false;
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const read = ([x, y, z]) => {
      const point = new Vector3(x, y, z).project(camera);
      if (Math.abs(point.x) >= 1 || Math.abs(point.y) >= 1) throw new Error('Pixel probe is outside the viewport.');
      const bytes = new Uint8Array(4);
      gl.readPixels(Math.floor((point.x + 1) * gl.drawingBufferWidth / 2),
        Math.floor((point.y + 1) * gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return [...bytes.slice(0, 3)];
    };
    const result = {
      inside: [-.7, 0, .7].flatMap(x => [startZ + .04, middleZ, endZ - .04].map(z => read([x, 0, z]))),
      outside: [startZ - .06, endZ + .06].map(z => read([0, 0, z])),
      walls: [-1.05, 1.05].map(x => read([x, 1, middleZ])),
    };
    marker.visible = markerVisible;
    cut.visible = cutVisible;
    return result;
  }, eyeX);
}

/** Read actual framebuffer pixels, exercise the operator button and recovery. */
export async function runFloorHoleScenario(page, output) {
  const original = await page.evaluate(() => {
    const { camera, controls, splats, floorHole } = window.__debug;
    if (floorHole.snapshot().open) throw new Error('The floor must start closed.');
    const mesh = splats.viewer.splatMesh;
    window.__floorResources = { geometry: mesh.geometry, material: mesh.material,
      textures: mesh.splatDataTextures, worker: splats.viewer.sortWorker };
    const state = { camera: camera.position.toArray(), target: controls.target.toArray(), damping: controls.enableDamping,
      scanPosition: splats.position.toArray(), scanRotation: splats.quaternion.toArray() };
    controls.enableDamping = false;
    return state;
  });
  const closed = await pixels(page);
  const closedEyes = [];
  for (const eye of [-.032, .032]) closedEyes.push({ eye, pixels: await pixels(page, eye) });
  const lit = rgb => rgb.reduce((a, b) => a + b, 0) > 60 && rgb.some(v => v < 253);
  assert.ok(closed.inside.every(lit), `Missing baseline floor: ${JSON.stringify(closed)}`);
  await page.locator('#experience-floor-hole').click();
  assert.equal(await page.locator('#experience-floor-hole').textContent(), 'Close floor hole');
  const state = await page.evaluate(() => window.__debug.floorHole.snapshot());
  const config = await page.evaluate(async () => (await import('/src/viewer/floorHole.ts')).FLOOR_HOLE);
  assert.equal(state.open, true); assert.ok(Math.abs(state.startZ - config.startZ) < 1e-10);
  assert.ok(Math.abs(state.endZ - config.startZ - config.length) < 1e-10);
  assert.equal(state.locked, true, 'The manual button must use the same frozen wall-arrival placement.');
  assert.ok(Math.abs(state.width - config.width) < 1e-6); assert.equal(state.length, config.length);
  const eyes = [];
  for (const { eye, pixels: baseline } of closedEyes) {
    const open = await pixels(page, eye); eyes.push(open);
    assert.ok(open.inside.every(rgb => rgb.every(v => v >= 253)), `The floor remains inside the white opening: ${JSON.stringify(open)}`);
    assert.ok(open.outside.every(lit), 'The floor outside the opening was removed.');
    assert.deepEqual(open.walls, baseline.walls);
    assert.ok(open.walls.every(lit), 'The cutout removed an adjacent wall.');
  }
  await page.screenshot({ path: path.join(output, 'floor-hole.png'), fullPage: true });
  const aligned = await page.evaluate(async () => {
    const { Vector3, Quaternion } = await import('/node_modules/.vite/deps/three.js');
    const { splats, floorHole } = window.__debug;
    const bounds = splats.viewer.splatMesh.material.uniforms.uFloorHoleBounds.value.toArray();
    const corners = floorHole.snapshot().worldCorners;
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    const station = new Vector3(0, 0, (floorHole.snapshot().startZ + floorHole.snapshot().endZ) / 2);
    splats.position.sub(station).applyQuaternion(turn).add(station); splats.position.x += .3;
    splats.quaternion.premultiply(turn);
    splats.updateMatrixWorld(true);
    floorHole.update();
    return { bounds, after: splats.viewer.splatMesh.material.uniforms.uFloorHoleBounds.value.toArray(),
      far: splats.viewer.splatMesh.material.uniforms.uFloorHoleFarBounds.value.toArray(), open: floorHole.snapshot().open,
      corners, afterCorners: floorHole.snapshot().worldCorners, locked: floorHole.snapshot().locked };
  });
  assert.deepEqual(aligned.after, aligned.bounds, 'Later scan motion must not move a captured wall-arrival opening.');
  assert.deepEqual(aligned.afterCorners, aligned.corners); assert.equal(aligned.locked, true);
  assert.deepEqual(aligned.after.slice(2), [state.startZ, state.endZ]); assert.equal(aligned.open, true);
  aligned.far.forEach((v, i) => assert.ok(Math.abs(v - aligned.after[i]) < 1e-6));
  await page.evaluate(original => {
    const { splats } = window.__debug;
    splats.position.fromArray(original.scanPosition); splats.quaternion.fromArray(original.scanRotation); splats.updateMatrixWorld(true);
  }, original);
  await page.locator('#experience-floor-hole').click();
  const restored = await pixels(page);
  assert.deepEqual(restored, closed);
  await page.locator('#experience-floor-hole').click();
  await page.locator('#experience-stop').click();
  assert.equal(await page.evaluate(() => window.__debug.floorHole.snapshot().open), false);
  await page.waitForFunction(() => document.getElementById('experience-floor-hole').disabled);
  await page.locator('#experience-reset').click();
  await page.locator('#experience-floor-hole').click();
  await page.locator('#experience-reset').click();
  assert.equal(await page.evaluate(() => window.__debug.floorHole.snapshot().open), false);
  await page.locator('#experience-floor-hole').click();
  const recovery = await page.evaluate(original => {
    const { experience, floorHole, camera, controls, splats } = window.__debug;
    experience.prepareForCalibration();
    const closed = !floorHole.snapshot().open && splats.viewer.splatMesh.material.uniforms.uFloorHoleOpen.value === 0;
    experience.setCalibrationActive(false);
    camera.position.fromArray(original.camera); controls.target.fromArray(original.target); controls.update();
    controls.enableDamping = original.damping;
    const saved = window.__floorResources, mesh = splats.viewer.splatMesh;
    return { closed, resourcesStable: mesh.geometry === saved.geometry && mesh.material === saved.material &&
      mesh.splatDataTextures === saved.textures && splats.viewer.sortWorker === saved.worker };
  }, original);
  assert.equal(recovery.closed, true); assert.equal(recovery.resourcesStable, true);
  return { state, closed, eyes, restored, aligned, ...recovery, stopCloses: true, resetCloses: true };
}

/** Optional private-scan evidence; the caller pauses its animation loop first. */
export async function capturePrivateFloorHole(page, output) {
  const original = await page.evaluate(() => {
    const { camera, controls, splats } = window.__debug;
    const saved = { camera: camera.position.toArray(), target: controls.target.toArray(), damping: controls.enableDamping,
      props: Array.from({ length: splats.getSceneCount() - 1 }, (_, i) => ({ index: i + 1, visible: splats.getSplatScene(i + 1).visible })) };
    controls.enableDamping = false;
    return saved;
  });
  await page.locator('#experience-floor-hole').click({ timeout: 60000 });
  const state = await page.evaluate(() => window.__debug.floorHole.snapshot());
  assert.equal(state.open, true, state.status);
  const withProps = await pixels(page);
  await page.screenshot({ path: path.join(output, 'private-floor-hole-with-box.png'), fullPage: true, timeout: 60000 });
  // The existing foreground box can occlude a probe at the opening's near
  // edge. Hide props only for the independent floor-only evidence, then restore.
  await page.evaluate(props => {
    for (const prop of props) window.__debug.splats.getSplatScene(prop.index).visible = false;
  }, original.props);
  const open = await pixels(page);
  assert.ok(open.inside.every(rgb => rgb.every(v => v >= 253)), `Original floor remains inside the white opening: ${JSON.stringify(open)}`);
  await page.screenshot({ path: path.join(output, 'private-floor-hole.png'), fullPage: true, timeout: 60000 });
  await page.locator('#experience-floor-hole').click({ timeout: 60000 });
  return page.evaluate(({ original, open, withProps, state }) => {
    const { camera, controls, splats } = window.__debug;
    for (const prop of original.props) splats.getSplatScene(prop.index).visible = prop.visible;
    camera.position.fromArray(original.camera); controls.target.fromArray(original.target); controls.update();
    controls.enableDamping = original.damping;
    return { state, pixels: open, withProps };
  }, { original, open, withProps, state });
}
