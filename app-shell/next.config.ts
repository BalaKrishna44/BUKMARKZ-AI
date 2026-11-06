import type { NextConfig } from 'next';
import { EMBED_SECURITY_HEADERS, STATIC_SECURITY_HEADERS } from './lib/security/csp';

// Merged from dash/next.config.ts. Headers only; the per-request nonce CSP is set in middleware.ts.
const config: NextConfig = {
  output: 'standalone',                       // self-contained server.js for the Docker image (Coolify)
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // sharp, jsdom, tesseract.js, pg and the AWS SDK are Node-only: keep them out of the bundler.
  serverExternalPackages: ['sharp', 'jsdom', 'tesseract.js', 'pg', 'rss-parser', 'sanitize-html'],
  async headers() {
    return [
      { source: '/((?!embed/).*)', headers: [...STATIC_SECURITY_HEADERS] },
      { source: '/embed/:path*', headers: [...EMBED_SECURITY_HEADERS] },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      { source: '/sw-push.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};
export default config;
