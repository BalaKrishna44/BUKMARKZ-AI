'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/* ───────────────────────────── types ───────────────────────────── */

/** Normalised box: every value is a fraction (0..1) of the ORIGINAL image width / height. */
export interface OcrBox { text: string; x: number; y: number; w: number; h: number; confidence?: number }

interface Base { id: string; title: string; description?: string }
export interface LinkItem extends Base {
  kind: 'link'; url: string;
  /** Open Graph banner. Drawn in a fixed 1.91:1 frame (the OG standard), so any source size is safe. */
  image?: string; favicon?: string;
}
export interface VideoItem extends Base {
  kind: 'video'; provider: 'youtube'; videoId: string; channel?: string; durationSec?: number;
  /** Override the computed thumbnail (your own proxy / cache). */
  thumbnail?: string;
}
export interface PhotoItem extends Base {
  kind: 'photo'; src: string;
  /** Intrinsic pixel size. Required: it reserves the exact box before the image arrives (no layout shift). */
  width: number; height: number;
  ocr?: { text: string; boxes: OcrBox[] };
}
export type MediaItem = LinkItem | VideoItem | PhotoItem;

export interface MediaCardProps {
  item?: MediaItem;
  /** Show the skeleton. With no `item`, pass `variant` (and `photoAspect` = width/height for photos). */
  loading?: boolean;
  variant?: MediaItem['kind'];
  photoAspect?: number;
  /** Eager + high fetch priority. Use for the first row only (LCP). */
  priority?: boolean;
  /** Rewrite image URLs, e.g. through your resizing / privacy proxy: (src, cssWidthPx) => url. */
  imageProxy?: (src: string, width: number) => string;
  /** Replace the default YouTube iframe in the modal (custom player, or hosts that block embeds). */
  renderPlayer?: (item: VideoItem) => ReactNode;
  /** Favicon resolver. Default is Google's s2 service; point it at your own endpoint for privacy. */
  resolveFavicon?: (domain: string) => string;
  className?: string;
}

/* ───────────────────── layout contract (CLS = 0 by construction) ─────────────────────
 * The card and its skeleton use the SAME constants, so their boxes are identical:
 *   media frame : width-driven aspect-ratio, independent of the image
 *   body        : 16 pad + meta 24 + 8 + title 44 + 8 + text 40 + 16 pad (text is clamped to a fixed number of lines)
 */
const OG_ASPECT = 1200 / 630;
const VIDEO_ASPECT = 16 / 9;
const PHOTO_MIN = 4 / 5, PHOTO_MAX = 16 / 9;

const SHELL = 'relative flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d1322] text-slate-100 shadow-lg shadow-black/30';
const BODY = 'flex flex-col gap-2 p-4';
const META = 'flex h-6 items-center gap-2';
const TITLE = 'h-11 text-[15px] font-semibold leading-[22px] line-clamp-2';
const TEXT = 'h-10 text-[13px] leading-5 text-slate-400 line-clamp-2';
const PILL = 'inline-flex h-5 min-w-0 max-w-full items-center truncate rounded-full bg-white/[0.07] px-2.5 text-xs font-medium text-slate-300';

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const mediaAspect = (kind: MediaItem['kind'], photoAspect = 4 / 3) =>
  kind === 'link' ? OG_ASPECT : kind === 'video' ? VIDEO_ASPECT : clamp(photoAspect, PHOTO_MIN, PHOTO_MAX);

/**
 * Rectangle (fractions of the frame) that an image of `imageAspect` occupies when contained in a frame of
 * `frameAspect`. OCR boxes are placed inside this rectangle so they stay glued to the text at any frame shape.
 */
export function fitRect(imageAspect: number, frameAspect: number) {
  if (imageAspect > frameAspect) { const h = frameAspect / imageAspect; return { left: 0, top: (1 - h) / 2, width: 1, height: h }; }
  const w = imageAspect / frameAspect; return { left: (1 - w) / 2, top: 0, width: w, height: 1 };
}
export const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.slice(0, 40); } };
export const ytThumb = (id: string, q: 'maxresdefault' | 'hqdefault' = 'maxresdefault') => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${q}.jpg`;
export const fmtDuration = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60); return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`; };
/** Drops malformed boxes and clamps the rest inside the image (OCR output is untrusted data). */
export const safeBoxes = (boxes: OcrBox[] = []) => boxes
  .filter((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0 && b.x < 1 && b.y < 1)
  .map((b) => { const x = clamp(b.x, 0, 1), y = clamp(b.y, 0, 1); return { ...b, x, y, w: clamp(b.w, 0, 1 - x), h: clamp(b.h, 0, 1 - y) }; });
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/* ───────────────────────────── shared pieces ───────────────────────────── */

const CSS = `@keyframes bkz-shimmer{100%{transform:translateX(100%)}}@keyframes bkz-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}`;
const Styles = () => <style>{CSS}</style>;

/** Requested skeleton look (pulse + slate gradient) with a light sweep on top. Honors prefers-reduced-motion. */
export function Shimmer({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`relative overflow-hidden animate-pulse bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 motion-reduce:animate-none ${className}`}>
      <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent motion-reduce:hidden" style={{ animation: 'bkz-shimmer 1.6s infinite' }} />
    </div>
  );
}

