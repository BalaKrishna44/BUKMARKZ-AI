// Dry-run by default: reports where kit files land in one Next.js tree and where they collide.
// Usage: node scripts/merge-kits.mjs [--write <outDir>]
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SKIP_KITS = new Set(['extension','ext3','extension-v0-vanilla','extension-v1-knox','photo-backup','back_auth','demo','docs','scripts','qa-suite','migration','supabase','emails','share_kit','mcp-search','logo-pipeline']);
// priority: later wins a collision (the winner is reported, the loser is listed)
const ORDER = ['frontend-kit','pwa-kit','knowledge-os','ai-engine','importexport','enrichment','fx','deepcite','flashcards','snippets','resurface','price-alerts','pricing','media','workspace-ui','auth-suite','growth-kit','team-vaults','plan-gating','i18n-kit','homepage','dash','mobile-pwa','voice-vault','legal-kit','profile-kit'];
const SKIP_DIR = /(^|\/)(node_modules|\.next|dist|test|tests|__tests__|sql|scripts)(\/|$)/;
const CODE = /\.(tsx?|css|json|mjs)$/;
const files = new Map(); // dest -> [{kit, src, hash}]
const add = (kit, src, dest) => { const h = crypto.createHash('md5').update(fs.readFileSync(src)).digest('hex'); (files.get(dest) ?? files.set(dest, []).get(dest)).push({ kit, src, h }); };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const kit of ORDER) {
  const kd = path.join(root, kit); if (!fs.existsSync(kd)) continue;
  for (const f of walk(kd)) {
    let rel = path.relative(kd, f).replaceAll('\\', '/');
    if (SKIP_DIR.test(rel) || (!CODE.test(rel) && !/^public\//.test(rel)) || /\.(test|spec)\./.test(rel) || /package-lock|tsconfig|package\.json$/.test(rel)) continue;
    if (kit === 'plan-gating' && rel.startsWith('knowledge-os-patch/')) rel = rel.slice('knowledge-os-patch/'.length);
    if (/^web\//.test(rel)) rel = 'lib/' + rel.slice(4);
    if (/(^|\/)next\.config\./.test(rel)) continue;                         // merged by hand: see next.config.ts at the root
    if (kit === 'flashcards' && /^lib\/[^/]+\.ts$/.test(rel)) rel = 'lib/flashcards/' + rel.slice(4);   // sm2.ts, generate.ts would otherwise sit at lib/ root
    // Route conflicts that make `next build` fail (two pages for one URL, or [locale] beside [username]):
    if (kit === 'frontend-kit' && rel === 'app/(landing)/page.tsx') rel = 'app/landing-v2/page.tsx';                         // `/` is homepage's
    if (kit === 'frontend-kit' && rel === 'app/(dashboard)/dashboard/page.tsx') rel = 'app/(dashboard)/dashboard-demo/page.tsx'; // `/dashboard` is dash's (real data)
    if (kit === 'i18n-kit' && rel.startsWith('app/[locale]/')) rel = 'app/_i18n-pending/' + rel.slice(4);                         // private folder = not routed; wire up after choosing /[locale] vs /[username]
    if (kit === 'fx') rel = 'lib/fx/' + rel;
    if (kit === 'price-alerts' && rel === 'extension/price-capture.ts') { add(kit, f, rel); continue; }  // shared with the extension build; imported as ../../extension/price-capture
    if (!/^(app|lib|components|hooks|worker|extension|middleware\.ts|i18n|messages|public)/.test(rel) && !/^[a-zA-Z-]+\.(tsx?)$/.test(rel)) rel = `${rel.startsWith('lib')?'':'lib/'+kit+'/'}${rel}`;
    add(kit, f, rel);
  }
}
let same = 0, diff = []; for (const [dest, v] of files) if (v.length > 1) (new Set(v.map(x => x.h)).size === 1 ? same++ : diff.push([dest, v.map(x => x.kit)]));
console.log(`files: ${files.size}  identical dups: ${same}  DIFFERING collisions: ${diff.length}`);
for (const [d, k] of diff) console.log(`  ${d}  <- ${k.join(' < ')}`);
const out = process.argv.indexOf('--write') > 0 ? process.argv[process.argv.indexOf('--write') + 1] : null;
if (out) for (const [dest, v] of files) { const w = v[v.length - 1], t = path.join(out, dest); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(w.src, t); }
