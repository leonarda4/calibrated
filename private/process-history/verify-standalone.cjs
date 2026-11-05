const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const base = __dirname;
const checksDir = path.join(base, 'summary-check');
fs.mkdirSync(checksDir, { recursive: true });
// Only this HTML is placed in the isolated folder: no sibling source images.
const copy = path.join(checksDir, 'standalone-copy.html');
fs.copyFileSync(path.join(base, 'summary.html'), copy);
const inventory = JSON.parse(fs.readFileSync(path.join(base, 'inventory.json'), 'utf8'));
const hashes = new Set(inventory.images.map(im => im.id));
function assert(value, message) { if (!value) throw new Error(message); }
(async () => {
  const errors = [], externalRequests = [], checks = [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-webxr-runtime=no-xr-runtime'] });
  try {
    const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
    await context.route('**/*', route => {
      if (/^https?:/.test(route.request().url())) { externalRequests.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
    await page.goto(pathToFileURL(copy).href);
    const structure = await page.evaluate(async () => {
      const images = [...document.querySelectorAll('.picture img')];
      await Promise.all(images.map(img => img.decode()));
      return {
        images: images.map(img => ({ src: img.src, width: img.naturalWidth, height: img.naturalHeight })),
        brokenAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(a => !document.getElementById(a.hash.slice(1))).map(a => a.hash),
        linkedResources: [...document.querySelectorAll('link[href],script[src],iframe,video,audio')].length,
        dates: [...document.querySelectorAll('time')].every(t => !Number.isNaN(Date.parse(t.dateTime)) && t.textContent.includes('CET')),
        stages: document.querySelectorAll('.stage').length,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert(structure.images.length === 9 && structure.images.every(im => im.width && im.height && im.src.startsWith('data:image/')), 'Nine embedded pictures must decode offline');
    for (const im of structure.images) {
      const hash = crypto.createHash('sha256').update(Buffer.from(im.src.split(',')[1], 'base64')).digest('hex');
      assert(hashes.has(hash), 'Embedded image must match original archived bytes');
    }
    assert(structure.brokenAnchors.length === 0 && structure.linkedResources === 0 && structure.dates && structure.stages === 7 && !structure.overflow, 'Document structure or desktop layout check failed');
    checks.push('Isolated HTML loads offline with nine original-byte images, valid timestamps/internal anchors and no linked resources');
    await page.screenshot({ path: path.join(checksDir, 'desktop-top.png') });
    await page.locator('#geometry').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(checksDir, 'desktop-geometry.png') });
    await page.locator('.picture').first().click();
    assert(await page.locator('dialog').evaluate(d => d.open), 'Image dialog must open');
    await page.locator('dialog img').evaluate(img => img.decode());
    await page.keyboard.press('Escape');
    assert(!await page.locator('dialog').evaluate(d => d.open), 'Escape must close image dialog');
    const source = page.locator('.image-context').first();
    await source.locator('summary').click();
    assert(await source.evaluate(d => d.open), 'Image explanation must expand');
    await source.locator('summary').click();
    checks.push('Picture enlargement, Escape dismissal and original-message disclosure work');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, 0); });
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Mobile page must fit viewport');
    await page.screenshot({ path: path.join(checksDir, 'mobile-top.png') });
    await page.locator('#atmosphere').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(checksDir, 'mobile-atmosphere.png') });
    await page.locator('#image-24 .picture').click();
    const dialogFits = await page.locator('dialog').evaluate(d => { const r=d.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; });
    assert(dialogFits, 'Enlarged mobile image must fit viewport');
    await page.keyboard.press('Escape');
    checks.push('390px mobile layout and enlarged screenshot fit without horizontal overflow');
    await page.emulateMedia({ media: 'print' });
    assert(await page.locator('.toolbar').evaluate(el => getComputedStyle(el).display === 'none'), 'Print stylesheet must hide toolbar');
    checks.push('Print stylesheet available');
    assert(errors.length === 0 && externalRequests.length === 0, 'No JavaScript errors or network requests allowed');
    checks.push('Zero JavaScript errors and zero external network requests');
    const report = { checkedAt: new Date().toISOString(), file: 'summary.html', bytes: fs.statSync(copy).size, checks, errors, externalRequests };
    fs.writeFileSync(path.join(checksDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    if (fs.existsSync(copy)) fs.unlinkSync(copy);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
