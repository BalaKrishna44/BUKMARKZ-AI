import { Clapperboard, Download, Layers, Sparkles, Sunrise, Tag } from 'lucide-react';
import Link from 'next/link';
import { focusRing, panelSoft } from '@/lib/ui';

/** Replace hrefs with real routes as pages ship. `/dashboard/deals`, `/switch/[tool]` and `/s/[stackSlug]` come from the other kits. */
const FEATURES = [
  { icon: Sparkles, title: 'Ask Your Vault', body: 'Ask a question in plain words. Buk answers from your own links and shows which ones it used.', href: '#sandbox', cta: 'Try it below' },
  { icon: Sunrise, title: 'Morning Resurface', body: 'Five forgotten links each morning, plus a short recall challenge so they actually stick.', href: '/dashboard', cta: 'See the widget' },
  { icon: Clapperboard, title: 'Shorts Feed', body: 'Saved Reels and YouTube Shorts in one swipeable feed, with a link back to the original.', href: '/dashboard/shorts', cta: 'Open the feed' },
  { icon: Tag, title: 'Deal Finder', body: 'Local product prices side by side, with the affiliate tag added for you where one exists.', href: '/dashboard/deals', cta: 'Compare deals' },
  { icon: Download, title: 'Switch in 60 seconds', body: 'Drop in a Raindrop or browser export. The file is read in your browser before you sign in.', href: '/switch/raindrop', cta: 'Import a file' },
  { icon: Layers, title: 'Live Stacks', body: 'Publish a set of links as a page. Anyone can remix it into their own vault in one click.', href: '/dashboard', cta: 'Make a stack' },
] as const;

export default function FeatureGrid() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map(({ icon: Icon, title, body, href, cta }) => (
        <li key={title}>
          <Link href={href} className={`group flex h-full flex-col rounded-2xl p-5 transition hover:border-emerald-500/40 hover:bg-slate-900/80 ${panelSoft} ${focusRing}`}>
            <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400 transition group-hover:scale-105"><Icon className="h-5 w-5" aria-hidden /></span>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-slate-400">{body}</p>
            <span className="mt-4 text-xs font-semibold text-emerald-400">{cta} →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
