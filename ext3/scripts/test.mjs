// Bundles test/unit.test.ts with esbuild and runs it with node's built-in test runner.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.test-build/x');
mkdirSync(dirname(out), { recursive: true });
await build({ entryPoints: [resolve(root, 'test/unit.test.ts'), resolve(root, 'test/feed.test.ts'), resolve(root, 'test/ingest.test.ts'), resolve(root, 'test/sync.test.ts')], outdir: resolve(root, '.test-build'), bundle: true, format: 'esm', outExtension: { '.js': '.js' }, platform: 'node', target: 'node20', alias: { '@/lib/import/normalize': resolve(root, 'test/vendor/normalize.ts') }, logLevel: 'warning' });
execFileSync(process.execPath, ['--test', resolve(root, '.test-build/unit.test.js'), resolve(root, '.test-build/feed.test.js'), resolve(root, '.test-build/ingest.test.js'), resolve(root, '.test-build/sync.test.js')], { stdio: 'inherit' });
