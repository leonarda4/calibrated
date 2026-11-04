import assert from 'node:assert/strict';
import path from 'node:path';

/** Actual reveal button, current hallway section and shared-renderer lifecycle. */
export async function runBroomScenario(page, output) {
  assert.equal(await page.locator('#experience-show-broom').isDisabled(), false);
  assert.equal(await page.evaluate(() => window.__debug.broom.snapshot().visible), false);
  const original = await page.evaluate(() => {
    const { camera, controls, splats } = window.__debug;
    window.__broomResources = { geometry: splats.viewer.splatMesh.geometry, material: splats.viewer.splatMesh.material,
      textures: splats.viewer.splatMesh.splatDataTextures, worker: splats.viewer.sortWorker };
    return { camera: camera.position.toArray(), target: controls.target.toArray(), damping: controls.enableDamping,
      scanPosition: splats.position.toArray(), scanRotation: splats.quaternion.toArray() };
  });
  await page.locator('#experience-show-broom').click();
  const shown = await page.evaluate(async () => {
    const { Vector3, Matrix4 } = await import('/node_modules/.vite/deps/three.js');
    const { BROOM } = await import('/src/viewer/broomConfig.ts');
    const { getSourceCenters } = await import('/src/viewer/splatViewer.ts');
    const { createHallwaySections } = await import('/src/experience/hallwaySection.ts');
    const { measureWallDistances } = await import('/src/experience/hallwayCenter.ts');
    const { broom, splats, camera, controls, experience } = window.__debug;
    const object = splats.getSplatScene(BROOM.sceneIndex);
    controls.enableDamping = false;
    const base = broom.snapshot().baseWorld;
    camera.position.set(base[0], base[1] + 1.1, base[2] + 2.9);
    controls.target.set(base[0], base[1] + .73, base[2]); controls.update();
    broom.update(); object.updateMatrix();
    const matrix = new Matrix4().multiplyMatrices(splats.matrixWorld, object.matrix);
    const actualBase = new Vector3(...BROOM.sourceBase).applyMatrix4(matrix);
    const up = new Vector3(0, 0, -1).transformDirection(matrix);
    const section = createHallwaySections({ scanRoot: splats, getCenters: () => getSourceCenters(splats), floorY: base[1] }).at(6);
    if (!section.ok) throw new Error(section.reason);
    const clearances = measureWallDistances(section.wallPlanes, base);
    await splats.viewer.sortPromise;
    splats.viewer.splatMesh.updateTransforms();
    await splats.viewer.runSplatSort(true, true);
    await splats.viewer.sortPromise;
    return { ...broom.snapshot(), actualBase: actualBase.toArray(), up: up.toArray(), determinant: matrix.determinant(),
      sectionCentre: section.centerWorld, clearances, floorY: experience.installation.snapshot().config.floorY,
      splatCount: object.splatBuffer.getSplatCount(), sourceCenterLength: getSourceCenters(splats).length,
      originalCount: splats.getSplatScene(0).splatBuffer.getSplatCount() };
  });
  assert.equal(shown.visible, true);
  shown.baseWorld.forEach((v, i) => assert.ok(Math.abs(v - shown.sectionCentre[i]) < 1e-8));
  assert.ok(shown.clearances.imbalance < 1e-8, 'broom base must be centred between current fitted walls');
  shown.actualBase.forEach((v, i) => assert.ok(Math.abs(v - shown.baseWorld[i]) < 1e-8));
  shown.up.forEach((v, i) => assert.ok(Math.abs(v - [0, 1, 0][i]) < 1e-8));
  assert.ok(Math.abs(shown.determinant - 1) < 1e-8);
  assert.equal(shown.sourceCenterLength, shown.originalCount * 3);
  assert.equal(await page.locator('#experience-show-broom').textContent(), 'Hide broom');
  await page.screenshot({ path: path.join(output, 'broom.png'), fullPage: true });
  const transformed = await page.evaluate(async () => {
    const { Vector3, Matrix4, Quaternion } = await import('/node_modules/.vite/deps/three.js');
    const { BROOM } = await import('/src/viewer/broomConfig.ts');
    const { broom, splats } = window.__debug;
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    const station = new Vector3(0, 0, 6);
    splats.position.sub(station).applyQuaternion(turn).add(station); splats.position.x += .3;
    splats.quaternion.premultiply(turn);
    broom.update();
    const object = splats.getSplatScene(BROOM.sceneIndex); object.updateMatrix();
    const matrix = new Matrix4().multiplyMatrices(splats.matrixWorld, object.matrix);
    return { base: new Vector3(...BROOM.sourceBase).applyMatrix4(matrix).toArray(),
      up: new Vector3(0, 0, -1).transformDirection(matrix).toArray() };
  });
  assert.ok(Math.abs(transformed.base[0] + shown.baseWorld[0] - .3) < 1e-6,
    'broom follows the new current hallway centre after rotation and sideways correction');
  assert.ok(Math.abs(transformed.base[1] - shown.baseWorld[1]) < 1e-8);
  assert.ok(Math.abs(transformed.base[2] - 6) < 1e-8);
  transformed.up.forEach((v, i) => assert.ok(Math.abs(v - [0, 1, 0][i]) < 1e-8));
  await page.locator('#experience-show-broom').click();
  assert.equal(await page.evaluate(() => window.__debug.broom.snapshot().visible), false);
  await page.locator('#experience-show-broom').click();
  await page.locator('#experience-reset').click();
  assert.equal(await page.evaluate(() => window.__debug.broom.snapshot().visible), false);
  await page.locator('#experience-show-broom').click();
  const recovered = await page.evaluate(original => {
    const { experience, broom, splats, camera, controls } = window.__debug;
    experience.prepareForCalibration(); broom.update();
    const hidden = !broom.snapshot().visible;
    experience.setCalibrationActive(false);
    splats.position.fromArray(original.scanPosition); splats.quaternion.fromArray(original.scanRotation); splats.updateMatrixWorld(true);
    camera.position.fromArray(original.camera); controls.target.fromArray(original.target); controls.update(); controls.enableDamping = original.damping;
    const mesh = splats.viewer.splatMesh, saved = window.__broomResources;
    return { hidden, resourcesStable: mesh.geometry === saved.geometry && mesh.material === saved.material &&
      mesh.splatDataTextures === saved.textures && splats.viewer.sortWorker === saved.worker };
  }, original);
  assert.equal(recovered.hidden, true); assert.equal(recovered.resourcesStable, true);
  return { ...shown, transformed, ...recovered, resetHides: true };
}
