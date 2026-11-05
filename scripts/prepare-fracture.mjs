// Offline conversion of the supplied Blender/Ogawa rigid-fragment archive.
// This deliberately supports one inspected schema; unfamiliar input fails closed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, Box3, LoopOnce, Matrix4, Quaternion, ShapeUtils, Vector2, Vector3 } from 'three';

const root = fileURLToPath(new URL('../', import.meta.url));
const DATA = 1n << 63n;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ensure = (condition, message) => { if (!condition) throw new Error(`Fracture conversion: ${message}`); };

/** Small, bounded Ogawa reader. No HDF5, generic Alembic decoding, or compression. */
function archive(bytes) {
  ensure(bytes.length >= 16 && bytes.length <= 64 * 1024 * 1024 && bytes.subarray(0,5).toString() === 'Ogawa', 'expected an Ogawa archive between16bytes and64MiB');
  ensure(bytes[5] === 255 && bytes.readUInt16BE(6) === 1, 'archive is unfinished or uses an unsupported Ogawa version');
  const location = ref => {
    const offset = Number(ref & ~DATA);
    ensure(Number.isSafeInteger(offset) && offset >= 0 && (!offset || offset + 8 <= bytes.length), 'invalid archive offset');
    return offset;
  };
  const group = ref => {
    ensure(!(ref & DATA), 'expected group reference');
    const offset = location(ref);
    if (!offset) return [];
    const count = Number(bytes.readBigUInt64LE(offset));
    ensure(Number.isSafeInteger(count) && count <= 10000 && offset + 8 + count * 8 <= bytes.length, 'group exceeds bounded archive data');
    return Array.from({ length: count }, (_, i) => bytes.readBigUInt64LE(offset + 8 + i * 8));
  };
  const data = ref => {
    ensure(!!(ref & DATA), 'expected data reference');
    const offset = location(ref);
    if (!offset) return Buffer.alloc(0);
    const size = Number(bytes.readBigUInt64LE(offset));
    ensure(Number.isSafeInteger(size) && size >= 0 && offset + 8 + size <= bytes.length, 'data block exceeds archive');
    return bytes.subarray(offset + 8, offset + 8 + size);
  };
  const objectChildren = ref => {
    const children = group(ref);
    ensure(children.length >= 2, 'object lacks properties/header');
    const header = data(children.at(-1));
    let cursor = 0;
    const objects = children.slice(1,-1).map(child => {
      ensure(cursor + 4 <= header.length, 'truncated object name');
      const size = header.readUInt32LE(cursor); cursor += 4;
      ensure(size > 0 && size <= 256 && cursor + size + 1 <= header.length, 'invalid object-name size');
      const name = header.toString('utf8', cursor, cursor + size); cursor += size;
      const metadata = header[cursor++];
      ensure(/^[\w.-]+$/.test(name) && metadata !== 255, 'inline metadata/names are not supported by this asset profile');
      return { name, metadata, ref: child };
    });
    ensure(header.length - cursor === 32, 'unexpected object-header checksum layout');
    return { properties: children[0], objects };
  };
  const array = (ref, type, extent = 1) => {
    const samples = group(ref);
    ensure(samples.length === 2 && data(samples[1]).length === 0, 'mesh topology/attributes must have one static rank-one sample');
    const raw = data(samples[0]);
    ensure(raw.length >= 16 && (raw.length - 16) % (4 * extent) === 0, 'invalid static attribute size');
    const count = (raw.length - 16) / 4;
    ensure(count <= 2000000, 'attribute exceeds conversion budget');
    const values = Array.from({ length: count }, (_, i) => type === 'float' ? raw.readFloatLE(16 + i * 4) : raw.readInt32LE(16 + i * 4));
    ensure(values.every(Number.isFinite), 'nonfinite mesh attribute');
    return values;
  };
  const top = group(bytes.readBigUInt64LE(8));
  ensure(top.length === 6 && data(top[0]).readUInt32LE(0) === 0, 'unsupported Alembic/Ogawa root schema');
  const metadata = data(top[3]).toString('utf8');
  ensure(/_ai_Application=Blender/.test(metadata), 'expected the supplied Blender rigid-fragment export');
  const timing = data(top[4]);
  ensure(timing.length === 48 && timing.readUInt32LE(36) === 1, 'expected default and uniform fragment time samplings');
  const sampleCount = timing.readUInt32LE(24), secondsPerSample = timing.readDoubleLE(28), sourceStartSeconds = timing.readDoubleLE(40);
  ensure(sampleCount >= 2 && sampleCount <= 1000 && secondsPerSample > 0 && secondsPerSample <= 1 && Number.isFinite(sourceStartSeconds), 'invalid fragment timing');
  const objects = objectChildren(top[2]).objects;
  const fragments = objects.filter(object => /^Dissolve_left_cell(?:_\d+)?$/.test(object.name));
  ensure(fragments.length > 0 && fragments.length <= 128, 'expected a bounded set of actual fracture cells');
  return { group, data, array, objectChildren, fragments, sampleCount, secondsPerSample, sourceStartSeconds,
    omittedObjects: objects.filter(object => !fragments.includes(object)).map(object => object.name) };
}

