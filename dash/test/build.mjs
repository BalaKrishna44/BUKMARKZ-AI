import { compile } from '/tmp/vsb/node_modules/tailwindcss/dist/lib.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { build } from '/tmp/vsb/node_modules/esbuild/lib/main.js';
const files = ['/tmp/live/dash/app/dashboard/BookmarkFeedView.tsx', '/tmp/live/dash/app/login/LoginForm.tsx', '/tmp/live/t/entry.tsx'];
const cands = new Set(files.map((f) => fs.readFileSync(f, 'utf8')).join('\n').match(/[^\s"'`<>{}]+/g));
const c = await compile('@import "tailwindcss";', { base: '/tmp/vsb/node_modules/tailwindcss', loadStylesheet: async (id, base) => { const p = id === 'tailwindcss' ? '/tmp/vsb/node_modules/tailwindcss/index.css' : path.resolve(base, id); return { path: p, base: path.dirname(p), content: fs.readFileSync(p, 'utf8') }; } });
const alias = { '@/lib/supabase/client': '/tmp/live/t/supa.ts', '@/lib/syncLoginToExtension': '/tmp/live/t/sync_stub.ts', '@/lib/bookmarks': '/tmp/live/dash/lib/bookmarks.ts' };
for (const [entry, out] of [['/tmp/live/t/entry.tsx', 'dash'], ['/tmp/live/t/login_entry.tsx', 'login']]) {
  await build({ entryPoints: [entry], bundle: true, outfile: `/tmp/live/t/${out}.js`, jsx: 'automatic', nodePaths: ['/tmp/vsb/node_modules'], alias, define: { 'process.env.NODE_ENV': '"production"' }, minify: true, logLevel: 'error' });
  fs.writeFileSync(`/tmp/live/t/${out}.html`, '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>' + c.build([...cands]) + `</style><div id=r></div><script src=${out}.js></script>`);
}
console.log('built');