/** Fixed-ratio media box. Its height comes from the width alone, never from the image. */
function Frame({ aspect, className = '', children }: { aspect: number; className?: string; children: ReactNode }) {
  return <div className={`relative w-full overflow-hidden bg-slate-900 ${className}`} style={{ aspectRatio: String(aspect) }}>{children}</div>;
}

/** <img> that fades in over a shimmer, survives cached/failed loads, and never changes its box size. */
function Img({ src, alt, priority, fit = 'cover', className = '', onLoadImg, onFail }: {
  src: string; alt: string; priority?: boolean; fit?: 'cover' | 'contain'; className?: string;
  onLoadImg?: (img: HTMLImageElement) => void; onFail?: () => void;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => setState('loading'), [src]);
  const ref = useCallback((el: HTMLImageElement | null) => {   // image already in cache before React attached onLoad
    if (el?.complete) { if (el.naturalWidth > 0) { setState('ok'); onLoadImg?.(el); } else { setState('error'); onFail?.(); } }
  }, [onLoadImg, onFail, src]);
  return (
    <>
      {state === 'loading' && <Shimmer className="absolute inset-0" />}
      {state !== 'error' && (
        <img ref={ref} src={src} alt={alt} decoding="async" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'}
          referrerPolicy="no-referrer"
          onLoad={(e) => { setState('ok'); onLoadImg?.(e.currentTarget); }} onError={() => { setState('error'); onFail?.(); }}
          className={`absolute inset-0 size-full transition-opacity duration-300 motion-reduce:transition-none ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${state === 'ok' ? 'opacity-100' : 'opacity-0'} ${className}`} />
      )}
    </>
  );
}

function Placeholder({ label, seed }: { label: string; seed: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center" style={{ background: `linear-gradient(135deg, hsl(${hue(seed)} 38% 20%), hsl(${(hue(seed) + 40) % 360} 38% 11%))` }}>
      <span aria-hidden="true" className="select-none text-5xl font-extrabold uppercase text-white/25">{label.slice(0, 1)}</span>
    </div>
  );
}

/* ───────────────────────────── skeleton ───────────────────────────── */

export function MediaCardSkeleton({ variant = 'link', photoAspect, className = '' }: { variant?: MediaItem['kind']; photoAspect?: number; className?: string }) {
  return (
    // aria-hidden: put aria-busy="true" on the feed container instead of announcing every placeholder.
    <div aria-hidden="true" data-skeleton={variant} className={`${SHELL} ${className}`}>
      <Styles />
      <Frame aspect={mediaAspect(variant, photoAspect)}><Shimmer className="absolute inset-0" /></Frame>
      <div className={BODY}>
        <div className={META}><Shimmer className="size-4 rounded" /><Shimmer className="h-5 w-28 rounded-full" /></div>
        <div className="flex h-11 flex-col justify-center gap-2"><Shimmer className="h-3.5 w-11/12 rounded" /><Shimmer className="h-3.5 w-2/3 rounded" /></div>
        <div className="flex h-10 flex-col justify-center gap-2"><Shimmer className="h-3 w-full rounded" /><Shimmer className="h-3 w-4/5 rounded" /></div>
      </div>
    </div>
  );
}

/* ───────────────────────────── web link ───────────────────────────── */

