import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSnippets, escapeHtmlAttr, escapeMdText, embedHeight } from '../lib/embed/snippets';
import { renderCard } from '../lib/embed/card';
import { buildCsp, EMBED_SECURITY_HEADERS, STATIC_SECURITY_HEADERS } from '../lib/security/csp';

const S = { slug: 'ai-dev-2026', title: 'Top AI Developer Resources 2026', itemCount: 8, site: 'https://bukmarkz.com' };
const n = 'dGVzdG5vbmNlMTIzNDU2Nzg=';
const dir = (csp: string, name: string) => csp.split('; ').find((p) => p.startsWith(name + ' '))?.split(' ').slice(1) ?? [];

test('snippets: iframe, markdown, html image, notion', () => {
  const x = buildSnippets({ ...S, theme: 'dark', limit: 4 });
  assert.equal(x.embedUrl, 'https://bukmarkz.com/embed/ai-dev-2026?theme=dark&limit=4');
  assert.match(x.iframe, /^<iframe src="https:\/\/bukmarkz\.com\/embed\/ai-dev-2026\?theme=dark&amp;limit=4"/);
  assert.match(x.iframe, /sandbox="allow-popups allow-popups-to-escape-sandbox"/);
  assert.equal(x.markdown, '[![Top AI Developer Resources 2026 on Bukmarkz](https://bukmarkz.com/embed/ai-dev-2026/card.svg?theme=dark&limit=4)](https://bukmarkz.com/s/ai-dev-2026)');
  assert.match(x.htmlImage, /^<a href="https:\/\/bukmarkz\.com\/s\/ai-dev-2026"><img src=".*card\.svg/);
  assert.equal(x.notion, x.embedUrl);
  assert.equal(buildSnippets(S).embedUrl, 'https://bukmarkz.com/embed/ai-dev-2026');
});
test('snippets: hostile titles and slugs cannot break out', () => {
  const x = buildSnippets({ ...S, title: 'x" onload="alert(1)"><script>y</script>' });
  assert.ok(!/<script/.test(x.iframe + x.htmlImage) && !/" onload="/.test(x.iframe + x.htmlImage));
  const m = buildSnippets({ ...S, title: '](https://evil.com) ![a' }).markdown;
  assert.ok(m.startsWith('[![\\]\\(https://evil.com\\) \\!\\[a on Bukmarkz](') && m.endsWith('(https://bukmarkz.com/s/ai-dev-2026)'), m);
  for (const bad of ['../x', 'a b', 'ab', 'login', 'x"y']) assert.throws(() => buildSnippets({ ...S, slug: bad }));
  assert.equal(escapeHtmlAttr(`a&"'<>`), 'a&amp;&quot;&#39;&lt;&gt;'); assert.equal(escapeMdText('a\nb[c]'), 'a b\\[c\\]');
});
test('height grows with items, then caps', () => { assert.ok(embedHeight(1) < embedHeight(3) && embedHeight(6) === embedHeight(40) && embedHeight(10, 2) === embedHeight(2)); });

const stack = { title: 'A <b>&"x"</b> ' + 'long '.repeat(30), handle: 'maya', slug: 'ai-dev-2026', items: Array.from({ length: 9 }, (_, i) => ({ title: `Item ${i} </text><script>x</script>`, url: `https://www.site${i}.com/p` })) };
test('svg card: valid, escaped, watermark, limits', () => {
  const svg = renderCard(stack, 'dark', 5);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(!/<script|<b>|<\/text><script/i.test(svg), 'no injected elements');
  assert.ok(svg.includes('Powered by Bukmarkz AI Vault'));
  assert.equal((svg.match(/<rect x="16"/g) ?? []).length, 5);
  assert.ok(svg.includes('+ 4 more on Bukmarkz'));
  assert.ok(!/<image|href=|foreignObject|<style|@import|font-face/i.test(svg), 'self-contained: nothing external or scriptable');
  assert.notEqual(renderCard(stack, 'light', 5), svg);
  assert.ok(renderCard({ ...stack, items: [stack.items[0]] }, 'dark', 5).includes('1 link '));
  const open = (svg.match(/<(\w+)[\s>]/g) ?? []).length; assert.ok(open > 5);
});
test('csp: only embed pages can be framed (https sites only)', () => {
  assert.deepEqual(dir(buildCsp({ nonce: n }), 'frame-ancestors'), ["'none'"]);
  assert.deepEqual(dir(buildCsp({ nonce: n, embed: true }), 'frame-ancestors'), ['https:']);
  assert.ok(dir(buildCsp({ nonce: n, embed: true, isDev: true }), 'frame-ancestors').includes('http://localhost:*'));
  const e = buildCsp({ nonce: n, embed: true }); assert.ok(!dir(e, 'script-src').includes("'unsafe-inline'") && dir(e, 'object-src')[0] === "'none'");
  assert.ok(!EMBED_SECURITY_HEADERS.some((h) => h.key === 'X-Frame-Options') && STATIC_SECURITY_HEADERS.some((h) => h.key === 'X-Frame-Options'));
  assert.equal(EMBED_SECURITY_HEADERS.length, STATIC_SECURITY_HEADERS.length - 1);
});
