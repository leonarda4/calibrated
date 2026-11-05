import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

/** An RGBA target retains alpha even when the desktop canvas has alpha:false.
 * This checks the pixels an alpha-capable XR layer would actually receive.
 * No immersive session or SteamVR compositor is used by this regression.
 */
export async function runOpaqueFrameScenario(page, output, loaded = false) {
  const result = await page.evaluate(async loaded => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { renderer, scene, camera, splats } = window.__debug;
    const width = 192, height = 128;
    const target = new THREE.WebGLRenderTarget(width, height, {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    });
    const previousTarget = renderer.getRenderTarget();
    const viewport = renderer.getViewport(new THREE.Vector4());
    const scissor = renderer.getScissor(new THREE.Vector4());
    const scissorTest = renderer.getScissorTest();
    const clearAlpha = renderer.getClearAlpha();
    const material = loaded ? splats.viewer.splatMesh.material : null;
    const savedOpacity = material?.uniforms.uGlobalOpacity.value;
    const savedSplatVisibility = splats.visible;
    const hidden = [];
    const frames = [];
    const sheet = document.createElement('canvas');
    sheet.width = width * (loaded ? 6 : 1); sheet.height = height + 28;
    const context = sheet.getContext('2d');
    const capture = (name, renderedScene) => {
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      renderer.render(renderedScene, camera);
      const bytes = new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes);
      let minAlpha = 255, transparentPixels = 0, rgb = 0, nonWhitePixels = 0;
      const picture = context.createImageData(width, height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4, alpha = bytes[i + 3];
        minAlpha = Math.min(minAlpha, alpha);
        if (alpha !== 255) transparentPixels++;
        rgb += bytes[i] + bytes[i + 1] + bytes[i + 2];
        if (765 - bytes[i] - bytes[i + 1] - bytes[i + 2] > 15) nonWhitePixels++;
        const destination = ((height - 1 - y) * width + x) * 4;
        // Composite over a conspicuous stand-in environment: leaked alpha is pink.
        const environment = ((x >> 4) + (y >> 4)) % 2 ? [220, 20, 170] : [45, 5, 75];
        for (let channel = 0; channel < 3; channel++) {
          picture.data[destination + channel] = Math.min(255, bytes[i + channel] + environment[channel] * (1 - alpha / 255));
        }
        picture.data[destination + 3] = 255;
      }
      const offset = frames.length * width;
      context.putImageData(picture, offset, 28);
      context.fillStyle = '#151b23'; context.fillRect(offset, 0, width, 28);
      context.fillStyle = '#ffffff'; context.font = '12px monospace';
      context.fillText(name, offset + 6, 18);
      frames.push({ name, minAlpha, transparentPixels, rgb, nonWhitePixels,
        whiteDistance: width * height * 765 - rgb });
    };
    try {
      // No meshes and no scene background: the production clear itself must be opaque.
      capture('Empty / loading', new THREE.Scene());
      if (loaded) {
        // Exercise the actual scene before hiding any diagnostic/helper geometry.
        // The production scene must expose only the opaque white void.
        material.uniforms.uGlobalOpacity.value = 0;
        capture('Actual scene / hidden', scene);
        material.uniforms.uGlobalOpacity.value = savedOpacity;
        splats.visible = false;
        capture('Actual scene / absent', scene);
        splats.visible = savedSplatVisibility;
        const mesh = splats.viewer.splatMesh;
        scene.traverse(object => {
          if (object !== mesh && (object.isMesh || object.isSprite || object.isLine || object.isPoints)) {
            hidden.push([object, object.visible]); object.visible = false;
          }
        });
        for (const [name, opacity] of [['Splats 100%', 1], ['Calibration fade 25%', .25], ['Splats hidden', 0]]) {
          material.uniforms.uGlobalOpacity.value = opacity;
          capture(name, scene);
        }
      }
      // Prove readback isn't masking alpha just because the canvas is opaque.
      renderer.setClearAlpha(0);
      renderer.render(new THREE.Scene(), camera);
      const transparentControl = new Uint8Array(4);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, transparentControl);
      renderer.setClearAlpha(clearAlpha);
      return {
        frames, png: sheet.toDataURL('image/png').split(',')[1],
        transparentControlAlpha: transparentControl[3],
        contextAlpha: renderer.getContext().getContextAttributes().alpha,
        clearAlpha: renderer.getClearAlpha(),
        clearColor: renderer.getClearColor(new THREE.Color()).getHex(),
        sceneBackground: scene.background?.isColor ? scene.background.getHex() : null,
        rgbaTarget: true, syntheticOnly: true,
      };
    } finally {
      renderer.setClearAlpha(clearAlpha);
      splats.visible = savedSplatVisibility;
      if (loaded) material.uniforms.uGlobalOpacity.value = savedOpacity;
      for (const [object, visible] of hidden) object.visible = visible;
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
      target.dispose();
    }
  }, loaded);
  const screenshot = loaded ? 'opaque-splat-frames.png' : 'opaque-loading-frame.png';
  await fs.writeFile(path.join(output, screenshot), Buffer.from(result.png, 'base64'));
  delete result.png;
  assert.equal(result.transparentControlAlpha, 0, 'RGBA readback must detect a deliberately transparent control.');
  for (const frame of result.frames) {
    assert.equal(frame.transparentPixels, 0,
      `${frame.name}: ${frame.transparentPixels} pixels can expose the compositor environment (minimum alpha ${frame.minAlpha}).`);
  }
  assert.equal(result.contextAlpha, false, 'The application canvas still requests AR transparency.');
  assert.equal(result.clearAlpha, 1);
  assert.equal(result.sceneBackground, 0xffffff, 'The world needs an opaque white background.');
  assert.equal(result.clearColor, 0xffffff, 'Empty/loading frames must clear to white.');
  assert.equal(result.frames[0].whiteDistance, 0, 'Uncovered space must be white.');
  if (loaded) {
    const actualHidden = result.frames.find(frame => frame.name === 'Actual scene / hidden');
    const actualAbsent = result.frames.find(frame => frame.name === 'Actual scene / absent');
    const full = result.frames.find(frame => frame.name === 'Splats 100%');
    const faded = result.frames.find(frame => frame.name === 'Calibration fade 25%');
    const hidden = result.frames.find(frame => frame.name === 'Splats hidden');
    assert.equal(actualHidden.whiteDistance, 0, 'A hidden scan still reveals app guides or an unintended environment.');
    assert.equal(actualAbsent.whiteDistance, 0, 'A missing scan still reveals app guides or an unintended environment.');
    assert.ok(full.nonWhitePixels > 100, 'Actual splat fragments were not exercised.');
    assert.ok(faded.whiteDistance > 0 && faded.whiteDistance < full.whiteDistance * .9,
      'Opacity must still fade splat contrast toward the opaque white application frame.');
    assert.equal(hidden.whiteDistance, 0, 'A fully faded scan must reveal white.');
  }
  return { ...result, screenshot };
}
