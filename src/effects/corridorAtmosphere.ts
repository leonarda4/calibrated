import { Vector3 } from 'three';
import { cutoutPlacement, type CutOpening, type HoleMouth, type Point3 } from '../viewer/hallwayCutPlacement.ts';
import type { VolumeMetadata } from './volumeTexture.ts';

/** Stretch only the baked vertical lookup; source voxels and horizontal tiles stay unchanged. */
export function stretchVolumeHeight(spec: VolumeMetadata, height: number) {
  if(!Number.isFinite(height)||height<=0)throw Error('Atmosphere needs a positive display height.');
  const scale=height/spec.height;
  return {min:[spec.min[0],spec.min[1]*scale,spec.min[2]] as Point3,
    size:[spec.size[0],spec.size[1]*scale,spec.size[2]] as Point3};
}

/** Same captured cutout frame for floor fog and full-height mist, including taper. */
export function corridorAtmosphereMatrix(source: CutOpening,hole: HoleMouth,box: Point3|null,height: number){
  const placement=cutoutPlacement(source,hole,box),point=new Vector3(0,height/2,0),affine=placement.derivative(point);
  affine.setPosition(placement.map(point).sub(point.clone().applyMatrix4(affine)));
  return placement.routeToWorld.clone().multiply(affine);
}