function readFragment(file, object) {
  const transformObject = file.objectChildren(object.ref);
  ensure(transformObject.objects.length === 1, `${object.name} must have one mesh child`);
  const props = file.group(transformObject.properties);
  ensure(props.length === 3 && file.data(props[2]).includes(Buffer.from('.xform')) && file.data(props[2]).includes(Buffer.from('visible')), 'unexpected transform property layout');
  const transform = file.group(props[0]);
  ensure(transform.length === 6 && file.data(transform.at(-1)).includes(Buffer.from('.vals')), 'expected animated matrix transforms');
  const ops = file.group(transform[1]);
  ensure(ops.length === 1 && file.data(ops[0]).subarray(16).equals(Buffer.from([0x30])), 'only one full-matrix transform operation is supported');
  const samples = file.group(transform[2]);
  ensure(samples.length === file.sampleCount, 'fragment transforms do not share uniform timing');
  const matrices = samples.map(ref => {
    const raw = file.data(ref);
    ensure(raw.length === 144, 'expected sixteen float64 matrix channels after the16-byte sample digest');
    const values = Array.from({ length: 16 }, (_, i) => raw.readDoubleLE(16 + i * 8));
    ensure(values.every(Number.isFinite) && Math.abs(values[3]) + Math.abs(values[7]) + Math.abs(values[11]) + Math.abs(values[15]-1) < 1e-6,
      'fragment matrix is nonfinite or nonaffine');
    return new Matrix4().fromArray(values);
  });
  const shape = file.objectChildren(transformObject.objects[0].ref);
  ensure(shape.objects.length === 0, 'mesh contains an unsupported child hierarchy');
  const shapeProps = file.group(shape.properties);
  ensure(shapeProps.length === 2 && file.data(shapeProps[1]).includes(Buffer.from('.geom')), 'mesh lacks a PolyMesh schema');
  const geom = file.group(shapeProps[0]), header = file.data(geom.at(-1));
  ensure(geom.length === 9 && ['.selfBnds','P','.faceIndices','.faceCounts','.arbGeomParams','uv','N'].every(name => header.includes(Buffer.from(name))),
    'unsupported PolyMesh property layout');
  const positions = file.array(geom[1], 'float', 3), indices = file.array(geom[2], 'int'), counts = file.array(geom[3], 'int');
  const normals = file.array(geom[7], 'float', 3), uv = file.group(geom[6]);
  ensure(uv.length === 3 && file.data(uv[2]).includes(Buffer.from('.vals')) && file.data(uv[2]).includes(Buffer.from('.indices')), 'expected indexed UVMap');
  const uvValues = file.array(uv[0], 'float', 2), uvIndices = file.array(uv[1], 'int');
  ensure(positions.length >= 9 && indices.length > 0 && counts.every(n => n >= 3 && n <= 256) && counts.reduce((sum,n) => sum+n,0) === indices.length,
    'invalid mesh polygon topology');
  ensure(indices.every(i => Number.isInteger(i) && i >= 0 && i < positions.length/3), 'polygon refers to a missing vertex');
  ensure(normals.length === indices.length*3 && uvIndices.length === indices.length && uvIndices.every(i => i >= 0 && i < uvValues.length/2),
    'expected finite face-varying normals and indexed per-corner UVs');
  return { name: object.name, matrices, positions, indices, counts, normals, uvValues, uvIndices };
}

