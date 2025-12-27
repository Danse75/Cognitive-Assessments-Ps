// sw.js — listo para GitHub Pages
const VERSION = 'efx-v1';

// Base path del repo en GitHub Pages, deducido del propio SW:
// ej.: /Cognitive-Assessments-Ps/
const BASE_PATH = self.location.pathname.replace(/sw\.js$/, '');
const INDEX_HTML = BASE_PATH + 'index_with_moves.html';

const ASSETS = [
  INDEX_HTML,
  BASE_PATH + 'sw.js',
  // CDNs que usa tu HTML (se guardan como respuestas "opaque", válidas offline)
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.development.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.development.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k === VERSION ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

// Estrategias:
// - Navegaciones (HTML): network-first con fallback al INDEX_HTML cacheado.
// - Otros GET: cache-first con actualización en segundo plano.
// - No interceptamos POST (Apps Script).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Deja pasar los POST sin tocar (envíos a Apps Script)
  if (req.method !== 'GET') return;

  // Navegaciones (páginas)
  const isNavigation = req.mode === 'navigate' || (req.destination === 'document');
  if (isNavigation) {
    event.respondWith(
      fetch(req).then(res => {
        // cachea copia
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
        return res;
      }).catch(() =>
        caches.match(req).then(r => r || caches.match(INDEX_HTML))
      )
    );
    return;
  }

  // Otros GET: cache-first + revalidate
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
        return res;
      }).catch(() => cached || Promise.reject('offline'));
      return cached || fetchPromise;
    })
  );
});
