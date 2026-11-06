'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Share2, Loader2, Sparkles } from 'lucide-react';
import { Buk, Markz } from '@/components/brand/Mascots';

/* ---------------------------------------------------------------------------------------------------------------------
 * Vault Studio: turn a saved bookmark or research stack into a 1200x630 share card (PNG).
 *
 * Needs:  npm i html-to-image
 * Why html-to-image (DOM -> SVG foreignObject -> canvas) and not hand-drawn canvas: the card is ordinary React/HTML, so what you
 * preview is what you export. The card uses ONLY inline styles + inline SVG, no remote images and no web fonts, because those are
 * what make DOM-to-image exports fail (CORS-tainted canvas) or differ from the preview. `backdrop-filter` is not captured by
 * html-to-image either, so the "glass" is built from translucent gradients + a hairline border, which exports identically.
 * ------------------------------------------------------------------------------------------------------------------- */

export interface StudioSource {
  id: string;
  kind: 'bookmark' | 'stack';
  title: string;
  url?: string;
  /** AI takeaways produced by the server (exactly the strings shown on the card). Preferred. */
  takeaways?: string[];
  /** Fallback when no takeaways exist yet: the first sentences of this are used. Not AI-rewritten. */
  summary?: string | null;
  /** Words in the source article/stack, for the read-time estimate. */
  wordCount?: number | null;
}

interface Props {
  sources: StudioSource[];
  initialId?: string;
  /** Optional: ask the server for fresh Buk takeaways (e.g. a Server Action). Must return 1-3 short strings. */
  generateTakeaways?: (id: string) => Promise<string[]>;
}

