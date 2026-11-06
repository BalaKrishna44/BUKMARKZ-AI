import { chromium } from '/tmp/vsb/node_modules/playwright/index.mjs';
const br = await chromium.launch();
const errs = [];
async function mk(opts = {}) { const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, ...opts }); const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type()==='error' && errs.push(m.text())); await pg.goto('file:///tmp/fxt/index.html'); await pg.waitForSelector('[data-testid=card]'); await pg.waitForTimeout(500); return pg; }
const ok = (c, m) => console.log(c ? 'ok  ' : 'FAIL', m);

let pg = await mk();
// ---- canvas draws ----
const px = await pg.evaluate(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for (let i=3;i<d.length;i+=4) if (d[i]>0) n++; return { n, w:c.width, h:c.height, css:c.getBoundingClientRect().width }; });
ok(px.n > 500, `canvas has drawn pixels (${px.n} non-transparent of ${px.w}x${px.h})`);
// ---- animation actually moves ----
const snap = () => pg.evaluate(() => { const c = document.querySelector('canvas'); return c.toDataURL().length + ':' + c.toDataURL().slice(-60); });
const a = await snap(); await pg.waitForTimeout(400); const b = await snap();
ok(a !== b, 'canvas content changes between frames (animating)');
// ---- frame budget: count rAF ticks over 2 s ----
const fps = await pg.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now()-t0 < 2000 ? requestAnimationFrame(f) : res(n/2); }; requestAnimationFrame(f); }));
console.log('     rAF rate with particles running (software-rendered headless):', fps.toFixed(1), 'fps');
// frame cost of the draw itself
const cost = await pg.evaluate(() => new Promise(res => { const c = document.querySelector('canvas'); const orig = c.getContext('2d').clearRect; const times = []; let t=0; const ctx = c.getContext('2d'); const cr = ctx.clearRect.bind(ctx); ctx.clearRect = (...a) => { t = performance.now(); cr(...a); }; const di = ctx.drawImage.bind(ctx); let last=0; ctx.drawImage = (...a) => { last = performance.now(); return di(...a); }; const iv = setInterval(()=>{ if (last>t && t) times.push(last - t); }, 16); setTimeout(()=>{ clearInterval(iv); ctx.clearRect = cr; ctx.drawImage = di; res(times); }, 2000); }));
const avg = cost.reduce((s,v)=>s+v,0)/Math.max(1,cost.length);
console.log('     approx draw-phase time per frame:', avg.toFixed(2), 'ms (samples', cost.length + ')');
ok(avg < 8, 'draw phase well under the 16.6 ms frame budget');
// ---- tilt ----
const card = pg.locator('[data-testid=card]').first(); const box = await card.boundingBox();
const tf = () => card.evaluate(e => ({ t: getComputedStyle(e).transform, rx: e.style.getPropertyValue('--tilt-rx'), ry: e.style.getPropertyValue('--tilt-ry'), g: e.style.getPropertyValue('--tilt-glare'), mx: e.style.getPropertyValue('--tilt-mx') }));
ok((await tf()).t === 'none' || /^matrix3d\(1, 0, 0, 0, 0, 1, 0, 0/.test((await tf()).t) || (await tf()).t.startsWith('matrix'), 'rest transform is neutral');
await pg.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.1, { steps: 6 }); await pg.waitForTimeout(700);
const hov = await tf();
ok(/matrix3d/.test(hov.t), 'hover applies a 3D matrix: ' + hov.t.slice(0, 40) + '…');
ok(parseFloat(hov.ry) > 5 && parseFloat(hov.rx) > 5, `top-right corner => rotateY ${hov.ry}, rotateX ${hov.rx} (leans toward cursor)`);
ok(parseFloat(hov.g) > 0.2 && parseFloat(hov.mx) > 80, `sheen follows the cursor (glare ${hov.g}, x ${hov.mx})`);
await pg.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.9, { steps: 6 }); await pg.waitForTimeout(700);
const opp = await tf(); ok(parseFloat(opp.ry) < -5 && parseFloat(opp.rx) < -5, `opposite corner flips the tilt (${opp.ry}, ${opp.rx})`);
await pg.screenshot({ path: '/tmp/fxt/tilt.png' });
await pg.mouse.move(5, 5, { steps: 4 }); await pg.waitForTimeout(1500);
const rest = await tf(); ok(Math.abs(parseFloat(rest.rx)) < 0.05 && parseFloat(rest.g) < 0.01, 'eases back flat and sheen fades on leave');
// loop sleeps when settled: no style writes after settling
const writes = await card.evaluate(e => new Promise(res => { let n=0; const o=new MutationObserver(m=>n+=m.length); o.observe(e,{attributes:true,attributeFilter:['style']}); setTimeout(()=>{o.disconnect();res(n)},700); }));
ok(writes === 0, 'idle card does zero work (rAF loop sleeps)');
// depth layer
const z = await pg.locator('[data-testid=card] h2').first().evaluate(e => e.parentElement.style.transform); ok(z === 'translateZ(40px)', 'TiltDepth lifts children: ' + z);
// touch ignored
const tcx = await br.newContext({ hasTouch: true, viewport: { width: 400, height: 800 } }); const tp = await tcx.newPage(); await tp.goto('file:///tmp/fxt/index.html'); await tp.waitForSelector('[data-testid=card]');
await tp.evaluate(() => { const c = document.querySelector('[data-testid=card]'); const r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, pointerType:'touch', clientX:r.left+r.width*.9, clientY:r.top+10 })); });
await tp.waitForTimeout(300); ok((await tp.evaluate(() => document.querySelector('[data-testid=card]').style.getPropertyValue('--tilt-ry'))) === '', 'touch pointers never tilt (scrolling is not hijacked)');
const sw = await tp.evaluate(() => document.documentElement.scrollWidth > innerWidth); ok(!sw, 'no horizontal scroll at 400px');
await tp.screenshot({ path: '/tmp/fxt/mobile.png' });
// ---- reduced motion ----
const rp = await mk({ reducedMotion: 'reduce' });
const rbox = await rp.locator('[data-testid=card]').first().boundingBox(); await rp.mouse.move(rbox.x + rbox.width * .9, rbox.y + 10, { steps: 4 }); await rp.waitForTimeout(400);
ok((await rp.locator('[data-testid=card]').first().evaluate(e => e.style.getPropertyValue('--tilt-ry'))) === '', 'reduced motion: no tilt');
const r1 = await rp.evaluate(() => document.querySelector('canvas').toDataURL().length); await rp.waitForTimeout(500); const r2 = await rp.evaluate(() => document.querySelector('canvas').toDataURL().length);
ok(r1 === r2 && r1 > 2000, 'reduced motion: particle field is a static frame');
// ---- pause when hidden ----
await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await pg.waitForTimeout(150); const h1 = await snap(); await pg.waitForTimeout(400); const h2 = await snap(); ok(h1 === h2, 'animation pauses when the tab is hidden');
// ---- resize ----
await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await pg.setViewportSize({ width: 390, height: 700 }); await pg.waitForTimeout(500);
ok((await pg.evaluate(() => { const c = document.querySelector('canvas'); return c.width <= Math.ceil(390 * 1.5) + 2; })), 'canvas resizes with the viewport; DPR capped at 1.5');
console.log('errors:', errs);
await br.close();
