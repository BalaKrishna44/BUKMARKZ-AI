import { slugify, baseSlug, validSlug, withSuffix, HANDLE_RE } from '../lib/stacks/slug';
import { THEMES, THEME_NAMES, contrast, isTheme, themeOf } from '../lib/stacks/themes';
import { parseStack } from '../lib/stacks/public';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };

ok(slugify('Best AI Tools for Devs (2026)!') === 'best-ai-tools-for-devs-2026', 'slugify basic');
ok(slugify('Café & Crème — Été') === 'cafe-and-creme-ete', 'accents folded, & -> and');
ok(slugify('  --Hello___World--  ') === 'hello-world' && slugify('x'.repeat(100)).length === 48, 'trim, collapse, max length');
ok(slugify('日本語のスタック') === '' && /^stack-[a-z0-9]{5}$/.test(baseSlug('日本語のスタック')), 'non-Latin title -> random fallback slug');
ok(baseSlug('Fork', () => 'q1w2e') === 'stack-q1w2e' && baseSlug('New', () => 'q1w2e') === 'stack-q1w2e', 'reserved words never become slugs');
ok(baseSlug('My Stack', () => 'zzzzz') === 'my-stack', 'normal title');
ok(validSlug('my-stack') && validSlug('a1b') && !validSlug('ab') && !validSlug('-a-b') && !validSlug('a--b') && !validSlug('A-b') && !validSlug('a b c') && !validSlug('x'.repeat(61)) && !validSlug('admin') && !validSlug('../etc'), 'slug validation');
ok(withSuffix('my-stack', () => 'ab12') === 'my-stack-ab12' && withSuffix('x'.repeat(60), () => 'ab12').length <= 60 && validSlug(withSuffix('my-stack')), 'suffix keeps slug valid and <= 60');
ok(HANDLE_RE.test('alice_1') && !HANDLE_RE.test('Al') && !HANDLE_RE.test('a b') && !HANDLE_RE.test('x'.repeat(21)), 'handle rules (same as SQL check)');

// themes: text must be readable on BOTH gradient stops, accent too (WCAG AA 4.5:1)
for (const n of THEME_NAMES) {
  const t = THEMES[n];
  const worst = (fg: string) => Math.min(contrast(fg, t.from), contrast(fg, t.to));
  ok(worst(t.ink) >= 7, `${n}: ink on cover >= 7:1 (${worst(t.ink).toFixed(1)})`);
  ok(worst(t.muted) >= 4.5, `${n}: muted text on cover >= 4.5:1 (${worst(t.muted).toFixed(1)})`);
  ok(worst(t.accent) >= 4.5, `${n}: accent on cover >= 4.5:1 (${worst(t.accent).toFixed(1)})`);
}
ok(contrast('#000000', '#ffffff') > 20.9 && contrast('#ffffff', '#ffffff') === 1, 'contrast function sanity');
ok(isTheme('mint') && !isTheme('red') && !isTheme(null) && themeOf('nope') === THEMES.mint, 'theme guards');

// public data parsing is defensive
const good = { slug: 'a-b', title: 'T', handle: 'al', description: 'd', theme: 'ocean', created_at: '2026-01-01', updated_at: '2026-01-02', fork_count: 3, items: [{ title: 'x', url: 'https://x.com', blurb: null }] };
ok(parseStack(good)?.items.length === 1 && parseStack(good)?.theme === 'ocean', 'parses a good stack');
ok(parseStack(null) === null && parseStack('x') === null && parseStack({ slug: 1 }) === null && parseStack({ ...good, handle: undefined }) === null, 'malformed -> null');
const evil = parseStack({ ...good, theme: 'hacker', items: [{ title: 'a', url: 'javascript:alert(1)' }, { title: 'b', url: 'data:text/html,x' }, { title: 'c', url: 'HTTPS://ok.com' }, { url: 'http://no-title.com' }, null, 5, { title: 'long', url: 'https://' + 'a'.repeat(3000) }] });
ok(evil?.theme === 'mint' && evil.items.map((i) => i.url).join() === 'HTTPS://ok.com,http://no-title.com,https://' + 'a'.repeat(2040), 'javascript:/data: links dropped, bad theme -> mint, urls capped');
ok(evil!.items[1].title === 'http://no-title.com', 'missing title falls back to URL');
ok(parseStack({ ...good, items: Array.from({ length: 80 }, (_, i) => ({ title: 't' + i, url: 'https://e.com/' + i })) })!.items.length === 50, 'items capped at 50');

// middleware matcher: public stack pages and OG images skip the auth round-trip; fork, dashboard and others do not
const m = new RegExp('^' + '/((?!_next/static|_next/image|favicon.ico|s/[^/]+(?:/opengraph-image[^/]*)?$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)' + '$');
ok(!m.test('/s/my-stack') && !m.test('/s/my-stack/opengraph-image') && !m.test('/s/my-stack/opengraph-image-1a2b3c'), 'matcher skips /s/<slug> and its OG image');
ok(m.test('/s/my-stack/fork') && m.test('/dashboard') && m.test('/login') && m.test('/api/stacks') && m.test('/'), 'matcher still runs for fork, dashboard, login, API');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
