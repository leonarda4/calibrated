import * as THREE from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { HALLWAY_CUT, cutOpeningFromMetadata, type HoleMouth, type Point3 } from '../viewer/hallwayCutPlacement.ts';
import { FOG, type FogPassage } from './volumeFogConfig.ts';
import { loadVolume } from './volumeTexture.ts';
import { corridorAtmosphereMatrix, stretchVolumeHeight } from './corridorAtmosphere.ts';
import { fogVertex, fogFragment } from './volumeFogShader.ts';
import { destructionUniforms, writeDestructionUniforms, type CutoutDestructionMask } from './collapseDamage.ts';

/** One fixed floor volume in the added hallway, attached throughout its turn. */
export function createVolumeFog(options: {
  scene: THREE.Scene; scanRoot: DropInViewer; canRender(): boolean;
  getHole(): HoleMouth;
  getSecondBoxRoute(): Point3 | null;
  getDestruction?(): CutoutDestructionMask;
  enabled?: boolean;
}) {
  const { scanRoot } = options;
  const root = new THREE.Group(); root.name = 'downward-hallway-fog'; root.visible = false; options.scene.add(root);
  const meshes: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>[] = [];
  let density: THREE.Data3DTexture | null = null;
  let height = 0;
  let phase: 'loading' | 'ready' | 'off' | 'error' = options.enabled === false ? 'off' : 'loading';
  let error: string | null = null, time = 0, cutKey = '';
  let disposed = false, visibleOverride = true;
  const abort = new AbortController();

  function addVolume(name: string, passage: FogPassage, textureMin: Point3, textureSize: Point3) {
    const xMin = Math.min(passage.sides[0], passage.sides[2]), xMax = Math.max(passage.sides[1], passage.sides[3]);
    const min = new THREE.Vector3(xMin, 0, passage.start), max = new THREE.Vector3(xMax, height, passage.end);
    const size = max.clone().sub(min), centre = max.clone().add(min).multiplyScalar(.5);
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z).translate(centre.x, centre.y, centre.z);
    const material = new THREE.ShaderMaterial({ vertexShader: fogVertex, fragmentShader: fogFragment,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.BackSide,
      uniforms: {
        uDensity: { value: density }, uTextureMin: { value: new THREE.Vector3(...textureMin) },
        uTextureSize: { value: new THREE.Vector3(...textureSize) }, uMin: { value: min }, uMax: { value: max },
        uSides: { value: new THREE.Vector4(...passage.sides) }, uPortalHeight: { value: passage.portalHeight ?? 0 },
        uWorldToFog: { value: new THREE.Matrix4() }, uTime: { value: 0 },
        uOpacity: { value: 0 }, uBrightness: { value: 1 },
        ...destructionUniforms(),
        uDensityScale: { value: FOG.densityScale }, uExtinction: { value: FOG.extinction },
        uFogHeight: { value: height },
      } });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.matrixAutoUpdate = false; mesh.visible = false; mesh.renderOrder = 20;
    // Renderer invokes this separately for each XR eye; built-in viewMatrix is
    // the current eye, not the inspection camera or ArrayCamera midpoint.
    mesh.onBeforeRender = () => {
      const u = material.uniforms, splat = scanRoot.viewer.splatMesh.material as THREE.ShaderMaterial;
      u.uWorldToFog.value.copy(mesh.matrixWorld).invert();
      u.uTime.value = time;
      u.uOpacity.value = scanRoot.visible === false ? 0 : (splat.uniforms.uGlobalOpacity?.value ?? 1)*(splat.uniforms.uRealityOpacity?.value??1);
      if (passage.portalHeight && !scanRoot.getSplatScene(HALLWAY_CUT.sceneIndex).visible) u.uOpacity.value = 0;
      u.uBrightness.value = splat.uniforms.uHallwayBrightness?.value ?? 1;
      const destruction = options.getDestruction?.();
      if (destruction) writeDestructionUniforms(u, destruction);
      material.uniformsNeedUpdate = true;
    };
    root.add(mesh); meshes.push(mesh); return mesh;
  }

  const update = (deltaSeconds = 0) => {
    if (Number.isFinite(deltaSeconds) && deltaSeconds > 0 && deltaSeconds <= .5) time += deltaSeconds;
    const hole = options.getHole();
    const cut = meshes[0];
    root.visible = !disposed && phase === 'ready' && visibleOverride && options.canRender() && hole.open;
    if (cut) cut.visible = root.visible;
    if (!root.visible) return;
    if (!cut) return;
    if (hole.open) {
      try {
        const source = cutOpeningFromMetadata(scanRoot.userData.hallwayCutMetadata);
        const signature = JSON.stringify([hole, options.getSecondBoxRoute()]);
        if (signature !== cutKey) {
          cut.matrix.copy(corridorAtmosphereMatrix(source,hole,options.getSecondBoxRoute(),height)); cutKey = signature;
        }
      } catch { cut.visible = false; }
    }
    root.updateMatrixWorld(true);
  };

  return { root, update,
    async initialize() {
      if (phase === 'off' || disposed) return;
      try {
        const loaded = await loadVolume(FOG.metadataUrl, FOG.densityUrl, abort.signal);
        if (disposed) { loaded.texture.dispose(); return; }
        const spec=loaded.spec; density=loaded.texture;
        const source = cutOpeningFromMetadata(scanRoot.userData.hallwayCutMetadata);
        height=source.height*FOG.heightFraction;
        const sampling=stretchVolumeHeight(spec,height);
        addVolume('added-hallway-fog', { start: FOG.startDepth, end: FOG.endDepth,
          sides: [-source.width / 2, source.width / 2, -source.width / 2, source.width / 2], portalHeight: source.height }, sampling.min, sampling.size);
        phase = 'ready'; update();
      } catch (cause) {
        if (disposed) return;
        phase = 'error'; error = cause instanceof Error ? cause.message : String(cause); root.visible = false;
        density?.dispose(); for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); root.remove(mesh); }
        meshes.length = 0;
      }
    },
    setVisible(visible: boolean) { visibleOverride = visible; update(); },
    async warmup(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
      if (phase !== 'ready' || disposed) return;
      if (density) renderer.initTexture(density);
      const visible = root.visible, flags = meshes.map(m => m.visible);
      root.visible = true; meshes.forEach(m => { m.visible = true; });
      try { await renderer.compileAsync(root, camera); }
      finally { root.visible = visible; meshes.forEach((m,i) => { m.visible = flags[i]; }); }
    },
    snapshot: () => ({ phase, error, height, visible: root.visible, visibleRequested: visibleOverride, volumes: meshes.map(m => ({ name:m.name, visible:m.visible,
        matrix:m.matrix.toArray(), min:m.material.uniforms.uMin.value.toArray(), max:m.material.uniforms.uMax.value.toArray(),
        sides:m.material.uniforms.uSides.value.toArray() })), time }),
    dispose() {
      disposed = true; abort.abort(); root.visible = false; density?.dispose();
      for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); }
      root.removeFromParent();
    },
  };
}
