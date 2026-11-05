import { Matrix4, Vector2, Vector4, type ShaderMaterial } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { HALLWAY_CUT, cutOpeningFromMetadata, cutoutPlacement, type HoleMouth, type Point3 } from './hallwayCutPlacement.ts';

/** Scope the deformation/covariance and per-eye aperture to the added scene. */
export function prepareHallwayCutShader(material: ShaderMaterial): void {
  if (material.uniforms.uHallwayCutOpen) return;
  const center = 'vec4 viewCenter = transformModelViewMatrix * vec4(splatCenter, 1.0);';
  const projection = 'gl_Position = quadPos;', fragment = 'void main () {';
  if (![center, projection].every(anchor => material.vertexShader.includes(anchor)) || !material.fragmentShader.includes(fragment)) {
    throw new Error('The installed splat shader cannot connect the hallway cutout.');
  }
  const shared = `
    uniform float uHallwayCutOpen;
    uniform float uHallwayCutFloorY;
    uniform vec4 uHallwayCutBounds;
    uniform vec2 uHallwayCutFarBounds;
    varying float vHallwayCutCandidate;
    varying vec3 vHallwayCutNear;
    varying vec3 vHallwayCutFar;
  `;
  material.vertexShader = shared + `
    uniform mat4 uHallwayCutRawToOpening;
    uniform mat4 uHallwayCutRouteToWorld;
    uniform mat4 uHallwayCutWorldToRoute;
    uniform vec2 uHallwayCutSourceSize;
    uniform float uHallwayCutSign;
  ` + material.vertexShader.replace(center, `${center}
    vHallwayCutCandidate = 0.0;
    vHallwayCutNear = vec3(0.0); vHallwayCutFar = vec3(0.0);
    if (int(sceneIndex) == ${HALLWAY_CUT.sceneIndex}) {
      if (uHallwayCutOpen < 0.5) { gl_Position = vec4(0.0,0.0,2.0,1.0); return; }
      vHallwayCutCandidate = 1.0;
      vec3 p = (uHallwayCutRawToOpening * vec4(splatCenter,1.0)).xyz;
      float ds = -uHallwayCutSign / uHallwayCutSourceSize.y;
      float s = (uHallwayCutSign > 0.0 ? 1.0 : 0.0) + p.y * ds;
      float t = 0.5 + uHallwayCutSign * p.x / uHallwayCutSourceSize.x;
      vec2 sides = mix(uHallwayCutBounds.xy, uHallwayCutFarBounds, s);
      vec3 routePoint = vec3(mix(sides.x,sides.y,t), uHallwayCutFloorY-p.z,
        mix(uHallwayCutBounds.z,uHallwayCutBounds.w,s));
      viewCenter = viewMatrix * uHallwayCutRouteToWorld * vec4(routePoint,1.0);
      vec2 sideDelta = uHallwayCutFarBounds - uHallwayCutBounds.xy;
      mat3 derivative = mat3(
        uHallwayCutSign*(sides.y-sides.x)/uHallwayCutSourceSize.x,0.0,0.0,
        mix(sideDelta.x,sideDelta.y,t)*ds,0.0,(uHallwayCutBounds.w-uHallwayCutBounds.z)*ds,
        0.0,-1.0,0.0);
      // The pinned renderer uses this matrix for covariance projection too.
      transformModelViewMatrix = viewMatrix * uHallwayCutRouteToWorld * mat4(derivative * mat3(uHallwayCutRawToOpening));
    }
  `).replace(projection, `${projection}
    if (vHallwayCutCandidate > 0.5) {
      mat4 clipToRoute = uHallwayCutWorldToRoute * inverse(viewMatrix) * inverse(projectionMatrix);
      vec4 nearPoint = clipToRoute * vec4(quadPos.xy,-1.0,1.0);
      vec4 farPoint = clipToRoute * vec4(quadPos.xy,1.0,1.0);
      vHallwayCutNear = nearPoint.xyz/nearPoint.w;
      vHallwayCutFar = farPoint.xyz/farPoint.w;
    }
  `);
  material.fragmentShader = shared + material.fragmentShader.replace(fragment, `${fragment}
    if (vHallwayCutCandidate > 0.5) {
      vec3 ray = vHallwayCutFar-vHallwayCutNear;
      float eyeAlong = (vHallwayCutNear.z-uHallwayCutBounds.z)/(uHallwayCutBounds.w-uHallwayCutBounds.z);
      vec2 eyeSides = mix(uHallwayCutBounds.xy,uHallwayCutFarBounds,eyeAlong);
      bool insideCorridor = vHallwayCutNear.y < uHallwayCutFloorY && eyeAlong >= 0.0 && eyeAlong <= 1.0 &&
        vHallwayCutNear.x >= eyeSides.x && vHallwayCutNear.x <= eyeSides.y;
      if (!insideCorridor) {
      if (abs(ray.y) < 0.000001) discard;
      float hit = (uHallwayCutFloorY-vHallwayCutNear.y)/ray.y;
      vec3 mouth = vHallwayCutNear+hit*ray;
      float s = (mouth.z-uHallwayCutBounds.z)/(uHallwayCutBounds.w-uHallwayCutBounds.z);
      vec2 sides = mix(uHallwayCutBounds.xy,uHallwayCutFarBounds,s);
      if (hit < 0.0 || s < 0.0 || s > 1.0 || mouth.x < sides.x || mouth.x > sides.y) discard;
      }
    }
  `);
  Object.assign(material.uniforms, {
    uHallwayCutOpen: { value: 0 }, uHallwayCutFloorY: { value: 0 },
    uHallwayCutBounds: { value: new Vector4() }, uHallwayCutFarBounds: { value: new Vector2() },
    uHallwayCutRawToOpening: { value: new Matrix4() }, uHallwayCutRouteToWorld: { value: new Matrix4() },
    uHallwayCutWorldToRoute: { value: new Matrix4() }, uHallwayCutSourceSize: { value: new Vector2() },
    uHallwayCutSign: { value: 1 },
  });
  material.needsUpdate = true;
}

