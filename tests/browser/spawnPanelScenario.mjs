import assert from 'node:assert/strict';
import path from 'node:path';

const near = (actual, expected, message, tolerance = 2e-6) => actual.forEach((value, axis) =>
  assert.ok(Math.abs(value - expected[axis]) < tolerance, `${message}, axis ${axis}: ${value} versus ${expected[axis]}`));

/** Exercise the existing inputs in the actual reversed application, without placing anything. */
export async function runSpawnPanelScenario(page, output, phase = 'reversed') {
  const damping = await page.evaluate(() => {
    const { controls } = window.__debug;
    const previous = controls.enableDamping;
    controls.enableDamping = false; controls.update();
    return previous;
  });
  const capture = () => page.evaluate(async () => {
    const { Vector3 } = await import('/node_modules/.vite/deps/three.js');
    const { splats, scene, camera, experience } = window.__debug;
    scene.updateMatrixWorld(true);
    const state = experience.installation.snapshot();
    return { phase: state.phase, yaw: state.yaw, offset: state.rotationOffsetMetres,
      position: splats.position.toArray(), quaternion: splats.quaternion.toArray(),
      rawOrigin: splats.worldToLocal(new Vector3()).toArray(),
      first: scene.getObjectByName('installation-box').matrixWorld.toArray(), camera: camera.matrixWorld.toArray(),
      fields: ['x', 'y', 'z'].map(axis => Number(document.getElementById('spawn-' + axis).value)) };
  });
  await page.locator('#spawn-x').blur();
  const before = await capture();
  assert.equal(before.phase, phase);
  near(before.fields, before.rawOrigin, 'panel follows the actual raw origin after turning');
  assert.equal(await page.locator('#spawn-x').isDisabled(), false);
  const verify = after => {
    assert.equal(after.phase, before.phase); assert.equal(after.yaw, before.yaw); assert.equal(after.offset, before.offset);
    near(after.quaternion, before.quaternion, 'heading stays flipped');
    near(after.first, before.first, 'physical pivot stays fixed');
    near(after.camera, before.camera, 'inspection camera stays fixed');
  };
  try {
    const target = before.rawOrigin.map((value, axis) => value + [.12, -.2, .04][axis]);
    for (const [axis, value] of ['x', 'y', 'z'].map((axis, index) => [axis, target[index]])) {
      await page.locator('#spawn-' + axis).fill(String(value));
    }
    await page.locator('#spawn-z').blur();
    const edited = await capture(); verify(edited);
    near(edited.rawOrigin, target, 'edited raw point maps to world origin');
    assert.ok(edited.position.some((value, axis) => Math.abs(value - before.position[axis]) > .01));
    await page.waitForTimeout(300);
    const settled = await capture(); verify(settled);
    near(settled.position, edited.position, 'render frames retain the translation');
    near(settled.fields, target, 'panel retains edited coordinates');
    await page.locator('#spawn-x').fill('');
    await page.waitForTimeout(100);
    const incomplete = await capture(); verify(incomplete);
    near(incomplete.position, edited.position, 'blank input does not move the scan to zero');
    assert.equal(await page.locator('#spawn-x').inputValue(), '', 'refresh does not overwrite a draft');
    await page.locator('#spawn-x').fill(String(target[0]));
    await page.locator('#spawn-x').dispatchEvent('change');
    await page.locator('#spawn-x').blur();
    const repeated = await capture(); verify(repeated);
    near(repeated.position, edited.position, 'input/change pair does not accumulate');
    const screenshot = phase === 'reversed' ? 'start-panel-rotated.png' : 'start-panel-original.png';
    await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
    return { phase: repeated.phase, yaw: repeated.yaw, rawOrigin: repeated.rawOrigin, displayed: repeated.fields,
      currentHeadingPreserved: true, repeatedFramesStable: true, blankInputIgnored: true,
      physicalPivotFixed: true, screenshot };
  } finally {
    // Restore using the same public inputs; later recovery checks start unchanged.
    for (let axis = 0; axis < 3; axis++) await page.locator('#spawn-' + ['x', 'y', 'z'][axis]).fill(String(before.rawOrigin[axis]));
    await page.locator('#spawn-z').blur();
    await page.evaluate(previous => { window.__debug.controls.enableDamping = previous; }, damping);
  }
}
