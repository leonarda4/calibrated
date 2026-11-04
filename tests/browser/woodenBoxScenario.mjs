import assert from 'node:assert/strict';
import path from 'node:path';
import { runBoxGlitchScenario } from './boxGlitchScenario.mjs';

/** Actual shared-renderer boxes, with explicit motion time and real UI buttons. */
export async function runWoodenBoxScenario(page, output) {
  const saved = await page.evaluate(() => {
    const { experience, camera, controls, splats } = window.__debug;
    window.__boxUpdate = experience.installation.update;
    experience.installation.update = () => {};
    const mesh = splats.viewer.splatMesh;
    window.__boxResources = { geometry: mesh.geometry, material: mesh.material, worker: splats.viewer.sortWorker };
    return { camera: camera.position.toArray(), target: controls.target.toArray() };
  });
  const pose = () => page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { WOODEN_BOX, woodenBoxSourceRotation } = await import('/src/viewer/woodenBox.ts');
    const { experience, splats } = window.__debug;
    const object = splats.getSplatScene(3);
    splats.updateWorldMatrix(true, false);
    object.updateWorldMatrix(true, false);
    // Compose the stored scene-local affine pose with the scan root once.
    const world = new THREE.Matrix4().multiplyMatrices(splats.matrixWorld, object.matrix);
    const top = new THREE.Vector3(
      (WOODEN_BOX.alignedMin[0] + WOODEN_BOX.alignedMax[0]) / 2, WOODEN_BOX.alignedMax[1],
      (WOODEN_BOX.alignedMin[2] + WOODEN_BOX.alignedMax[2]) / 2,
    ).applyMatrix4(woodenBoxSourceRotation().invert()).applyMatrix4(world);
    return { ...experience.installation.snapshot().boxReveal, visible: object.visible, topY: top.y,
      floorY: experience.installation.snapshot().config.floorY, splats: object.splatBuffer.getSplatCount() };
  });
  const settle = () => page.evaluate(async () => {
    const { splats, renderer, scene, camera } = window.__debug;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    splats.viewer.update(renderer, camera);
    await splats.viewer.sortPromise;
    splats.viewer.splatMesh.updateTransforms();
    await splats.viewer.runSplatSort(true, true);
    renderer.render(scene, camera);
  });
  try {
    await page.locator('#experience-hide-box').click();
    await page.evaluate(() => window.__boxUpdate(.75));
    const halfOut = await pose();
    assert.equal(halfOut.motion, 'exiting'); assert.equal(halfOut.fraction, .5);
    await page.evaluate(() => {
      const { experience, camera, controls } = window.__debug;
      const c = experience.installation.snapshot().config;
      camera.position.set(c.centerX + .8, c.floorY + .8, c.centerZ + 1.5);
      controls.target.set(c.centerX, c.floorY + .2, c.centerZ); controls.update();
    });
    await settle();
    await page.screenshot({ path: path.join(output, 'wooden-box-floor-out.png'), fullPage: true });
    await page.evaluate(() => window.__boxUpdate(.75));
    const hidden = await pose(); assert.equal(hidden.visible, false);
    assert.ok(hidden.topY < hidden.floorY, 'the hidden endpoint must stay fully below the floor');
    await page.locator('#experience-show-box').click();
    const start = await pose();
    assert.equal(start.fraction, 0); assert.ok(start.topY < start.floorY, 'box does not start entirely below the floor');
    assert.equal(await page.locator('#experience-rotate').isDisabled(), true);
    await page.evaluate(() => window.__boxUpdate(.75));
    const halfIn = await pose();
    assert.equal(halfIn.motion, 'entering'); assert.equal(halfIn.fraction, .5);
    assert.ok(Math.abs(halfIn.topY - halfOut.topY) < 1e-8, 'entrance and exit must use the same fixed world path');
    await settle();
    await page.screenshot({ path: path.join(output, 'wooden-box-floor-in.png'), fullPage: true });
    await page.evaluate(() => window.__boxUpdate(.75));
    const shown = await pose(); assert.equal(shown.motion, 'visible');
    assert.ok(Math.abs(shown.topY - shown.floorY - .43) < 1e-8, '43 cm visual box should stand directly on its floor anchor');
    await settle();
    await page.screenshot({ path: path.join(output, 'wooden-box-upright.png'), fullPage: true });
    await page.locator('#experience-hide-box').click();
    await page.evaluate(() => { window.__boxUpdate(.5); window.__debug.experience.installation.reset(); window.__boxUpdate(10); });
    assert.equal((await pose()).visible, false, 'reset must cancel the descent without reviving the object');
    await page.locator('#experience-show-box').click();
    await page.evaluate(() => window.__boxUpdate(1.5));
    const resourcesUnchanged = await page.evaluate(() => {
      const { splats } = window.__debug, mesh = splats.viewer.splatMesh, saved = window.__boxResources;
      return mesh.geometry === saved.geometry && mesh.material === saved.material && splats.viewer.sortWorker === saved.worker;
    });
    assert.ok(resourcesUnchanged);
    const glitch = await runBoxGlitchScenario(page, output);
    return { start, halfIn, shown, halfOut, hidden, resourcesUnchanged, glitch,
      sourceUp: '-Z', sourceYawCorrectionDegrees: -19, asset: process.env.CHECK_REAL_BOX === '1' ? 'actual private WoodenBox.ply' : 'synthetic wooden-box fixture' };
  } finally {
    await page.evaluate(saved => {
      const { experience, camera, controls } = window.__debug;
      experience.installation.update = window.__boxUpdate;
      camera.position.fromArray(saved.camera); controls.target.fromArray(saved.target); controls.update();
      delete window.__boxUpdate; delete window.__boxResources;
    }, saved);
  }
}