/** No separate position controls: the captured hole is the only placement source. */
export function createHallwayCut(options: { scanRoot: DropInViewer; getHole(): HoleMouth; getSecondBoxRoute(): Point3 | null }) {
  const { scanRoot } = options;
  let ready = false, error: string | null = null, signature = '';
  let placement: ReturnType<typeof cutoutPlacement> | null = null;
  const object = () => scanRoot.getSceneCount() > HALLWAY_CUT.sceneIndex ? scanRoot.getSplatScene(HALLWAY_CUT.sceneIndex) : null;
  const material = () => scanRoot.viewer.splatMesh.material as ShaderMaterial;
  const hide = () => {
    const scene = object(); if (scene) scene.visible = false;
    if (material()?.uniforms?.uHallwayCutOpen) material().uniforms.uHallwayCutOpen.value = 0;
    signature = ''; placement = null;
  };
  const update = () => {
    const scene = object(), hole = options.getHole();
    if (!ready || !scene || !hole.open) { hide(); return; }
    try {
      const box = options.getSecondBoxRoute();
      const nextSignature = JSON.stringify([hole.floorY,hole.startZ,hole.endZ,hole.nearBounds,hole.farBounds,hole.routeToWorld,box]);
      if (nextSignature !== signature) {
        const source = cutOpeningFromMetadata(scanRoot.userData.hallwayCutMetadata);
        placement = cutoutPlacement(source, hole, box);
        const uniforms = material().uniforms;
        uniforms.uHallwayCutRawToOpening.value.copy(placement.rawToOpening);
        uniforms.uHallwayCutRouteToWorld.value.copy(placement.routeToWorld);
        uniforms.uHallwayCutWorldToRoute.value.copy(placement.routeToWorld).invert();
        uniforms.uHallwayCutSourceSize.value.set(source.width,source.height);
        uniforms.uHallwayCutSign.value = placement.sign;
        uniforms.uHallwayCutFloorY.value = hole.floorY;
        uniforms.uHallwayCutBounds.value.set(hole.nearBounds![0],hole.nearBounds![1],hole.startZ,hole.endZ);
        uniforms.uHallwayCutFarBounds.value.set(...hole.farBounds!);
        signature = nextSignature;
      }
      scanRoot.updateWorldMatrix(true,false);
      scene.matrix.copy(scanRoot.matrixWorld).invert().multiply(placement!.sourceToWorld);
      scene.updateTransform(true);
      scene.visible = true; material().uniforms.uHallwayCutOpen.value = 1; error = null;
    } catch (cause) { hide(); error = cause instanceof Error ? cause.message : String(cause); }
  };
  return { update, reset: hide,
    initialize() {
      const scene = object(); if (!scene) throw new Error('The preloaded hallway cutout is missing.');
      cutOpeningFromMetadata(scanRoot.userData.hallwayCutMetadata);
      prepareHallwayCutShader(material()); scene.name = 'hole-hallway-cutout'; scene.matrixAutoUpdate = false;
      ready = true; hide();
    },
    snapshot() { return { ready, visible: object()?.visible ?? false, error, sceneIndex: HALLWAY_CUT.sceneIndex,
      floorSide: placement ? placement.floorAtEnd ? 'end' : 'start' : null, mouthWorld: placement?.mouthWorld ?? null }; },
  };
}