/** Preserve per-corner normals/UV seams while triangulating source polygons. */
function triangles(fragment) {
  const positions = [], normals = [], uvs = [], indices = [], vertices = new Map();
  const vertex = corner => {
    const source = fragment.indices[corner], uvIndex = fragment.uvIndices[corner];
    const n = fragment.normals.slice(corner*3,corner*3+3);
    const key = [source,...n,uvIndex].join(',');
    if (!vertices.has(key)) {
      vertices.set(key,positions.length/3);
      positions.push(...fragment.positions.slice(source*3,source*3+3)); normals.push(...n);
      uvs.push(...fragment.uvValues.slice(uvIndex*2,uvIndex*2+2));
    }
    return vertices.get(key);
  };
  let corner = 0;
  for (const count of fragment.counts) {
    const points = Array.from({ length: count }, (_, i) => new Vector3().fromArray(fragment.positions,fragment.indices[corner+i]*3));
    const faceNormal = new Vector3();
    points.forEach((a,i) => {
      const b = points[(i+1)%count];
      faceNormal.x += (a.y-b.y)*(a.z+b.z); faceNormal.y += (a.z-b.z)*(a.x+b.x); faceNormal.z += (a.x-b.x)*(a.y+b.y);
    });
    ensure(faceNormal.lengthSq()>1e-16,'degenerate polygon cannot be triangulated');
    const axis = [Math.abs(faceNormal.x),Math.abs(faceNormal.y),Math.abs(faceNormal.z)].indexOf(Math.max(Math.abs(faceNormal.x),Math.abs(faceNormal.y),Math.abs(faceNormal.z)));
    const contour = points.map(p => axis === 0 ? new Vector2(p.y,p.z) : axis === 1 ? new Vector2(p.z,p.x) : new Vector2(p.x,p.y));
    const result = count === 3 ? [[0,1,2]] : ShapeUtils.triangulateShape(contour,[]);
    ensure(result.length === count-2,'source polygon is not a simple triangulatable face');
    for (const input of result) {
      const tri = [...input];
      const normal = points[tri[1]].clone().sub(points[tri[0]]).cross(points[tri[2]].clone().sub(points[tri[0]]));
      const supplied = new Vector3().fromArray(fragment.normals,(corner+tri[0])*3);
      if (normal.dot(supplied)<0) [tri[1],tri[2]]=[tri[2],tri[1]];
      indices.push(...tri.map(i => vertex(corner+i)));
    }
    corner += count;
  }
  return { positions,normals,uvs,indices };
}