function LinkCard({ item, priority, imageProxy, resolveFavicon, className }: Required<Pick<MediaCardProps, 'item'>> & MediaCardProps & { item: LinkItem }) {
  const domain = domainOf(item.url);
  const fav = item.favicon ?? (resolveFavicon ?? ((d) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`))(domain);
  const [imgFailed, setImgFailed] = useState(false), [favFailed, setFavFailed] = useState(false);
  const hasImg = !!item.image && !imgFailed;
  return (
    <article className={`group/card ${SHELL} transition-colors hover:border-white/25 focus-within:border-amber-400/60 ${className ?? ''}`} data-kind="link">
      <Frame aspect={OG_ASPECT}>
        {hasImg
          ? <Img src={imageProxy ? imageProxy(item.image!, 640) : item.image!} alt="" priority={priority} onFail={() => setImgFailed(true)}
              className="transition-transform duration-500 group-hover/card:scale-105 motion-reduce:transform-none" />
          : <Placeholder label={domain} seed={domain} />}
      </Frame>
      <div className={BODY}>
        <div className={META}>
          {!favFailed
            ? <img src={fav} alt="" width={16} height={16} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFavFailed(true)} className="size-4 shrink-0 rounded-[3px] bg-white/10" />
            : <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center rounded-[3px] bg-white/10 text-[10px] font-bold uppercase">{domain[0]}</span>}
          <span className={PILL}>{domain}</span>
        </div>
        <h3 className={TITLE}>
          {/* stretched link: the whole card is one tab stop and one click target */}
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="outline-none after:absolute after:inset-0 after:content-['']">{item.title}</a>
        </h3>
        <p className={TEXT}>{item.description}</p>
      </div>
    </article>
  );
}

/* ───────────────────────────── video ───────────────────────────── */

function VideoModal({ videoId, title, onClose, custom }: { videoId: string; title: string; onClose: () => void; custom?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');   // top layer, focus trap and Esc come free
    return () => { if (d.open) d.close(); };
  }, []);
  return (
    <dialog ref={ref} aria-label={title} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-auto w-[min(92vw,960px)] max-w-none overflow-visible bg-transparent p-0 text-slate-100 backdrop:bg-black/80 backdrop:backdrop-blur-sm">
      <button type="button" onClick={onClose} aria-label="Close video"
        className="absolute -top-12 right-0 grid size-11 place-items-center rounded-full bg-white/10 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-amber-400">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl">
        {/* privacy-enhanced domain; mounted only while open, so closing stops playback */}
        {custom ?? <iframe title={title} src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="size-full border-0" />}
      </div>
    </dialog>
  );
}

function VideoCard({ item, priority, imageProxy, renderPlayer, className }: MediaCardProps & { item: VideoItem }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<'maxresdefault' | 'hqdefault'>('maxresdefault');
  const [thumbFailed, setThumbFailed] = useState(false);
  const src = item.thumbnail ?? ytThumb(item.videoId, q);
  // maxres does not exist for every video: YouTube answers with a 120px grey placeholder (or a 404). Fall back to hq (4:3 with bars, which object-cover crops away).
  const onLoadImg = useCallback((el: HTMLImageElement) => { if (!item.thumbnail && q === 'maxresdefault' && el.naturalWidth <= 120) setQ('hqdefault'); }, [item.thumbnail, q]);
  const onFail = useCallback(() => { if (!item.thumbnail && q === 'maxresdefault') setQ('hqdefault'); else setThumbFailed(true); }, [item.thumbnail, q]);
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`;
  return (
    <article className={`group/card ${SHELL} transition-colors hover:border-white/25 ${className ?? ''}`} data-kind="video">
      <Frame aspect={VIDEO_ASPECT}>
        {thumbFailed ? <Placeholder label="▶" seed={item.videoId} /> : <Img src={imageProxy ? imageProxy(src, 640) : src} alt="" priority={priority} onLoadImg={onLoadImg} onFail={onFail} className="transition-transform duration-500 group-hover/card:scale-105 motion-reduce:transform-none" />}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
        <button type="button" onClick={() => setOpen(true)} aria-label={`Play video: ${item.title}`} aria-haspopup="dialog"
          className="group/play absolute inset-0 z-10 grid place-items-center outline-none">
          <span className="relative grid size-16 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/50 backdrop-blur-sm transition duration-300 group-hover/play:scale-110 group-hover/play:bg-amber-400 group-hover/play:text-[#14213d] group-focus-visible/play:scale-110 group-focus-visible/play:bg-amber-400 group-focus-visible/play:text-[#14213d] group-focus-visible/play:ring-2 group-focus-visible/play:ring-white motion-reduce:transition-none motion-reduce:group-hover/play:scale-100">
            <span aria-hidden="true" className="absolute inset-0 rounded-full ring-2 ring-white/70 opacity-0 group-hover/play:animate-ping group-hover/play:opacity-100 motion-reduce:hidden" />
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="translate-x-[2px]"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
          </span>
        </button>
        {item.durationSec != null && item.durationSec > 0 && (
          <span className="pointer-events-none absolute bottom-2 right-2 z-20 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white">{fmtDuration(item.durationSec)}</span>
        )}
      </Frame>
      <div className={BODY}>
        <div className={META}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0 text-red-500"><path fill="currentColor" d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2C.5 9.1.5 12 .5 12s0 2.9.5 4.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-4.8.5-4.8s0-2.9-.5-4.8ZM9.7 15.4V8.6l5.9 3.4-5.9 3.4Z" /></svg>
          <span className={PILL}>youtube.com</span>
        </div>
        <h3 className={TITLE}><a href={watch} target="_blank" rel="noopener noreferrer" className="outline-none hover:underline focus-visible:underline">{item.title}</a></h3>
        <p className={TEXT}>{item.description ?? item.channel}</p>
      </div>
      {open && <VideoModal videoId={item.videoId} title={item.title} onClose={() => setOpen(false)} custom={renderPlayer?.(item)} />}
    </article>
  );
}

/* ───────────────────────────── OCR photo ───────────────────────────── */

function PhotoCard({ item, priority, imageProxy, className }: MediaCardProps & { item: PhotoItem }) {
  const [show, setShow] = useState(false);
  const [failed, setFailed] = useState(false);
  const imgAspect = item.width / item.height;
  const frameAspect = mediaAspect('photo', imgAspect);
  const fit = fitRect(imgAspect, frameAspect);
  const boxes = safeBoxes(item.ocr?.boxes);
  const text = item.ocr?.text.replace(/\s+/g, ' ').trim();
  return (
    <article className={`group/card ${SHELL} transition-colors hover:border-white/25 ${className ?? ''}`} data-kind="photo">
      <Styles />
      <Frame aspect={frameAspect} className="bg-slate-950">
        {/* inner box = exactly where the image lands inside the frame; OCR boxes are children of it */}
        <div className="absolute" style={{ left: `${fit.left * 100}%`, top: `${fit.top * 100}%`, width: `${fit.width * 100}%`, height: `${fit.height * 100}%` }}>
          {failed ? <Placeholder label="▣" seed={item.id} /> : <Img src={imageProxy ? imageProxy(item.src, 640) : item.src} alt={item.title} priority={priority} onFail={() => setFailed(true)} />}
          {show && !failed && (
            <div className="absolute inset-0" data-ocr-layer role="list" aria-label="Recognized text regions">
              {boxes.map((b, i) => (
                <div key={i} role="listitem" tabIndex={0} title={b.text} aria-label={b.text} data-ocr-box
                  className="absolute rounded-[3px] border-2 border-amber-400 bg-amber-400/20 outline-none hover:bg-amber-400/40 focus-visible:bg-amber-400/40 focus-visible:ring-2 focus-visible:ring-white motion-reduce:!animate-none"
                  style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, opacity: 0.55 + 0.45 * clamp(b.confidence ?? 1, 0, 1), animation: `bkz-pop .25s ${Math.min(i, 12) * 25}ms both` }} />
              ))}
            </div>
          )}
        </div>
        {boxes.length > 0 && !failed && (
          <button type="button" aria-pressed={show} onClick={() => setShow((v) => !v)}
            className={`absolute right-2 top-2 z-10 inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-xs font-semibold outline-none backdrop-blur-sm transition focus-visible:ring-2 focus-visible:ring-white ${show ? 'bg-amber-400 text-[#14213d]' : 'bg-black/60 text-white hover:bg-black/75'}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8" /></svg>
            Text{show ? ` · ${boxes.length}` : ''}
          </button>
        )}
      </Frame>
      <div className={BODY}>
        <div className={META}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-slate-400"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="m21 16-5-5-8 8" /></svg>
          <span className={PILL}>Photo · {item.width.toLocaleString('en-US')}×{item.height.toLocaleString('en-US')}</span>
        </div>
        <h3 className={TITLE}>{item.title}</h3>
        <p className={TEXT}>{text || item.description}</p>
      </div>
    </article>
  );
}

/* ───────────────────────────── polymorphic entry ───────────────────────────── */

export default function MediaCard(props: MediaCardProps) {
  const { item, loading, variant, photoAspect, className } = props;
  if (loading || !item) {
    return <MediaCardSkeleton variant={variant ?? item?.kind ?? 'link'} photoAspect={photoAspect ?? (item?.kind === 'photo' ? item.width / item.height : undefined)} className={className} />;
  }
  switch (item.kind) {
    case 'link': return <LinkCard {...props} item={item} />;
    case 'video': return <VideoCard {...props} item={item} />;
    case 'photo': return <PhotoCard {...props} item={item} />;
  }
}
