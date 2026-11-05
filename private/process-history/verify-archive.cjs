const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const base=__dirname, inventory=JSON.parse(fs.readFileSync(path.join(base,'inventory.json'),'utf8'));
(async()=>{
 const checks=[];
 for(const image of inventory.images){
  const bytes=fs.readFileSync(path.join(base,image.file));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==image.id)throw Error('Image hash mismatch');
  for(const o of image.occurrences){
   const [file,anchor]=o.conversation.split('#');
   const text=fs.readFileSync(path.join(base,file),'utf8');
   if(!text.includes(`id="${anchor}"`))throw Error('Missing conversation anchor');
   if(!text.includes(`../${image.file}`))throw Error('Image missing from its linked message');
  }
 }
 checks.push(`${inventory.images.length} original image hashes and all context links verified`);
 for(const s of inventory.sessions){
  const text=fs.readFileSync(path.join(base,s.file),'utf8');
  const count=[...text.matchAll(/<a id="message-\d+"><\/a>/g)].length;
  if(count!==s.messages)throw Error('Transcript message count mismatch');
 }
 checks.push(`${inventory.sessions.length} transcript message counts verified`);
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--force-webxr-runtime=no-xr-runtime']});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100},deviceScaleFactor:1});
  await page.goto(pathToFileURL(path.join(base,'gallery.html')).href);
  const decoded=await page.evaluate(async()=>{
   const imgs=[...document.images];
   await Promise.all(imgs.map(im=>{im.loading='eager';return im.decode()}));
   return imgs.map(im=>({width:im.naturalWidth,height:im.naturalHeight}));
  });
  if(decoded.some(d=>d.width===0||d.height===0))throw Error('Image decode failed');
  await page.locator('#search').fill('zzzz-no-matching-explanation');
  if(await page.locator('article:visible').count()!==0)throw Error('Gallery filtering failed');
  await page.locator('#search').fill('');
  if(await page.locator('article:visible').count()!==inventory.images.length)throw Error('Gallery reset failed');
  checks.push(`${decoded.length} images decode in Chrome; gallery search/reset passes`);
  await page.addStyleTag({content:'body{margin:16px}main{grid-template-columns:repeat(4,1fr);gap:10px}article{padding:6px}article h2{font-size:14px;margin:0}img{height:170px}details,small,input,body>p{display:none}h1{font-size:20px;margin:0}main{margin-top:12px}'});
  await page.screenshot({path:path.join(base,'contact-sheet.png'),fullPage:true});
 }finally{await browser.close()}
 const report={checkedAt:new Date().toISOString(),checks,missingImages:inventory.missingImages.length,parseFailures:inventory.failures.length};
 fs.writeFileSync(path.join(base,'verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
})();
