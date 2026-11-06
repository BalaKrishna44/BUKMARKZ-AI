'use client';

/**
 * InstantMigrationSandbox: drop a bookmark export on the landing page, see it organised, then claim it by signing up.
 *
 * PRIVACY: 100% in the browser. The file is read and parsed inside a Web Worker; nothing is uploaded. Only when the visitor
 * presses "Create Free Account" is the original file saved to IndexedDB (via lib/import/pending, on this device only) so the
 * real import can run after signup. If storage is blocked they simply pick the file again.
 *
 * SPEED: a single-pass tokenizer (no DOMParser: workers have no DOM, and exports contain unclosed <DT>/<p> tags that DOM
 * parsers handle slowly). The worker streams progress; the UI thread only renders. 5,000 links parse in well under a second.
 *
 * NEEDS:  '@/lib/import/pending' (importexport/lib/import/pending.ts)  and a CSP with  worker-src 'self' blob:  (dash/lib/security/csp.ts has it).
 * USE:    in a Server Component page:  <InstantMigrationSandbox signupHref="/signup" />
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { savePending } from '@/lib/import/pending';

/* ───────────────────────────── types ───────────────────────────── */

export interface PreviewLink { title: string; host: string; url: string; category: string }
export interface MigrationSummary {
  total: number;                 // unique links found
  duplicates: number;            // exact repeats removed from the count
  skipped: number;               // non-web links (javascript:, file:, chrome:// ...) and unreadable rows
  folders: number;
  source: string | null;         // 'Pocket' | 'Raindrop.io' | 'Chrome / Edge / Safari' | 'Firefox' | null
  categories: { name: string; count: number }[];   // top 5, most links first
  preview: PreviewLink[];        // up to 5
  ms: number;
}
type WorkerMsg =
  | { type: 'progress'; pct: number }
  | { type: 'done'; summary: MigrationSummary }
  | { type: 'error'; message: string };

type Phase = { name: 'idle' } | { name: 'parsing'; file: string; pct: number } | { name: 'done'; summary: MigrationSummary; file: File } | { name: 'error'; message: string };

const MAX_BYTES = 80 * 1024 * 1024;   // an export with 100k links is about 25 MB

/* ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 * The parser. It is serialised with Function.prototype.toString() and run inside a Worker, so it MUST NOT reference
 * anything outside its own body (no imports, no helpers, no closures over module scope). If the Worker cannot start
 * (old browser, locked-down CSP) the very same function runs on the main thread in a timeout instead.
 * ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
function parseCore(text: string, filename: string, post: (m: WorkerMsg) => void): void {
  const t0 = Date.now();
  const MAX_ITEMS = 100000;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = (s: string) => s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });

  /* ---- classification: domain first, then folder name, then title keywords ---- */
  const DOMAINS: Record<string, string[]> = {
    Development: ['github.com', 'gitlab.com', 'stackoverflow.com', 'stackexchange.com', 'npmjs.com', 'developer.mozilla.org', 'dev.to', 'hashnode.dev', 'vercel.com', 'netlify.com', 'docs.python.org', 'rust-lang.org', 'go.dev', 'readthedocs.io', 'postgresql.org', 'supabase.com', 'nextjs.org', 'react.dev', 'tailwindcss.com', 'codepen.io', 'replit.com', 'huggingface.co', 'kaggle.com', 'pypi.org', 'crates.io', 'aws.amazon.com', 'cloud.google.com', 'azure.microsoft.com', 'docker.com', 'kubernetes.io', 'cloudflare.com'],
    Design: ['dribbble.com', 'behance.net', 'figma.com', 'awwwards.com', 'canva.com', 'unsplash.com', 'pexels.com', 'fonts.google.com', 'coolors.co', 'pinterest.com', 'mobbin.com', 'lordicon.com', 'framer.com'],
    Video: ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'netflix.com', 'ted.com', 'dailymotion.com', 'loom.com'],
    Social: ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'threads.net', 'mastodon.social', 'tiktok.com', 'bsky.app', 'discord.com', 'news.ycombinator.com'],
    Reading: ['medium.com', 'substack.com', 'nytimes.com', 'theguardian.com', 'bbc.com', 'bbc.co.uk', 'wired.com', 'theverge.com', 'arstechnica.com', 'techcrunch.com', 'wikipedia.org', 'newyorker.com', 'theatlantic.com', 'economist.com', 'ft.com', 'bloomberg.com', 'reuters.com', 'paulgraham.com', 'getpocket.com', 'quora.com', 'goodreads.com'],
    Learning: ['coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org', 'freecodecamp.org', 'duolingo.com', 'arxiv.org', 'scholar.google.com', 'leetcode.com', 'codecademy.com', 'brilliant.org', 'skillshare.com', 'pluralsight.com'],
    Shopping: ['amazon.com', 'amazon.co.uk', 'amazon.in', 'ebay.com', 'etsy.com', 'aliexpress.com', 'flipkart.com', 'walmart.com', 'target.com', 'bestbuy.com', 'ikea.com', 'shopify.com', 'argos.co.uk', 'asos.com', 'zalando.com'],
    Finance: ['paypal.com', 'stripe.com', 'wise.com', 'coinbase.com', 'binance.com', 'investopedia.com', 'robinhood.com', 'fidelity.com', 'hl.co.uk', 'monzo.com', 'revolut.com', 'moneysavingexpert.com', 'xe.com', 'finance.yahoo.com', 'tradingview.com'],
    Productivity: ['notion.so', 'trello.com', 'asana.com', 'airtable.com', 'docs.google.com', 'drive.google.com', 'calendar.google.com', 'slack.com', 'zoom.us', 'dropbox.com', 'evernote.com', 'todoist.com', 'linear.app', 'obsidian.md', 'office.com', 'mail.google.com', 'outlook.live.com'],
    Travel: ['booking.com', 'airbnb.com', 'tripadvisor.com', 'skyscanner.net', 'expedia.com', 'kayak.com', 'google.com/maps', 'maps.google.com', 'lonelyplanet.com', 'ryanair.com', 'easyjet.com', 'trainline.com'],
    Health: ['nhs.uk', 'webmd.com', 'mayoclinic.org', 'healthline.com', 'myfitnesspal.com', 'strava.com', 'fitbit.com', 'nih.gov', 'who.int', 'bodybuilding.com'],
  };
  const KEYWORDS: [string, RegExp][] = [
    ['Development', /\b(api|sdk|github|code|coding|programming|javascript|typescript|python|react|next\.?js|database|sql|docker|devops|framework|tutorial|developer|algorithm|compiler|linux|git)\b/i],
    ['Design', /\b(design|ui|ux|typography|font|color palette|illustration|icon|figma|branding|logo)\b/i],
    ['Finance', /\b(invest|stock|crypto|bitcoin|tax|mortgage|bank|budget|finance|savings|pension|isa)\b/i],
    ['Health', /\b(health|fitness|workout|gym|nutrition|diet|yoga|running|sleep|meditation|medical|symptom)\b/i],
    ['Travel', /\b(travel|flight|hotel|itinerary|visa|trip|hostel|airport|train times)\b/i],
    ['Shopping', /\b(buy|deal|discount|price|review|best \d+|coupon|sale)\b/i],
    ['Learning', /\b(course|learn|lesson|study|lecture|certification|exam|guide to|how to)\b/i],
    ['Video', /\b(video|watch|episode|podcast|film|movie|documentary)\b/i],
    ['Reading', /\b(article|essay|blog|news|opinion|story|longread|newsletter)\b/i],
    ['Productivity', /\b(productivity|notes|todo|template|workflow|automation|calendar|planner)\b/i],
  ];
  const FOLDER_HINTS: [string, RegExp][] = [
    ['Development', /dev|code|programming|tech|software|engineering/i], ['Design', /design|art|inspiration/i], ['Finance', /financ|money|invest|tax|bank/i],
    ['Health', /health|fitness|gym|food|recipe/i], ['Travel', /travel|trip|holiday/i], ['Shopping', /shop|buy|wishlist/i],
    ['Learning', /learn|course|study|school|research/i], ['Reading', /read|news|article|blog/i], ['Video', /video|watch|youtube|music/i],
    ['Social', /social|twitter|reddit/i], ['Productivity', /work|productiv|tools|office/i],
  ];
  const domainMap: Record<string, string> = {};
  for (const cat in DOMAINS) for (const d of DOMAINS[cat]) domainMap[d] = cat;
  const classify = (host: string, path: string, title: string, folder: string): string => {
    const h = host.replace(/^www\./, '');
    let cat = domainMap[h] || domainMap[h + path.split('/').slice(0, 2).join('/')];
    if (!cat) { const parts = h.split('.'); for (let i = 1; i < parts.length - 1 && !cat; i++) cat = domainMap[parts.slice(i).join('.')]; }
    if (cat) return cat;
    if (folder) for (const [c, re] of FOLDER_HINTS) if (re.test(folder)) return c;
    for (const [c, re] of KEYWORDS) if (re.test(title)) return c;
    return 'Other';
  };

  /* ---- accumulation (counts + a few samples per category; the full list is never kept in memory twice) ---- */
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  const samples: Record<string, PreviewLink[]> = {};
  const folderSet = new Set<string>();
  let duplicates = 0, skipped = 0, total = 0;

  const add = (rawUrl: string, rawTitle: string, folder: string) => {
    if (total >= MAX_ITEMS) { skipped++; return; }
    const url = rawUrl.trim();
    if (url.length > 2048 || !/^https?:\/\//i.test(url)) { skipped++; return; }
    let host = '', path = '';
    try { const u = new URL(url); host = u.hostname.toLowerCase(); path = u.pathname; } catch { skipped++; return; }
    if (!host || host.indexOf('.') < 0 && host !== 'localhost') { skipped++; return; }
    const key = host.replace(/^www\./, '') + path.replace(/\/+$/, '') + (url.indexOf('?') > 0 ? url.slice(url.indexOf('?')).replace(/[?&]utm_[^&]*/g, '') : '');
    if (seen.has(key)) { duplicates++; return; }
    seen.add(key);
    total++;
    const title = (rawTitle || '').replace(/\s+/g, ' ').trim().slice(0, 160) || host;
    const cat = classify(host, path, title, folder);
    counts[cat] = (counts[cat] || 0) + 1;
    const s = samples[cat] || (samples[cat] = []);
    if (s.length < 6 && !s.some((x) => x.host === host)) s.push({ title, host: host.replace(/^www\./, ''), url, category: cat });
    if (folder) folderSet.add(folder);
  };

  const head = text.slice(0, 200000);
  const isHtml = /<!doctype\s+netscape-bookmark-file|<dl\b|<a\s[^>]*href/i.test(head);
  let source: string | null = null;
  let lastPct = -1;
  const progress = (i: number) => { const p = Math.min(99, Math.floor((i / text.length) * 100)); if (p !== lastPct) { lastPct = p; post({ type: 'progress', pct: p }); } };

  if (isHtml) {
    if (/time_added=/i.test(text.slice(0, 20000))) source = 'Pocket';
    else if (/Bookmarks Menu|places:/i.test(head)) source = 'Firefox';
    else if (/PERSONAL_TOOLBAR_FOLDER/i.test(text.slice(0, 20000))) source = 'Chrome / Edge / Safari';
    else if (/raindrop/i.test(text.slice(0, 2000))) source = 'Raindrop.io';

    // <a ...> </a>, <h3> </h3>, <dl> </dl>. Attribute values may contain '>' inside quotes.
    const TOKEN = /<(\/?)(a|h3|dl)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
    const ATTR = /([a-z_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    const stack: (string | null)[] = [];
    let pendingFolder: string | null = null;
    let aStart = -1, aHref = '', aFolder = '';
    let h3Start = -1;
    let m: RegExpExecArray | null;
    while ((m = TOKEN.exec(text))) {
      const closing = m[1] === '/', tag = m[2].toLowerCase();
      if (tag === 'a') {
        if (!closing) {
          if (aStart >= 0) add(aHref, '', aFolder);                      // previous <a> was never closed
          aHref = ''; ATTR.lastIndex = 0;
          let am: RegExpExecArray | null;
          const attrs = m[3];
          while ((am = ATTR.exec(attrs))) if (am[1].toLowerCase() === 'href') { aHref = decode(am[2] ?? am[3] ?? ''); break; }
          aStart = TOKEN.lastIndex;
          aFolder = stack.filter(Boolean).join(' / ');
        } else if (aStart >= 0) {
          add(aHref, decode(text.slice(aStart, m.index).replace(/<[^>]*>/g, '')), aFolder);
          aStart = -1;
          if ((total + duplicates + skipped) % 500 === 0) progress(m.index);
        }
      } else if (tag === 'h3') {
        if (!closing) h3Start = TOKEN.lastIndex;
        else if (h3Start >= 0) { pendingFolder = decode(text.slice(h3Start, m.index).replace(/<[^>]*>/g, '')).trim() || null; h3Start = -1; }
      } else if (!closing) { stack.push(pendingFolder); pendingFolder = null; }
      else { stack.pop(); pendingFolder = null; }
    }
    if (aStart >= 0) add(aHref, '', aFolder);
  } else {
    if (/^\s*</.test(head)) { post({ type: 'error', message: "We couldn't find any bookmarks in that file. Try the HTML export from your browser, Raindrop or Pocket." }); return; }
    // CSV (Pocket and Raindrop CSV exports): header row must contain a url column.
    const rows: string[][] = [];
    let row: string[] = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; if (rows.length % 2000 === 0) progress(i); }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) { post({ type: 'error', message: 'That file is empty.' }); return; }
    const hdr = rows[0].map((h) => h.trim().toLowerCase());
    const iu = hdr.findIndex((h) => h === 'url' || h === 'href' || h === 'link');
    if (iu < 0) { post({ type: 'error', message: "We couldn't find a URL column. Export from Raindrop, Pocket or your browser as HTML or CSV." }); return; }
    const it = hdr.indexOf('title'), ifo = hdr.findIndex((h) => h === 'folder' || h === 'collection');
    if (hdr.indexOf('time_added') >= 0) source = 'Pocket';
    else if (hdr.indexOf('excerpt') >= 0 || hdr.indexOf('highlights') >= 0) source = 'Raindrop.io';
    for (let r = 1; r < rows.length; r++) add(rows[r][iu] || '', it >= 0 ? rows[r][it] || '' : '', ifo >= 0 ? (rows[r][ifo] || '').trim() : '');
  }

  if (!total) {
    post({ type: 'error', message: skipped ? 'We only found non-web links (for example browser pages). Nothing to import.' : "We couldn't find any bookmarks in that file. Try the HTML export from your browser, Raindrop or Pocket." });
    return;
  }

  // Top 5 categories; "Other" only if it is the biggest, so the preview feels organised.
  const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const ranked = names.filter((n) => n !== 'Other').concat(names.filter((n) => n === 'Other'));
  const top = (counts[names[0]] === counts.Other ? names : ranked).slice(0, 5);
  // 5 preview cards: take one sample at a time from each top category so the cards are varied.
  const preview: PreviewLink[] = [];
  for (let round = 0; preview.length < 5 && round < 6; round++) for (const c of top) { const s = samples[c]?.[round]; if (s && preview.length < 5 && !preview.some((p) => p.host === s.host)) preview.push(s); }
  void filename;
  post({ type: 'done', summary: { total, duplicates, skipped, folders: folderSet.size, source, categories: top.map((name) => ({ name, count: counts[name] })), preview, ms: Date.now() - t0 } });
}