const W = 1200, H = 630, WORDS_PER_MIN = 220;
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Pure helpers (exported for tests). */
export function readMinutes(words?: number | null): number | null {
  return words && words > 0 ? Math.max(1, Math.round(words / WORDS_PER_MIN)) : null;
}
export function pickTakeaways(s: Pick<StudioSource, 'takeaways' | 'summary'>): string[] {
  const own = (s.takeaways ?? []).map(t => t.trim()).filter(Boolean);
  if (own.length) return own.slice(0, 3).map(t => clip(t, 118));
  const parts = (s.summary ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map(t => t.trim()).filter(t => t.length > 12);
  return parts.slice(0, 3).map(t => clip(t, 118));
}
export function clip(t: string, n: number): string {
  const c = Array.from(t);                     // by code point, so an emoji is never cut in half
  return c.length <= n ? t : c.slice(0, n - 1).join('').replace(/[\s,;:.\-–—]+$/, '') + '…';
}
export function fileName(title: string): string {
  const base = title.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `bukmarkz-${base || 'card'}.png`;
}
function host(url?: string) { try { return url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { return ''; } }

/* ----------------------------------------------------------------------------------------------- the card (1200x630, fixed) */
function Card({ title, bullets, minutes, source, kind }: { title: string; bullets: string[]; minutes: number | null; source: string; kind: string }) {
  const titleSize = title.length > 90 ? 40 : title.length > 55 ? 48 : 56;
  return (
    <div style={{ width: W, height: H, position: 'relative', overflow: 'hidden', fontFamily: FONT, color: '#ecfdf5',
      background: 'linear-gradient(135deg,#020617 0%,#0b1f1a 55%,#052e22 100%)' }}>
      {/* soft light blobs (plain gradients: they export reliably, unlike filter: blur) */}
      <div style={{ position: 'absolute', left: -140, top: -160, width: 620, height: 620, borderRadius: '50%', background: 'radial-gradient(circle,rgba(52,211,153,.30),rgba(52,211,153,0) 68%)' }} />
      <div style={{ position: 'absolute', right: -160, bottom: -200, width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle,rgba(252,163,17,.16),rgba(252,163,17,0) 68%)' }} />

      {/* glass panel */}
      <div style={{ position: 'absolute', left: 48, top: 44, width: W - 96, height: 458, borderRadius: 32, boxSizing: 'border-box', padding: '36px 44px',
        background: 'linear-gradient(145deg,rgba(255,255,255,.13),rgba(255,255,255,.04))', border: '1.5px solid rgba(255,255,255,.22)',
        boxShadow: '0 24px 60px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.25)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 20, letterSpacing: 2, textTransform: 'uppercase', color: '#6ee7b7', fontWeight: 700 }}>
          <span>{kind === 'stack' ? 'Research stack' : 'Saved insight'}</span>
          {source && <span style={{ color: 'rgba(236,253,245,.55)', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· {source}</span>}
          {minutes && <span style={{ marginLeft: 'auto', color: '#fcd34d', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>{minutes} min read</span>}
        </div>
        <div style={{ marginTop: 16, fontSize: titleSize, lineHeight: 1.12, fontWeight: 800, letterSpacing: -1, maxHeight: titleSize * 1.12 * 2, overflow: 'hidden' }}>{title}</div>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {bullets.map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start', fontSize: 26, lineHeight: 1.3, color: 'rgba(236,253,245,.92)' }}>
              <div style={{ flex: 'none', width: 34, height: 34, marginTop: 1, borderRadius: 11, background: 'rgba(52,211,153,.2)', border: '1px solid rgba(110,231,183,.5)',
                color: '#6ee7b7', fontSize: 19, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
              <div>{b}</div>
            </div>
          ))}
        </div>
      </div>

      {/* footer banner */}
      <div style={{ position: 'absolute', left: 48, right: 48, bottom: 28, height: 64, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 56, height: 56 }}><Buk className="" /></div>
        <div style={{ width: 56, height: 56, marginLeft: -22 }}><Markz className="" /></div>
        <div style={{ marginLeft: 6, fontSize: 24, fontWeight: 700, color: '#ecfdf5' }}>Synthesized via <span style={{ color: '#6ee7b7' }}>Bukmarkz.com</span></div>
        <div style={{ marginLeft: 'auto', fontSize: 18, color: 'rgba(236,253,245,.5)' }}>Save it once. Find it by meaning.</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------- the exporter */
export default function VaultStudioExporter({ sources, initialId, generateTakeaways }: Props) {
  const [id, setId] = useState(initialId && sources.some(s => s.id === initialId) ? initialId : sources[0]?.id);
  const src = useMemo(() => sources.find(s => s.id === id), [sources, id]);
  const [generated, setGenerated] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<'gen' | 'png' | 'share' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  // Scale the fixed 1200x630 card to the preview width with a transform (the export ignores it, see render()).
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / W)));
    ro.observe(el); setScale(Math.min(1, el.clientWidth / W));
    return () => ro.disconnect();
  }, []);

  const bullets = useMemo(() => src ? pickTakeaways({ takeaways: generated[src.id] ?? src.takeaways, summary: src.summary }) : [], [src, generated]);
  const minutes = readMinutes(src?.wordCount);

  const render = useCallback(async (): Promise<Blob> => {
    const node = cardRef.current; if (!node) throw new Error('Card not ready');
    const { toBlob } = await import('html-to-image');                       // loaded on demand: ~no cost until someone exports
    await document.fonts?.ready;
    const opts = { width: W, height: H, pixelRatio: 2, cacheBust: true, backgroundColor: '#020617',
      style: { transform: 'none', transformOrigin: 'top left', width: `${W}px`, height: `${H}px` } };   // undo the preview scaling for the export
    await toBlob(node, opts);                                                // Safari paints inline SVG lazily: the first pass can be blank, the second is right
    const blob = await toBlob(node, opts);
    if (!blob || blob.size < 5_000) throw new Error('The image came out empty. Please try again.');
    return blob;
  }, []);

  async function download() {
    if (!src) return; setBusy('png'); setMsg(null);
    try {
      const blob = await render(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = fileName(src.title); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMsg({ ok: true, text: `Saved 2400×1260 PNG (shows at 1200×630).` });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Export failed.' }); }
    finally { setBusy(null); }
  }

  async function share() {
    if (!src) return; setBusy('share'); setMsg(null);
    try {
      const blob = await render(); const file = new File([blob], fileName(src.title), { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: src.title, text: 'Synthesized via Bukmarkz.com' }); }
      else { await download(); return; }                                      // desktop browsers: no file sharing, so fall back to download
    } catch (e) { if ((e as Error).name !== 'AbortError') setMsg({ ok: false, text: e instanceof Error ? e.message : 'Share failed.' }); }
    finally { setBusy(null); }
  }

  async function regenerate() {
    if (!src || !generateTakeaways) return; setBusy('gen'); setMsg(null);
    try {
      const t = (await generateTakeaways(src.id)).map(x => String(x).trim()).filter(Boolean).slice(0, 3);
      if (!t.length) throw new Error('Buk had nothing to add.');
      setGenerated(g => ({ ...g, [src.id]: t }));
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not generate takeaways.' }); }
    finally { setBusy(null); }
  }

  if (!src) return <p className="text-sm text-slate-400">Save a bookmark or stack first, then pick it here.</p>;
  const noBullets = bullets.length === 0;

  return (
    <section aria-label="Vault Studio" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-300">
          <span className="shrink-0">Card for</span>
          <select value={id} onChange={e => { setId(e.target.value); setMsg(null); }}
            className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
            {sources.map(s => <option key={s.id} value={s.id}>{s.kind === 'stack' ? '📚 ' : '🔖 '}{clip(s.title, 70)}</option>)}
          </select>
        </label>
        {generateTakeaways && (
          <button onClick={regenerate} disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/5 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
            {busy === 'gen' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-amber-300" />} Ask Buk for takeaways
          </button>
        )}
      </div>

      {/* preview: the real 1200x630 card, scaled down. The wrapper reserves the scaled height so nothing jumps. */}
      <div ref={boxRef} className="w-full overflow-hidden rounded-2xl border border-white/10" style={{ height: H * scale }}>
        <div ref={cardRef} style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <Card title={src.title} bullets={bullets} minutes={minutes} source={host(src.url)} kind={src.kind} />
        </div>
      </div>

      {noBullets && <p role="status" className="text-sm text-amber-300">No takeaways yet for this item{generateTakeaways ? ': ask Buk above.' : '.'} The card still exports with the title only.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={download} disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
          {busy === 'png' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PNG
        </button>
        <button onClick={share} disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-white/5 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
          {busy === 'share' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Share
        </button>
        {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