function buildGlb(fragments, timing, sourceHash) {
  const sourceBounds = new Box3();
  for (const fragment of fragments) for (let i=0;i<fragment.positions.length;i+=3) {
    sourceBounds.expandByPoint(new Vector3().fromArray(fragment.positions,i).applyMatrix4(fragment.matrices[0]));
  }
  const centre = sourceBounds.getCenter(new Vector3());
  const normalization = new Matrix4().makeRotationY(Math.PI).setPosition(centre.x,-sourceBounds.min.y,centre.z);
  const chunks = [], views = [], accessors = []; let length = 0;
  const accessor = (values,type,componentType=5126,bounds=false) => {
    const extent = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type];
    ensure(values.length%extent===0 && values.every(Number.isFinite),'invalid GLB accessor');
    const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}
    const raw = Buffer.from(componentType===5123 ? new Uint16Array(values).buffer : componentType===5125 ? new Uint32Array(values).buffer : new Float32Array(values).buffer);
    const bufferView=views.length;views.push({buffer:0,byteOffset:length,byteLength:raw.length});chunks.push(raw);length+=raw.length;
    const entry={bufferView,componentType,count:values.length/extent,type};
    if(bounds){entry.min=Array.from({length:extent},(_,axis)=>Math.min(...values.filter((_,i)=>i%extent===axis)));
      entry.max=Array.from({length:extent},(_,axis)=>Math.max(...values.filter((_,i)=>i%extent===axis)));}
    accessors.push(entry);return accessors.length-1;
  };
  const times=Array.from({length:timing.sampleCount},(_,i)=>i*timing.secondsPerSample), input=accessor(times,'SCALAR',5126,true);
  const nodes=[{name:'Fracture_BottomCentre_InwardPositiveZ',matrix:normalization.toArray(),children:[]}], meshes=[], channels=[], samplers=[];
  let triangleCount=0, vertexCount=0, maxReconstructionError=0, peakStep=0, peakFrame=0;
  const initial=new Box3(), allFrames=new Box3(), motion=Array(timing.sampleCount).fill(0);
  for (const fragment of fragments) {
    const geometry=triangles(fragment);triangleCount+=geometry.indices.length/3;vertexCount+=geometry.positions.length/3;
    const mesh=meshes.length;meshes.push({name:fragment.name,primitives:[{attributes:{POSITION:accessor(geometry.positions,'VEC3',5126,true),NORMAL:accessor(geometry.normals,'VEC3'),TEXCOORD_0:accessor(geometry.uvs,'VEC2')},
      indices:accessor(geometry.indices,'SCALAR',geometry.positions.length/3<65536?5123:5125),material:0,mode:4}]});
    const translations=[],rotations=[],scales=[];let previousQuaternion=null;
    fragment.matrices.forEach((matrix,frame) => {
      const t=new Vector3(),q=new Quaternion(),s=new Vector3();matrix.decompose(t,q,s);q.normalize();
      ensure(s.toArray().every(value=>Math.abs(value-1)<1e-5),'fragment has non-rigid scale/shear');
      if(previousQuaternion && previousQuaternion.dot(q)<0)q.set(-q.x,-q.y,-q.z,-q.w);
      previousQuaternion=q.clone();
      const tr=t.toArray().map(Math.fround), qr=q.toArray().map(Math.fround), sr=s.toArray().map(Math.fround);
      const rebuilt=new Matrix4().compose(new Vector3(...tr),new Quaternion(...qr),new Vector3(...sr));
      const error=Math.max(...matrix.elements.map((value,i)=>Math.abs(value-rebuilt.elements[i])));
      maxReconstructionError=Math.max(maxReconstructionError,error);ensure(error<2e-5,'TRS conversion exceeds source matrix tolerance');
      translations.push(...tr);rotations.push(...qr);scales.push(...sr);
      if(frame>0){const previous=fragment.matrices[frame-1],step=t.distanceTo(new Vector3().setFromMatrixPosition(previous));motion[frame]=Math.max(motion[frame],step);if(step>peakStep){peakStep=step;peakFrame=frame;}}
      for(let i=0;i<fragment.positions.length;i+=3){const point=new Vector3().fromArray(fragment.positions,i).applyMatrix4(matrix).applyMatrix4(normalization);allFrames.expandByPoint(point);if(frame===0)initial.expandByPoint(point);}
    });
    const node=nodes.length;nodes.push({name:fragment.name,mesh,translation:translations.slice(0,3),rotation:rotations.slice(0,4),scale:scales.slice(0,3)});nodes[0].children.push(node);
    for(const [target,values,type]of[['translation',translations,'VEC3'],['rotation',rotations,'VEC4'],['scale',scales,'VEC3']]){
      const sampler=samplers.length;samplers.push({input,output:accessor(values,type),interpolation:'LINEAR'});channels.push({sampler,target:{node,path:target}});
    }
  }
  const binary=Buffer.concat(chunks), binPadding=(4-binary.length%4)%4;
  const gltf={asset:{version:'2.0',generator:'Calibrated offline Ogawa rigid-fragment preparation'},scene:0,scenes:[{nodes:[0]}],nodes,meshes,
    materials:[{name:'Neutral fragment surface (Alembic supplies no PBR material)',pbrMetallicRoughness:{baseColorFactor:[.52,.49,.43,1],metallicFactor:0,roughnessFactor:.9}}],
    animations:[{name:'fracture',samplers,channels}],buffers:[{byteLength:binary.length}],bufferViews:views,accessors,
    extras:{sourceSha256:sourceHash,fragmentCount:fragments.length,sourceFirstSampleSeconds:timing.sourceStartSeconds}};
  const jsonBytes=Buffer.from(JSON.stringify(gltf)),jsonPadding=(4-jsonBytes.length%4)%4,json=Buffer.concat([jsonBytes,Buffer.alloc(jsonPadding,32)]);
  const header=Buffer.alloc(12),jsonHeader=Buffer.alloc(8),binHeader=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);
  header.writeUInt32LE(12+8+json.length+8+binary.length+binPadding,8);jsonHeader.writeUInt32LE(json.length);jsonHeader.writeUInt32LE(0x4e4f534a,4);
  binHeader.writeUInt32LE(binary.length+binPadding);binHeader.writeUInt32LE(0x004e4942,4);
  const glb=Buffer.concat([header,jsonHeader,json,binHeader,binary,Buffer.alloc(binPadding)]);
  const activeFrames=motion.flatMap((step,frame)=>step>=peakStep*.25?[frame]:[]), firstStrong=Math.min(...activeFrames),lastStrong=Math.max(...activeFrames);
  const sourceWindow={start:Math.max(0,firstStrong-6)*timing.secondsPerSample,end:Math.min(timing.sampleCount-1,lastStrong+30)*timing.secondsPerSample};
  const displacements=fragments.map(fragment=>new Vector3().setFromMatrixPosition(fragment.matrices.at(-1))
    .sub(new Vector3().setFromMatrixPosition(fragment.matrices[0]))
    .applyMatrix4(normalization).sub(new Vector3().applyMatrix4(normalization)));
  const verification=[0,peakFrame,Math.min(timing.sampleCount-1,Math.round(sourceWindow.end/timing.secondsPerSample)),timing.sampleCount-1]
    .map(frame=>({seconds:frame*timing.secondsPerSample,poses:fragments.map(fragment=>({name:fragment.name,
      matrix:normalization.clone().multiply(fragment.matrices[frame])}))}));
  return {glb,gltf,verification,metadata:{fragmentCount:fragments.length,sourceVertexCount:fragments.reduce((n,f)=>n+f.positions.length/3,0),vertexCount,triangleCount,
    sourcePolygonCount:fragments.reduce((n,f)=>n+f.counts.length,0),fps:1/timing.secondsPerSample,samples:timing.sampleCount,sourceFirstSampleSeconds:timing.sourceStartSeconds,
    durationSeconds:times.at(-1),rawArchiveEndSeconds:timing.sourceStartSeconds+times.at(-1),initialBounds:{min:initial.min.toArray(),max:initial.max.toArray(),size:initial.getSize(new Vector3()).toArray()},
    debrisBounds:{min:allFrames.min.toArray(),max:allFrames.max.toArray()},sourceInitialBounds:{min:sourceBounds.min.toArray(),max:sourceBounds.max.toArray()},
    sourceToObject:normalization.toArray(),forwardAxis:'+Z',upAxis:'+Y',origin:'initial panel bottom centre',maxTrsReconstructionError:maxReconstructionError,
    motion:{firstChangedFrame:motion.findIndex(step=>step>1e-5),lastChangedFrame:motion.findLastIndex(step=>step>1e-5),peakTranslationStep:peakStep,peakFrame,
      strongMotionFrames:[firstStrong,lastStrong],suggestedSourceWindow:sourceWindow,suggestedPlaybackSeconds:1.8,
      finalCentreDisplacement:{mean:displacements.reduce((sum,p)=>sum.add(p),new Vector3()).multiplyScalar(1/fragments.length).toArray(),
        positiveZPieces:displacements.filter(p=>p.z>0).length,negativeZPieces:displacements.filter(p=>p.z<0).length},
      suggestedTimeScale:(sourceWindow.end-sourceWindow.start)/1.8}}};
}

