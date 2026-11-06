import test from 'node:test'; import assert from 'node:assert/strict';
import { isIndexable, stackMetadata, stackJsonLd, safeJson, sitemapEntries, ogText, stackDescription, STACK_LINK_REL, type PublicStack } from '../lib/seo/stack-seo';
const mk = (n: number, o: Partial<PublicStack> = {}): PublicStack => ({ slug: 'pg-tools', title: 'Postgres toolkit', description: null, handle: 'alice', items: Array.from({ length: n }, (_, i) => ({ title: `Link ${i}`, url: `https://e.com/${i}` })), ...o });
test('thin stacks are noindex (but follow); full stacks are indexed', () => {
  assert.equal((stackMetadata(mk(2)) as any).robots.index, false);
  assert.equal((stackMetadata(mk(3)) as any).robots.index, true);
  assert.equal(isIndexable(mk(3, { title: 'ab' })), false);
});
test('missing stack: noindex, nofollow', () => { assert.deepEqual((stackMetadata(null) as any).robots, { index: false, follow: false }); });
test('canonical + titles are bounded', () => {
  const m = stackMetadata(mk(5, { title: 'x'.repeat(200) })) as any;
  assert.match(m.alternates.canonical, /\/s\/pg-tools$/); assert.ok(m.title.length <= 70); assert.ok(m.description.length <= 160);
});
test('auto description names the first links', () => { assert.match(stackDescription(mk(4)), /Link 0, Link 1, Link 2/); });
test('user links are ugc/nofollow', () => { for (const w of ['ugc', 'nofollow', 'noopener', 'noreferrer']) assert.ok(STACK_LINK_REL.includes(w)); });
test('JSON-LD matches visible items and cannot break out of the script tag', () => {
  const ld = stackJsonLd(mk(3, { title: '</script><script>alert(1)</script>' }));
  assert.equal(ld.numberOfItems, 3); assert.equal(ld.itemListElement[2].position, 3);
  assert.ok(!safeJson(ld).includes('</script>'));
});
test('sitemap drops malformed slugs', () => {
  const e = sitemapEntries([{ slug: 'ok-slug', updated_at: '2026-01-01T00:00:00Z' }, { slug: '../etc', updated_at: '2026-01-01T00:00:00Z' }, { slug: 'Bad_Slug', updated_at: '2026-01-01T00:00:00Z' }]);
  assert.equal(e.length, 1); assert.match(e[0].url, /\/s\/ok-slug$/);
});
test('og text is bounded and singular/plural correct', () => {
  const o = ogText(mk(1, { title: 'y'.repeat(300) }));
  assert.ok(o.title.length <= 60); assert.equal(o.count, '1 link'); assert.equal(ogText(mk(2)).count, '2 links');
});
test('safeJson strips U+2028/2029 and escapes <, but leaves normal text intact', () => {
  const sep = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
  const out = safeJson({ a: 'x' + sep + 'y', b: '<b>' });
  assert.ok(!out.includes(String.fromCharCode(0x2028)) && !out.includes(String.fromCharCode(0x2029)));
  assert.ok(out.includes('\\u003cb>')); assert.ok(out.includes('xy'));
  assert.equal(safeJson({ t: 'u2028 stays' }), '{"t":"u2028 stays"}');
});
