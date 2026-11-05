import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { volumeMetadata } from '../src/effects/volumeTexture.ts';

/** Same byte/layer/seam checks as the supplied validators, without Python. */
export async function checkVolumeAssets(folder: string | URL,base: string){
  if(folder instanceof URL)folder=fileURLToPath(folder);
  const [json,data]=await Promise.all([fs.readFile(path.join(folder,base+'.json'),'utf8'),fs.readFile(path.join(folder,base+'.bin'))]);
  const metadata=JSON.parse(json),spec=volumeMetadata(metadata,data.byteLength),[nx,ny,nz]=spec.resolution;
  const means=Array(ny).fill(0);let filled=0;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const v=data[x+nx*(y+ny*z)];means[y]+=v/(255*nx*nz);if(v)filled++;
  }
  if(!Array.isArray(metadata.meanDensityPerHeightLayer)||metadata.meanDensityPerHeightLayer.length!==ny||
    // Houdini records floating density means before uint8 quantisation.
    means.some((n,i)=>Math.abs(n-metadata.meanDensityPerHeightLayer[i])>1/255+.0001))throw Error('Height-layer density means do not match the supplied binary.');
  if(filled/data.length<.05)throw Error('The density volume is empty.');
  const at=(x:number,y:number,z:number)=>data[x+nx*(y+ny*z)]/255;
  const seams={} as Record<'x'|'z',{seam:number;step:number}>;
  for(const axis of ['x','z'] as const){
    let seam=0,step=0,count=0;
    for(let y=0;y<ny;y+=Math.max(1,Math.floor(ny/8))){
      for(let n=0;n<(axis==='x'?nz:nx);n+=axis==='x'?4:2){
        const a=axis==='x'?at(0,y,n):at(n,y,0),b=axis==='x'?at(nx-1,y,n):at(n,y,nz-1),c=axis==='x'?at(1,y,n):at(n,y,1);
        seam+=Math.abs(a-b);step+=Math.abs(a-c);count++;
      }
    }
    seam/=count;step/=count;if(seam>3*step+.01)throw Error(`Visible ${axis} wrap seam.`);seams[axis]={seam,step};
  }
  return {base,resolution:spec.resolution,height:spec.height,bytes:data.length,filled:filled/data.length,seams,
    sha256:createHash('sha256').update(data).digest('hex')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  console.log(JSON.stringify(await checkVolumeAssets(process.argv[2],process.argv[3]),null,2));
}
