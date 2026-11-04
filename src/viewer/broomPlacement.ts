import { Vector3, type Object3D } from 'three';

/** Keep the explicit world Z while the caller supplies the current section centre. */
export const BROOM_WORLD_Z = 6;

export function createBroomPlacement(options: {
  object: Object3D;
  getPivot(): { centerX: number; floorY: number };
  blockReason(): string | null;
  toWorld?(position: Vector3): Vector3;
}) {
  const { object } = options;
  object.visible = false;
  let status = 'Broom hidden.';
  const snapshot = () => ({
    visible: object.visible, status,
    baseWorld: object.visible ? object.getWorldPosition(new Vector3()).toArray() : null,
  });
  const reset = () => { object.visible = false; status = 'Broom hidden.'; };
  const show = () => {
    const reason = options.blockReason();
    if (reason) { status = reason; return false; }
    const pivot = options.getPivot();
    if (![pivot.centerX, pivot.floorY].every(Number.isFinite)) {
      status = 'Broom placement needs a finite pivot and floor.';
      return false;
    }
    // The renderer's caller refreshes this world pose from the current hallway.
    const point = new Vector3(pivot.centerX, pivot.floorY, BROOM_WORLD_Z);
    object.position.copy(options.toWorld?.(point) ?? point);
    object.quaternion.identity();
    object.scale.set(1, 1, 1);
    object.visible = true;
    status = `Broom at [${pivot.centerX.toFixed(3)}, ${pivot.floorY.toFixed(3)}, 6.000] m.`;
    return true;
  };
  return { snapshot, show, reset,
    toggle() { if (object.visible) { reset(); return true; } return show(); },
  };
}
