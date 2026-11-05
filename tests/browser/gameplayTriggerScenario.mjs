import assert from 'node:assert/strict';
import path from 'node:path';

/** Actual main.ts music/lighting hooks and the render-loop camera-over-hole trigger. */
export async function runGameplayTriggerScenario(page, output) {
  try {
    await page.evaluate(async () => {
      const { experience, hallwayLighting, wallBlocker, camera, controls } = window.__debug;
      const ensure = (ok, message) => { if (!ok) throw new Error(`Gameplay trigger regression: ${message}`); };
      const state = { THREE:await import('/node_modules/.vite/deps/three.js'), experienceUpdate: experience.update, lightingUpdate: hallwayLighting.update, wallUpdate: wallBlocker.update,
        transition: experience.gameplayAudio.transition, speech: experience.gameplayAudio.speech,
        speechCalls: [], camera: camera.position.toArray(), target: controls.target.toArray(),
        damping: controls.enableDamping, controlsEnabled: controls.enabled, muted: experience.gameplayAudio.snapshot().muted,
        elapsed: 0, transitions: [], ensure };
      window.__gameplayTriggers = state;
      experience.update = () => {}; hallwayLighting.update = () => {}; wallBlocker.update = () => {};
      controls.enableDamping = false;
      // The check-owned Chrome is globally muted. Suppress auxiliary output too,
      // while retaining native background playback for its source-path assertions.
      experience.voices.setMuted(true); experience.gameplayAudio.setMuted(false);
      await experience.gameplayAudio.unlock(); await experience.gameplayAudio.preload();
      experience.gameplayAudio.transition = index => {
        const accepted = state.transition(index);
        state.transitions.push({ index, elapsed: state.elapsed, performanceMs: performance.now(), accepted,
          phase: experience.installation.snapshot().phase, lightingPhase: hallwayLighting.snapshot().cuePhase });
        return accepted;
      };
      experience.gameplayAudio.speech = id => {
        state.speechCalls.push({ id, elapsed: state.elapsed, phase: experience.installation.snapshot().phase });
        state.speech(id);
      };
      document.getElementById('experience-reset').click();
      camera.position.set(0, 1.7, 3); controls.target.set(0, 1.2, -4); controls.update(); camera.updateMatrixWorld(true);
      ensure(experience.startTestScenarioPreview(), 'Fresh desktop preview did not start');
      state.experienceUpdate(0);
      ensure(experience.gameplayAudio.snapshot().running, 'Preview did not start background playback');
    });
    await page.waitForFunction(() => window.__debug.experience.gameplayAudio.snapshot().currentMusic?.endsWith('Ambience_1.wav'));
    const timed = await page.evaluate(() => {
      const { experience, hallwayLighting } = window.__debug, s = window.__gameplayTriggers;
      let spinAt = null, settledAt = null, flickerAt = null, boxPreservedMusic = false;
      let lastPhase = experience.installation.snapshot().phase;
      while (s.elapsed < 40 - 1e-9) {
        const dt = Math.min(.1, 40 - s.elapsed); s.elapsed += dt;
        s.experienceUpdate(dt);
        const state = experience.installation.snapshot();
        if (state.phase === 'box' && lastPhase !== 'box') boxPreservedMusic = experience.gameplayAudio.snapshot().running;
        if (state.phase === 'rotating' && lastPhase !== 'rotating') spinAt = s.elapsed;
        lastPhase = state.phase;
        const settled = state.phase === 'reversed' && state.secondBox.visible && state.secondBox.reveal.motion === 'visible';
        if (settled && settledAt === null) settledAt = s.elapsed;
        hallwayLighting.observeSecondBox(settled); s.lightingUpdate(dt);
        if (hallwayLighting.snapshot().flickering && flickerAt === null) flickerAt = s.elapsed;
      }
      const [turnMusic, flickerMusic] = s.transitions;
      const openingSpeech = s.speechCalls.filter(cue => cue.elapsed < 20);
      s.ensure(openingSpeech.length === 2 && openingSpeech[0].id === 'welcome' && openingSpeech[1].id === 'stepOnBox' &&
        Math.abs(openingSpeech[0].elapsed - 1) < .11 && Math.abs(openingSpeech[1].elapsed - 8) < .11 &&
        openingSpeech[1].phase === 'box' && !s.speechCalls.some(cue => cue.id === 'findBox'),
        'Opening speech must be welcome at 1s, then step-on instruction with the first box at 8s; no find-box instruction');
      s.ensure(s.transitions.length === 2 && turnMusic.index === 1 && flickerMusic.index === 2 &&
        turnMusic.accepted && flickerMusic.accepted, 'Main hooks did not start exactly transitions 1 and 2');
      s.ensure(Math.abs(turnMusic.elapsed - 20) < .11 && Math.abs(spinAt - 22) < .11,
        'Autoplay did not retain exploration and the two-second turn anticipation');
      s.ensure(settledAt !== null && flickerAt !== null && Math.abs(flickerAt - flickerMusic.elapsed - 2) < .11,
        'Flicker music did not anticipate the actual lighting by two seconds');
      s.ensure(Math.abs(flickerMusic.elapsed - 33) < .21 && Math.abs(flickerAt - 35) < .21,
        'Second-box settled visibility did not set the expected flicker timeline');
      s.ensure(boxPreservedMusic && experience.gameplayAudio.snapshot().running,
        'A box reveal or turn stopped the background soundtrack');
      s.ensure(hallwayLighting.snapshot().brightness === .3 && experience.gameplayAudio.snapshot().lastTransition === 2 &&
        experience.gameplayAudio.snapshot().transition === null, 'Second transition did not complete into the dim hallway');
      s.timed = { turnMusicSeconds: turnMusic.elapsed, spinSeconds: spinAt, settledSecondBoxSeconds: settledAt,
        flickerMusicSeconds: flickerMusic.elapsed, flickerSeconds: flickerAt, musicContinuesAcrossBoxReveal: boxPreservedMusic,
        openingSpeech, openingFindBoxSkipped: true };
      return s.timed;
    });
    await page.waitForFunction(() => window.__debug.experience.gameplayAudio.snapshot().currentMusic?.endsWith('Ambience_3.wav'));
    await page.evaluate(() => {
      const { floorHole, holeTransition } = window.__debug, s = window.__gameplayTriggers;
      s.ensure(floorHole.show(), `Actual floor hole failed to fit: ${floorHole.snapshot().status}`);
      s.ensure(holeTransition.snapshot().phase === 'idle', 'Hole trigger started before the camera entered its fitted footprint');
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const { experience, floorHole, holeTransition, camera, controls, splats, scene } = window.__debug;
      const s = window.__gameplayTriggers, hole = floorHole.snapshot();
      s.ensure(holeTransition.snapshot().phase === 'idle' && s.transitions.length === 2, 'Outside camera triggered the hole');
      const center = hole.worldCorners.reduce((sum, point) => sum.map((value, index) => value + point[index] / 4), [0, 0, 0]);
      camera.position.set(center[0], center[1] + 1.7, center[2]);
      controls.target.set(center[0], center[1] + 1.1, center[2] - 2); controls.update(); camera.updateMatrixWorld(true);
      s.experienceUpdate(0); // Publish the actual camera through the coordinator's normal pose callback.
      scene.updateMatrixWorld(true);
      s.beforeHole = { camera: camera.matrixWorld.toArray(), scan: splats.matrixWorld.toArray(),
        scanLocal: splats.matrix.toArray(),
        firstBox: scene.getObjectByName('installation-box').matrixWorld.toArray(),
        secondBox: scene.getObjectByName('installation-second-box').matrixWorld.toArray(),
        floor: JSON.stringify(floorHole.snapshot().worldCorners) };
    });
    await page.waitForFunction(() => window.__debug.holeTransition.snapshot().phase === 'anticipating');
    const anticipated = await page.evaluate(() => ({ phase: window.__debug.holeTransition.snapshot().phase,
      remaining: window.__debug.holeTransition.snapshot().remainingSeconds,
      music: window.__debug.experience.gameplayAudio.snapshot().desiredMusic }));
    assert.equal(anticipated.phase, 'anticipating'); assert.ok(anticipated.remaining > 1.4);
    assert.ok(anticipated.music.endsWith('Transition_3.wav'));
    await page.screenshot({ path: path.join(output, 'hole-world-before.png'), fullPage: true });
    await page.waitForFunction(() => window.__debug.holeTransition.snapshot().phase === 'triggered', undefined, { timeout: 8000 });
    await page.waitForFunction(() => window.__debug.holeWorldRotation.snapshot().angleDegrees >= 35, undefined, { timeout: 7000 });
    const middleTurn = await page.evaluate(() => {
      const {holeWorldRotation,camera,scene}=window.__debug, s=window.__gameplayTriggers;
      const state=holeWorldRotation.snapshot();scene.updateMatrixWorld(true);
      s.ensure(state.phase==='turning'&&state.angleDegrees>0&&state.angleDegrees<90,'The hallway skipped its eased intermediate poses');
      s.ensure(camera.matrixWorld.toArray().every((v,i)=>Math.abs(v-s.beforeHole.camera[i])<1e-7),'World turn moved the tracked viewpoint');
      return state;
    });
    await page.screenshot({ path: path.join(output, 'hole-world-mid.png'), fullPage: true });
    await page.waitForFunction(() => window.__debug.holeWorldRotation.snapshot().phase === 'complete', undefined, { timeout: 7000 });
    const hole = await page.evaluate(() => {
      const { experience, holeTransition, holeWorldRotation, floorHole, hallwayCut, camera, splats, scene } = window.__debug, s = window.__gameplayTriggers;
      scene.updateMatrixWorld(true);
      const equal = (actual, expected) => actual.every((value, index) => Math.abs(value - expected[index]) < 1e-7);
      s.ensure(s.transitions.length === 3 && s.transitions[2].index === 3 && s.transitions[2].accepted,
        'Main camera-over-hole path failed to start transition 3 exactly once');
      s.ensure(holeTransition.snapshot().visualImplemented && floorHole.snapshot().open && hallwayCut.snapshot().visible,
        'The transition hid its attached hallway');
      s.ensure(equal(camera.matrixWorld.toArray(), s.beforeHole.camera) && equal(splats.matrix.toArray(), s.beforeHole.scanLocal) &&
        !equal(splats.matrixWorld.toArray(), s.beforeHole.scan) && JSON.stringify(floorHole.snapshot().worldCorners) === s.beforeHole.floor,
        'Quarter-turn must rotate the presented world while retaining camera/source/captured-hole coordinates');
      const THREE=window.__gameplayTriggers.THREE;
      const presentation=new THREE.Matrix4().fromArray(holeWorldRotation.snapshot().matrix);
      const state=floorHole.snapshot(), cut=hallwayCut.snapshot();
      s.ensure(Math.abs(holeWorldRotation.snapshot().angleDegrees-90)<1e-7,'The final hallway angle is not 90 degrees');
      const hinge=new THREE.Vector3(...holeWorldRotation.snapshot().hingeWorld);
      const floorAtEnd=cut.floorSide==='end';
      const floorCorners=state.worldCorners.slice(floorAtEnd?2:0,floorAtEnd?4:2);
      s.ensure(floorCorners.every(p=>new THREE.Vector3(...p).applyMatrix4(presentation).distanceTo(new THREE.Vector3(...p))<1e-7),
        'The floor hinge moved during the turn');
      const floorDepth=new THREE.Vector3(...floorCorners[0]).add(new THREE.Vector3(0,-3,0)).applyMatrix4(presentation);
      s.ensure(Math.abs(floorDepth.y-state.floorY)<1e-7,'The new corridor floor is above or below the physical floor');
      s.ensure(Math.abs(new THREE.Vector3(0,-1,0).transformDirection(presentation).y)<1e-7,'The new hallway remains sloped');
      const route=new THREE.Matrix4().fromArray(state.routeToWorld);
      const cutRoute=window.__debug.splats.viewer.splatMesh.material.uniforms.uHallwayCutRouteToWorld.value;
      s.ensure(cut.mouthWorld.every(point=>new THREE.Vector3(...point).applyMatrix4(route.clone().invert()).applyMatrix4(cutRoute)
        .distanceTo(new THREE.Vector3(...point).applyMatrix4(presentation))<1e-7),'The cutout detached from the rotating opening');
      for(const [name,key] of [['installation-box','firstBox'],['installation-second-box','secondBox']]) {
        const expected=new THREE.Matrix4().fromArray(s.beforeHole[key]).premultiply(presentation);
        s.ensure(equal(scene.getObjectByName(name).matrixWorld.toArray(),expected.toArray()),`${name} did not rotate with the complete world`);
      }
      s.ensure(experience.gameplayAudio.snapshot().lastTransition === 3, 'Hole music stage was not recorded');
      return { actualRenderLoopCameraEntry: true, transitionCount: s.transitions.length, onceOnly: true,
        visualImplemented: true, cameraAndSourceCoordinatesUnchanged:true, floorHingeFixed:true, finalAngle:90,
        joinedMouth:true, leadSeconds:2, turnSeconds:holeWorldRotation.snapshot().durationSeconds, hinge:hinge.toArray() };
    });
    await page.screenshot({ path: path.join(output, 'hole-world-horizontal.png'), fullPage: true });
    await page.screenshot({ path: path.join(output, 'gameplay-audio-flow.png'), fullPage: true });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const { experience, holeTransition, holeWorldRotation, worldPresentation, floorHole, lightFlickerAudio, wallMovementAudio } = window.__debug, s = window.__gameplayTriggers;
      s.ensure(s.transitions.length === 3, 'Stationary camera replayed transition 3');
      document.getElementById('experience-reset').click();
      s.ensure(!experience.gameplayAudio.snapshot().running && holeTransition.snapshot().phase === 'idle' && !floorHole.snapshot().open &&
        !lightFlickerAudio.snapshot().playing && !wallMovementAudio.snapshot().playing, 'Reset retained an old cue or auxiliary source');
      s.ensure(holeWorldRotation.snapshot().phase==='idle'&&worldPresentation.snapshot().matrix.every((v,i)=>Math.abs(v-(i%5===0?1:0))<1e-8),
        'Reset retained the rotated environment');
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const { experience, holeTransition } = window.__debug, s = window.__gameplayTriggers;
      s.ensure(!experience.gameplayAudio.snapshot().running && holeTransition.snapshot().phase === 'idle' && s.transitions.length === 3,
        'Reset allowed a pending soundtrack/trigger to revive');
      s.ensure(experience.startTestScenarioPreview(), 'Fresh preview failed after reset');
      s.ensure(experience.gameplayAudio.snapshot().lastTransition === 0 && experience.scenario.snapshot().stage === 'waitingWelcome',
        'Fresh preview retained an old audio stage or skipped welcome');
    });
    await page.waitForFunction(() => window.__debug.experience.gameplayAudio.snapshot().currentMusic?.endsWith('Ambience_1.wav'));
    return { ...timed, hole, middleTurn, actualMainWiring: true, resetCancelsAllAudio: true, freshPreviewRestartsAmbience1: true,
      screenshot: 'gameplay-audio-flow.png', desktopOnly: true, noAudibleOrHardwareAcceptance: true };
  } finally {
    await page.evaluate(() => {
      const s = window.__gameplayTriggers;
      if (!s) return;
      const { experience, hallwayLighting, wallBlocker, camera, controls } = window.__debug;
      document.getElementById('experience-reset').click();
      experience.update = s.experienceUpdate; hallwayLighting.update = s.lightingUpdate; wallBlocker.update = s.wallUpdate;
      experience.gameplayAudio.transition = s.transition; experience.gameplayAudio.speech = s.speech;
      experience.voices.setMuted(s.muted);
      camera.position.set(...s.camera); controls.target.set(...s.target); controls.update();
      controls.enableDamping = s.damping; controls.enabled = s.controlsEnabled;
      delete window.__gameplayTriggers;
    }).catch(() => {});
  }
}
