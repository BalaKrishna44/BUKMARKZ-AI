// Bundles test/unit.test.ts with esbuild and runs it with node's built-in test runner.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.test-build/unit.test.mjs');
mkdirSync(dirname(out), { recursive: true });
await build({ entryPoints: [resolve(root, 'test/unit.test.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'warning' });
execFileSync(process.execPath, ['--test', out], { stdio: 'inherit' });
