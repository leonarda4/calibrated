import assert from 'node:assert/strict';
import path from 'node:path';
import { WALL_SECTION } from '../../src/viewer/wallSectionConfig.ts';

/** Compare the real rendered outward faces, with the hallway temporarily hidden. */
export async function captureWallFaces(page, output, prefix = 'wall') {
  const saved = await page.evaluate(() => {
    const { camera, controls, splats } = window.__debug;
    const visible = Array.from({ length: splats.viewer.getSceneCount() }, (_, i) => splats.getSplatScene(i).visible);
    for (let i = 0; i < visible.length; i++) if (i !== 1) splats.getSplatScene(i).visible = false;
    const state = { camera: camera.position.toArray(), target: controls.target.toArray(), damping: controls.enableDamping, visible };
    controls.enableDamping = false;
    return state;
  });
  const views = [];
  try {
    for (const side of [1, -1]) {
      const view = await page.evaluate(async ({ side, height, faceOffset }) => {
        const THREE = await import('/node_modules/.vite/deps/three.js');
        const { camera, controls, renderer, scene, splats, wallBlocker } = window.__debug;
        const wall = splats.getSplatScene(wallBlocker.snapshot().sceneIndex);
        wall.updateWorldMatrix(true, false);
        camera.position.copy(wall.localToWorld(new THREE.Vector3(0, height / 2, side * 3.2)));
        controls.target.copy(wall.localToWorld(new THREE.Vector3(0, height / 2, 0)));
        controls.update(); camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
        wallBlocker.update(0);
        splats.viewer.update(renderer, camera);
        const settle = async () => {
          let timer;
          try {
            await Promise.race([splats.viewer.sortPromise, new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('Wall face sort timed out.')), 30000);
            })]);
          } finally { clearTimeout(timer); }
        };
        await settle(); splats.viewer.splatMesh.updateTransforms();
        await splats.viewer.runSplatSort(true, true); await settle();
        renderer.render(scene, camera);
        const gl = renderer.getContext(), samples = [], pixel = new Uint8Array(4);
        // Asymmetric colour/lettering must read identically from either side.
        for (let iy = 1; iy < 20; iy++) for (let ix = -9; ix <= 9; ix++) {
          const p = wall.localToWorld(new THREE.Vector3(side * ix * .10, iy * height / 20, side * faceOffset)).project(camera);
          const x = Math.floor((p.x + 1) * gl.drawingBufferWidth / 2);
          const y = Math.floor((p.y + 1) * gl.drawingBufferHeight / 2);
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          samples.push(...pixel.slice(0, 3));
        }
        return { side, samples, transform: wall.matrixWorld.toArray(), scale: wall.scale.toArray(),
          splatCount: wall.splatBuffer.getSplatCount() };
      }, { side, height: WALL_SECTION.height, faceOffset: WALL_SECTION.faceOffset });
      await page.screenshot({ path: path.join(output, `${prefix}-${side === 1 ? 'front' : 'back'}.png`), fullPage: true, timeout: 60000 });
      views.push(view);
    }
    const [front, back] = views;
    assert.deepEqual(back.transform, front.transform, 'Viewing the back changed the wall transform.');
    assert.deepEqual(back.scale, front.scale);
    assert.ok(Math.abs(back.scale[0] * WALL_SECTION.width - await page.evaluate(() => window.__debug.wallBlocker.snapshot().width)) < 1e-7);
    assert.equal(back.scale[1], 1); assert.equal(back.scale[2], 1);
    assert.equal(back.splatCount, front.splatCount);
    assert.ok(front.samples.filter(value => value > 25).length > front.samples.length / 2, 'Wall face is blank.');
    const meanDifference = front.samples.reduce((sum, value, i) => sum + Math.abs(value - back.samples[i]), 0) / front.samples.length;
    assert.ok(meanDifference < 2, `Front/back differ or the good face is mirrored (${meanDifference}).`);
    return { meanRgbDifference: meanDifference, sampleCount: front.samples.length / 3, splatCount: front.splatCount,
      renderedScale: back.scale, heightAndThicknessUnchanged: true, oneUnchangedTransform: true, authoredThickness: WALL_SECTION.depth, gap: WALL_SECTION.faceGap };
  } finally {
    await page.evaluate(saved => {
      const { camera, controls, splats } = window.__debug;
      saved.visible.forEach((value, i) => { splats.getSplatScene(i).visible = value; });
      camera.position.set(...saved.camera); controls.target.set(...saved.target); controls.update();
      controls.enableDamping = saved.damping;
    }, saved);
  }
}
