// A tiny stand-in for the Bukmarkz web app that reproduces the *DOM contract* the spec relies on (labels, roles, text, URLs, API shapes).
// Purpose: prove full-flow.spec.ts itself is correct and runs green in headless Chromium without Supabase/OpenAI. It is NOT the product.
//   node e2e/_selftest/mock-app.mjs  (PORT=3100)    then  E2E_BASE_URL=http://localhost:3100 E2E_EMAIL=qa@x.test E2E_PASSWORD=x E2E_STACK_SLUG=pg-toolkit E2E_VAULT_HAS_DATA=1 npx playwright test
import http from 'node:http';
const PORT = Number(process.env.PORT ?? 3100);
const marks = []; const stacks = { 'pg-toolkit': { title: 'Postgres toolkit', own: false, links: ['https://github.com/pgvector/pgvector', 'https://www.postgresql.org/docs/current/indexes-types.html', 'https://supabase.com/docs/guides/database/postgres/row-level-security'] } };
let remixes = 0;
const page = (title, body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
const authed = (req) => /(^|; )sess=1/.test(req.headers.cookie ?? '');
const send = (res, code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, ...extra }); res.end(body); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

const SWITCH = page('Switch', `<main><h1>Switch from Raindrop</h1><div id="root"></div></main><script>
const root = document.getElementById('root');
function idle(msg){ root.innerHTML = '<label><span>Drop your Raindrop export here</span><input type="file" accept=".html,.htm,.csv,.json" class="sr-only"></label><p role="status" aria-live="polite">'+(msg||'')+'</p><p>Parsed in your browser. Nothing is uploaded until you sign in and confirm.</p>'; root.querySelector('input').onchange = (e) => handle(e.target.files[0]); }
async function handle(f){ if(!f) return; if(f.size===0) return idle('That file is empty.'); if(f.size>50*1048576) return idle('That file is '+(f.size/1048576).toFixed(1)+' MB. The limit is 50 MB; try exporting one collection at a time.');
  const t = await f.text(); const links=[...t.matchAll(/<A [^>]*HREF="([^"]*)"/gi)].map(m=>m[1]); const ok=links.filter(h=>/^https?:/i.test(h)); const skipped=links.length-ok.length;
  if(!ok.length) return idle('No web links found in that file. Check that it is a bookmarks export (HTML, CSV or JSON).');
  const folders=[...t.matchAll(/<H3[^>]*>([^<]*)<\\/H3>/gi)].map(m=>m[1]);
  root.innerHTML='<h2>'+ok.length+' links ready</h2><p>Looks like a raindrop export. Read in your browser; nothing has been uploaded.</p><h3>Folders and tags found</h3><ul>'+folders.map(n=>'<li><span>'+n+'</span></li>').join('')+'</ul>'+(skipped?'<p>'+skipped+' item can’t be imported (not regular web links).</p>':'')+'<button type="button" id="go">Continue with '+ok.length+' links</button>';
  document.getElementById('go').onclick=()=>{ location.href='/login?next='+encodeURIComponent('/dashboard/import/resume')+'&ref='+encodeURIComponent('switch_raindrop'); }; }
idle('');</script>`);

const LOGIN = page('Login', `<main><form id="f"><h1>Welcome back</h1><label for="email">Email</label><input id="email" type="email" required><label for="password">Password</label><input id="password" type="password" required><button type="submit">Sign in</button></form></main><script>
f.onsubmit=(e)=>{e.preventDefault(); document.cookie='sess=1; path=/'; location.assign(new URLSearchParams(location.search).get('next')||'/dashboard');};</script>`);

