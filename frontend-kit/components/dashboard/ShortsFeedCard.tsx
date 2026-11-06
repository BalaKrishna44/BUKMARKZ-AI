'use client';
import { Bookmark, Check, ExternalLink, Pause, Play, Share2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Markz } from '@/components/brand/Mascots';
import type { ShortItem } from '@/lib/demo/data';
import { focusRing } from '@/lib/ui';

const YT_ID = /^[\w-]{11}$/;
const PLATFORM = { youtube: 'YouTube Shorts', instagram: 'Instagram Reels' } as const;
const safeHref = (u: string) => (/^https:\/\//i.test(u) ? u : '#');                       // stored URLs are never trusted as hrefs
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const embedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&playsinline=1&rel=0&modestbranding=1`;

interface CardProps {
  item: ShortItem; index: number; total: number;
  onSaveChange?: (id: string, saved: boolean) => void;
  onShare?: (id: string, how: 'native' | 'copy') => void;
}

/**
 * One full-height card of the vertical feed. Place cards inside <ShortsFeed> (or any `snap-y snap-mandatory` scroll container).
 * - YouTube Shorts with an `embedId` play inline (privacy-enhanced embed, muted) only while the card is on screen, and not at all
 *   if the visitor prefers reduced motion until they press play. Nothing from YouTube loads before that.
 * - Instagram Reels cannot be embedded without Instagram's own script, so they show a poster with a clear "Open on Instagram" action.
 */
export function ShortsFeedCard({ item, index, total, onSaveChange, onShare }: CardProps) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false), [playing, setPlaying] = useState(false), [saved, setSaved] = useState(item.saved), [toast, setToast] = useState('');
  const canEmbed = item.platform === 'youtube' && !!item.embedId && YT_ID.test(item.embedId);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && e.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {                                                                      // autoplay only when on screen and motion is welcome; always stop when scrolled away
    if (!visible) { setPlaying(false); return; }
    if (canEmbed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(true);
  }, [visible, canEmbed]);

  const say = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 1800); }, []);
  const toggleSave = () => { const n = !saved; setSaved(n); onSaveChange?.(item.id, n); say(n ? 'Saved to your vault' : 'Removed from your vault'); };
  async function share() {
    const data = { title: item.title, text: `${item.title} by ${item.creator}`, url: item.url };
    try {
      if (typeof navigator.share === 'function') { await navigator.share(data); onShare?.(item.id, 'native'); return; }
    } catch (e) { if ((e as DOMException).name === 'AbortError') return; }                // the visitor closed the sheet: not an error
    try { await navigator.clipboard.writeText(item.url); onShare?.(item.id, 'copy'); say('Link copied'); } catch { say('Copy failed'); }
  }

  const rail = `grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 ${focusRing}`;
  return (
    <article ref={ref} aria-roledescription="slide" aria-label={`${index + 1} of ${total}: ${item.title}`} className="relative isolate h-[calc(100dvh-4rem)] min-h-[32rem] w-full shrink-0 snap-start snap-always overflow-hidden bg-slate-950">
      {/* Stage */}
      {playing && canEmbed ? (
        <iframe title={`${item.title} (${PLATFORM[item.platform]})`} src={embedUrl(item.embedId!)} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 -z-10 h-full w-full border-0" />
      ) : (
        <div className="absolute inset-0 -z-10" style={{ background: `radial-gradient(120% 80% at 50% 0%, hsl(${item.hue} 70% 28% / .9), transparent 60%), linear-gradient(180deg, hsl(${item.hue} 40% 10%), #020617)` }}>
          {canEmbed ? (
            <button type="button" onClick={() => setPlaying(true)} aria-label={`Play ${item.title}`} className={`absolute left-1/2 top-[38%] grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-md transition hover:scale-105 hover:bg-white/20 motion-reduce:transition-none ${focusRing}`}><Play className="ml-1 h-8 w-8" aria-hidden /></button>
          ) : (
            <a href={safeHref(item.url)} target="_blank" rel="noopener noreferrer" className={`absolute left-1/2 top-[38%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 text-white ${focusRing}`}>
              <span className="grid h-20 w-20 place-items-center rounded-full border border-white/20 bg-white/10 backdrop-blur-md transition hover:scale-105 hover:bg-white/20 motion-reduce:transition-none"><ExternalLink className="h-7 w-7" aria-hidden /></span>
              <span className="rounded-full bg-black/40 px-3 py-1 text-xs font-semibold backdrop-blur-md">Watch on {item.platform === 'instagram' ? 'Instagram' : 'YouTube'}<span className="sr-only"> (opens in a new tab)</span></span>
            </a>
          )}
        </div>
      )}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-0 h-2/5 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
        <span className="rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur-md">{PLATFORM[item.platform]}</span>
        <div className="flex items-center gap-2">
          {playing && canEmbed && <button type="button" onClick={() => setPlaying(false)} aria-label="Pause" className={`${rail} !h-9 !w-9`}><Pause className="h-4 w-4" aria-hidden /></button>}
          <span className="rounded-full bg-black/40 px-3 py-1 text-xs tabular-nums text-slate-200 backdrop-blur-md">{index + 1} / {total}</span>
        </div>
      </div>

      {/* Action rail */}
      <div className="absolute bottom-24 right-3 flex flex-col items-center gap-4 sm:right-5">
        <button type="button" onClick={toggleSave} aria-pressed={saved} className={`${rail} ${saved ? '!border-emerald-400 !bg-emerald-500 !text-slate-950' : ''}`}><span className="sr-only">{saved ? 'Remove from vault' : 'Save to vault'}</span><Bookmark className="h-5 w-5" fill={saved ? 'currentColor' : 'none'} aria-hidden /></button>
        <button type="button" onClick={share} className={rail}><span className="sr-only">Share</span><Share2 className="h-5 w-5" aria-hidden /></button>
        <a href={safeHref(item.url)} target="_blank" rel="noopener noreferrer" className={rail}><span className="sr-only">Open original on {PLATFORM[item.platform]} (new tab)</span><ExternalLink className="h-5 w-5" aria-hidden /></a>
      </div>

      {/* Caption */}
      <div className="absolute inset-x-0 bottom-0 p-4 pr-20 sm:p-6 sm:pr-24">
        <p className="text-sm font-semibold text-white/90">{item.creator} <span className="font-normal text-white/50">· {fmt(item.seconds)}</span></p>
        <h2 className="mt-1 line-clamp-2 text-balance text-lg font-bold leading-snug text-white sm:text-xl">{item.title}</h2>
        <div className="mt-2 flex items-start gap-2 rounded-xl bg-black/35 p-2.5 backdrop-blur-md"><Markz className="h-7 w-7 shrink-0" /><p className="text-xs leading-relaxed text-slate-200"><b className="text-amber-300">Markz:</b> {item.summary}</p></div>
        <ul className="mt-2 flex flex-wrap gap-1.5">{item.tags.map((t) => <li key={t} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-slate-200">#{t}</li>)}</ul>
      </div>

      <p role="status" aria-live="polite" className={`pointer-events-none absolute left-1/2 top-16 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-opacity motion-reduce:transition-none ${toast ? 'opacity-100' : 'opacity-0'}`}>{toast && <Check className="h-3.5 w-3.5" aria-hidden />}{toast}</p>
    </article>
  );
}

