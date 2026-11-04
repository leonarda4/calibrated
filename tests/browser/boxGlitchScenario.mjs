import assert from 'node:assert/strict';
import path from 'node:path';

/** Uses the actual installation and shared shader with a frozen test clock. */
export async function runBoxGlitchScenario(page, output) {
  const begin = await page.evaluate(() => {
    const { experience, scene, splats, camera, controls } = window.__debug;
    const install = experience.installation, c = install.snapshot().config;
    if (!install.rotateHallway()) throw new Error('Could not start glitch test turn');
    window.__boxUpdate(c.rotationSeconds);
    camera.position.set(c.centerX + .65, c.floorY + .65, c.centerZ + 1);
    controls.target.set(c.centerX, c.floorY + .2, c.centerZ); controls.update();
    scene.updateMatrixWorld(true);
    window.__boxGlitchPose = { anchor: scene.getObjectByName('installation-box').matrixWorld.toArray(),
      world: splats.matrixWorld.toArray(), box: splats.getSplatScene(3).matrix.toArray(),
      second: splats.getSplatScene(4).matrix.toArray(), secondVisible: splats.getSplatScene(4).visible };
    return install.snapshot().boxGlitch;
  });
  assert.equal(begin.phase, 'waiting');
  const capture = () => page.evaluate(async () => {
    const { experience, splats, scene, camera, renderer } = window.__debug;
    const THREE = await import('/node_modules/.vite/deps/three.js');
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    splats.viewer.update(renderer, camera); await splats.viewer.sortPromise;
    splats.viewer.splatMesh.updateTransforms(); await splats.viewer.runSplatSort(true, true);
    renderer.render(scene, camera);
    const gl = renderer.getContext(), c = experience.installation.snapshot().config;
    const point = new THREE.Vector3(c.centerX, c.floorY + .22, c.centerZ).project(camera);
    const size = 160, x = Math.max(0, Math.min(gl.drawingBufferWidth - size, Math.round((point.x + 1) / 2 * gl.drawingBufferWidth - size / 2)));
    const y = Math.max(0, Math.min(gl.drawingBufferHeight - size, Math.round((point.y + 1) / 2 * gl.drawingBufferHeight - size / 2)));
    const pixels = new Uint8Array(size * size * 4); gl.readPixels(x, y, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { state: experience.installation.snapshot(), pixels: Array.from(pixels),
      visible: splats.getSplatScene(3).visible, uniform: splats.viewer.splatMesh.material.uniforms.uPivotBoxGlitch.value,
      box: splats.getSplatScene(3).matrix.toArray(), second: splats.getSplatScene(4).matrix.toArray(),
      anchor: scene.getObjectByName('installation-box').matrixWorld.toArray(), world: splats.matrixWorld.toArray() };
  });
  try {
    await page.evaluate(() => window.__boxUpdate(.999));
    const before = await capture();
    assert.equal(before.state.boxGlitch.progress, 0); assert.equal(before.visible, true);
    await page.screenshot({ path: path.join(output, 'box-glitch-before.png'), fullPage: true });
    await page.evaluate(() => window.__boxUpdate(.276));
    const during = await capture();
    assert.equal(during.state.boxGlitch.phase, 'glitching');
    assert.ok(Math.abs(during.uniform - .5) < 1e-8);
    assert.equal(during.state.boxReveal.fraction, 1);
    assert.deepEqual(during.box, before.box, 'glitch must not lower the visual pose');
    assert.deepEqual(during.anchor, before.anchor); assert.deepEqual(during.world, before.world);
    assert.deepEqual(during.second, before.second, 'glitch must not move the second box');
    const changedPixels = before.pixels.reduce((sum, value, index) =>
      sum + (index % 4 !== 3 && Math.abs(value - during.pixels[index]) > 10 ? 1 : 0), 0);
    assert.ok(changedPixels > 50, `Glitch did not change the rendered box: ${changedPixels}`);
    await page.screenshot({ path: path.join(output, 'box-glitch-during.png'), fullPage: true });
    await page.evaluate(() => window.__boxUpdate(.3));
    const after = await capture();
    assert.equal(after.visible, false); assert.equal(after.state.boxReveal.motion, 'hidden');
    assert.equal(after.uniform, 0, 'hidden effect must stop affecting the shader');
    assert.deepEqual(after.anchor, before.anchor); assert.deepEqual(after.world, before.world);
    await page.screenshot({ path: path.join(output, 'box-glitch-after.png'), fullPage: true });
    return { delaySeconds: 1, effectSeconds: .55, changedColorChannels: changedPixels,
      fixedAnchorAndScan: true, noFloorDescent: true, secondPoseUnchanged: true };
  } finally {
    await page.evaluate(() => { window.__debug.experience.installation.reset(); delete window.__boxGlitchPose; });
    await page.locator('#experience-show-box').click();
    await page.evaluate(() => window.__boxUpdate(1.5));
  }
}
