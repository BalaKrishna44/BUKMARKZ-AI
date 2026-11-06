import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard', name: 'Bukmarkz Knowledge Vault', short_name: 'Bukmarkz',
    description: 'The AI vault that remembers your links and answers questions about them.',
    start_url: '/dashboard?source=pwa', scope: '/', display: 'standalone',
    background_color: '#020617', theme_color: '#10b981',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    share_target: { action: '/api/vault/share-target', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
  } as MetadataRoute.Manifest;
}
