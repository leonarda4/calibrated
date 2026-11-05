import test from 'node:test';
import assert from 'node:assert/strict';
import {deferDevReload} from '../src/xr/deferDevReload.ts';

function fixture() {
  const listeners=new Map<string,()=>Promise<void>|undefined>();
  const hot={on:(name:string,callback:()=>Promise<void>|undefined)=>listeners.set(name,callback),
    off:(name:string)=>listeners.delete(name)} as unknown as NonNullable<Parameters<typeof deferDevReload>[0]>;
  let session:EventTarget|null=null,deferred=0;
  const guard=deferDevReload(hot,()=>session as XRSession|null,()=>deferred++);
  return {listeners,guard,setSession:(value:EventTarget|null)=>{session=value;},deferred:()=>deferred};
}

test('desktop development updates are immediate and production needs no hot client',()=>{
  const f=fixture();for(const callback of f.listeners.values())assert.equal(callback(),undefined);
  assert.equal(f.deferred(),0);f.guard.dispose();assert.equal(f.listeners.size,0);
  deferDevReload(undefined,()=>{throw Error('Production must not inspect a session.');}).dispose();
});

test('source reloads, updates and server reconnects wait for actual XR end without ending it',async()=>{
  const f=fixture(),session=new EventTarget();let ends=0;
  Object.assign(session,{end:()=>{ends++;}});f.setSession(session);
  const waiting=[...f.listeners.values()].map(callback=>callback()!);
  let resumed=0;waiting.forEach(p=>{void p.then(()=>resumed++);});
  await Promise.resolve();assert.equal(resumed,0);assert.equal(ends,0);assert.equal(f.deferred(),1);
  f.setSession(null);session.dispatchEvent(new Event('end'));await Promise.all(waiting);
  assert.equal(resumed,3);assert.equal(ends,0);
  assert.equal(f.listeners.get('vite:beforeFullReload')!(),undefined);f.guard.dispose();
});

test('later headset sessions get independent gates and teardown releases every pending listener',async()=>{
  const f=fixture();
  for(let visit=0;visit<2;visit++) {
    const session=new EventTarget();f.setSession(session);
    const pending=f.listeners.get('vite:beforeFullReload')!()!;
    session.dispatchEvent(new Event('end'));await pending;
  }
  assert.equal(f.deferred(),2);
  const session=new EventTarget();f.setSession(session);
  const pending=f.listeners.get('vite:beforeUpdate')!()!;
  f.guard.dispose();await pending;assert.equal(f.listeners.size,0);
  session.dispatchEvent(new Event('end'));f.guard.dispose();
});
