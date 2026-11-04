// Standalone private-asset evidence: never imports the application's main.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { chromium } from '@playwright/test';
import { readPly } from './extract-hallway.mjs';
import { ACTIVE_SCAN } from '../src/viewer/scanAsset.ts';
import { scanOriginForStart } from '../src/viewer/scanPlacement.ts';

const root = process.cwd(), output = path.resolve('.check/hallway-cut');
await fs.mkdir(output, { recursive: true });
const asset = 'public/splats/hallway-cut/hallway3-cut.ply';
const report = { date: new Date().toISOString(), environment: 'Standalone desktop Chrome; physical XR disabled; no hardware acceptance', checks: [], errors: [], passed: false };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let server, browser;
try {
  const metadata = JSON.parse(await fs.readFile(`${asset}.meta.json`, 'utf8'));
  const source = await fs.readFile(metadata.source), crop = await fs.readFile(asset);
  assert.equal(hash(source), metadata.sourceSha256); assert.equal(hash(crop), metadata.outputSha256);
  const before = readPly(source), after = readPly(crop);
  assert.equal(before.count, metadata.sourceVertexCount); assert.equal(after.count, metadata.outputVertexCount);
  assert.equal(before.stride, after.stride);
  const planes = metadata.clipPlanesRaw ?? [metadata.cutPlane];
  let target = 0;
  for (let i = 0; i < before.count; i++) {
    if (planes.some(plane => plane.normalRaw.reduce((sum, value, axis) => sum + value * before.centers[i * 3 + axis], plane.constantRaw) < 0)) continue;
    assert.ok(source.subarray(before.end + i * before.stride, before.end + (i + 1) * before.stride)
      .equals(crop.subarray(after.end + target * after.stride, after.end + (target + 1) * after.stride)), `Changed retained vertex ${i}`);
    target++;
  }
  assert.equal(target, after.count);
  assert.ok(Math.abs(metadata.floorOrthogonalityDot) < 1e-12);
  assert.ok(Math.max(...metadata.walls.cutAngleErrorDegrees) < .5);
  report.checks.push({ name: 'All retained records byte-identical, exactly the cut and corridor envelope; floor-orthogonal cut', passed: true,
    details: { sourceCount: before.count, cropCount: after.count, sourceSha256: hash(source), outputSha256: hash(crop), plane: metadata.cutPlane,
      envelope: metadata.envelope, floorResidual: metadata.floorFit.residual, wallResidual: metadata.walls.residual, wallAngleErrorDegrees: metadata.walls.cutAngleErrorDegrees } });
  for (const [file, expected] of [
    ['src/viewer/scanAsset.ts', 'ec629526d142081756c6b2ae32f595d842225243df23e3ca381924599f47dae6'],
    ['src/calibration/landmarks.ts', 'fbf0240aa64b2c50870dd1c6a94db38a4259191b60e7fbece17eaaa3c6f2b482'],
  ]) assert.equal(hash(await fs.readFile(file)), expected, `${file} changed`);
  report.checks.push({ name: 'Original source fingerprint and protected placement/landmark files unchanged', passed: true });

  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>
    body{margin:0;background:#11151c;font:14px system-ui;color:#edf4f7}canvas{display:block}#label{position:fixed;top:18px;left:20px;background:#111b;padding:12px 18px;border-radius:8px;pointer-events:none}
    </style><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script></head><body><div id="label">Separate hallway crop · original coordinates · loading…</div><script type="module">
    import * as THREE from 'three';
    import { DropInViewer, SceneRevealMode } from '/node_modules/@mkkellogg/gaussian-splats-3d/build/gaussian-splats-3d.module.js';
    const renderer = new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
    renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.setClearColor(0x11151c,1);document.body.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.05,100);
    const splats=new DropInViewer({gpuAcceleratedSort:false,sharedMemoryForWorkers:false,integerBasedSort:false,dynamicScene:true,
      sceneRevealMode:SceneRevealMode.Instant,sphericalHarmonicsDegree:0,inMemoryCompressionLevel:0,halfPrecisionCovariancesOnGPU:false,optimizeSplatData:false});
    scene.add(splats); await splats.addSplatScenes([{path:'/splats/hallway-cut/hallway3-cut.ply',splatAlphaRemovalThreshold:0}]);
    splats.quaternion.fromArray(${JSON.stringify(ACTIVE_SCAN.rotation)});splats.position.fromArray(${JSON.stringify(scanOriginForStart(ACTIVE_SCAN.startPoint,ACTIVE_SCAN.rotation))});
    const wait=async p=>{if(p)await Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('Sort timeout')),45000))]);};
    async function view(position,target,label){
      camera.position.fromArray(position);camera.lookAt(new THREE.Vector3(...target));camera.updateMatrixWorld(true);scene.updateMatrixWorld(true);
      splats.viewer.update(renderer,camera);await wait(splats.viewer.sortPromise);splats.viewer.splatMesh.updateTransforms();
      await wait(splats.viewer.runSplatSort(true,true));await wait(splats.viewer.sortPromise);
      splats.viewer.update(renderer,camera);renderer.render(scene,camera);document.querySelector('#label').textContent=label;
      return {renderedSplats:splats.viewer.splatMesh.getSplatCount(),rawRootMatrix:splats.matrix.toArray(),width:renderer.domElement.width,height:renderer.domElement.height};
    }
    window.cropPreview={view,renderer,scene,camera,splats};window.ready=true;
    </script></body></html>`;
  const previewPath = '/__hallway_crop_preview.html';
  const allowedFiles = new Map([
    ['/splats/hallway-cut/hallway3-cut.ply', asset],
    ...['three/build/three.module.js', 'three/build/three.core.js', '@mkkellogg/gaussian-splats-3d/build/gaussian-splats-3d.module.js']
      .map(file => [`/node_modules/${file}`, `node_modules/${file}`]),
  ]);
  server = createServer(async (request, response) => {
    if (request.url === previewPath) { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return; }
    const file = allowedFiles.get(request.url);
    if (!file) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    response.setHeader('Content-Length', (await fs.stat(file)).size);
    createReadStream(file).on('error', error => response.destroy(error)).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-webxr-runtime=no-xr-runtime'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  await context.addInitScript(() => Object.defineProperty(navigator, 'xr', { configurable: true, value: Object.assign(new EventTarget(), {
    isSessionSupported: async () => false, requestSession: async () => { throw Error('Hardware XR disabled.'); },
  }) }));
  const page = await context.newPage();
  page.on('pageerror', error => { report.errors.push(error.message); console.error(error.message); });
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${port}${previewPath}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  for (const [name, position, target, label] of [
    ['front', [.05, 1.25, 0], [.05, -.65, 15], 'Separate hallway crop · front · cut beside FoodTech'],
    ['cut-overview', [4.2, 3.2, -2.4], [.1, 1.1, 4], 'Separate hallway crop · oblique view of the transverse cut'],
  ]) {
    const details = await page.evaluate(async ({position, target, label}) => window.cropPreview.view(position, target, label), {position, target, label});
    assert.equal(details.renderedSplats, after.count);
    const pixels = await page.evaluate(() => {
      const gl = window.cropPreview.renderer.getContext(), data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,data);
      let changed=0;for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-17)+Math.abs(data[i+1]-21)+Math.abs(data[i+2]-28)>35)changed++;
      return changed;
    });
    assert.ok(pixels > 20000, `Blank crop render: ${pixels}`);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    report.checks.push({ name: `${name}: actual standalone PLY parse/render`, passed: true, details: {...details, nonBackgroundPixels: pixels} });
    console.log(`PASS ${name}`);
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) { report.failure = error.stack; process.exitCode = 1; console.error(error); }
finally {
  await browser?.close();
  if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
