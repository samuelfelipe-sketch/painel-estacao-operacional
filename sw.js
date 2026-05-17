const CACHE_NAME = 'painel-es-v1';
const ASSETS = [
  './painel-operacional-mobile.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.map(key => key !== CACHE_NAME && caches.delete(key)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request)
      .then(r => r || fetch(e.request))
      .catch(() => caches.match('./painel-operacional-mobile.html'))
  );
});