const DASH = page('Dashboard', `<main>
<form role="search" id="sf"><div role="group" aria-label="Search mode"><button type="button" id="m-s" aria-pressed="true">Search</button><button type="button" id="m-a" aria-pressed="false">Ask</button></div>
<label><span class="sr-only" id="lbl">Search your bookmarks</span><input id="q" maxlength="300" autocomplete="off"></label><span id="slot"></span></form>
<div id="ans"></div>
<button type="button" id="addbtn" aria-expanded="false">Add bookmark</button><div id="pop"></div>
<ul id="list"></ul>
<section aria-labelledby="mr-h" id="mr"><h2 id="mr-h">Buk’s Morning Resurface</h2><p id="cnt"></p><div role="progressbar" aria-label="Links revisited" aria-valuemin="0" aria-valuemax="2" aria-valuenow="0"></div><ul id="mrl"></ul></section>
</main><script>
let mode='search', opened=0; const $=(i)=>document.getElementById(i); const ans=$('ans'), m_s=$('m-s'), m_a=$('m-a'), lbl=$('lbl'), slot=$('slot'), q=$('q'), sf=$('sf'), list=$('list'), addbtn=$('addbtn'), pop=$('pop'), cnt=$('cnt'), mrl=$('mrl');
const draw=()=>{ m_s.setAttribute('aria-pressed',mode==='search'); m_a.setAttribute('aria-labelledby',''); m_a.setAttribute('aria-pressed',mode==='ask'); lbl.textContent=mode==='ask'?'Ask your vault a question':'Search your bookmarks';
  slot.innerHTML=(q.value?'<button type="button" id="clr" aria-label="Clear">x</button>':'')+(mode==='ask'?'<button type="submit" '+(q.value.trim()?'':'disabled')+'>Ask</button>':''); const c=document.getElementById('clr'); if(c) c.onclick=()=>{q.value='';draw();filter();}; };
m_s.onclick=()=>{mode='search';draw()}; m_a.onclick=()=>{mode='ask';draw()}; q.oninput=()=>{draw(); if(mode==='search') filter();}; draw();
sf.onsubmit=async(e)=>{e.preventDefault(); if(mode!=='ask'||!q.value.trim()) return; const r=await fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({q:q.value})}); const j=await r.json();
  ans.innerHTML='<section aria-label="Answer from your vault"><p>Buk’s answer</p><button type="button" aria-label="Dismiss answer" id="dis">x</button><p>'+j.answer+'</p>'+j.sources.map(s=>'<a href="'+s.url+'" target="_blank" rel="noopener noreferrer">'+s.title+'</a>').join('')+'</section>'; $('dis').onclick=()=>ans.innerHTML='';};
let items=[]; const render=(f)=>{ list.innerHTML=items.filter(i=>!f||i.url.includes(f)).map(i=>'<li><a href="'+i.url+'">'+i.url.replace(/^https?:\\/\\//,'')+'</a> <span>example.com</span></li>').join(''); };
const filter=()=>render(q.value); const load=async()=>{ items=await (await fetch('/api/bookmarks')).json(); render(''); }; load();
addbtn.onclick=()=>{ addbtn.setAttribute('aria-expanded','true'); pop.innerHTML='<form id="af"><label for="add-url">Page address</label><input id="add-url" placeholder="https://example.com/article"><button type="button" id="cx">Cancel</button><button type="submit"><span aria-hidden="true">+</span> Save</button></form>';
  $('af').onsubmit=async(e)=>{e.preventDefault(); await fetch('/api/bookmarks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:document.getElementById('add-url').value})}); pop.innerHTML=''; await load();}; };
const links=[{id:1,t:'Why HNSW',u:'https://example.org/hnsw'},{id:2,t:'RLS patterns',u:'https://example.org/rls'}]; const st={};
const mrdraw=()=>{ cnt.textContent=opened+' of '+links.length+' revisited today'; document.querySelector('[role=progressbar]').setAttribute('aria-valuenow',opened);
  mrl.innerHTML=links.map(l=>'<li><a href="'+l.u+'" target="_blank" rel="noopener noreferrer" data-id="'+l.id+'">'+l.t+'</a><button type="button" aria-label="Snooze '+l.t+'">z</button></li>').join('');
  mrl.querySelectorAll('a').forEach(a=>a.onclick=(e)=>{ e.preventDefault(); if(!st[a.dataset.id]){st[a.dataset.id]=1;opened++;} mrdraw(); }); };
mrdraw();
</script>`);

const STACK = (slug, s, isAuthed) => page(s.title, `<main><h1>${s.title}</h1>${s.remixedFrom ? `<p>Remixed from ${s.remixedFrom}</p>` : ''}<ul>${s.links.map((l) => `<li><a href="${l}" target="_blank" rel="noopener noreferrer">${l}</a></li>`).join('')}</ul>
<div id="actions"></div></main><script>
const slug=${JSON.stringify(slug)}; const a=document.getElementById('actions'); let lock=false, v=null;
a.innerHTML='<span id="fc">0 followers</span>'; fetch('/api/stacks/follow?slug='+slug,{cache:'no-store'}).then(r=>r.json()).then(j=>{v=j; a.innerHTML=(j.own?'<span>This is your stack</span>':'<button type="button" id="fol">+ Follow Stack</button><button type="button" id="rmx">⑂ Remix this Stack</button>')+' <span>0 followers</span>'; wire();});
function wire(){ const r=document.getElementById('rmx'); if(!r) return; r.onclick=async()=>{ if(lock) return; lock=true; if(!v.authed){ location.href='/login?next='+encodeURIComponent('/s/'+slug); return; }
  const res=await fetch('/api/stacks/remix',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug})}); const j=await res.json(); if(res.ok){ location.href='/s/'+j.slug; return;} lock=false; }; }
</script>`, `<meta property="og:title" content="${s.title}">`);

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  if (p === '/switch/raindrop') return send(res, 200, 'text/html', SWITCH);
  if (p === '/login') return send(res, 200, 'text/html', LOGIN);
  if (p === '/dashboard') return authed(req) ? send(res, 200, 'text/html', DASH) : (res.writeHead(302, { location: '/login?next=/dashboard' }), res.end());
  if (p === '/api/ask' && req.method === 'POST') { if (!authed(req)) return send(res, 401, 'application/json', '{}'); return send(res, 200, 'application/json', JSON.stringify({ answer: 'You saved the pgvector README, which covers HNSW and IVFFlat.', sources: [{ title: 'pgvector', url: 'https://github.com/pgvector/pgvector' }] })); }
  if (p === '/api/bookmarks') { if (req.method === 'POST') { const b = JSON.parse(await readBody(req)); marks.push({ url: b.url }); return send(res, 200, 'application/json', '{"ok":true}'); } return send(res, 200, 'application/json', JSON.stringify(marks)); }
  if (p === '/api/stacks/follow') { const s = stacks[u.searchParams.get('slug')]; return send(res, 200, 'application/json', JSON.stringify({ authed: authed(req), own: !!s?.own, following: false, follower_count: 0 })); }
  if (p === '/api/stacks/remix' && req.method === 'POST') { if (!authed(req)) return send(res, 401, 'application/json', '{}'); const b = JSON.parse(await readBody(req)); const o = stacks[b.slug]; const slug = `${b.slug}-remix-${++remixes}`; stacks[slug] = { title: o.title, own: true, links: o.links, remixedFrom: o.title }; return send(res, 200, 'application/json', JSON.stringify({ slug })); }
  const m = /^\/s\/([^/]+)$/.exec(p);
  if (m) { const s = stacks[m[1]]; return s ? send(res, 200, 'text/html', STACK(m[1], s, authed(req))) : send(res, 404, 'text/html', page('Not found', '<h1>404</h1>')); }
  send(res, 404, 'text/plain', 'nope');
}).listen(PORT, () => console.log('mock app on', PORT));
