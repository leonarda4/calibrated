import assert from 'node:assert/strict';
import path from 'node:path';
import { Matrix4 } from 'three';

function near(actual, expected, message, tolerance = 1e-8) {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < tolerance,
    message + ', component ' + axis + ': ' + value + ' versus ' + expected[axis]));
}

/** Actual controls: only the physical turn box stays fixed; other props fit the current scan. */
export async function runRotationOffsetScenario(page, output) {
  const details = page.locator('#experience-flip-alignment');
  const input = page.locator('#experience-flip-offset');
  const originalUi = await details.evaluate(element => ({ open: element.open,
    panelScroll: element.closest('#experience-panel')?.scrollTop ?? 0 }));
  const original = await page.evaluate(() => {
    const { broom, floorHole, wallBlocker, camera, controls } = window.__debug;
    window.__offsetWallUpdate = wallBlocker.update;
    // Keep longitudinal travel paused while comparing several lateral edits.
    wallBlocker.update = () => window.__offsetWallUpdate(0);
    return { broom: broom.snapshot().visible, hole: floorHole.snapshot().open, wall: wallBlocker.snapshot().visible,
      camera: camera.position.toArray(), target: controls.target.toArray(), damping: controls.enableDamping };
  });
  const capture = () => page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { measureWallDistances } = await import('/src/experience/hallwayCenter.ts');
    const { WOODEN_BOX, woodenBoxSourceRotation } = await import('/src/viewer/woodenBox.ts');
    const { WALL_SECTION } = await import('/src/viewer/wallSectionConfig.ts');
    const { BROOM } = await import('/src/viewer/broomConfig.ts');
    const { scene, splats, experience, broom, floorHole, wallBlocker } = window.__debug;
    broom.update(); floorHole.update(); wallBlocker.update(0);
    scene.updateMatrixWorld(true); splats.updateWorldMatrix(true, false);
    const state = experience.installation.snapshot();
    const section = z => {
      const fit = experience.hallwaySection(z);
      if (!fit.ok) throw new Error('Offset section Z' + z + ': ' + fit.reason);
      return fit;
    };
    const worldMatrix = index => new THREE.Matrix4().multiplyMatrices(splats.matrixWorld, splats.getSplatScene(index).matrix);
    const seatAnchor = scene.getObjectByName('installation-second-box');
    const position = seatAnchor.geometry.getAttribute('position');
    const corners = new Map();
    for (let index = 0; index < position.count; index++) {
      const p = new THREE.Vector3().fromBufferAttribute(position, index);
      if (p.y > -.49) continue;
      p.applyMatrix4(seatAnchor.matrixWorld);
      corners.set([p.x.toFixed(8), p.z.toFixed(8)].join(','), p.toArray());
    }
    const seatFit = section(state.secondBox.base[2]);
    const seatDistances = [...corners.values()].map(p => measureWallDistances(seatFit.wallPlanes, p));
    const minimum = side => Math.min(...seatDistances.map(value => value[side]));
    const seatWall = minimum('left') < minimum('right') ? 'left' : 'right';
    const sourceBottom = new THREE.Vector3(
      (WOODEN_BOX.alignedMin[0] + WOODEN_BOX.alignedMax[0]) / 2, WOODEN_BOX.alignedMin[1],
      (WOODEN_BOX.alignedMin[2] + WOODEN_BOX.alignedMax[2]) / 2,
    ).applyMatrix4(woodenBoxSourceRotation().invert());
    const broomState = broom.snapshot(), broomFit = section(6);
    const holeState = floorHole.snapshot();
    const edges = z => Object.values(section(z).wallPlanes).map(wall =>
      (wall.normal.reduce((sum, n, i) => sum + n * wall.point[i], 0) - wall.normal[1] * holeState.floorY - wall.normal[2] * z) / wall.normal[0]
    ).sort((a, b) => a - b);
    const wallState = wallBlocker.snapshot(), wallWorld = worldMatrix(wallState.sceneIndex);
    const wallFit = section(wallState.baseWorld[2]);
    const spanAtDepth = depth => [-1, 1].map(sign => new THREE.Vector3(sign * WALL_SECTION.width / 2,
      WALL_SECTION.height / 2, depth).applyMatrix4(wallWorld));
    const span = spanAtDepth(0);
    const wallCenter = new THREE.Vector3(0, 0, 0).applyMatrix4(wallWorld);
    return {
      phase: state.phase, heading: state.boxYaw, amount: state.rotationOffsetMetres,
      offsetWorld: state.rotationOffsetWorld, position: splats.position.toArray(),
      quaternion: splats.quaternion.toArray(), scanMatrix: splats.matrix.toArray(),
      anchors: ['installation-box', 'installation-second-box'].map(name => scene.getObjectByName(name).matrixWorld.toArray()),
      props: [3, 4].map(index => ({ visible: splats.getSplatScene(index).visible,
        count: splats.getSplatScene(index).splatBuffer.getSplatCount(), world: worldMatrix(index).toArray(),
        bottom: sourceBottom.clone().applyMatrix4(worldMatrix(index)).toArray() })),
      settled: state.boxReveal.motion === 'visible' && state.secondBox.reveal.motion === 'visible',
      floorY: state.config.floorY, seat: { base: state.secondBox.base, wall: seatWall, cornerDistances: seatDistances,
        cornerCount: corners.size, error: state.secondBox.alignmentError },
      broom: { ...broomState, centre: broomFit.centerWorld,
        actualBase: new THREE.Vector3(...BROOM.sourceBase).applyMatrix4(worldMatrix(BROOM.sceneIndex)).toArray(),
        clearances: measureWallDistances(broomFit.wallPlanes, broomState.baseWorld) },
      hole: { ...holeState, expectedNear: edges(holeState.startZ), expectedFar: edges(holeState.endZ),
        uniformNear: splats.viewer.splatMesh.material.uniforms.uFloorHoleBounds.value.toArray(),
        uniformFar: splats.viewer.splatMesh.material.uniforms.uFloorHoleFarBounds.value.toArray() },
      wall: { ...wallState, renderedWidth: span[0].distanceTo(span[1]),
        worldMatrix: wallWorld.toArray(),
        centre: wallCenter.toArray(), clearances: measureWallDistances(wallFit.wallPlanes, wallCenter.toArray()),
        coverage: [-WALL_SECTION.depth / 2, 0, WALL_SECTION.depth / 2].map(depth =>
          spanAtDepth(depth).map(point => measureWallDistances(wallFit.wallPlanes, point.toArray()))) },
    };
  });
  try {
    // The automatic post-turn exit has finished. Explicitly re-show the first
    // box to inspect its fixed pose alongside the current-wall props.
    await page.locator('#experience-show-box').click();
    await page.evaluate(() => window.__debug.experience.installation.update(1.5));
    await details.evaluate(element => { element.open = true; });
    if (!original.broom) await page.locator('#experience-show-broom').click();
    if (!original.hole) await page.locator('#experience-floor-hole').click();
    if (!original.wall) await page.locator('#experience-show-wall').click();
    await page.evaluate(async () => {
      const { WALL_SECTION } = await import('/src/viewer/wallSectionConfig.ts');
      window.__offsetWallUpdate(window.__debug.wallBlocker.snapshot().motion === 'visible' ? 0 : WALL_SECTION.slideSeconds);
    });
    const before = await capture();
    assert.equal(before.phase, 'reversed'); assert.equal(before.amount, 0);
    assert.equal(before.settled, true, 'both floor reveals must settle before comparing the corrected props');
    assert.ok(before.props.every(prop => prop.visible && prop.count > 0));
    const verify = (state, metres) => {
      const vector = [-Math.cos(before.heading) * metres, 0, Math.sin(before.heading) * metres];
      assert.equal(state.amount, metres);
      near(state.position, before.position.map((v, i) => v + vector[i]), 'root lateral correction');
      near(state.offsetWorld, vector, 'reported correction');
      assert.equal(state.position[1], before.position[1]); near(state.quaternion, before.quaternion, 'completed heading');
      near(state.anchors[0], before.anchors[0], 'physical turn box anchor');
      near(state.props[0].world, before.props[0].world, 'physical turn box splat');
      state.props.forEach((prop, index) => {
        assert.equal(prop.visible, true); assert.equal(prop.count, before.props[index].count);
        assert.ok(Math.abs(prop.bottom[1] - state.floorY) < 1e-8, 'box splats must have no visual floor raise');
      });
      assert.equal(state.seat.error, null); assert.equal(state.seat.cornerCount, 4);
      assert.equal(state.seat.wall, before.seat.wall, 'seat must retain the chosen physical side');
      near([state.seat.base[1], state.seat.base[2]], [before.seat.base[1], before.seat.base[2]], 'seat floor/station');
      for (const measure of state.seat.cornerDistances) assert.ok(measure.left >= -1e-8 && measure.right >= -1e-8,
        'seat footprint may not enter either fitted wall');
      assert.equal(state.seat.cornerDistances.filter(value => Math.abs(value[state.seat.wall]) < 1e-8).length, 2,
        'one actual seat edge must meet the current chosen wall');
      const seatDelta = new Matrix4().fromArray(state.anchors[1]).multiply(new Matrix4().fromArray(before.anchors[1]).invert());
      const expectedSeat = seatDelta.multiply(new Matrix4().fromArray(before.props[1].world));
      near(state.props[1].world, expectedSeat.toArray(), 'seat splat follows its adjusted metric anchor');
      assert.equal(state.broom.visible, true); near(state.broom.baseWorld, state.broom.centre, 'centred broom');
      near(state.broom.actualBase, state.broom.centre, 'actual broom Gaussian base');
      assert.ok(state.broom.clearances.imbalance < 1e-8);
      assert.equal(state.hole.open, true); assert.equal(state.hole.startZ, 3); assert.equal(state.hole.endZ, 5.6);
      near(state.hole.nearBounds, state.hole.expectedNear, 'hole near edges meet current walls');
      near(state.hole.farBounds, state.hole.expectedFar, 'hole far edges meet current walls');
      near(state.hole.uniformNear, [...state.hole.nearBounds, 3, 5.6], 'actual hole near clip uniform');
      near(state.hole.uniformFar, state.hole.farBounds, 'actual hole far clip uniform');
      assert.equal(state.wall.visible, true); assert.equal(state.wall.motion, 'visible');
      assert.ok(Math.abs(state.wall.renderedWidth - state.wall.width) < 1e-8);
      if (state === before) for (const span of state.wall.coverage) {
        assert.ok(Math.min(...span.map(value => value.left)) <= 1e-8, 'initial wall must reach the left fitted wall');
        assert.ok(Math.min(...span.map(value => value.right)) <= 1e-8, 'initial wall must reach the right fitted wall');
      }
      near(state.wall.worldMatrix, before.wall.worldMatrix, 'locked wall ignores later hallway correction');
      assert.equal(state.wall.alignmentQueries, before.wall.alignmentQueries, 'correction refitted a visible wall');
    };
    verify(before, 0);
    await input.fill('10'); await page.locator('#experience-flip-apply').click();
    const shifted = await capture(); verify(shifted, .1);
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.locator('#experience-flip-apply').click(); const repeated = await capture(); verify(repeated, .1);
      near(repeated.scanMatrix, shifted.scanMatrix, 'repeated Apply must not accumulate');
    }
    await page.locator('#experience-flip-right').click(); verify(await capture(), .11);
    assert.equal(await input.inputValue(), '11');
    await page.locator('#experience-flip-left').click(); verify(await capture(), .1);
    assert.equal(await input.inputValue(), '10');
    await input.fill('101'); await page.locator('#experience-flip-apply').click(); verify(await capture(), .1);
    assert.match(await page.locator('#experience-flip-offset-error').textContent(), /100|between|finite/i);
    await input.fill('10'); await page.locator('#experience-flip-apply').click();
    await page.evaluate(async () => {
      const { splats, renderer, scene, camera, controls, experience } = window.__debug;
      controls.enableDamping = false;
      const config = experience.installation.snapshot().config;
      camera.position.set(config.centerX + .25, config.floorY + 1.5, .5);
      controls.target.set(config.centerX, config.floorY + .8, 5.5); controls.update();
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      splats.viewer.update(renderer, camera); await splats.viewer.sortPromise;
      splats.viewer.splatMesh.updateTransforms(); await splats.viewer.runSplatSort(true, true);
      renderer.render(scene, camera);
    });
    await page.screenshot({ path: path.join(output, 'rotation-offset.png'), fullPage: true });
    await page.locator('#experience-flip-zero').click(); const zero = await capture(); verify(zero, 0);
    near(zero.scanMatrix, before.scanMatrix, 'Zero restores the uncorrected reversed root');
    return { phase: shifted.phase, offsetMetres: shifted.amount, offsetWorld: shifted.offsetWorld,
      heading: shifted.heading, splatCounts: shifted.props.map(prop => prop.count), physicalTurnBoxFixed: true,
      seatEdgeOnCurrentWall: true, seatLongitudinalStation: shifted.seat.base[2], boxFloorRaiseRemoved: true,
      broomCentredAtZ6: shifted.broom.baseWorld, holeNearBounds: shifted.hole.nearBounds, holeFarBounds: shifted.hole.farBounds,
      wallLockedWidth: shifted.wall.width, wallLockedBase: shifted.wall.centre, wallDoesNotRefitAfterCorrection: true,
      repeatedApplyStable: true, oneCentimetreNudges: true, invalid101CentimetresRejected: true,
      zeroRestoresReversedRoot: true, screenshot: 'rotation-offset.png' };
  } finally {
    await page.locator('#experience-flip-zero').click();
    await page.evaluate(original => {
      const { broom, floorHole, wallBlocker, camera, controls } = window.__debug;
      if (!original.broom) broom.reset();
      if (!original.hole) floorHole.close();
      if (!original.wall) wallBlocker.reset();
      wallBlocker.update = window.__offsetWallUpdate; delete window.__offsetWallUpdate;
      camera.position.fromArray(original.camera); controls.target.fromArray(original.target);
      controls.enableDamping = original.damping; controls.update();
    }, original);
    await details.evaluate((element, saved) => {
      element.open = saved.open;
      const panel = element.closest('#experience-panel'); if (panel) panel.scrollTop = saved.panelScroll;
    }, originalUi);
  }
}