export function convertFracture(bytes) {
  const file=archive(bytes),fragments=file.fragments.map(object=>readFragment(file,object));
  const result=buildGlb(fragments,file,sha256(bytes));
  return { ...result,metadata:{formatVersion:1,sourceFile:'fracture_nowall.abc',sourceBytes:bytes.length,sourceSha256:sha256(bytes),
    producer:'Blender4.1.10 / Alembic1.8.3 Ogawa',omittedObjects:file.omittedObjects,...result.metadata,
    pieces:result.metadata.fragmentCount,vertices:result.metadata.vertexCount,triangles:result.metadata.triangleCount,
    duration:result.metadata.durationSeconds,bounds:result.metadata.initialBounds,
    activeWindow:[result.metadata.motion.suggestedSourceWindow.start,result.metadata.motion.suggestedSourceWindow.end]} };
}

async function main() {
  const args=process.argv.slice(2),force=args.includes('--force');
  ensure(args.every(arg=>['--force'].includes(arg)),'usage: node scripts/prepare-fracture.mjs [--force]');
  const source=path.join(root,'public','fracture_nowall.abc'),output=path.join(root,'public','effects','fracture','fracture.glb'),metadata=output.replace(/\.glb$/,'.meta.json');
  ensure(force || (!fs.existsSync(output)&&!fs.existsSync(metadata)),'derived files already exist; pass --force to replace only those derivatives');
  const bytes=fs.readFileSync(source),result=convertFracture(bytes);
  ensure(sha256(fs.readFileSync(source))===result.metadata.sourceSha256,'source changed during conversion');
  const { GLTFLoader }=await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loaded=await new GLTFLoader().parseAsync(result.glb.buffer.slice(result.glb.byteOffset,result.glb.byteOffset+result.glb.byteLength),'');
  let meshes=0,triangles=0;loaded.scene.traverse(object=>{if(object.isMesh){meshes++;triangles+=object.geometry.index.count/3;}});
  ensure(meshes===result.metadata.fragmentCount && triangles===result.metadata.triangleCount && loaded.animations.length===1,'pinned Three.js loader did not recover all fragments/animation');
  const mixer=new AnimationMixer(loaded.scene),action=mixer.clipAction(loaded.animations[0]);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
  let maxLoadedMatrixError=0;
  for(const sample of result.verification){mixer.setTime(sample.seconds);loaded.scene.updateMatrixWorld(true);
    for(const pose of sample.poses){const node=loaded.scene.getObjectByName(pose.name);ensure(node?.isMesh,'loaded fragment node is missing');
      maxLoadedMatrixError=Math.max(maxLoadedMatrixError,...pose.matrix.elements.map((value,i)=>Math.abs(value-node.matrixWorld.elements[i])));}}
  ensure(maxLoadedMatrixError<2e-5,'loaded animation does not reproduce source fragment poses');
  mixer.stopAllAction();mixer.uncacheRoot(loaded.scene);
  result.metadata.outputFile='fracture.glb';result.metadata.outputBytes=result.glb.length;result.metadata.outputSha256=sha256(result.glb);
  result.metadata.validation={pinnedThreeLoader:true,meshes,triangles,clipDuration:loaded.animations[0].duration,trackCount:loaded.animations[0].tracks.length,
    comparedPoseSamples:result.verification.length*meshes,maxLoadedMatrixError};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.tmp',result.glb);fs.renameSync(output+'.tmp',output);
  fs.writeFileSync(metadata,JSON.stringify(result.metadata,null,2)+'\n');
  console.log(JSON.stringify({output:path.relative(root,output),...result.metadata},null,2));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
