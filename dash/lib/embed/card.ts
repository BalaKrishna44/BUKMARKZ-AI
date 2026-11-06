import { SITE } from '../stacks/public';

/** SVG card renderer (kept out of the route file: Next only allows HTTP methods and config exports there). */
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const PAL = {
  dark: { bg: '#0c1511', card: '#13201a', line: '#233a2f', ink: '#eaf7f0', mut: '#9db8aa', acc: '#6ee7a8' },
  light: { bg: '#ffffff', card: '#f4f7f5', line: '#dbe5df', ink: '#10261c', mut: '#566b60', acc: '#17693f' },
};

export function renderCard(s: { title: string; handle: string; slug: string; items: { title: string; url: string }[] }, theme: 'dark' | 'light', limit: number, site = SITE): string {
  const c = PAL[theme], rows = s.items.slice(0, limit), W = 560, rowH = 40, top = 62, h = top + rows.length * rowH + (s.items.length > rows.length ? 26 : 0) + 44;
  const font = `system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
  const items = rows.map((it, i) => {
    const y = top + i * rowH;
    return `<rect x="16" y="${y}" width="528" height="34" rx="9" fill="${c.card}" stroke="${c.line}"/>`
      + `<text x="28" y="${y + 21}" font-size="13" font-weight="600" fill="${c.ink}">${esc(clip(it.title, 52))}</text>`
      + `<text x="544" y="${y + 21}" font-size="11" fill="${c.mut}" text-anchor="end" transform="translate(-12 0)">${esc(clip(host(it.url), 22))}</text>`;
  }).join('');
  const more = s.items.length > rows.length ? `<text x="28" y="${top + rows.length * rowH + 16}" font-size="12" fill="${c.mut}">+ ${s.items.length - rows.length} more on Bukmarkz</text>` : '';
  const fy = h - 18;
  const label = `${s.title}, a Bukmarkz stack by @${s.handle} with ${s.items.length} links`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(clip(label, 160))}">`
    + `<title>${esc(clip(label, 160))}</title><g font-family="${font}">`
    + `<rect width="${W}" height="${h}" rx="14" fill="${c.bg}" stroke="${c.line}"/>`
    + `<text x="16" y="30" font-size="16" font-weight="700" fill="${c.ink}">${esc(clip(s.title, 48))}</text>`
    + `<text x="16" y="48" font-size="12" fill="${c.mut}">@${esc(s.handle)} · ${s.items.length} link${s.items.length === 1 ? '' : 's'} · ${esc(site.replace(/^https?:\/\//, ''))}/s/${esc(s.slug)}</text>`
    + items + more
    + `<line x1="16" y1="${h - 36}" x2="544" y2="${h - 36}" stroke="${c.line}"/>`
    + `<path d="M209 ${fy - 11}l-8 11h6l-2 8 8-11h-6z" fill="${c.acc}"/>`                           // the bolt, drawn (an emoji would depend on the viewer's fonts)
    + `<text x="221" y="${fy + 4}" font-size="12" font-weight="600" fill="${c.acc}">Powered by Bukmarkz AI Vault</text>`
    + `</g></svg>`;
}

