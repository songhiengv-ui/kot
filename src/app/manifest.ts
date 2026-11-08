import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kat · កត់', short_name: 'កត់', description: 'All your banks and cash in one place — just speak Khmer.',
    lang: 'km', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait',
    background_color: '#F4F2EC', theme_color: '#F4F2EC',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
