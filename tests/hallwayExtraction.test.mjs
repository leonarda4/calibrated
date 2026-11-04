import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { cropPly, fitFloor, readPly, transversePlane } from '../scripts/extract-hallway.mjs';

// Deliberately reordered properties, plus higher SH: copying must preserve all bytes.
const names = ['opacity', 'z', 'rot_2', 'x', 'scale_1', 'y', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'scale_0', 'rot_0', 'scale_2', 'rot_1', 'rot_3', 'f_rest_0'];
function fixture(points, newline = '\n') {
  const header = Buffer.from(['ply', 'format binary_little_endian 1.0', `element vertex ${points.length}`,
    ...names.map(name => `property float ${name}`), 'end_header', ''].join(newline));
  const body = Buffer.alloc(points.length * names.length * 4);
  points.forEach(([x,y,z], i) => names.forEach((name, j) => body.writeFloatLE(
    ({x,y,z})[name] ?? (i * names.length + j + 1) / 17, (i * names.length + j) * 4)));
  return Buffer.concat([header, body]);
}

test('hallway crop retains whole original records and the boundary, without coordinate or SH changes', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = fixture([[2,17.5,-1.45], [2,17.6,-1.45], [2,18.6,-1.45], [3,25,1.1]], newline);
    // Exactly representable station also covers the equality case.
    const plane = {normalRaw:[0,1,0], constantRaw:-17.5};
    const result = cropPly(source, {...plane, constantRaw:-17.6});
    const before = readPly(source), after = readPly(result.file);
    assert.equal(after.count, 3);
    assert.ok(source.subarray(before.end + before.stride).equals(result.file.subarray(after.end)));
    const equality = cropPly(fixture([[0,17.5,0],[0,17,0],[0,18,0]],newline),plane);
    assert.equal(equality.outputCount,2); assert.equal(equality.minSignedDistance,0);
  }
});

test('oblique crop selects a halfspace across floor and ceiling rather than raw Y alone', () => {
  const n = new Vector3(1,2,.3).normalize(), point = new Vector3(2,17.6,-1.45);
  const plane = {normalRaw:n.toArray(), constantRaw:-n.dot(point)};
  const points = [[0,18,0], [4,17.4,0], [2,17.4,-1.4], [2,17.4,2], [0,15,0]];
  const beforeFile=fixture(points), before=readPly(beforeFile), result=cropPly(beforeFile,plane), after=readPly(result.file);
  const expected=points.map((xyz,i)=>({xyz,i})).filter(({xyz})=>n.dot(new Vector3(...xyz).sub(point))>=0);
  assert.equal(after.count,expected.length);
  expected.forEach(({i},j)=>assert.ok(beforeFile.subarray(before.end+i*before.stride,before.end+(i+1)*before.stride)
    .equals(result.file.subarray(after.end+j*after.stride,after.end+(j+1)*after.stride))));
});

test('a tilted noisy floor and uneven density produce an orthogonal transverse frame', () => {
  const seed=[2,17.6,-1.45], centers=[];
  for(let ix=0;ix<=32;ix++)for(let iy=0;iy<=30;iy++) {
    const x=-.8+ix*.05, y=-1.5+iy*.1;
    centers.push(seed[0]+x,seed[1]+y,seed[2]+.012*x-.006*y+.002*Math.sin(ix*iy));
  }
  // A dense local scan artifact must not pull the complete floor toward it.
  for(let i=0;i<3000;i++) centers.push(2.005,17.605,-1.36);
  const floor=fitFloor(new Float32Array(centers),seed,.85), expectedUp=new Vector3(-.012,.006,1).normalize();
  const actualUp=new Vector3(...floor.normalRaw);
  assert.ok(actualUp.distanceTo(expectedUp)<.001); assert.ok(floor.residual<.005);
  const direction=new Vector3(.03,1,0).normalize(), plane=transversePlane(floor.pointRaw,floor.normalRaw,direction.toArray());
  const cut=new Vector3(...plane.normalRaw), lateral=new Vector3().crossVectors(actualUp,direction).normalize();
  assert.ok(Math.abs(cut.dot(actualUp))<1e-12); assert.ok(Math.abs(cut.dot(lateral))<1e-12);
  assert.ok(cut.dot(direction)>.999); assert.ok(Math.abs(cut.dot(new Vector3(...floor.pointRaw))+plane.constantRaw)<1e-12);
});

test('invalid or unsupported crops fail rather than emit an empty or unbounded object', () => {
  const source=fixture([[0,0,0],[1,1,1]]);
  assert.throws(()=>readPly(source.subarray(0,source.length-1)),/body length/);
  assert.throws(()=>cropPly(source,{normalRaw:[0,2,0],constantRaw:0}),/unit normal/);
  assert.throws(()=>cropPly(source,{normalRaw:[0,1,0],constantRaw:-2}),/retain part/);
  assert.throws(()=>cropPly(source,{normalRaw:[0,1,0],constantRaw:1}),/retain part/);
  assert.throws(()=>fitFloor(new Float32Array([2,17.6,-1.45]),[2,17.6,-1.45],.8),/coverage/);
  assert.throws(()=>transversePlane([0,0,0],[0,0,1],[0,0,2]),/direction/);
});

test('corridor envelope removes exterior rooms and below-floor noise without changing retained splats', () => {
  const original=fixture([[0,2,.5],[3,2,.5],[0,2,-1],[0,2,4],[0,-1,.5]]), before=readPly(original);
  const result=cropPly(original,{normalRaw:[0,1,0],constantRaw:0},[
    {normalRaw:[1,0,0],constantRaw:1.3}, {normalRaw:[-1,0,0],constantRaw:1.3},
    {normalRaw:[0,0,1],constantRaw:.15}, {normalRaw:[0,0,-1],constantRaw:2.85},
  ]), after=readPly(result.file);
  assert.equal(after.count,1);
  assert.ok(original.subarray(before.end,before.end+before.stride).equals(result.file.subarray(after.end)));
});
