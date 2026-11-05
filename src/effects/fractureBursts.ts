import {
  AdditiveBlending, AnimationMixer, DoubleSide, Group, LoopOnce, Matrix4, Mesh,
  PlaneGeometry, ShaderMaterial, Vector2, Vector3, Vector4, type BufferGeometry, type Scene,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import type { HallwayCollapse } from '../experience/hallwayCollapse.ts';
import { cutoutFarDepth } from './cutoutDisintegration.ts';

const ASSET = '/effects/fracture/fracture.glb';
const METADATA = '/effects/fracture/fracture.meta.json';
const vertexShader = `
  varying vec3 vWorld, vNormal; varying vec2 vUv;
  void main() {
    vec4 p=modelMatrix*vec4(position,1.0); vWorld=p.xyz;
    vNormal=normalize(mat3(modelMatrix)*normal); vUv=uv;
    gl_Position=projectionMatrix*viewMatrix*p;
  }
`;
const confinement = `
  uniform mat4 uWorldToOpening;
  uniform vec4 uLimits;
  uniform vec2 uTaper;
  uniform float uOpacity, uBrightness, uScanOpacity;
  varying vec3 vWorld, vNormal; varying vec2 vUv;
  bool outsidePassage() {
    vec3 affinePoint=(uWorldToOpening*vec4(vWorld,1.0)).xyz;
    vec3 p=affinePoint;
    p.x/=max(1e-6,mix(uTaper.x,uTaper.y,p.y/uLimits.y));
    if(p.z<=uLimits.z+0.25 || p.z>uLimits.w+1.0 || abs(p.x)>uLimits.x+0.2 || p.y<0.0 || p.y>uLimits.y) return true;
    vec3 eye=(uWorldToOpening*inverse(viewMatrix)*vec4(0.0,0.0,0.0,1.0)).xyz;
    if(eye.z<0.0) {
      vec3 ray=affinePoint-eye;
      if(ray.z<=0.0) return true;
      vec3 mouth=eye+ray*(-eye.z/ray.z);
      mouth.x/=max(1e-6,mix(uTaper.x,uTaper.y,mouth.y/uLimits.y));
      if(abs(mouth.x)>uLimits.x || mouth.y<0.0 || mouth.y>uLimits.y) return true;
    } else {
      eye.x/=max(1e-6,mix(uTaper.x,uTaper.y,eye.y/uLimits.y));
      if(abs(eye.x)>uLimits.x+0.2 || eye.y<0.0 || eye.y>uLimits.y+0.3) return true;
    }
    return false;
  }
`;
const debrisFragment = confinement + `
  void main() {
    if(uOpacity*uScanOpacity<=0.001 || outsidePassage()) discard;
    float light=0.45+0.55*abs(dot(normalize(vNormal),normalize(vec3(-0.4,0.8,0.3))));
    gl_FragColor=vec4(vec3(0.58,0.54,0.47)*light,uOpacity*uScanOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb*=uBrightness;
  }
`;
const flashFragment = confinement + `
  void main() {
    if(uOpacity*uScanOpacity<=0.001 || outsidePassage()) discard;
    float r=dot(vUv-0.5,vUv-0.5)*4.0;
    float alpha=exp(-r*7.0)*uOpacity*uScanOpacity;
    if(alpha<0.003) discard;
    gl_FragColor=vec4(vec3(1.0,0.7,0.35),alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb*=uBrightness;
  }
`;
const smooth = (a: number, b: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - a) / (b - a))); return t * t * (3 - 2 * t);
};

