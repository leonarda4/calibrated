// Actual bundled models, driven by synthetic current-frame WebXR joints.
// This is an isolated desktop asset check; it does not start an XR session.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export async function runHandModelsScenario(parentPage) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = path.join(root, '.check');
  const report = { date: new Date().toISOString(), environment: 'Desktop Chrome; actual bundled GLBs with synthetic WebXR joints; no immersive session or hardware claim', checks: [], consoleErrors: [], passed: false };
  const page = await parentPage.context().newPage();
  try {
    await fs.mkdir(output, { recursive: true });
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await page.route('**/hands-preview', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#101824;color:#e3edf2;font:16px monospace"><div style="position:absolute;top:24px;left:30px">LOCAL SKINNED WEBXR HANDS<br><small>Synthetic joint poses - desktop asset check only</small></div></body></html>' }));
    await page.setViewportSize({ width: 1000, height: 650 });
    await page.goto(`${new URL(parentPage.url()).origin}/hands-preview`);
    await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { setupTrackedHands } = await import('/src/xr/hands.ts');
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1000, 650);
      renderer.setClearColor(0x101824);
      document.body.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1000 / 650, 0.01, 10);
      camera.position.set(0, 0, 0.65); camera.lookAt(0, 0, 0);
      const sources = [], poses = new Map();
      for (const handedness of ['left', 'right']) {
        const bytes = await (await fetch(`/hands/${handedness}.glb`)).arrayBuffer();
        const view = new DataView(bytes);
        if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error('Invalid GLB v2 asset.');
        const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, view.getUint32(12, true))));
        const jointNodes = json.skins[0].joints.map(index => json.nodes[index]);
        if (jointNodes.length !== 25) throw new Error('Expected 25 WebXR joints.');
        const wrist = jointNodes.find(node => node.name === 'wrist').translation;
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), handedness === 'left' ? Math.PI / 2 : -Math.PI / 2);
        const input = { handedness, hand: new Map() };
        for (const node of jointNodes) {
          const jointSpace = {};
          input.hand.set(node.name, jointSpace);
          const position = new THREE.Vector3(...node.translation).sub(new THREE.Vector3(...wrist)).applyQuaternion(rotation);
          position.x += handedness === 'left' ? -0.13 : 0.13; position.y += 0.08;
          const orientation = new THREE.Quaternion(...node.rotation).premultiply(rotation);
          poses.set(jointSpace, { emulatedPosition: false, radius: 0.008, transform: { position, orientation } });
        }
        sources.push(input);
      }
      const space = {};
      const xr = { isPresenting: true, getSession: () => ({ inputSources: sources }), getReferenceSpace: () => space, addEventListener() {}, removeEventListener() {} };
      const frame = { getJointPose: joint => poses.get(joint) };
      const hands = setupTrackedHands({ xr }, scene, { meshPath: '/hands/' });
      renderer.setAnimationLoop(() => { hands.update(frame, space); renderer.render(scene, camera); });
      window.__handsCheck = { renderer, scene, camera, hands, frame, space, poses, sources };
    });
    await page.waitForFunction(() => ['left', 'right'].every(hand => window.__handsCheck.scene.getObjectByName(`tracked-${hand}-hand`)?.children.length === 3), undefined, { timeout: 15000 });
    await page.waitForTimeout(250);
    report.checks.push(await page.evaluate(() => {
      const { scene, hands, frame, space, renderer } = window.__handsCheck;
      const meshes = [];
      scene.traverse(object => { if (object.isSkinnedMesh) meshes.push(object); });
      if (meshes.length !== 2 || meshes.some(mesh => !mesh.visible || mesh.material.type !== 'MeshBasicMaterial')) throw new Error('Expected two visible unlit skinned hands.');
      const contacts = hands.update(frame, space);
      if (contacts.length !== 2) throw new Error('Synthetic current joint poses did not provide two fingertip contacts.');
      const gl = renderer.getContext();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      renderer.render(scene, window.__handsCheck.camera);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 100 && pixels[i + 1] > 100) lit++;
      if (lit < 1000) throw new Error(`Hand mesh frame is blank (${lit} bright pixels).`);
      return { name: 'both bundled skinned hands render from current synthetic joints without lights', passed: true, skinMeshes: meshes.length, contacts: contacts.length, brightPixels: lit };
    }));
    await page.screenshot({ path: path.join(output, 'hands.png'), fullPage: true });
    report.checks.push(await page.evaluate(() => {
      const { scene, hands, frame, space, poses } = window.__handsCheck;
      poses.clear();
      const contacts = hands.update(frame, space);
      if (contacts.length || ['left', 'right'].some(hand => scene.getObjectByName(`tracked-${hand}-hand`).visible)) throw new Error('Missing joints retained visible hands or contact authority.');
      hands.dispose();
      window.__handsCheck.renderer.setAnimationLoop(null);
      return { name: 'missing current joint poses hide hands and clear contact', passed: true };
    }));
    assert.deepEqual(report.consoleErrors, []);
    report.checks.push({ name: 'no desktop JavaScript errors', passed: true });
    report.passed = true;
    return report;
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    await fs.writeFile(path.join(output, 'hands-report.json'), JSON.stringify(report, null, 2));
    await page.close();
  }
}
