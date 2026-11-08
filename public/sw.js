// Shell cache only. Never caches API responses, Supabase data, or pages — financial data stays network-only.
// Hashed build assets and fonts: cache-first. Navigations: network, falling back to /offline.html.
const CACHE = 'kat-v1'  // bump to drop old entries (ponytail: hashed assets accumulate until a bump)
const PRECACHE = ['/offline.html', '/fonts/material-symbols.woff2', '/icon-192.png']

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE))); self.skipWaiting() })
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')))
  } else if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
      return res
    })))
  }
})
