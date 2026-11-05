import * as THREE from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';

/** Original, private SH0 PLY: 27,577 Gaussians. Raw -Z is upright. */
export const WOODEN_BOX = {
  modelUrl: '/splats/WoodenBox.ply',
  sceneIndices: [3, 4],
  min: [-0.2248503565788269, -1.146284818649292, 0.7229748368263245],
  max: [0.27997469902038574, -0.6390771865844727, 1.1574608087539673],
  // Minimum-area footprint of opaque source Gaussians: undo the source's
  // 19-degree in-plane heading before matching the existing hallway anchor.
  sourceYawDegrees: 19,
  alignedMin: [-0.46529657028071647, -1.1574608087539673, -1.0904107606594082],
  alignedMax: [-0.04974879308935898, -0.7229748368263245, -0.6416709268787275],
  clearance: 0.04,
} as const;

export function woodenBoxSourceTransform(width: number, height: number, depth: number): THREE.Matrix4 {
  const { alignedMin: min, alignedMax: max } = WOODEN_BOX;
  return new THREE.Matrix4().makeScale(width / (max[0] - min[0]), height / (max[1] - min[1]), depth / (max[2] - min[2]))
    .multiply(new THREE.Matrix4().makeTranslation(-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2))
    .multiply(woodenBoxSourceRotation());
}

export function woodenBoxSourceRotation(): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationX(Math.PI / 2)
    .multiply(new THREE.Matrix4().makeRotationZ(-THREE.MathUtils.degToRad(WOODEN_BOX.sourceYawDegrees)));
}

/** Clip the projected Gaussian quads at each prop's actual world floor plane. */
function clipBoxFloors(material: THREE.ShaderMaterial): void {
  if (material.uniforms.uBoxFloors) return;
  const vertex = 'gl_Position = quadPos;', fragment = 'void main () {';
  if (!material.vertexShader.includes(vertex) || !material.fragmentShader.includes(fragment)) {
    throw new Error('The installed splat shader cannot clip the wooden boxes at the floor.');
  }
  material.vertexShader = `uniform vec2 uBoxFloors;
    uniform mat4 uBoxWorldToContent;
    uniform float uPivotBoxGlitch;
    uniform vec3 uPivotBoxGlitchRight;
    varying float vPivotBoxDrop;
    varying float vBoxFloorDistance;\n` +
    material.vertexShader.replace(vertex, `
      vPivotBoxDrop = 0.0;
      if (int(sceneIndex) == 3 && uPivotBoxGlitch > 0.0) {
        float band = floor(-splatCenter.z * 70.0);
        float tick = floor(uPivotBoxGlitch * 14.0);
        float jitter = fract(sin(band * 127.1 + tick * 311.7) * 43758.5453);
        float chunk = fract(sin(dot(floor(splatCenter * 65.0), vec3(12.9898, 78.233, 39.425))) * 43758.5453);
        vPivotBoxDrop = step(chunk, uPivotBoxGlitch);
        float shift = (jitter - 0.5) * 0.12 * sin(uPivotBoxGlitch * 3.14159265);
        vec4 shiftedBoxClip = clipCenter + projectionMatrix * viewMatrix * vec4(uPivotBoxGlitchRight * shift, 0.0);
        quadPos.xy += shiftedBoxClip.xy / shiftedBoxClip.w - ndcCenter.xy;
      }
      ${vertex}
      vBoxFloorDistance = 1.0;
      if (int(sceneIndex) == 3 || int(sceneIndex) == 4) {
        vec4 boxFragmentWorld = uBoxWorldToContent * inverse(viewMatrix) * inverse(projectionMatrix) * quadPos;
        float boxFloor = int(sceneIndex) == 3 ? uBoxFloors.x : uBoxFloors.y;
        vBoxFloorDistance = boxFragmentWorld.y / boxFragmentWorld.w - boxFloor;
      }
    `);
  material.fragmentShader = 'varying float vBoxFloorDistance; varying float vPivotBoxDrop;\n' + material.fragmentShader.replace(fragment,
    `${fragment}\n if (vBoxFloorDistance < 0.0 || vPivotBoxDrop > 0.5) discard;`);
  material.uniforms.uBoxFloors = { value: new THREE.Vector2() };
  material.uniforms.uBoxWorldToContent = { value: new THREE.Matrix4() };
  material.uniforms.uPivotBoxGlitch = { value: 0 };
  material.uniforms.uPivotBoxGlitchRight = { value: new THREE.Vector3(1, 0, 0) };
  material.needsUpdate = true;
}

export interface WoodenBoxPose {
  anchor: THREE.Object3D;
  height: number;
  floorY: number;
  fraction: number;
  visible: boolean;
  glitch?: number;
}

/** Reuse the shared sorter; cancel the scan transform to keep both props fixed. */
export function createWoodenBoxVisuals(scanRoot: DropInViewer) {
  const local = new THREE.Matrix4(), world = new THREE.Matrix4(), inverse = new THREE.Matrix4();
  const sourceToUnitCenter = new THREE.Matrix4().makeTranslation(0, -0.5, 0)
    .multiply(woodenBoxSourceTransform(1, 1, 1));
  let initialized = false;
  const material = () => scanRoot.viewer.splatMesh.material as THREE.ShaderMaterial;
  return {
    initialize() {
      for (const [slot, index] of WOODEN_BOX.sceneIndices.entries()) {
        if (scanRoot.getSceneCount() <= index) throw new Error('A preloaded wooden box scene is missing.');
        const object = scanRoot.getSplatScene(index);
        object.name = slot === 0 ? 'wooden-box-splat' : 'wooden-second-box-splat';
        object.visible = false;
        // Preserve the full affine source correction. Decomposing a rotation
        // followed by unequal axis scales into TRS would skew the box faces.
        object.matrixAutoUpdate = false;
      }
      clipBoxFloors(material());
      initialized = true;
    },
    update(poses: readonly WoodenBoxPose[]) {
      if (!initialized) return;
      scanRoot.updateWorldMatrix(true, false);
      inverse.copy(scanRoot.matrixWorld).invert();
      poses.forEach((pose, slot) => {
        const object = scanRoot.getSplatScene(WOODEN_BOX.sceneIndices[slot]);
        object.visible = pose.visible;
        material().uniforms.uBoxFloors.value.setComponent(slot, pose.floorY);
        pose.anchor.updateWorldMatrix(true, false);
        if (slot === 0) {
          material().uniforms.uPivotBoxGlitch.value = pose.visible ? pose.glitch ?? 0 : 0;
          material().uniforms.uPivotBoxGlitchRight.value.set(1, 0, 0)
            .transformDirection(pose.anchor.matrixWorld);
        }
        // Anchors describe a unit cube's final centre and dimensions. Convert
        // the original splat to that cube, then move only the visual below it.
        world.makeTranslation(0, -(pose.height + WOODEN_BOX.clearance) * (1 - pose.fraction), 0)
          .multiply(pose.anchor.matrixWorld)
          .multiply(sourceToUnitCenter);
        local.copy(inverse).multiply(world);
        object.matrix.copy(local);
        object.updateTransform(true);
      });
    },
  };
}
