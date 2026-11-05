import { Group, Matrix4, type Object3D, type Scene, type ShaderMaterial } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';

/** Keep gameplay/calibration coordinates canonical; present one rigid world pose.
 * The camera, tracked hands/controllers, HUD and physical boundaries stay in XR.
 */
export function createWorldPresentation(scene: Scene, scanRoot: DropInViewer) {
  const root = new Group(); root.name = 'hallway-world-presentation'; root.matrixAutoUpdate = false;
  scene.add(root);
  const saved = new Map<Matrix4,Matrix4>();
  const beginFrame = () => {
    for (const [matrix,baseline] of saved) matrix.copy(baseline);
    saved.clear(); root.matrix.identity(); root.updateMatrixWorld(true);
  };
  const apply = (presentation: Matrix4) => {
    const inverse = presentation.clone().invert();
    const material = scanRoot.viewer.splatMesh.material as ShaderMaterial | undefined;
    const uniforms = material?.uniforms;
    for (const [name,forward] of [
      ['uFloorHoleWorldToRoute',false], ['uHallwayCutRouteToWorld',true],
      ['uHallwayCutWorldToRoute',false], ['uBoxWorldToContent',false],
    ] as const) {
      const matrix = uniforms?.[name]?.value as Matrix4 | undefined;
      if (!matrix) continue;
      saved.set(matrix,matrix.clone());
      if (forward) matrix.premultiply(presentation); else matrix.multiply(inverse);
    }
    root.matrix.copy(presentation); root.updateMatrixWorld(true);
  };
  return { beginFrame, apply, reset:beginFrame,
    setVisible(visible:boolean) { root.visible=visible; },
    attach(object: Object3D) {
      if ('isCamera' in object || object.parent !== scene) throw new Error('Only authored environment objects may join the world presentation.');
      root.attach(object);
    },
    snapshot: () => ({visible:root.visible,matrix:root.matrix.toArray(), content:root.children.map(child=>child.name || child.type)}),
  };
}