/** Scroll-snap container with keyboard control: ↑/↓ or PageUp/PageDown move one card, Home/End jump to the ends. */
export function ShortsFeed({ items }: { items: ShortItem[] }) {
  const box = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = box.current;
    if (!el || (e.target as HTMLElement).closest('a,button,iframe,input,textarea')) return;       // don't hijack keys while a control is focused
    const h = el.clientHeight;
    const to = (top: number) => { e.preventDefault(); el.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
    if (e.key === 'ArrowDown' || e.key === 'PageDown') to(Math.round(el.scrollTop / h + 1) * h);
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') to(Math.max(0, Math.round(el.scrollTop / h - 1) * h));
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(el.scrollHeight);
  };
  return (
    <div ref={box} tabIndex={0} onKeyDown={onKeyDown} role="region" aria-roledescription="carousel" aria-label="Saved shorts. Use the up and down arrow keys to move between videos." className={`mx-auto flex h-[calc(100dvh-4rem)] max-w-md snap-y snap-mandatory flex-col overflow-y-auto overscroll-contain rounded-none sm:rounded-3xl sm:border sm:border-slate-800 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${focusRing}`}>
      {items.map((it, i) => <ShortsFeedCard key={it.id} item={it} index={i} total={items.length} />)}
    </div>
  );
}

export default ShortsFeedCard;
