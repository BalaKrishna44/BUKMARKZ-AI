'use client';
/**
 * Bukmarkz interactive sandbox  ·  /demo
 * Self-contained: React only (no extra packages, no API keys, no network). Tailwind classes for styling.
 * Everything "AI" here is simulated with local scoring so the page works out-of-the-box.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';

/* ───────────────────────────── types ───────────────────────────── */
type Category = 'Dev' | 'Design' | 'AI' | 'Reading' | 'Video' | 'Finance' | 'Other';
interface Bookmark { id: string; title: string; url: string; description: string; tags: string[]; category: Category; note?: string; folder?: string; imported?: boolean }
interface Task { id: string; text: string; sourceId: string; done: boolean }
type ModelId = 'claude' | 'gemini' | 'chatgpt';
interface Match { bookmark: Bookmark; score: number }

/* ───────────────────────────── data ───────────────────────────── */
const CAT_STYLE: Record<Category, { dot: string; chip: string; hex: string }> = {
  Dev: { dot: 'bg-sky-400', chip: 'bg-sky-400/15 text-sky-300', hex: '#38bdf8' },
  Design: { dot: 'bg-fuchsia-400', chip: 'bg-fuchsia-400/15 text-fuchsia-300', hex: '#e879f9' },
  AI: { dot: 'bg-amber-400', chip: 'bg-amber-400/15 text-amber-300', hex: '#fbbf24' },
  Reading: { dot: 'bg-emerald-400', chip: 'bg-emerald-400/15 text-emerald-300', hex: '#34d399' },
  Video: { dot: 'bg-rose-400', chip: 'bg-rose-400/15 text-rose-300', hex: '#fb7185' },
  Finance: { dot: 'bg-teal-300', chip: 'bg-teal-300/15 text-teal-200', hex: '#5eead4' },
  Other: { dot: 'bg-slate-400', chip: 'bg-slate-400/15 text-slate-300', hex: '#94a3b8' },
};
const CATS = Object.keys(CAT_STYLE) as Category[];

const SEED: Bookmark[] = [
  { id: 's1', title: 'Next.js App Router: server vs client components', url: 'https://nextjs.org/docs/app', description: 'Official guide to the App Router, layouts, streaming and the server/client boundary.', tags: ['react', 'nextjs', 'frontend'], category: 'Dev', note: 'TODO: migrate the bookmarks page to a server component\nTODO: add loading.tsx skeletons' },
  { id: 's2', title: 'Supabase Row Level Security, explained', url: 'https://supabase.com/docs/guides/database/postgres/row-level-security', description: 'Policies, auth.uid() and how to lock tables so each user only sees their own rows.', tags: ['supabase', 'postgres', 'security'], category: 'Dev', note: '- [ ] write RLS policy for bookmarks\n- [ ] test with two users' },
  { id: 's3', title: 'pgvector: embeddings and similarity search in Postgres', url: 'https://github.com/pgvector/pgvector', description: 'Store embeddings next to your rows and query by cosine distance with HNSW indexes.', tags: ['postgres', 'embeddings', 'search', 'ai'], category: 'AI', note: 'TODO: backfill embeddings for old bookmarks' },
  { id: 's4', title: 'Prompting Claude: patterns for reliable structured output', url: 'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview', description: 'Tool use, XML tags and examples for getting valid JSON back from an LLM.', tags: ['llm', 'prompting', 'ai'], category: 'AI' },
  { id: 's5', title: 'Refactoring UI: practical visual design for developers', url: 'https://www.refactoringui.com', description: 'Spacing, hierarchy, colour and depth: design tactics that do not need a designer.', tags: ['design', 'ui', 'frontend'], category: 'Design', note: '- [ ] apply the spacing scale to the sidebar' },
  { id: 's6', title: 'Figma variables and design tokens in practice', url: 'https://www.figma.com/blog/design-systems', description: 'Model colour, type and spacing as tokens so design and code stay in sync.', tags: ['design', 'tokens', 'ui'], category: 'Design' },
  { id: 's7', title: 'The Pragmatic Engineer: how big tech ships software', url: 'https://newsletter.pragmaticengineer.com', description: 'Long-form reporting on engineering culture, hiring and scaling teams.', tags: ['career', 'engineering', 'reading'], category: 'Reading' },
  { id: 's8', title: 'Building a zero layout-shift feed (talk)', url: 'https://www.youtube.com/watch?v=perf-cls', description: 'Conference talk on reserving space for images and embeds to remove CLS.', tags: ['performance', 'frontend', 'video'], category: 'Video' },
  { id: 's9', title: 'Index funds vs. picking stocks: the long-run numbers', url: 'https://www.investopedia.com/index-funds', description: 'Why low-cost broad-market funds beat most active managers over decades.', tags: ['investing', 'money'], category: 'Finance', note: 'TODO: compare expense ratios of three funds' },
  { id: 's10', title: 'Chrome extension Manifest V3: service workers and messaging', url: 'https://developer.chrome.com/docs/extensions/mv3', description: 'Background service workers, content scripts and the storage API for MV3.', tags: ['extension', 'chrome', 'frontend'], category: 'Dev', note: '- [ ] wire the save-page shortcut' },
  { id: 's11', title: 'Retrieval-augmented generation: a field guide', url: 'https://www.pinecone.io/learn/retrieval-augmented-generation', description: 'Chunking, embedding, retrieval and grounding answers in your own documents.', tags: ['rag', 'embeddings', 'llm', 'search', 'ai'], category: 'AI' },
  { id: 's12', title: 'Tailwind CSS: utility-first at scale', url: 'https://tailwindcss.com/docs', description: 'Design systems with utility classes, variants and the theme layer.', tags: ['css', 'frontend', 'design'], category: 'Design' },
];

