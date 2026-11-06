import { getBuyLink } from '@/lib/affiliate';

/**
 * The ONLY place an affiliate link is built. Server component: the tag is attached while rendering, so nothing is stored and the saved URL is untouched.
 *   <BuyButton url={deal.url} isPro={isPro} />      // isPro from getIsPro(); pass undefined when unknown (no affiliate tag then)
 */
export function BuyButton({ url, isPro, label = 'Buy' }: { url: string; isPro: boolean | undefined; label?: string }) {
  const link = getBuyLink(url, isPro as boolean);
  const noteId = `buy-note-${Math.abs([...url].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}`;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <a href={link.href} target="_blank" rel={link.rel} aria-describedby={link.disclosure ? noteId : undefined}
         className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400">
        {label}
      </a>
      {link.disclosure && <span id={noteId} className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[11px] text-slate-400">{link.disclosure}</span>}
    </span>
  );
}
