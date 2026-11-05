import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createServer as portProbe} from 'node:net';

/** Exercise Vite's actual awaited reload event without a native XR request. */
export async function runDevReloadScenario(parent) {
  const port=await new Promise((resolve,reject)=>{
    const probe=portProbe();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{
      const value=probe.address().port;probe.close(error=>error?reject(error):resolve(value));
    });
  });
  // The main regression server intentionally disables HMR. Keep this actual
  // reload check on its own local server and target only its child-page client.
  const server=await createServer({configFile:false,root:process.cwd(),cacheDir:'.check/dev-reload-vite-cache',
    optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:true}});
  await server.listen().catch(async error=>{await server.close();throw error;});const ws=server.ws;
  let page;const errors=[],nonce=`reload-${Date.now()}-${Math.random()}`;
  let requested=false;
  const listener=(data,client)=>{if(data?.nonce===nonce){requested=true;client.send({type:'full-reload'});}};
  try {
    page=await parent.context().newPage();ws.on('hallway:reload-check',listener);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    const url=`http://127.0.0.1:${port}/__xr_reload_check`;
    // Recent Chrome gates loopback WebSockets even on loopback test pages.
    // Grant only this disposable origin; no user-browser preference changes.
    await parent.context().grantPermissions(['local-network-access'],{origin:new URL(url).origin});
    await page.route(url,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><script type="module">
      import {createHotContext} from '/@vite/client';
      import {deferDevReload} from '/src/xr/deferDevReload.ts';
      const hot=createHotContext('/__xr_reload_check_context');
      const session=new EventTarget(),state={hot,session,deferred:0,endCalls:0,ready:true};
      session.end=()=>{state.endCalls++;};
      sessionStorage.reloadCheckBoots=String(Number(sessionStorage.reloadCheckBoots||0)+1);
      state.guard=deferDevReload(hot,()=>state.session,()=>state.deferred++);
      window.__reloadCheck=state;
      </script></body></html>`}));
    await page.goto(url,{waitUntil:'load'});await page.waitForFunction(()=>window.__reloadCheck?.ready);
    await page.evaluate(nonce=>window.__reloadCheck.hot.send('hallway:reload-check',{nonce}),nonce);
    await page.waitForFunction(()=>window.__reloadCheck?.deferred===1,{},{timeout:5000}).catch(error=>{
      throw new Error(`${error.message}; request received=${requested}; browser errors=${JSON.stringify(errors)}`);
    });
    await page.evaluate(()=>new Promise(resolve=>{let frames=0;const next=()=>{if(++frames===8)resolve();else requestAnimationFrame(next);};requestAnimationFrame(next);}));
    const held=await page.evaluate(()=>({boots:Number(sessionStorage.reloadCheckBoots),endCalls:window.__reloadCheck.endCalls}));
    assert.deepEqual(held,{boots:1,endCalls:0},'A development reload cannot exit an active headset session.');
    const loaded=page.waitForEvent('load');
    await page.evaluate(()=>{const s=window.__reloadCheck,session=s.session;s.session=null;session.dispatchEvent(new Event('end'));});
    await loaded;await page.waitForFunction(()=>window.__reloadCheck?.ready);
    assert.equal(await page.evaluate(()=>Number(sessionStorage.reloadCheckBoots)),2,'The deferred reload resumes after session end.');
    assert.deepEqual(errors,[]);
    return {actualViteReload:true,heldDuringSyntheticSession:true,resumedAfterEnd:true,endCalls:0,noNativeXrRequest:true};
  } finally {ws.off('hallway:reload-check',listener);await page?.close();await server.close();}
}
