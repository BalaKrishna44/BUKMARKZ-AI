import type { MetadataRoute } from 'next';

/** Overrides pwa-kit's manifest: starts in the mobile app (/m), brand colours, home-screen shortcuts. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/m', name: 'Bukmarkz', short_name: 'Bukmarkz',
    description: 'Save links once. Find them by meaning.',
    start_url: '/m?source=pwa', scope: '/', display: 'standalone', orientation: 'portrait',
    background_color: '#0e2a1c', theme_color: '#0e2a1c', categories: ['productivity', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Save a link', short_name: 'Save', url: '/m/save', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Stacks', url: '/m/stacks' },
    ],
    // Android Chrome/Edge only, and only once installed. The route redirects to /m/save; it never saves by itself.
    share_target: { action: '/api/vault/share-target', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
  } as MetadataRoute.Manifest;
}
