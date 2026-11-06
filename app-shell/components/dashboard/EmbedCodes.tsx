'use client';

import { useMemo, useState } from 'react';
import { buildSnippets, type EmbedTheme } from '@/lib/embed/snippets';

type Tab = 'iframe' | 'markdown' | 'html' | 'notion';
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'iframe', label: 'Website (iframe)', hint: 'Blogs, docs sites and any page that allows iframes.' },
  { id: 'markdown', label: 'GitHub README', hint: 'GitHub strips iframes, so this is an image card that links to your live stack.' },
  { id: 'html', label: 'HTML image', hint: 'For emails, wikis and READMEs that accept <img> but not iframes.' },
  { id: 'notion', label: 'Notion', hint: 'Paste the link in Notion and choose “Create embed”.' },
];

/** "Embed this stack": shows the exact snippet to copy, a live preview, and a theme choice. Clipboard is best-effort (older webviews refuse it). */
export function EmbedCodes({ slug, title, itemCount }: { slug: string; title: string; itemCount: number }) {
  const [tab, setTab] = useState<Tab>('iframe');
  const [theme, setTheme] = useState<EmbedTheme>('auto');
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const sn = useMemo(() => buildSnippets({ slug, title, itemCount, theme }), [slug, title, itemCount, theme]);
  const code = tab === 'iframe' ? sn.iframe : tab === 'markdown' ? sn.markdown : tab === 'html' ? sn.htmlImage : sn.notion;

  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied('ok'); }
    catch {
      try { const t = document.createElement('textarea'); t.value = code; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); document.body.removeChild(t); setCopied(ok ? 'ok' : 'fail'); }
      catch { setCopied('fail'); }
    }
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <section aria-label="Embed this stack" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-md">
      <h3 className="font-semibold text-slate-100">Embed this stack</h3>
      <div role="tablist" aria-label="Where are you pasting it?" className="mt-3 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`rounded-full border px-3 py-1.5 text-sm ${tab === t.id ? 'border-emerald-400 bg-emerald-400 text-slate-950' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>{t.label}</button>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-400">{TABS.find((t) => t.id === tab)!.hint}</p>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">Theme
        <select value={theme} onChange={(e) => setTheme(e.target.value as EmbedTheme)} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100">
          <option value="auto">Match the page</option><option value="dark">Dark</option><option value="light">Light</option>
        </select>
      </label>
      <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-emerald-200"><code>{code}</code></pre>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={copy} className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">
          {copied === 'ok' ? 'Copied ✓' : copied === 'fail' ? 'Select the text and copy' : 'Copy'}
        </button>
        <span role="status" className="sr-only">{copied === 'ok' ? 'Copied to clipboard' : ''}</span>
      </div>
      <p className="mt-3 text-xs text-slate-500">The widget shows a small “Powered by Bukmarkz AI Vault” badge. Only public stacks can be embedded; making a stack private stops the widget within about 5 minutes.</p>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Preview</p>
      {tab === 'markdown' || tab === 'html'
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={sn.svgUrl} alt={`${title} card preview`} width={560} className="mt-2 max-w-full rounded-xl" />
        : <iframe src={sn.embedUrl} title="Embed preview" loading="lazy" width="100%" height={sn.height} className="mt-2 max-w-[560px] rounded-xl border-0" sandbox="allow-popups allow-popups-to-escape-sandbox" />}
    </section>
  );
}
