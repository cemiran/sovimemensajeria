// Service worker: shell offline + red primero para la API.
const CACHE = 'um-v10';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/manifest.json', '/icon.svg', '/img/logo.png', '/img/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/tiles/')) return; // API: cola offline; mapas: caché del navegador
  if (url.origin === location.origin || url.hostname.includes('unpkg.com') || url.hostname.includes('jsdelivr') || url.hostname.includes('cdnjs') || url.hostname.includes('fonts.g')) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r.ok && !url.hostname.includes('tile')) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return r;
        })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
    );
  }
});
