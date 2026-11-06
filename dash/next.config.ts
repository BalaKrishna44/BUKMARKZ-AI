import type { NextConfig } from 'next';
import { EMBED_SECURITY_HEADERS, STATIC_SECURITY_HEADERS } from './lib/security/csp';

const config: NextConfig = {
  poweredByHeader: false,                    // no "X-Powered-By: Next.js"
  productionBrowserSourceMaps: false,        // never ship source maps
  async headers() {
    return [
      { source: '/((?!embed/).*)', headers: [...STATIC_SECURITY_HEADERS] },                 // everything except /embed/*: X-Frame-Options DENY
      { source: '/embed/:path*', headers: [...EMBED_SECURITY_HEADERS] },                   // widgets may be framed by other sites (the CSP restricts to https)
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      // The push worker must always be fetched fresh, or users can run a stale worker for a day.
      { source: '/sw-push.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};
export default config;
