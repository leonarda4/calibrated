import * as THREE from 'three';

/** One desktop click on the existing floor plane refines the second-box line guide. */
export function setupFloorLinePicker(
  renderer: Pick<THREE.WebGLRenderer, 'domElement' | 'xr'>,
  camera: THREE.Camera,
  scanRoot: THREE.Object3D,
  floorY: number,
  onPicked: (rawPoint: [number, number, number]) => void,
) {
  let picking = false;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY);
  const onPointer = (event: PointerEvent) => {
    if (!picking || renderer.xr.isPresenting || event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!point || !point.toArray().every(Number.isFinite)) return;
    scanRoot.updateWorldMatrix(true, false);
    picking = false;
    onPicked(scanRoot.worldToLocal(point).toArray() as [number, number, number]);
  };
  renderer.domElement.addEventListener('pointerdown', onPointer);
  return {
    start() { if (!renderer.xr.isPresenting) picking = true; },
    cancel() { picking = false; },
    isPicking: () => picking,
    dispose() { picking = false; renderer.domElement.removeEventListener('pointerdown', onPointer); },
  };
}
