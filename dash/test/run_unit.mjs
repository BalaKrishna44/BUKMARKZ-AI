import { build } from '/tmp/vsb/node_modules/esbuild/lib/main.js';
await build({ entryPoints: ['/tmp/live/t/unit.test.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '/tmp/live/t/unit.mjs', logLevel: 'error' });