const SAMPLE_NETSCAPE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
  <DT><H3>Work</H3>
  <DL><p>
    <DT><A HREF="https://github.com/vercel/next.js">vercel/next.js: The React Framework</A>
    <DT><A HREF="https://stackoverflow.com/questions/tagged/supabase">Newest supabase questions</A>
    <DT><A HREF="https://www.figma.com/community">Figma Community</A>
  </DL><p>
  <DT><H3>Watch later</H3>
  <DL><p>
    <DT><A HREF="https://www.youtube.com/watch?v=abc">Rust in 100 seconds</A>
    <DT><A HREF="https://vimeo.com/12345">Short film: The Lighthouse</A>
  </DL><p>
  <DT><H3>Misc</H3>
  <DL><p>
    <DT><A HREF="https://openai.com/research">OpenAI research index</A>
    <DT><A HREF="https://medium.com/@someone/why-i-journal">Why I journal every morning</A>
    <DT><A HREF="https://www.bloomberg.com/markets">Markets - Bloomberg</A>
    <DT><A HREF="https://example.com/recipe">Weeknight dal</A>
  </DL><p>
</DL><p>`;

/* ───────────────────────────── helpers ───────────────────────────── */
const RULES: { cat: Category; domains: string[]; words: string[] }[] = [
  { cat: 'Dev', domains: ['github.com', 'stackoverflow.com', 'gitlab.com', 'developer.mozilla.org', 'npmjs.com', 'vercel.com'], words: ['api', 'react', 'next', 'docker', 'code', 'sql', 'supabase', 'rust', 'python'] },
  { cat: 'AI', domains: ['openai.com', 'anthropic.com', 'huggingface.co', 'arxiv.org'], words: ['llm', 'gpt', 'claude', 'embedding', 'rag', 'machine learning', 'neural'] },
  { cat: 'Design', domains: ['figma.com', 'dribbble.com', 'behance.net', 'awwwards.com'], words: ['design', 'ui', 'ux', 'typography', 'tailwind', 'css'] },
  { cat: 'Video', domains: ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv'], words: ['watch', 'video', 'talk', 'film', 'episode'] },
  { cat: 'Finance', domains: ['bloomberg.com', 'investopedia.com', 'wsj.com', 'ft.com'], words: ['stock', 'invest', 'market', 'fund', 'money', 'tax'] },
  { cat: 'Reading', domains: ['medium.com', 'substack.com', 'nytimes.com', 'theguardian.com'], words: ['essay', 'journal', 'newsletter', 'read', 'book'] },
];
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u.slice(0, 30); } };

export function categorize(url: string, title: string, folder = ''): { category: Category; reason: string } {
  const host = hostOf(url), text = `${title} ${folder}`.toLowerCase();
  for (const r of RULES) if (r.domains.some((d) => host === d || host.endsWith('.' + d))) return { category: r.cat, reason: `domain ${host}` };
  for (const r of RULES) { const w = r.words.find((x) => new RegExp(`\\b${x}\\b`).test(text)); if (w) return { category: r.cat, reason: `keyword “${w}”` }; }
  return { category: 'Other', reason: 'no rule matched' };
}

/** Real Netscape bookmark parser (the format every browser exports). Folders come from nested <DL>/<H3>. */
export function parseNetscape(html: string): { title: string; url: string; folder: string }[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: { title: string; url: string; folder: string }[] = [];
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (!/^https?:/i.test(href)) return;                 // skip javascript:, place:, file:
    let folder = '', el: Element | null = a.closest('dl');
    while (el && !folder) { const dt: Element | null = el.previousElementSibling ?? el.parentElement?.previousElementSibling ?? null; const h = dt?.querySelector?.('h3') ?? (dt?.tagName === 'H3' ? dt : null); if (h) folder = h.textContent ?? ''; el = el.parentElement?.closest('dl') ?? null; }
    out.push({ title: (a.textContent ?? href).trim() || href, url: href, folder });
  });
  return out;
}

const STOP = new Set('the a an of to in on for and or with is are how what why my i me about that this it from by as at be do does'.split(' '));
const SYN: Record<string, string[]> = { speed: ['performance', 'cls', 'layout', 'shift'], fast: ['performance', 'cls'], loading: ['performance', 'cls', 'layout'], slow: ['performance'], security: ['rls', 'auth', 'policies', 'lock'], search: ['retrieval', 'similarity', 'query', 'embeddings', 'rag'], design: ['ui', 'visual', 'tokens', 'figma'], money: ['investing', 'fund', 'stocks'], performance: ['cls', 'layout', 'shift', 'speed'], database: ['postgres', 'supabase', 'sql'], ai: ['llm', 'prompting', 'embeddings', 'rag'], chrome: ['extension', 'mv3'] };
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
/** Toy "semantic" ranker: weighted keyword overlap + synonym expansion, normalised to a 0–1 similarity. */
export function rank(query: string, items: Bookmark[], k = 4): Match[] {
  const q = tokens(query); if (!q.length) return [];
  const expanded = new Map<string, number>(); q.forEach((w) => { expanded.set(w, 1); (SYN[w] ?? []).forEach((s) => expanded.set(s, Math.max(expanded.get(s) ?? 0, 0.55))); });
  const total = [...expanded.values()].reduce((a, b) => a + b, 0);
  return items.map((b) => {
    const title = new Set(tokens(b.title)), body = new Set(tokens(b.description)), tags = new Set(b.tags);
    let s = 0; expanded.forEach((wt, w) => { s += wt * ((tags.has(w) ? 1.2 : 0) + (title.has(w) ? 1 : 0) + (body.has(w) ? 0.6 : 0)); });
    return { bookmark: b, score: Math.min(0.99, s / (total * 1.6)) };
  }).filter((m) => m.score > 0.08).sort((a, b) => b.score - a.score).slice(0, k);
}

export function extractTasks(b: Bookmark): string[] {
  if (!b.note) return [];
  return b.note.split('\n').map((l) => l.trim()).map((l) => /^(?:TODO:?|- \[ \]|\[ \]|\* \[ \])\s*(.+)$/i.exec(l)?.[1] ?? '').filter(Boolean);
}

/** Mulberry32: deterministic PRNG so the graph layout is stable between renders. */
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/* ───────────────────────────── ui atoms ───────────────────────────── */
const Section = ({ id, n, title, blurb, children }: { id: string; n: string; title: string; blurb: string; children: ReactNode }) => (
  <section id={id} className="scroll-mt-20 border-t border-white/10 py-12">
    <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-400">{n}</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-white">{title}</h2></div>
      <p className="max-w-xl text-sm leading-6 text-slate-400">{blurb}</p>
    </div>
    {children}
  </section>
);
const CatChip = ({ c }: { c: Category }) => <span className={`inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold ${CAT_STYLE[c].chip}`}><i className={`size-1.5 rounded-full ${CAT_STYLE[c].dot}`} />{c}</span>;
const Btn = ({ children, onClick, tone = 'ghost', pressed, disabled }: { children: ReactNode; onClick?: () => void; tone?: 'amber' | 'ghost'; pressed?: boolean; disabled?: boolean }) => (
  <button type="button" disabled={disabled} aria-pressed={pressed} onClick={onClick}
    className={`min-h-10 rounded-full px-4 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40 ${tone === 'amber' || pressed ? 'bg-amber-400 text-[#14213d] hover:bg-amber-300' : 'bg-white/10 text-slate-100 hover:bg-white/15'}`}>{children}</button>
);
const Fav = ({ url }: { url: string }) => { const h = hostOf(url); return <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded bg-white/10 text-[10px] font-bold uppercase text-slate-300">{h[0]}</span>; };

/* ───────────────────────────── 1 · import ───────────────────────────── */
function ImportLab({ onImport }: { onImport: (b: Bookmark[]) => void }) {
  const [rows, setRows] = useState<{ title: string; url: string; folder: string; category: Category; reason: string }[]>([]);
  const [over, setOver] = useState(false), [busy, setBusy] = useState(0), [done, setDone] = useState(false), [err, setErr] = useState('');
  const [quick, setQuick] = useState(''), [flash, setFlash] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const run = useCallback((html: string) => {
    setErr(''); setDone(false);
    const parsed = parseNetscape(html);
    if (!parsed.length) { setRows([]); setErr('No http(s) bookmarks found. Export from Chrome, Firefox, Safari or Edge as “Bookmarks HTML”.'); return; }
    const full = parsed.map((p) => ({ ...p, ...categorize(p.url, p.title, p.folder) }));
    setRows([]); setBusy(1);
    let i = 0; if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => { i++; setRows(full.slice(0, i)); setBusy(i / full.length); if (i >= full.length && timer.current) { clearInterval(timer.current); setBusy(0); } }, 140);
  }, []);
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (!f) return; f.text().then(run).catch(() => setErr('Could not read that file.')); };
  const commit = () => {
    onImport(rows.map((r, i) => ({ id: `imp${Date.now()}${i}`, title: r.title, url: r.url, description: `Imported from folder “${r.folder || 'root'}”.`, tags: [r.category.toLowerCase(), hostOf(r.url).split('.')[0]], category: r.category, folder: r.folder, imported: true })));
    setDone(true); setRows([]);
  };
  const addQuick = () => {
    let u = quick.trim(); if (!u) return; if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { new URL(u); } catch { setFlash('That doesn’t look like a URL.'); return; }
    const host = hostOf(u), { category } = categorize(u, host);
    onImport([{ id: `q${Date.now()}`, title: host, url: u, description: 'Metadata fetched on save (simulated): title, description and preview image.', tags: [category.toLowerCase(), host.split('.')[0]], category, imported: true }]);
    setQuick(''); setFlash(`Saved ${host} → ${category}`);
  };
  const counts = useMemo(() => { const m = new Map<Category, number>(); rows.forEach((r) => m.set(r.category, (m.get(r.category) ?? 0) + 1)); return [...m]; }, [rows]);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col gap-4">
        <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
          className={`grid min-h-44 place-items-center rounded-2xl border-2 border-dashed p-6 text-center transition ${over ? 'border-amber-400 bg-amber-400/10' : 'border-white/15 bg-white/[0.03]'}`}>
          <div><p className="text-base font-semibold text-white">Drop a bookmarks .html export here</p><p className="mx-auto mt-1 max-w-xs text-sm text-slate-400">Parsed in your browser with the real Netscape format; nothing is uploaded.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2"><Btn tone="amber" onClick={() => run(SAMPLE_NETSCAPE)}>Try sample file</Btn>
              <label className="inline-flex min-h-10 cursor-pointer items-center rounded-full bg-white/10 px-4 text-sm font-semibold hover:bg-white/15 focus-within:ring-2 focus-within:ring-white">Choose file<input type="file" accept=".html,.htm,text/html" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(run); e.target.value = ''; }} /></label></div></div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm font-semibold text-white">1-click save</p>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); addQuick(); }}>
            <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Paste any URL, e.g. github.com/vercel/swr" aria-label="URL to save" className="min-h-10 min-w-0 flex-1 rounded-full border border-white/15 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-amber-400" />
            <Btn tone="amber" onClick={addQuick}>Save</Btn></form>
          <p aria-live="polite" className="mt-2 h-5 text-xs text-emerald-300">{flash}</p>
        </div>
      </div>
      <div className="min-h-64 rounded-2xl border border-white/10 bg-[#0d1322] p-4" aria-live="polite">
        <div className="flex items-center justify-between"><p className="text-sm font-semibold text-white">Auto-categorisation</p>{rows.length > 0 && !busy && <Btn tone="amber" onClick={commit}>Add {rows.length} to my vault</Btn>}</div>
        {busy > 0 && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-amber-400 transition-all" style={{ width: `${busy * 100}%` }} /></div>}
        {err && <p className="mt-3 text-sm text-rose-300">{err}</p>}
        {done && <p className="mt-3 rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-300">Imported. Scroll to the grid, they’re at the top with an “imported” badge.</p>}
        {!rows.length && !err && !done && <p className="mt-6 text-sm text-slate-500">Nothing parsed yet. Try the sample file.</p>}
        {counts.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{counts.map(([c, n]) => <span key={c} className="inline-flex items-center gap-1"><CatChip c={c} /><b className="text-xs text-slate-300">{n}</b></span>)}</div>}
        <ul className="mt-3 flex max-h-72 flex-col gap-1.5 overflow-auto pr-1">
          {rows.map((r) => (<li key={r.url} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2"><Fav url={r.url} /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-slate-100">{r.title}</p><p className="truncate text-[11px] text-slate-500">{r.folder || 'root'} · {r.reason}</p></div><CatChip c={r.category} /></li>))}
        </ul>
      </div>
    </div>
  );
}

/* ───────────────────────────── 2 · bento grid / list ───────────────────────────── */
function Vault({ items }: { items: Bookmark[] }) {
  const [view, setView] = useState<'grid' | 'list'>('grid'), [cat, setCat] = useState<Category | 'All'>('All'), [q, setQ] = useState('');
  const shown = items.filter((b) => (cat === 'All' || b.category === cat) && (!q || `${b.title} ${b.tags.join(' ')} ${hostOf(b.url)}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="View" className="flex gap-1 rounded-full bg-white/[0.06] p-1"><Btn pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</Btn><Btn pressed={view === 'list'} onClick={() => setView('list')}>List</Btn></div>
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter bookmarks" placeholder="Filter…" className="min-h-10 w-40 rounded-full border border-white/15 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-amber-400" />
        <div className="flex flex-wrap gap-1.5">{(['All', ...CATS] as const).map((c) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)} className={`min-h-8 rounded-full px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white ${cat === c ? 'bg-white text-slate-900' : 'bg-white/[0.07] text-slate-300 hover:bg-white/[0.12]'}`}>{c}</button>)}</div>
        <span className="ml-auto text-xs text-slate-500">{shown.length} of {items.length}</span>
      </div>
      {!shown.length && <p className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">No bookmarks match.</p>}
      {view === 'grid' ? (
        <ul className="grid auto-rows-[minmax(150px,auto)] grid-flow-dense gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((b, i) => { const big = i % 7 === 0, wide = i % 7 === 3; return (
            <li key={b.id} className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 p-4 transition hover:border-white/30 ${big ? 'sm:col-span-2 sm:row-span-2' : wide ? 'sm:col-span-2' : ''}`} style={{ background: `linear-gradient(145deg, ${CAT_STYLE[b.category].hex}22, #0d1322 55%)` }}>
              <div className="flex items-center gap-2"><Fav url={b.url} /><span className="truncate text-xs text-slate-400">{hostOf(b.url)}</span>{b.imported && <span className="ml-auto rounded-full bg-emerald-400/15 px-2 text-[10px] font-bold uppercase text-emerald-300">imported</span>}</div>
              <div><h3 className={`mt-3 font-semibold leading-snug text-white ${big ? 'text-xl' : 'text-[15px]'}`}><a href={b.url} target="_blank" rel="noopener noreferrer" className="outline-none after:absolute after:inset-0 focus-visible:underline">{b.title}</a></h3>
                <p className={`mt-1 text-[13px] leading-5 text-slate-400 ${big ? 'line-clamp-4' : 'line-clamp-2'}`}>{b.description}</p></div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5"><CatChip c={b.category} />{b.tags.slice(0, big ? 4 : 2).map((t) => <span key={t} className="text-[11px] text-slate-500">#{t}</span>)}</div>
            </li>); })}
        </ul>
      ) : (
        <ul className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-[#0d1322]">
          {shown.map((b) => (<li key={b.id} className="relative flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04]"><i className={`size-2 shrink-0 rounded-full ${CAT_STYLE[b.category].dot}`} />
            <a href={b.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100 outline-none after:absolute after:inset-0 focus-visible:underline">{b.title}</a>
            <span className="hidden shrink-0 text-xs text-slate-500 sm:block">{hostOf(b.url)}</span><span className="hidden md:block"><CatChip c={b.category} /></span></li>))}
        </ul>)}
    </div>
  );
}

