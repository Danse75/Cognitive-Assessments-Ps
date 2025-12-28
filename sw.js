/* Service Worker para modo offline y caché de recursos básicos */
const CACHE = 'efx-cache-v3';
const ASSETS = [
  './',
  './index.html',
  './sw.js',
  // CDNs que usamos (se almacenan como respuestas "opaque")
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.development.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.development.js',
  'https://unpkg.com/@babel/standalone/babel.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const requests = ASSETS.map(u => {
        try {
          const isRemote = /^https?:\/\//i.test(u);
          return isRemote ? new Request(u, { mode: 'no-cors' }) : u;
        } catch { return u; }
      });
      await cache.addAll(requests);
    } catch (e) {
      console.warn('Precache parcial:', e);
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate' || (req.destination === 'document')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        const cached = await cache.match('./index.html');
        if (cached) return cached;
        return new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p>Sin conexión. Intenta de nuevo cuando vuelva el Internet.</p>', {headers:{'Content-Type':'text/html; charset=UTF-8'}});
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) {
      fetch(req).then(res => { if (res && (res.ok || res.type==='opaque')) cache.put(req, res.clone()); }).catch(()=>{});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type==='opaque')) cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', {status: 204});
    }
  })());
});
