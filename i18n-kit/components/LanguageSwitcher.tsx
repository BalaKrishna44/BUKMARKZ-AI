'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { COOKIE_MAX_AGE, LOCALE_COOKIE, LOCALE_META, locales, withLocale, type Locale } from '@/i18n';

function GlobeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  );
}

export default function LanguageSwitcher({ current }: { current: Locale }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, locales.indexOf(current)));
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const choose = useCallback((next: Locale) => {
    setOpen(false);
    if (next === current) return;
    // 1) Remember the choice for a year. This cookie beats auto-detection in middleware.ts.
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    // 2) Same page, new locale: keep the query string and the #hash, and don't jump the scroll position.
    const qs = search?.toString();
    router.replace(`${withLocale(pathname, next)}${qs ? `?${qs}` : ''}${window.location.hash}`, { scroll: false });
    router.refresh(); // re-fetch server components in the new language
  }, [current, pathname, router, search]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % locales.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + locales.length) % locales.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(locales.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(locales[active]); }
  };

  const meta = LOCALE_META[current];
  return (
    <div ref={root} className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Language: ${meta.label}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm font-medium text-slate-800 shadow-sm backdrop-blur-xl transition hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-900/80"
      >
        <GlobeIcon className="text-emerald-600 dark:text-emerald-400" />
        <span aria-hidden="true" className="text-base leading-none">{meta.flag}</span>
        <span className="hidden sm:inline">{meta.native}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Choose language"
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onKeyDown={onListKey}
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-white/40 bg-white/70 p-1.5 shadow-xl backdrop-blur-xl focus:outline-none dark:border-white/10 dark:bg-slate-900/70"
        >
          {locales.map((code, i) => {
            const m = LOCALE_META[code];
            const selected = code === current;
            return (
              <li
                key={code}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(code)}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-slate-100 ${i === active ? 'bg-emerald-500/15' : ''}`}
              >
                <span aria-hidden="true" className="text-lg leading-none">{m.flag}</span>
                <span className="flex-1"><span className="font-medium">{m.native}</span>{m.native !== m.label && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{m.label}</span>}</span>
                {selected && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-400" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
