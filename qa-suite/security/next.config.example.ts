// Merge into next.config.ts
import type { NextConfig } from 'next';
import { STATIC_SECURITY_HEADERS } from './security/csp';

const config: NextConfig = {
  poweredByHeader: false,                                              // no "X-Powered-By: Next.js"
  productionBrowserSourceMaps: false,                                  // never ship source maps (they expose server-adjacent code and comments)
  async headers() {
    return [
      { source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};
export default config;