/** The worker body: read the File inside the worker (the main thread never touches the bytes) and run the parser. */
const WORKER_SOURCE = `const parseCore=${parseCore.toString()};
self.onmessage=async function(e){try{const f=e.data;const t=await f.text();parseCore(t,f.name,function(m){self.postMessage(m)})}catch(err){self.postMessage({type:'error',message:String(err&&err.message||err)})}};`;

/* ───────────────────────────── component ───────────────────────────── */

export interface InstantMigrationSandboxProps {
  /** Where "Create Free Account" goes. The saved file is picked up after signup (?import=pending). */
  signupHref?: string;
  /** Open the claim modal by itself shortly after results appear. Default true. */
  autoOpenModal?: boolean;
  /** Optional analytics hook: 'file_dropped' | 'parsed' | 'parse_error' | 'modal_open' | 'claim_click'. */
  onEvent?: (name: string, data?: Record<string, unknown>) => void;
  className?: string;
}

const CAT_COLOR: Record<string, string> = {
  Development: 'bg-emerald-400', Design: 'bg-teal-400', Video: 'bg-cyan-400', Social: 'bg-sky-400', Reading: 'bg-lime-400',
  Learning: 'bg-green-400', Shopping: 'bg-amber-400', Finance: 'bg-emerald-300', Productivity: 'bg-teal-300', Travel: 'bg-cyan-300', Health: 'bg-lime-300', Other: 'bg-slate-500',
};
const fmt = (n: number) => n.toLocaleString('en-GB');