/** Small preloaded pool of the supplied fragment animation, never a scan mutation. */
export function createFractureBursts(options: { scene: Scene; scanRoot: DropInViewer }) {
  const root = new Group(); root.name = 'added-hallway-fractures'; root.visible = false; options.scene.add(root);
  const pools: { anchor: Group; mixer: AnimationMixer; material: ShaderMaterial; flash: Mesh<PlaneGeometry, ShaderMaterial>; id: number }[] = [];
  const geometries = new Set<BufferGeometry>(), materials = new Set<ShaderMaterial>();
  const canonicalToOpening = new Matrix4(), inversePresentation = new Matrix4();
  let phase: 'loading' | 'ready' | 'error' = 'loading', error: string | null = null, disposed = false;
  let height = 1, clipStart = 0, clipEnd = 1, pieces = 0, sourceSha256 = '';
  let activeActors = 0, farDepth = 0;
  const abort = new AbortController();
  const disposeImported = (model: Group, keepGeometry = false) => {
    const importedGeometry = new Set<BufferGeometry>(), importedMaterials = new Set<{ dispose(): void }>();
    model.traverse(object => {
      if (object instanceof Mesh) {
        importedGeometry.add(object.geometry);
        for (const m of Array.isArray(object.material) ? object.material : [object.material]) importedMaterials.add(m);
      }
    });
    if (!keepGeometry) importedGeometry.forEach(geometry => geometry.dispose());
    importedMaterials.forEach(shared => shared.dispose());
  };
  const releasePool = () => {
    pools.forEach(pool => pool.mixer.stopAllAction());
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(shared => shared.dispose());
    pools.length = 0; geometries.clear(); materials.clear(); root.clear();
  };
  const material = (flash = false) => {
    const result = new ShaderMaterial({ vertexShader, fragmentShader: flash ? flashFragment : debrisFragment,
      side: DoubleSide, transparent: true, depthWrite: false,
      uniforms: { uWorldToOpening: { value: new Matrix4() }, uLimits: { value: new Vector4() },
        uTaper: { value: new Vector2(1, 1) },
        uOpacity: { value: 0 }, uBrightness: { value: 1 }, uScanOpacity: { value: 1 } } });
    if (flash) result.blending = AdditiveBlending;
    materials.add(result); return result;
  };
  const bindRender = (mesh: Mesh, shared: ShaderMaterial) => {
    mesh.frustumCulled = false;
    mesh.renderOrder = 18;
    mesh.onBeforeRender = () => {
      inversePresentation.copy(root.parent?.matrixWorld ?? new Matrix4()).invert();
      shared.uniforms.uWorldToOpening.value.copy(canonicalToOpening).multiply(inversePresentation);
      const splat = options.scanRoot.viewer.splatMesh.material as ShaderMaterial;
      shared.uniforms.uBrightness.value = splat.uniforms.uHallwayBrightness?.value ?? 1;
      shared.uniforms.uScanOpacity.value = options.scanRoot.visible === false ? 0 : (splat.uniforms.uGlobalOpacity?.value ?? 1);
    };
  };
  const reset = () => {
    root.visible = false; activeActors = 0;
    for (const pool of pools) { pool.anchor.visible = false; pool.id = -1; pool.material.uniforms.uOpacity.value = 0; pool.flash.material.uniforms.uOpacity.value = 0; }
  };
  return {
    root, reset,
    async initialize() {
      let loaded: Group | null = null, abandoned = false;
      try {
        farDepth = cutoutFarDepth(options.scanRoot);
        const modelPromise = new GLTFLoader().loadAsync(ASSET).then(gltf => {
          if (disposed || abandoned) { disposeImported(gltf.scene); return null; }
          loaded = gltf.scene; return gltf;
        });
        const [gltf, response] = await Promise.all([modelPromise, fetch(METADATA, { signal: abort.signal })]);
        if (!gltf) return;
        if (!response.ok) throw new Error('The prepared local fracture metadata is missing.');
        const metadata = await response.json();
        if (disposed) { disposeImported(gltf.scene); loaded = null; return; }
        const bounds = metadata.bounds ?? metadata.initialBounds;
        height = metadata.height ?? (bounds?.max?.[1] - bounds?.min?.[1]);
        const clip = gltf.animations[0];
        if (!clip || !Number.isFinite(height) || height <= 0 || !Number.isFinite(clip.duration) || clip.duration <= 0) {
          throw new Error('The supplied fracture needs animated fragment transforms and finite bounds.');
        }
        clipStart = metadata.activeWindow?.[0] ?? 0; clipEnd = metadata.activeWindow?.[1] ?? clip.duration;
        if (![clipStart, clipEnd].every(Number.isFinite) || clipStart < 0 || clipEnd <= clipStart || clipEnd > clip.duration + 1e-4) {
          throw new Error('The fracture active animation window is invalid.');
        }
        sourceSha256 = metadata.sourceSha256 ?? '';
        gltf.scene.traverse(object => {
          if (object instanceof Mesh) {
            geometries.add(object.geometry); pieces++;
            if (!object.geometry.getAttribute('normal')) object.geometry.computeVertexNormals();
          }
        });
        if (pieces === 0 || pieces > 256) throw new Error('The fracture contains no bounded fragment mesh set.');
        const flashGeometry = new PlaneGeometry(1.8, 1.8); geometries.add(flashGeometry);
        for (let id = 0; id < 5; id++) {
          const anchor = new Group(); anchor.name = `fracture-burst-${id}`; anchor.matrixAutoUpdate = false; anchor.visible = false;
          const shared = material(), model = gltf.scene.clone(true), mixer = new AnimationMixer(model);
          const action = mixer.clipAction(clip); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
          model.traverse(object => { if (object instanceof Mesh) { object.material = shared; bindRender(object, shared); } });
          const flash = new Mesh(flashGeometry, material(true)); flash.name = 'fracture-flash'; bindRender(flash, flash.material);
          anchor.add(model, flash); root.add(anchor); pools.push({ anchor, mixer, material: shared, flash, id: -1 });
        }
        disposeImported(gltf.scene, true); loaded = null;
        phase = 'ready'; reset();
      } catch (cause) {
        abandoned = true;
        if (loaded) disposeImported(loaded, geometries.size > 0);
        releasePool(); phase = 'error'; error = cause instanceof Error ? cause.message : String(cause); reset();
      }
    },
    update(collapse: HallwayCollapse, upright: boolean) {
      const state = collapse.snapshot(); activeActors = 0;
      if (phase !== 'ready' || disposed || !upright || !state.active || !state.canonicalToOpening) { root.visible = false; return; }
      canonicalToOpening.fromArray(state.canonicalToOpening);
      const widthAt = (height: number) => new Vector3(...collapse.canonicalPoint(-state.openingWidth / 2, height, 0)!)
        .distanceTo(new Vector3(...collapse.canonicalPoint(state.openingWidth / 2, height, 0)!));
      const floorWidth = widthAt(0), ceilingWidth = widthAt(state.openingHeight), middleWidth = (floorWidth + ceilingWidth) / 2;
      for (const pool of pools) pool.anchor.visible = false;
      for (const blast of state.blasts) {
        if (!blast.active) continue;
        // At most three overlap; five reusable actors cover all ten locations.
        const pool = pools[blast.id % pools.length]; pool.anchor.visible = true;
        const panelHeight = 1.6, scale = panelHeight / height;
        const baseY = Math.max(.04, Math.min(state.openingHeight - panelHeight - .04, blast.height - panelHeight / 2));
        const point = collapse.canonicalPoint(blast.across, baseY, blast.depth)!;
        const up = new Vector3(...collapse.canonicalPoint(blast.across, baseY + .5, blast.depth)!).sub(new Vector3(...point)).normalize();
        const inward = new Vector3(...collapse.canonicalPoint(0, baseY, blast.depth)!).sub(new Vector3(...point)).normalize();
        inward.addScaledVector(up, -inward.dot(up)).normalize();
        const right = new Vector3().crossVectors(up, inward).normalize();
        pool.anchor.matrix.makeBasis(right, up, inward).scale(new Vector3(scale, scale, scale)).setPosition(...point);
        pool.anchor.updateMatrixWorld(true);
        pool.mixer.setTime(Math.min(clipEnd - 1e-5, clipStart + (clipEnd - clipStart) * blast.progress));
        const opacity = smooth(0, .06, blast.progress) * (1 - smooth(.72, 1, blast.progress));
        pool.material.uniforms.uOpacity.value = opacity;
        pool.material.uniforms.uLimits.value.set(state.openingWidth / 2, state.openingHeight, state.protectedDepth, state.farDepth);
        pool.material.uniforms.uTaper.value.set(floorWidth / middleWidth, ceilingWidth / middleWidth);
        pool.flash.material.uniforms.uLimits.value.copy(pool.material.uniforms.uLimits.value);
        pool.flash.material.uniforms.uTaper.value.copy(pool.material.uniforms.uTaper.value);
        pool.flash.material.uniforms.uOpacity.value = Math.exp(-blast.age * 12) * smooth(0, .035, blast.age) * .8;
        pool.flash.position.set(0, panelHeight / (2 * scale), .06 / scale);
        pool.flash.scale.setScalar(1 / scale);
        pool.id = blast.id; activeActors++;
      }
      root.visible = activeActors > 0;
    },
    async warmup(renderer: { compileAsync(scene: Group, camera: import('three').Camera): Promise<unknown> }, camera: import('three').Camera) {
      if (phase !== 'ready') return;
      root.visible = true; pools.forEach(pool => { pool.anchor.visible = true; });
      try { await renderer.compileAsync(root, camera); } finally { reset(); }
    },
    snapshot: () => ({ phase, error, activeActors, visible: root.visible, sourceSha256, pieces, farDepth,
      geometryCount: geometries.size, materialCount: materials.size, poolSize: pools.length, clipStart, clipEnd,
      actors: pools.map(pool => ({ id: pool.id, visible: pool.anchor.visible, matrix: pool.anchor.matrix.toArray(), time: pool.mixer.time })) }),
    dispose() {
      disposed = true; abort.abort(); reset();
      releasePool(); root.removeFromParent();
    },
  };
}