/* ───────────────────────────── 3 · ask my vault ───────────────────────────── */
const MODELS: { id: ModelId; name: string; ms: number; intro: (n: number) => string; ring: string }[] = [
  { id: 'claude', name: 'Claude', ms: 900, ring: 'ring-amber-400', intro: (n) => `I found ${n} saved page${n === 1 ? '' : 's'} that answer this. The strongest match is` },
  { id: 'gemini', name: 'Gemini', ms: 600, ring: 'ring-sky-400', intro: (n) => `Across your vault, ${n} bookmark${n === 1 ? ' is' : 's are'} relevant. Start with` },
  { id: 'chatgpt', name: 'ChatGPT', ms: 1200, ring: 'ring-emerald-400', intro: (n) => `Here’s what I pulled from your bookmarks (${n} hit${n === 1 ? '' : 's'}). Best first read:` },
];
const EXAMPLES = ['how do I secure user data in my database', 'learn embeddings and search', 'make my UI look better', 'speed up page loading', 'where should I put my money'];
function AskVault({ items }: { items: Bookmark[] }) {
  const [model, setModel] = useState<ModelId>('claude'), [q, setQ] = useState(EXAMPLES[0]);
  const [state, setState] = useState<{ phase: 'idle' | 'thinking' | 'done'; matches: Match[]; typed: string; q: string }>({ phase: 'idle', matches: [], typed: '', q: '' });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clear, []);
  const ask = (query = q) => {
    clear(); const m = MODELS.find((x) => x.id === model)!; const matches = rank(query, items);
    setState({ phase: 'thinking', matches: [], typed: '', q: query });
    timers.current.push(setTimeout(() => {
      const full = matches.length ? `${m.intro(matches.length)} “${matches[0].bookmark.title}” [1]${matches.length > 1 ? `, followed by [2]${matches.length > 2 ? ` and [3]` : ''}` : ''}. Similarity is ranked from title, tags and notes.` : 'Nothing in your vault is close enough to that. Try different words, or import more bookmarks.';
      setState({ phase: 'done', matches, typed: '', q: query });
      let i = 0; const tick = () => { i += 3; setState((s) => ({ ...s, typed: full.slice(0, i) })); if (i < full.length) timers.current.push(setTimeout(tick, 18)); }; tick();
    }, m.ms));
  };
  const cur = MODELS.find((x) => x.id === model)!;
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d1322] p-4 sm:p-5">
      <div role="tablist" aria-label="Model" className="mb-3 flex flex-wrap gap-1.5">{MODELS.map((m) => <button key={m.id} role="tab" aria-selected={model === m.id} onClick={() => setModel(m.id)} className={`min-h-9 rounded-full px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white ${model === m.id ? `bg-white/15 text-white ring-1 ${m.ring}` : 'bg-white/[0.05] text-slate-400 hover:bg-white/10'}`}>{m.name}</button>)}<span className="ml-auto self-center text-[11px] text-slate-500">simulated · no API key used</span></div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ask your vault" className="min-h-11 min-w-0 flex-1 rounded-full border border-white/15 bg-black/30 px-5 text-sm text-white outline-none focus:border-amber-400" />
        <Btn tone="amber" onClick={() => ask()}>Ask</Btn></form>
      <div className="mt-2 flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} type="button" onClick={() => { setQ(e); ask(e); }} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-slate-300 hover:bg-white/10">{e}</button>)}</div>
      <div className="mt-4 min-h-32" aria-live="polite">
        {state.phase === 'thinking' && <p className="flex items-center gap-2 text-sm text-slate-400"><span className="size-2 animate-pulse rounded-full bg-amber-400" />{cur.name} is searching {items.length} bookmarks…</p>}
        {state.phase === 'done' && (<>
          <p className="text-sm leading-6 text-slate-200">{state.typed}</p>
          <ol className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">{state.matches.map((m, i) => (<li key={m.bookmark.id} className="relative rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded bg-amber-400 text-[11px] font-bold text-[#14213d]">{i + 1}</span><a href={m.bookmark.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-semibold text-white after:absolute after:inset-0 hover:underline">{m.bookmark.title}</a></div>
            <div className="mt-2 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-amber-400" style={{ width: `${m.score * 100}%` }} /></div><span className="text-xs tabular-nums text-slate-400">{Math.round(m.score * 100)}%</span></div></li>))}</ol></>)}
      </div>
    </div>
  );
}