export default function InstantMigrationSandbox({ signupHref = '/signup', autoOpenModal = true, onEvent, className = '' }: InstantMigrationSandboxProps) {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [modal, setModal] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);
  const emit = useCallback((n: string, d?: Record<string, unknown>) => { try { onEvent?.(n, d); } catch { /* analytics must never break the page */ } }, [onEvent]);

  const stop = useCallback(() => {
    workerRef.current?.terminate(); workerRef.current = null;
    window.clearTimeout(timerRef.current);
  }, []);
  useEffect(() => stop, [stop]);

  const handleMsg = useCallback((id: number, file: File, m: WorkerMsg) => {
    if (id !== runId.current) return;                                   // a newer file replaced this one
    if (m.type === 'progress') setPhase((p) => (p.name === 'parsing' ? { ...p, pct: m.pct } : p));
    else if (m.type === 'done') { stop(); setPhase({ name: 'done', summary: m.summary, file }); emit('parsed', { total: m.summary.total, source: m.summary.source, ms: m.summary.ms }); }
    else { stop(); setPhase({ name: 'error', message: m.message }); emit('parse_error', { message: m.message }); }
  }, [emit, stop]);

  const runOnMainThread = useCallback((id: number, file: File) => {
    file.text().then((text) => { timerRef.current = window.setTimeout(() => { try { parseCore(text, file.name, (m) => handleMsg(id, file, m)); } catch (e) { handleMsg(id, file, { type: 'error', message: String((e as Error).message ?? e) }); } }, 30); })
      .catch(() => handleMsg(id, file, { type: 'error', message: "We couldn't read that file." }));
  }, [handleMsg]);

  const start = useCallback((file: File | undefined | null) => {
    if (!file) return;
    stop(); setModal(false);
    const id = ++runId.current;
    if (file.size > MAX_BYTES) { setPhase({ name: 'error', message: 'That file is over 80 MB. Bookmark exports are normally under 10 MB.' }); return; }
    if (!/\.(html?|csv)$/i.test(file.name) && !/^(text\/html|text\/csv)$/.test(file.type)) { setPhase({ name: 'error', message: 'Please drop the HTML or CSV export from your browser, Raindrop or Pocket.' }); return; }
    emit('file_dropped', { size: file.size });
    setPhase({ name: 'parsing', file: file.name, pct: 0 });
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      const w = new Worker(url); URL.revokeObjectURL(url);
      w.onmessage = (e: MessageEvent<WorkerMsg>) => handleMsg(id, file, e.data);
      w.onerror = () => { w.terminate(); if (workerRef.current === w) workerRef.current = null; if (id === runId.current) runOnMainThread(id, file); };   // CSP or old browser: same parser, main thread
      workerRef.current = w; w.postMessage(file);
    } catch { runOnMainThread(id, file); }
  }, [emit, handleMsg, runOnMainThread, stop]);

  const reset = useCallback(() => { stop(); runId.current++; setPhase({ name: 'idle' }); setModal(false); if (inputRef.current) inputRef.current.value = ''; }, [stop]);

  // Open the CTA once, a moment after the results land, so the visitor sees their data first.
  useEffect(() => {
    if (phase.name !== 'done' || !autoOpenModal) return;
    const t = window.setTimeout(() => { setModal(true); emit('modal_open', { auto: true }); }, 1800);
    return () => window.clearTimeout(t);
  }, [phase.name, autoOpenModal, emit]);

  const claim = useCallback(async () => {
    if (phase.name !== 'done' || claiming) return;
    setClaiming(true); emit('claim_click', { total: phase.summary.total });
    const saved = await savePending({ file: phase.file, name: phase.file.name, source: phase.summary.source, count: phase.summary.total });
    let href = signupHref;
    try { const u = new URL(signupHref, window.location.origin); u.searchParams.set('import', saved ? 'pending' : 'reselect'); href = u.pathname + u.search + u.hash; } catch { /* keep as given */ }
    window.location.assign(href);
  }, [phase, claiming, signupHref, emit]);

  /* ---- dropzone events ---- */
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); start(e.dataTransfer.files?.[0]); };
  const onDrag = (e: React.DragEvent, on: boolean) => { e.preventDefault(); setDragging(on); };

  const summary = phase.name === 'done' ? phase.summary : null;
  const maxCat = useMemo(() => (summary ? Math.max(...summary.categories.map((c) => c.count)) : 1), [summary]);

  return (
    <section id="instant-migration" aria-labelledby="ims-title" className={`relative mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 ${className}`}>
      <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 -z-10 h-64 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="mb-8 text-center">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium tracking-wide text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-400" /> TRY IT WITHOUT AN ACCOUNT
        </p>
        <h2 id="ims-title" className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">Drop your bookmark export. Watch it organise itself.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-pretty text-slate-400">
          Works with Raindrop, Pocket, Chrome, Edge, Firefox and Safari. Your file is read in this tab only. <span className="text-slate-300">Nothing is uploaded</span> until you create an account.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-950 p-3 shadow-2xl shadow-emerald-950/30 sm:p-5">
        {phase.name !== 'done' && (
          <label
            onDragEnter={(e) => onDrag(e, true)} onDragOver={(e) => onDrag(e, true)} onDragLeave={(e) => onDrag(e, false)} onDrop={onDrop}
            className={`group relative flex min-h-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition focus-within:ring-2 focus-within:ring-emerald-400 ${dragging ? 'border-emerald-400 bg-emerald-400/10' : 'border-slate-700 bg-slate-900/60 hover:border-emerald-400/60'} ${phase.name === 'parsing' ? 'pointer-events-none' : ''}`}
          >
            <input ref={inputRef} type="file" accept=".html,.htm,.csv,text/html,text/csv" className="sr-only" onChange={(e) => start(e.target.files?.[0])} aria-describedby="ims-help" />
            {phase.name === 'parsing' ? (
              <div className="w-full max-w-sm" role="status" aria-live="polite">
                <p className="mb-3 truncate text-sm text-slate-300">Reading <span className="font-medium text-white">{phase.file}</span></p>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800" aria-hidden>
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-150" style={{ width: `${Math.max(6, phase.pct)}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500">{phase.pct}% &middot; on your device</p>
              </div>
            ) : (
              <>
                <span className="grid size-14 place-items-center rounded-2xl border border-slate-700 bg-slate-900 text-emerald-400 transition group-hover:scale-105" aria-hidden>
                  <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m0 0 4 4m-4-4L8 8" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
                </span>
                <p className="text-lg font-semibold text-white">{dragging ? 'Release to organise' : 'Drag your export here'}</p>
                <p className="text-sm text-slate-400">or <span className="font-medium text-emerald-400 underline underline-offset-4">choose a file</span> (.html or .csv)</p>
                <p id="ims-help" className="max-w-md text-xs text-slate-500">Chrome: Bookmarks manager, three dots, Export bookmarks. Pocket and Raindrop: Settings, Export.</p>
              </>
            )}
          </label>
        )}

        {phase.name === 'error' && (
          <div role="alert" className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <span>{phase.message}</span>
            <button type="button" onClick={reset} className="shrink-0 font-medium text-rose-100 underline underline-offset-4">Try again</button>
          </div>
        )}

        {summary && phase.name === 'done' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <p className="text-sm text-slate-400">
                {summary.source ? <>Detected a <span className="font-medium text-emerald-300">{summary.source}</span> export</> : 'Bookmark file read'} &middot; <span className="text-slate-500">{phase.file.name}</span>
              </p>
              <button type="button" onClick={reset} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-emerald-400/60 hover:text-white">Try another file</button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [fmt(summary.total), 'links found'],
                [fmt(summary.folders), summary.folders === 1 ? 'folder' : 'folders'],
                [fmt(summary.duplicates), 'duplicates merged'],
                [summary.ms < 1000 ? `${summary.ms} ms` : `${(summary.ms / 1000).toFixed(1)} s`, 'to read it'],
              ].map(([v, l]) => (
                <div key={l} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
                  <p className="text-2xl font-bold tabular-nums text-emerald-400">{v}</p>
                  <p className="text-xs text-slate-400">{l}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur lg:col-span-2 min-w-0">
                <h3 className="mb-4 text-sm font-semibold text-white">Auto-sorted into</h3>
                <ul className="space-y-3">
                  {summary.categories.map((c) => (
                    <li key={c.name}>
                      <div className="mb-1 flex justify-between text-sm"><span className="text-slate-200">{c.name}</span><span className="tabular-nums text-slate-400">{fmt(c.count)}</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full ${CAT_COLOR[c.name] ?? 'bg-emerald-400'}`} style={{ width: `${Math.max(4, (c.count / maxCat) * 100)}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="min-w-0 space-y-2.5 lg:col-span-3">
                <h3 className="px-1 text-sm font-semibold text-white">A first look at your vault</h3>
                {summary.preview.map((l) => (
                  <article key={l.url} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 backdrop-blur transition hover:border-emerald-400/40">
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-400/10 text-sm font-bold uppercase text-emerald-400">{l.host[0]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{l.title}</p>
                      <p className="truncate text-xs text-slate-500">{l.host}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-xs text-emerald-300">{l.category}</span>
                  </article>
                ))}
                {summary.total > summary.preview.length && <p className="px-1 text-xs text-slate-500">and {fmt(summary.total - summary.preview.length)} more, ready to import</p>}
              </div>
            </div>

            <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-5 text-center">
              <p className="text-lg font-semibold text-white">Claim your {fmt(summary.total)} organised bookmarks in Bukmarkz</p>
              <button type="button" onClick={() => { setModal(true); emit('modal_open', { auto: false }); }} className="rounded-xl bg-emerald-400 px-6 py-3 font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">
                Create Free Account in 1-Click
              </button>
              <p className="text-xs text-slate-500">No credit card. Your file stays on this device until you sign up.</p>
            </div>
          </div>
        )}
      </div>

      {modal && summary && <ClaimModal count={summary.total} busy={claiming} onClaim={claim} onClose={() => setModal(false)} />}
    </section>
  );
}

/* ───────────────────────────── modal ───────────────────────────── */

function ClaimModal({ count, busy, onClaim, onClose }: { count: number; busy: boolean; onClaim: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {                              // keep focus inside the dialog
        const f = ref.current.querySelectorAll<HTMLElement>('button, a[href]'); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="presentation">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-slate-950/80 backdrop-blur-sm" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="ims-modal-title" className="relative w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/95 p-7 text-center shadow-2xl shadow-emerald-950/50">
        <span aria-hidden className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-400">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /><path d="m9 10 2 2 4-4" /></svg>
        </span>
        <h3 id="ims-modal-title" className="text-balance text-2xl font-bold text-white">Claim your {count.toLocaleString('en-GB')} organised bookmarks in Bukmarkz</h3>
        <p className="mt-2 text-sm text-slate-400">Create your free account and we will import them, sorted and searchable, in seconds.</p>
        <button data-autofocus type="button" onClick={onClaim} disabled={busy} className="mt-6 w-full rounded-xl bg-emerald-400 px-5 py-3.5 font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 disabled:cursor-wait disabled:opacity-70">
          {busy ? 'Saving your file on this device…' : 'Create Free Account in 1-Click'}
        </button>
        <ul className="mt-5 space-y-1.5 text-left text-xs text-slate-400">
          <li className="flex gap-2"><span className="text-emerald-400">&#10003;</span> No credit card required</li>
          <li className="flex gap-2"><span className="text-emerald-400">&#10003;</span> Your file never left this device until now</li>
          <li className="flex gap-2"><span className="text-emerald-400">&#10003;</span> Private links stay private</li>
        </ul>
        <button type="button" onClick={onClose} className="mt-5 text-xs text-slate-500 underline underline-offset-4 hover:text-slate-300">Maybe later</button>
      </div>
    </div>
  );
}
