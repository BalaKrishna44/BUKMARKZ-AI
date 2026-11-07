'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { NAV } from './nav';

interface Row { key: string; label: string; hint: string; go: () => void }

/** Ctrl/Cmd+K: jump to any page or find a saved link by title/URL. */
export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [links, setLinks] = useState<{ id: string; title: string | null; url: string }[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('bukmarkz:palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('bukmarkz:palette', onOpen); };
  }, []);

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  useEffect(() => {
    const term = q.trim().replace(/[%,()]/g, ' ');
    if (term.length < 2) { setLinks([]); return; }
    const t = setTimeout(async () => {
      const { data } = await createClient().from('oneclist_items').select('id,title,url')
        .or(`title.ilike.%${term}%,url.ilike.%${term}%`).order('created_at', { ascending: false }).limit(6);
      setLinks(data ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const rows = useMemo<Row[]>(() => {
    const s = q.trim().toLowerCase();
    const pages = NAV.flatMap((g) => g.items).filter((i) => i.href && (!s || i.label.toLowerCase().includes(s)))
      .map((i) => ({ key: 'p' + i.label, label: i.label, hint: 'Page', go: () => router.push(i.href as string) }));
    const found = links.map((l) => ({ key: 'l' + l.id, label: l.title || l.url, hint: 'Saved link', go: () => window.open(l.url, '_blank', 'noopener,noreferrer') }));
    return [...pages, ...found];
  }, [q, links, router]);

  if (!open) return null;
  const run = (r?: Row) => { if (r) { setOpen(false); r.go(); } };
  return (
    <div className="fixed inset-0 z-50 grid place-items-start bg-black/40 px-4 pt-[12vh]" onMouseDown={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Quick search">
      <div className="mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-[#d8eedf] bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, rows.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
            else if (e.key === 'Enter') run(rows[sel]);
          }}
          placeholder="Jump to a page or search your saved links…" className="w-full border-b border-[#e6f3ea] px-4 py-3.5 text-[15px] text-[#10261c] outline-none" />
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-[#66766d]">Nothing found</li>}
          {rows.map((r, i) => (
            <li key={r.key}><button onClick={() => run(r)} onMouseEnter={() => setSel(i)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === sel ? 'bg-[#e6f6ec] text-[#10261c]' : 'text-[#33443b]'}`}>
              <span className="truncate">{r.label}</span><span className="shrink-0 text-xs text-[#66766d]">{r.hint}</span></button></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
