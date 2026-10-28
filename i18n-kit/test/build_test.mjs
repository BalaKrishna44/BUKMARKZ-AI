import { build } from '/tmp/vsb/node_modules/esbuild/lib/main.js';
await build({ entryPoints: ['test/i18n.test.ts', 'test/middleware.test.ts'], bundle: true, platform: 'node', format: 'esm', outdir: 'test/out', logLevel: 'error',
  alias: { 'next/server': './test/stubs.ts', '@/lib/supabase/middleware': './test/stub_updatesession.ts' }, external: ['node:*'] });
