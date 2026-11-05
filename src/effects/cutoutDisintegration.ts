import { Vector3, type ShaderMaterial } from 'three';
import type { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { HALLWAY_CUT, cutOpeningFromMetadata } from '../viewer/hallwayCutPlacement.ts';

import { collapseDamageGLSL, destructionUniforms } from './collapseDamage.ts';

/** Read the added source once at startup; original scan centres remain separate. */
export function cutoutFarDepth(scanRoot: DropInViewer): number {
  const metadata = scanRoot.userData.hallwayCutMetadata;
  const source = cutOpeningFromMetadata(metadata), along = new Vector3(...source.along), origin = new Vector3(...source.origin);
  const bounds = metadata?.boundsRaw as number[][] | undefined;
  let maximum = -Infinity;
  if (bounds?.length === 2 && bounds.every(p => p.length === 3 && p.every(Number.isFinite))) {
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
      maximum = Math.max(maximum, new Vector3(bounds[x][0], bounds[y][1], bounds[z][2]).sub(origin).dot(along));
    }
  } else {
    const buffer = scanRoot.getSplatScene(HALLWAY_CUT.sceneIndex).splatBuffer as {
      getSplatCount(): number; getSplatCenter(index: number, target: Vector3): void;
    }, point = new Vector3();
    for (let i = 0; i < buffer.getSplatCount(); i++) {
      buffer.getSplatCenter(i, point); maximum = Math.max(maximum, point.sub(origin).dot(along));
    }
  }
  if (!Number.isFinite(maximum) || maximum <= 0 || maximum > 1000) throw new Error('The added corridor has no finite source depth.');
  return maximum;
}

/** Fade individual added-corridor Gaussians; never edit source buffers or scene0. */
export function prepareCutoutDisintegration(material: ShaderMaterial): void {
  if (material.uniforms.uCutoutDestruction) return;
  const center = 'vec4 viewCenter = transformModelViewMatrix * vec4(splatCenter, 1.0);';
  const opening = 'vec3 p = (uHallwayCutRawToOpening * vec4(splatCenter,1.0)).xyz;';
  const covariance = 'mat3 J;';
  if (![center, opening, covariance].every(anchor => material.vertexShader.includes(anchor))) {
    throw new Error('Prepare the pinned hallway-cutout shader before its disintegration effect.');
  }
  material.vertexShader = collapseDamageGLSL + material.vertexShader
    .replace(center, `vec3 cutoutDestructionPoint = vec3(0.0);\n${center}`)
    .replace(opening, `${opening}\ncutoutDestructionPoint = p;`)
    .replace(covariance, `
      if (int(sceneIndex) == ${HALLWAY_CUT.sceneIndex} && uCutoutDestruction.x > 0.5) {
        vec3 sourceAlong = vec3(uHallwayCutRawToOpening[0][2], uHallwayCutRawToOpening[1][2], uHallwayCutRawToOpening[2][2]);
        float alongSigma = sqrt(max(0.0, dot(sourceAlong, Vrk * sourceAlong)));
        // Preserve Gaussians whose finite rendered support reaches the return prefix.
        if (cutoutDestructionPoint.z - 4.0 * alongSigma > uCutoutDestruction.w + 0.15) {
          float safeClearance = cutoutDestructionPoint.z - 4.0 * alongSigma - uCutoutDestruction.w - 0.15;
          float lost = collapseDamage(cutoutDestructionPoint)*smoothstep(0.0,1.0,safeClearance);
          // Neighbouring splats disappear in small clumps, with individual specks
          // at their edges. Independent thinning alone hides behind dense layers.
          float cluster = collapseNoise(cutoutDestructionPoint*vec3(3.5,3.5,2.5)+0.37*uCollapsePatchShapes[0].w);
          float grain = mix(0.04,0.96,pow(0.85*cluster+0.15*collapseHash(floor(splatCenter*137.0)),1.5));
          float survival = 1.0-smoothstep(grain-0.07,grain+0.09,lost);
          vColor.a *= survival;
          if (survival < 0.001) { gl_Position = vec4(0.0,0.0,2.0,1.0); return; }
        }
      }
      ${covariance}
    `);
  Object.assign(material.uniforms, destructionUniforms());
  material.needsUpdate = true;
}
