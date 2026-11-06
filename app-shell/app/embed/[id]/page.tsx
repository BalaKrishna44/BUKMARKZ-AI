import { notFound } from 'next/navigation';
import { getPublicStack, SITE } from '@/lib/stacks/public';
import { validSlug } from '@/lib/stacks/slug';

/**
 * /embed/<slug>?theme=dark|light&limit=1..50   (the `id` segment is the stack's public slug)
 *
 * Built to load fast inside an iframe: a pure server component, no client JavaScript of its own, no fonts to download, no images, inline CSS only.
 * It reads through the anonymous get_public_stack() RPC (no cookies), so it is cached (ISR) and a widget on a busy page costs almost nothing.
 * Private, blocked and unknown stacks are all the same 404. Framing by other sites is allowed only for this route family (see lib/security/csp.ts).
 * The footer badge is part of the page, pinned to the bottom of the frame; the "Powered by" link carries utm_source=embed so you can count signups from it.
 */
export const revalidate = 300;
type Search = { theme?: string; limit?: string };
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

const CSS = `
body{margin:0}
.w{--bg:#fff;--card:#f4f7f5;--line:#dbe5df;--ink:#10261c;--mut:#566b60;--acc:#17693f;min-height:100vh;height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.w.dark{--bg:#0c1511;--card:#13201a;--line:#233a2f;--ink:#eaf7f0;--mut:#9db8aa;--acc:#6ee7a8}
@media (prefers-color-scheme:dark){.w.auto{--bg:#0c1511;--card:#13201a;--line:#233a2f;--ink:#eaf7f0;--mut:#9db8aa;--acc:#6ee7a8}}
.w *{box-sizing:border-box}
.w header{padding:12px 14px 8px}.w h1{margin:0;font-size:15px;line-height:1.25;overflow-wrap:anywhere}.w header p{margin:2px 0 0;font-size:12px;color:var(--mut)}
.w main{flex:1;min-height:0;overflow-y:auto;padding:0 14px 8px;display:grid;gap:8px;align-content:start}
.w a.c{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 11px;color:inherit;text-decoration:none;min-width:0}
.w a.c:hover,.w a.c:focus-visible{border-color:var(--acc);outline:none}
.w a.c b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.w a.c span{display:block;font-size:12px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.w footer{border-top:1px solid var(--line);background:var(--bg);padding:9px 14px;text-align:center;font-size:12px}
.w footer a{color:var(--acc);font-weight:600;text-decoration:none}.w footer a:hover{text-decoration:underline}
`;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = validSlug((await params).id.toLowerCase()) ? await getPublicStack((await params).id.toLowerCase()) : null;
  return { title: s ? `${s.title}` : 'Bukmarkz stack' };
}

export default async function EmbedPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const slug = (await params).id.toLowerCase();
  if (!validSlug(slug)) notFound();
  const stack = await getPublicStack(slug);
  if (!stack) notFound();
  const sp = await searchParams;
  const theme = sp.theme === 'dark' || sp.theme === 'light' ? sp.theme : 'auto';
  const n = Number(sp.limit);
  const items = stack.items.slice(0, Number.isInteger(n) && n >= 1 && n <= 50 ? n : 50);
  const home = `${SITE}/s/${stack.slug}`;

  return (
    <div className={`w ${theme}`}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header>
        <h1>{stack.title}</h1>
        <p>@{stack.handle} · {stack.items.length} link{stack.items.length === 1 ? '' : 's'}</p>
      </header>
      <main>
        {items.map((it, i) => (
          // nofollow + ugc: user-supplied outbound links. target=_blank keeps the host page where it is (the iframe is usually sandboxed).
          <a key={`${i}-${it.url}`} className="c" href={it.url} target="_blank" rel="nofollow ugc noopener noreferrer">
            <b>{it.title}</b><span>{it.blurb || hostOf(it.url)}</span>
          </a>
        ))}
        {stack.items.length > items.length && <a className="c" href={home} target="_blank" rel="noopener"><span>+ {stack.items.length - items.length} more on Bukmarkz</span></a>}
      </main>
      <footer>
        <a href={`${home}?utm_source=embed&utm_medium=widget`} target="_blank" rel="noopener">⚡ Powered by Bukmarkz AI Vault</a>
      </footer>
    </div>
  );
}