/* ───────────────────────────── 4 · oneclist tasks ───────────────────────────── */
function Oneclist({ items }: { items: Bookmark[] }) {
  const seed = useMemo<Task[]>(() => items.flatMap((b) => extractTasks(b).map((text, i) => ({ id: `${b.id}:${i}`, text, sourceId: b.id, done: false }))), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [tasks, setTasks] = useState<Task[]>(seed), [note, setNote] = useState('TODO: read the RLS guide tonight\n- [ ] book a dentist slot\njust a regular line');
  const byId = useMemo(() => new Map(items.map((b) => [b.id, b])), [items]);
  const done = tasks.filter((t) => t.done).length;
  const addFromNote = () => { const fake: Bookmark = { id: 'scratch', title: 'Scratch note', url: 'https://bukmarkz.com', description: '', tags: [], category: 'Other', note }; const found = extractTasks(fake); setTasks((t) => [...found.map((text, i) => ({ id: `n${Date.now()}${i}`, text, sourceId: 'scratch', done: false })), ...t]); };
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
      <div className="rounded-2xl border border-white/10 bg-[#0d1322] p-4">
        <div className="mb-3 flex items-center gap-3"><p className="text-sm font-semibold text-white">Oneclist</p><div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></div><span className="text-xs tabular-nums text-slate-400">{done}/{tasks.length}</span></div>
        <ul className="flex flex-col gap-1">{tasks.map((t) => (<li key={t.id}><label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.04]">
          <input type="checkbox" checked={t.done} onChange={() => setTasks((all) => all.map((x) => x.id === t.id ? { ...x, done: !x.done } : x))} className="mt-0.5 size-5 shrink-0 accent-emerald-400" />
          <span className="min-w-0"><span className={`block text-sm ${t.done ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{t.text}</span><span className="block truncate text-[11px] text-slate-500">from {byId.get(t.sourceId)?.title ?? 'Scratch note'}</span></span></label></li>))}
          {!tasks.length && <li className="p-6 text-center text-sm text-slate-500">No tasks. Add a note with “TODO:” lines →</li>}</ul>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-sm font-semibold text-white">Extract from a note</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">Lines starting with <code className="rounded bg-white/10 px-1">TODO:</code> or <code className="rounded bg-white/10 px-1">- [ ]</code> become tasks. Everything else is ignored.</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} aria-label="Bookmark note" className="mt-3 w-full rounded-xl border border-white/15 bg-black/30 p-3 font-mono text-xs text-slate-200 outline-none focus:border-amber-400" />
        <div className="mt-2 flex items-center gap-3"><Btn tone="amber" onClick={addFromNote}>Extract {extractTasks({ id: '', title: '', url: '', description: '', tags: [], category: 'Other', note }).length} tasks</Btn></div></div>
    </div>
  );
}

/* ───────────────────────────── 5 · knowledge graph ───────────────────────────── */
interface GNode { id: string; x: number; y: number; vx: number; vy: number; b: Bookmark }
interface GEdge { a: number; b: number; shared: string[] }
const GW = 720, GH = 440;
function layout(items: Bookmark[]) {
  const r = rng(7); const nodes: GNode[] = items.map((b) => ({ id: b.id, b, x: GW / 2 + (r() - 0.5) * 300, y: GH / 2 + (r() - 0.5) * 200, vx: 0, vy: 0 }));
  const edges: GEdge[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) { const s = items[i].tags.filter((t) => items[j].tags.includes(t)); if (s.length) edges.push({ a: i, b: j, shared: s }); }
  for (let it = 0; it < 260; it++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) { const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d2 = dx * dx + dy * dy + 0.01, f = 2600 / d2, d = Math.sqrt(d2); nodes[i].vx += (dx / d) * f; nodes[i].vy += (dy / d) * f; nodes[j].vx -= (dx / d) * f; nodes[j].vy -= (dy / d) * f; }
    edges.forEach((e) => { const A = nodes[e.a], B = nodes[e.b], dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 110) * 0.02 * Math.min(2, e.shared.length); A.vx += (dx / d) * f; A.vy += (dy / d) * f; B.vx -= (dx / d) * f; B.vy -= (dy / d) * f; });
    nodes.forEach((n) => { n.vx += (GW / 2 - n.x) * 0.004; n.vy += (GH / 2 - n.y) * 0.004; n.x = Math.min(GW - 30, Math.max(30, n.x + n.vx * 0.5)); n.y = Math.min(GH - 30, Math.max(30, n.y + n.vy * 0.5)); n.vx *= 0.6; n.vy *= 0.6; });
  }
  return { nodes: nodes.map(({ id, x, y, b }) => ({ id, x, y, b })), edges };
}
function Graph({ items }: { items: Bookmark[] }) {
  const base = useMemo(() => layout(items), [items]);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [sel, setSel] = useState<string | null>(null), [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ id: string } | null>(null), svg = useRef<SVGSVGElement>(null);
  const P = (id: string) => pos[id] ?? base.nodes.find((n) => n.id === id)!;
  const focus = hover ?? sel; const idx = (id: string) => base.nodes.findIndex((n) => n.id === id);
  const nbr = new Set<number>(); if (focus) base.edges.forEach((e) => { if (e.a === idx(focus)) nbr.add(e.b); if (e.b === idx(focus)) nbr.add(e.a); });
  const move = (e: RPointerEvent<SVGSVGElement>) => { if (!drag.current || !svg.current) return; const r = svg.current.getBoundingClientRect(); setPos((p) => ({ ...p, [drag.current!.id]: { x: ((e.clientX - r.left) / r.width) * GW, y: ((e.clientY - r.top) / r.height) * GH } })); };
  const selNode = base.nodes.find((n) => n.id === sel)?.b;
  const related = selNode ? base.edges.filter((e) => base.nodes[e.a].id === sel || base.nodes[e.b].id === sel).map((e) => ({ other: base.nodes[base.nodes[e.a].id === sel ? e.b : e.a].b, shared: e.shared })) : [];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a0f1c]">
        <svg ref={svg} viewBox={`0 0 ${GW} ${GH}`} className="block h-auto w-full touch-none select-none" role="img" aria-label="Knowledge graph of related bookmarks" onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
          {base.edges.map((e, i) => { const A = P(base.nodes[e.a].id), B = P(base.nodes[e.b].id); const on = focus && (idx(focus) === e.a || idx(focus) === e.b); return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={on ? '#fbbf24' : '#94a3b8'} strokeOpacity={focus ? (on ? 0.9 : 0.07) : 0.22} strokeWidth={0.8 + e.shared.length * 0.7} />; })}
          {base.nodes.map((n, i) => { const p = P(n.id); const dim = focus && n.id !== focus && !nbr.has(i); return (
            <g key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={dim ? 0.2 : 1} className="cursor-grab" tabIndex={0} role="button" aria-label={n.b.title} aria-pressed={sel === n.id}
              onPointerDown={(e) => { drag.current = { id: n.id }; setSel(n.id); (e.target as Element).setPointerCapture?.(e.pointerId); }} onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(n.id)} onBlur={() => setHover(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(n.id); } }}>
              <circle r={sel === n.id ? 15 : 11} fill={CAT_STYLE[n.b.category].hex} stroke={sel === n.id ? '#fff' : '#0a0f1c'} strokeWidth={2} />
              <text y={26} textAnchor="middle" fontSize="10.5" fill="#cbd5e1" style={{ paintOrder: 'stroke' }} stroke="#0a0f1c" strokeWidth="3">{n.b.title.length > 22 ? n.b.title.slice(0, 21) + '…' : n.b.title}</text></g>); })}
        </svg>
        <p className="border-t border-white/10 px-3 py-2 text-[11px] text-slate-500">Drag nodes · hover to light up neighbours · edges = shared tags (thicker = more)</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
        {selNode ? (<><CatChip c={selNode.category} /><h3 className="mt-2 text-base font-semibold text-white">{selNode.title}</h3><p className="mt-1 text-slate-400">{selNode.description}</p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Connected to {related.length}</p>
          <ul className="mt-2 flex flex-col gap-1.5">{related.map((r) => <li key={r.other.id}><button type="button" onClick={() => setSel(r.other.id)} className="w-full rounded-lg bg-white/[0.05] px-3 py-2 text-left hover:bg-white/10"><span className="block truncate text-[13px] text-slate-100">{r.other.title}</span><span className="text-[11px] text-amber-300">via {r.shared.map((s) => '#' + s).join(' ')}</span></button></li>)}</ul></>)
          : <p className="text-slate-500">Select a node to see why it’s connected to the rest of your vault.</p>}
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1">{CATS.map((c) => <span key={c} className="flex items-center gap-1.5 text-[11px] text-slate-400"><i className={`size-2 rounded-full ${CAT_STYLE[c].dot}`} />{c}</span>)}</div>
      </div>
    </div>
  );
}

/* ───────────────────────────── 6 · reels reader ───────────────────────────── */
interface Reel { id: string; title: string; creator: string; grad: string; dur: number; lines: { t: number; text: string }[]; ocr: string[]; insights: string[] }
const REELS: Reel[] = [
  { id: 'r1', title: '3 habits for faster code review', creator: '@devnotes', grad: 'from-indigo-600 via-fuchsia-600 to-rose-500', dur: 12, ocr: ['REVIEW < 400 LINES', 'ASK “WHY?” NOT “FIX”', 'SHIP SMALL'],
    lines: [{ t: 0, text: 'Habit one: keep every pull request under four hundred lines.' }, { t: 4, text: 'Two: ask why a change exists before you suggest how to fix it.' }, { t: 8, text: 'Three: ship small, ship often. Reviews get faster by themselves.' }], insights: ['Small PRs get reviewed ~3× faster', 'Comment on intent before style', 'Review within 24h to keep flow'] },
  { id: 'r2', title: 'Why your index fund beats your stock picks', creator: '@moneymath', grad: 'from-emerald-600 via-teal-600 to-sky-600', dur: 10, ocr: ['EXPENSE RATIO 0.04%', '85% OF FUNDS LAG', 'TIME > TIMING'],
    lines: [{ t: 0, text: 'Eighty-five percent of active funds trail their index over fifteen years.' }, { t: 5, text: 'Fees compound against you. A point of expense ratio is huge.' }], insights: ['Fees compound like returns do', 'Time in market beats timing it', 'Rebalance once a year'] },
  { id: 'r3', title: 'Design tip: one accent colour', creator: '@uipolish', grad: 'from-amber-500 via-orange-600 to-red-600', dur: 9, ocr: ['1 ACCENT', '2 NEUTRALS', '8px GRID'],
    lines: [{ t: 0, text: 'Pick one accent colour and use it only for the primary action.' }, { t: 5, text: 'Everything else stays neutral. Your UI instantly looks calmer.' }], insights: ['Accent = primary action only', 'Tint neutrals toward the accent', 'Space everything on an 8px grid'] },
];
function Reels() {
  const [i, setI] = useState(0), [t, setT] = useState(0), [playing, setPlaying] = useState(true);
  const r = REELS[i];
  useEffect(() => { if (!playing) return; const id = setInterval(() => setT((x) => { const n = x + 0.1; return n >= r.dur ? 0 : n; }), 100); return () => clearInterval(id); }, [playing, r.dur]);
  const go = (d: number) => { setI((x) => (x + d + REELS.length) % REELS.length); setT(0); };
  const line = [...r.lines].reverse().find((l) => t >= l.t) ?? r.lines[0];
  const ocrIdx = Math.min(r.ocr.length - 1, Math.floor((t / r.dur) * r.ocr.length));
  return (
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[auto_1fr]">
      <div className="mx-auto w-[260px]">
        <div className={`relative aspect-[9/16] overflow-hidden rounded-[28px] border-4 border-slate-800 bg-gradient-to-b ${r.grad} shadow-2xl`}>
          <div aria-hidden className="absolute -inset-10 animate-pulse bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,.25),transparent_50%)] motion-reduce:animate-none" />
          <div className="absolute inset-x-0 top-0 flex gap-1 p-3">{REELS.map((x, k) => <i key={x.id} className="h-0.5 flex-1 overflow-hidden rounded bg-white/30"><b className="block h-full bg-white" style={{ width: k < i ? '100%' : k === i ? `${(t / r.dur) * 100}%` : '0%' }} /></i>)}</div>
          <div className="absolute left-3 top-8 right-3"><span key={ocrIdx} className="inline-block animate-[fadein_.4s_ease] rounded bg-black/55 px-2 py-1 font-mono text-[11px] font-bold tracking-wide text-amber-300">OCR · {r.ocr[ocrIdx]}</span></div>
          <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} className="absolute inset-0 grid place-items-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white">{!playing && <span className="grid size-14 place-items-center rounded-full bg-black/50 text-2xl text-white">▶</span>}</button>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10"><p className="text-xs font-semibold text-white/80">{r.creator}</p><p className="mt-1 text-[13px] font-semibold leading-snug text-white">{r.title}</p><p aria-live="off" className="mt-2 min-h-10 text-[12px] leading-[18px] text-white/90">{line.text}</p></div>
        </div>
        <div className="mt-3 flex justify-center gap-2"><Btn onClick={() => go(-1)}>↑ Prev</Btn><Btn onClick={() => go(1)}>Next ↓</Btn></div>
      </div>
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#0d1322] p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Transcript</p>
        <ol className="mt-2 flex flex-col gap-1.5">{r.lines.map((l) => <li key={l.t}><button type="button" onClick={() => setT(l.t)} className={`flex w-full gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${l === line ? 'bg-amber-400/15 text-white' : 'text-slate-400 hover:bg-white/5'}`}><span className="w-8 shrink-0 font-mono text-xs tabular-nums text-slate-500">0:{String(l.t).padStart(2, '0')}</span>{l.text}</button></li>)}</ol>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">Recognised on screen (OCR)</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{r.ocr.map((o) => <span key={o} className="rounded bg-white/[0.07] px-2 py-1 font-mono text-[11px] text-amber-200">{o}</span>)}</div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">Key insights</p>
        <ul className="mt-2 flex flex-col gap-1.5">{r.insights.map((k) => <li key={k} className="flex gap-2 text-sm text-slate-200"><span className="text-emerald-400">✓</span>{k}</li>)}</ul>
      </div>
    </div>
  );
}

/* ───────────────────────────── page ───────────────────────────── */
const NAV = [['import', 'Import'], ['vault', 'Vault'], ['ask', 'Ask'], ['tasks', 'Tasks'], ['graph', 'Graph'], ['reels', 'Reels']] as const;
export default function DemoPage() {
  const [items, setItems] = useState<Bookmark[]>(SEED);
  return (
    <div className="min-h-screen bg-[#070b14] text-slate-200 antialiased">
      <style>{'@keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}'}</style>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#070b14]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 overflow-x-auto px-4 py-3">
          <b className="shrink-0 text-base text-white">Bukmarkz <span className="text-amber-400">sandbox</span></b>
          <nav className="flex gap-1">{NAV.map(([id, l]) => <a key={id} href={`#${id}`} className="rounded-full px-3 py-1.5 text-sm text-slate-300 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white">{l}</a>)}</nav>
          <span className="ml-auto hidden shrink-0 rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300 sm:block">Offline · mock data · no API keys</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-24">
        <div className="py-12"><h1 className="max-w-2xl text-4xl font-bold tracking-tight text-white sm:text-5xl">Everything Bukmarkz does, in one page.</h1><p className="mt-4 max-w-xl text-base leading-7 text-slate-400">Import a real bookmarks file, browse it as a bento grid, ask it questions, turn notes into tasks, see how it connects, and read short videos. Every panel shares the same {items.length} bookmarks.</p></div>
        <Section id="import" n="01" title="1-click save & Netscape import" blurb="Drop a real browser export (or use the sample). Each link is parsed from the Netscape HTML and auto-categorised by domain, then keyword."><ImportLab onImport={(b) => setItems((x) => [...b, ...x])} /></Section>
        <Section id="vault" n="02" title="Bento grid & compact list" blurb="Same data, two densities. Filter by category or text; imported links appear first."><Vault items={items} /></Section>
        <Section id="ask" n="03" title="Ask My Vault" blurb="Natural-language search over your own bookmarks with a choice of model. Here the ranking is simulated locally; in the app it’s pgvector + an LLM."><AskVault items={items} /></Section>
        <Section id="tasks" n="04" title="Oneclist action tasks" blurb="Notes on bookmarks become a checklist automatically. Tick to complete."><Oneclist items={SEED} /></Section>
        <Section id="graph" n="05" title="Knowledge graph" blurb="Bookmarks that share tags are linked. Drag to rearrange; select a node to see the reason for each link."><Graph items={SEED} /></Section>
        <Section id="reels" n="06" title="Reels reader" blurb="Short videos with a synced transcript, on-screen text recognised by OCR, and the key points pulled out."><Reels /></Section>
      </main>
    </div>
  );
}
