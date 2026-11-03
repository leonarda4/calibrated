import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface HandContact {
  handedness: 'left' | 'right';
  position: [number, number, number];
  radius: number;
}

export interface TrackedHandOptions {
  onStatus?: (status: string) => void;
  /** Optional LOCAL generic-hand assets, with left.glb and right.glb. No CDN default. */
  meshPath?: string;
}

const JOINTS: readonly XRHandJoint[] = [
  'wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
const CHAINS = [
  ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ['wrist', 'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  ['wrist', 'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ['wrist', 'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  ['wrist', 'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
] as readonly (readonly XRHandJoint[])[];

function validJoint(pose: XRJointPose | null | undefined): pose is XRJointPose {
  if (!pose || pose.emulatedPosition) return false;
  const p = pose.transform.position;
  const q = pose.transform.orientation;
  return [p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite) &&
    (pose.radius === undefined || (Number.isFinite(pose.radius) && pose.radius > 0));
}

// Some runtimes do not supply a joint radius. This affects the visual/contact
// sphere only; the position must still be genuinely tracked in the current frame.
const jointRadius = (pose: XRJointPose): number => pose.radius ?? 0.008;

/** Fresh frame poses only. No cached model/grip transform can authorize contact. */
export function readFingerContacts(
  frame: XRFrame | undefined,
  referenceSpace: XRReferenceSpace | null | undefined,
  inputSources: Iterable<XRInputSource>,
): HandContact[] {
  if (!frame?.getJointPose || !referenceSpace) return [];
  const contacts: HandContact[] = [];
  for (const source of inputSources) {
    if (!source.hand || (source.handedness !== 'left' && source.handedness !== 'right')) continue;
    const tip = source.hand.get('index-finger-tip');
    if (!tip) continue;
    try {
      const pose = frame.getJointPose(tip, referenceSpace);
      if (!validJoint(pose)) continue;
      const p = pose.transform.position;
      contacts.push({ handedness: source.handedness, position: [p.x, p.y, p.z], radius: Math.min(jointRadius(pose), 0.025) });
    } catch { /* frame ended, runtime interruption or invalid space: no contact */ }
  }
  return contacts;
}

interface HandVisual {
  root: THREE.Group;
  joints: THREE.InstancedMesh;
  bones: THREE.InstancedMesh;
  skin: THREE.Object3D | null;
  skinBones: Map<XRHandJoint, THREE.Object3D>;
  skinLoading: boolean;
}

/**
 * White hand visuals in the unmodified XR reference frame. The bundled joint
 * fallback works offline. Optional generic-hand GLBs use r180's bone contract.
 * Native Meta compositor hands are outside a PC WebXR application's control.
 */
export function setupTrackedHands(renderer: THREE.WebGLRenderer, scene: THREE.Scene, options: TrackedHandOptions = {}) {
  const jointGeometry = new THREE.SphereGeometry(1, 10, 8);
  const boneGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0xdce8ed, depthTest: false, depthWrite: false });
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const visual = new Map<'left' | 'right', HandVisual>();
  let disposed = false;
  let lastStatus = '';
  const report = (text: string) => {
    if (text !== lastStatus) { lastStatus = text; options.onStatus?.(text); }
  };

  for (const handedness of ['left', 'right'] as const) {
    const root = new THREE.Group();
    root.name = `tracked-${handedness}-hand`;
    root.visible = false;
    const joints = new THREE.InstancedMesh(jointGeometry, material, JOINTS.length);
    const bones = new THREE.InstancedMesh(boneGeometry, material, 25);
    for (const mesh of [joints, bones]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Splats cannot reliably occlude mesh hands with their Gaussian depth.
      mesh.renderOrder = 1001;
    }
    root.add(joints, bones);
    scene.add(root);
    visual.set(handedness, { root, joints, bones, skin: null, skinBones: new Map(), skinLoading: false });
  }

  const loadSkin = (handedness: 'left' | 'right', hand: HandVisual) => {
    if (!options.meshPath || hand.skinLoading || hand.skin) return;
    // A path opt-in avoids a hidden CDN request or expected 404s on every run.
    if (!options.meshPath.startsWith('/') || options.meshPath.startsWith('//') || options.meshPath.includes('..')) return;
    hand.skinLoading = true;
    const loader = new GLTFLoader().setPath(options.meshPath.endsWith('/') ? options.meshPath : `${options.meshPath}/`);
    loader.load(`${handedness}.glb`, (gltf) => {
      if (disposed) { disposeObject(gltf.scene); return; }
      hand.skin = gltf.scene;
      for (const joint of JOINTS) {
        const bone = gltf.scene.getObjectByName(joint);
        if (bone) hand.skinBones.set(joint, bone);
      }
      // Require the standard skeleton, otherwise retain the known fallback.
      if (hand.skinBones.size !== JOINTS.length) {
        disposeObject(gltf.scene); hand.skin = null; hand.skinBones.clear();
        report('Local hand asset has no compatible skeleton; using joint hands.');
        return;
      }
      gltf.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.frustumCulled = false; object.renderOrder = 1001;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          // The splat scene needs no lights. Give an optional skinned mesh its
          // own unlit material so a valid local asset cannot appear black.
          const unlit = materials.map((original) => {
            const textured = original as THREE.Material & { map?: THREE.Texture | null; alphaMap?: THREE.Texture | null };
            const replacement = new THREE.MeshBasicMaterial({
              color: 0xdce8ed, map: textured.map ?? null, alphaMap: textured.alphaMap ?? null,
              transparent: original.transparent, opacity: original.opacity, side: original.side,
              depthTest: false, depthWrite: false,
            });
            original.dispose();
            return replacement;
          });
          object.material = Array.isArray(object.material) ? unlit : unlit[0];
        }
      });
      hand.root.add(gltf.scene);
    }, undefined, () => report('Local hand mesh unavailable; using joint hands.'));
  };

  const clear = () => {
    for (const hand of visual.values()) hand.root.visible = false;
  };
  const sessionEnd = () => { clear(); report('Hands: no XR session.'); };
  renderer.xr.addEventListener('sessionend', sessionEnd);
  report('Hands: waiting for a runtime with WebXR hand joints.');

  return {
    update(frame?: XRFrame, referenceSpace?: XRReferenceSpace | null): HandContact[] {
      clear(); // missing data can never leave an old visible hand behind
      const session = renderer.xr.getSession();
      if (disposed || !renderer.xr.isPresenting || !session) return [];
      const space = referenceSpace ?? renderer.xr.getReferenceSpace();
      const sources = [...session.inputSources];
      if (!frame?.getJointPose || !space) {
        report('Hands: no WebXR joint poses on this route.'); return [];
      }
      let trackedHands = 0;
      for (const source of sources) {
        if (!source.hand || (source.handedness !== 'left' && source.handedness !== 'right')) continue;
        const hand = visual.get(source.handedness)!;
        const poses = new Map<XRHandJoint, XRJointPose>();
        for (const joint of JOINTS) {
          const jointSpace = source.hand.get(joint);
          if (!jointSpace) continue;
          try {
            const pose = frame.getJointPose(jointSpace, space);
            if (validJoint(pose)) poses.set(joint, pose);
          } catch { /* no visual for a stale/invalid joint */ }
        }
        if (!poses.has('wrist')) continue;
        hand.root.visible = true;
        trackedHands += 1;
        loadSkin(source.handedness, hand);
        const fullSkin = !!hand.skin && poses.size === JOINTS.length;
        if (hand.skin) hand.skin.visible = fullSkin;
        hand.joints.visible = hand.bones.visible = !fullSkin;
        let jointCount = 0;
        for (const [joint, pose] of poses) {
          const p = pose.transform.position;
          const q = pose.transform.orientation;
          position.set(p.x, p.y, p.z);
          orientation.set(q.x, q.y, q.z, q.w);
          size.setScalar(Math.min(jointRadius(pose), 0.02));
          matrix.compose(position, orientation, size);
          hand.joints.setMatrixAt(jointCount++, matrix);
          const bone = hand.skinBones.get(joint);
          if (bone) { bone.position.copy(position); bone.quaternion.copy(orientation); }
        }
        hand.joints.count = jointCount;
        hand.joints.instanceMatrix.needsUpdate = true;
        let boneCount = 0;
        for (const chain of CHAINS) {
          for (let i = 1; i < chain.length; i++) {
            const a = poses.get(chain[i - 1]);
            const b = poses.get(chain[i]);
            if (!a || !b) continue;
            const pa = a.transform.position, pb = b.transform.position;
            direction.set(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
            const length = direction.length();
            if (length < 0.0001 || length > 0.15) continue;
            position.set((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2);
            orientation.setFromUnitVectors(up, direction.divideScalar(length));
            size.set(Math.min(jointRadius(a), jointRadius(b), 0.012) * 0.8, length, Math.min(jointRadius(a), jointRadius(b), 0.012) * 0.8);
            matrix.compose(position, orientation, size);
            hand.bones.setMatrixAt(boneCount++, matrix);
          }
        }
        hand.bones.count = boneCount;
        hand.bones.instanceMatrix.needsUpdate = true;
      }
      const hasHandSources = sources.some((source) => !!source.hand);
      report(trackedHands
        ? `Hands: ${trackedHands} tracked (${options.meshPath ? 'local mesh / joint fallback' : 'local joint fallback'}).`
        : hasHandSources ? 'Hands: tracking unavailable; orb contact paused.' : 'Hands: no hand input from Steam Link / runtime; orb contact unavailable.');
      return readFingerContacts(frame, space, sources);
    },
    clear,
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.xr.removeEventListener('sessionend', sessionEnd);
      for (const hand of visual.values()) {
        scene.remove(hand.root);
        if (hand.skin) disposeObject(hand.skin);
      }
      jointGeometry.dispose(); boneGeometry.dispose(); material.dispose();
    },
  };
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}
