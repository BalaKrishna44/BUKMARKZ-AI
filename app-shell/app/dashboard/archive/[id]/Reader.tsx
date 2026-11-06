'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

/** Re-fetches the server component every 4 s while the worker runs; gives up after ~2 minutes. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => { if (++n > 30) clearInterval(t); else router.refresh(); }, 4000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

export function RetryButton({ id, label = 'Try again' }: { id: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  return (
    <>
      <button disabled={pending} onClick={() => start(async () => {
        setErr('');
        const r = await fetch('/api/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: id }) }).catch(() => null);
        if (!r || !r.ok) setErr('Couldn’t start the archive. Please try again.'); else router.refresh();
      })} className="rounded-xl bg-[#2fa66a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a7f4e] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a7f4e]">
        {pending ? 'Starting…' : label}
      </button>
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
    </>
  );
}

export function ReadingProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => { const h = document.documentElement; const max = h.scrollHeight - h.clientHeight; setP(max > 0 ? Math.min(100, (h.scrollTop / max) * 100) : 0); };
    on(); window.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); };
  }, []);
  return <div aria-hidden className="fixed inset-x-0 top-0 z-20 h-0.5 bg-transparent"><div className="h-full bg-[#2fa66a]" style={{ width: `${p}%` }} /></div>;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="not-prose group relative my-6 overflow-hidden rounded-xl border border-[#d8eedf] bg-[#fafdfb]">
      <div className="flex items-center justify-between border-b border-[#e6f4ec] bg-[#f1f9f4] px-3 py-1.5 text-xs text-[#4b5c53]">
        <span className="font-mono uppercase tracking-wide">{lang || 'text'}</span>
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: ignore */ } }}
          className="rounded px-2 py-0.5 font-medium text-[#1a7f4e] hover:bg-[#e6f4ec] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2fa66a]">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter language={lang || 'text'} style={oneLight} PreTag="div" wrapLongLines={false}
        customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '0.85rem', lineHeight: 1.6, overflowX: 'auto' }}
        codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' } }}>
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

const components: Components = {
  // Block code arrives as <pre><code class="language-x">; we render the whole block in `pre` and keep `code` for inline only.
  pre({ children }) {
    const el: any = Array.isArray(children) ? children[0] : children;
    const cls: string = el?.props?.className ?? '';
    const code = String(el?.props?.children ?? '').replace(/\n$/, '');
    return <CodeBlock lang={/language-([\w+#-]+)/.exec(cls)?.[1] ?? ''} code={code} />;
  },
  code({ className, children, ...rest }) {
    return <code className={`rounded bg-[#e6f4ec] px-1.5 py-0.5 font-mono text-[0.9em] text-[#0f6b3e] ${className ?? ''}`} {...rest}>{children}</code>;
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc" className="font-medium text-[#1a7f4e] underline decoration-[#9fd8b8] underline-offset-2 hover:decoration-[#1a7f4e]">{children}</a>;
  },
  img({ src, alt }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="my-6 h-auto max-w-full rounded-xl border border-[#d8eedf]" />;
  },
  table({ children }) { return <div className="my-6 overflow-x-auto"><table className="w-full border-collapse text-sm">{children}</table></div>; },
  th({ children }) { return <th className="border border-[#d8eedf] bg-[#f1f9f4] px-3 py-2 text-left font-semibold text-[#10261c]">{children}</th>; },
  td({ children }) { return <td className="border border-[#d8eedf] px-3 py-2 align-top">{children}</td>; },
  blockquote({ children }) { return <blockquote className="my-6 border-l-4 border-[#4fbf85] bg-white/60 py-1 pl-4 italic text-[#4b5c53]">{children}</blockquote>; },
  h1: ({ children }) => <h2 className="mb-3 mt-10 text-2xl font-bold text-[#10261c]">{children}</h2>,       // one <h1> per page: the title in the header
  h2: ({ children }) => <h2 className="mb-3 mt-10 text-2xl font-bold text-[#10261c]">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-8 text-xl font-semibold text-[#10261c]">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-2 mt-6 text-lg font-semibold text-[#10261c]">{children}</h4>,
  p: ({ children }) => <p className="my-4">{children}</p>,
  ul: ({ children }) => <ul className="my-4 list-disc space-y-1.5 pl-6 marker:text-[#4fbf85]">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 list-decimal space-y-1.5 pl-6 marker:text-[#4fbf85]">{children}</ol>,
  hr: () => <hr className="my-10 border-[#d8eedf]" />,
};

/** No rehype-raw: any HTML in the archived text stays inert text, so a hostile page cannot inject markup into the reader. */
export function MarkdownReader({ markdown }: { markdown: string }) {
  return (
    <div className="text-[1.0625rem] leading-8 text-[#26372e] [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown>
    </div>
  );
}
