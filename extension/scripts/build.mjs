// Bundles the extension into ./dist. Usage: npm run build
// Optional env for local testing:
//   BUKMARKZ_WEB="https://www.bukmarkz.test,https://bukmarkz.test"   (also rewrites manifest hosts)
//   BUKMARKZ_API="https://api.bukmarkz.test"
//   BUKMARKZ_EXTRA_HOSTS="https://site.test"   (extra host_permissions so tests can inject the overlay without a keypress)
//   POPUP_CSS_PREBUILT=/path/to.css    (skip the Tailwind CLI and use this file)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const web = process.env.BUKMARKZ_WEB?.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const api = process.env.BUKMARKZ_API?.replace(/\/+$/, '');
const define = {
  'process.env.NODE_ENV': '"production"',
  ...(web ? { __WEB_ORIGINS__: JSON.stringify(web) } : {}),
  ...(api ? { __API_BASE__: JSON.stringify(api) } : {}),
  __TEST_HOOKS__: process.env.BUKMARKZ_TEST_HOOKS ? 'true' : 'false',
};
const common = { bundle: true, minify: process.env.NO_MINIFY ? false : true, sourcemap: false, target: 'chrome114', define, logLevel: 'warning', jsx: 'automatic' };

await Promise.all([
  build({ ...common, entryPoints: [resolve(root, 'src/background/background.ts')], outfile: resolve(dist, 'service-worker.js'), format: 'esm' }),
  build({ ...common, entryPoints: [resolve(root, 'src/content/bridge.ts')], outfile: resolve(dist, 'bridge.js'), format: 'iife' }),
  build({ ...common, entryPoints: [resolve(root, 'src/content/overlay.ts')], outfile: resolve(dist, 'overlay.js'), format: 'iife' }),
  build({ ...common, entryPoints: [resolve(root, 'src/popup/main.tsx')], outfile: resolve(dist, 'popup.js'), format: 'iife' }),
]);

// popup CSS
const cssOut = resolve(dist, 'popup.css');
if (process.env.POPUP_CSS_PREBUILT) cpSync(process.env.POPUP_CSS_PREBUILT, cssOut);
else execFileSync(resolve(root, 'node_modules/.bin/tailwindcss'), ['-c', resolve(root, 'tailwind.config.js'), '-i', resolve(root, 'src/popup/popup.css'), '-o', cssOut, '--minify'], { stdio: 'inherit', cwd: root });

cpSync(resolve(root, 'src/popup/popup.html'), resolve(dist, 'popup.html'));
if (existsSync(resolve(root, 'icons'))) cpSync(resolve(root, 'icons'), resolve(dist, 'icons'), { recursive: true });

const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
if (web || api) {
  const hosts = [...(web ?? []), ...(api ? [api] : [])].map((o) => `${o}/*`);
  manifest.host_permissions = [...hosts, ...(process.env.BUKMARKZ_EXTRA_HOSTS?.split(',').filter(Boolean).map((h) => `${h.trim().replace(/\/+$/, '')}/*`) ?? [])];
  manifest.content_scripts[0].matches = (web ?? []).map((o) => `${o}/*`);
  manifest.name += ' (dev)';
}
writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('built ->', dist);
