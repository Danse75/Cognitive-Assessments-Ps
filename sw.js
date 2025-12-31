/* Service Worker (offline) – compatible con el nuevo index (sin Babel y sin videos) */
const CACHE = 'efx-cache-v3.1'; // Sube esta versión cuando quieras forzar actualización

// Archivos que realmente usa el nuevo index
const CORE_ASSETS = [
  './',
  './index.html',
  './sw.js',
];

// CDNs usados por el index (se cachean como "opaque" con no-cors)
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.development.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.development.js',
];

// Precaching robusto (uno por uno; si falla uno, no tumba todo)
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    const all = [...CORE_ASSETS, ...CDN_ASSETS];
    for (const u of all) {
      try {
        const isRemote = /^https?:\/\//i.test(u);
        const req = isRemote
          ? new Request(u, { mode: 'no-cors' })
          : new Request(u, { cache: 'reload' });
        await cache.add(req);
      } catch (e) {
        // Precache parcial está permitido; seguimos
        // (Esto es normal si el CDN está bloqueado en el primer load)
        // console.warn('Precache omitido:', u, e);
      }
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

  // Sólo manejamos GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Navegación (HTML): network-first, fallback a index cacheado
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          // Guardamos tanto la request real como index.html para asegurar fallback
          cache.put(req, fresh.clone()).catch(() => {});
          cache.put('./index.html', fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        // Offline: devolvemos index cacheado
        const cached = await cache.match('./index.html', { ignoreSearch: true });
        if (cached) return cached;

        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Offline</title><p>Sin conexión. Intenta de nuevo cuando vuelva el Internet.</p>',
          { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
        );
      }
    })());
    return;
  }

  // 2) Resto de recursos: cache-first + actualización en segundo plano (SWR)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    // Si hay caché, devolvemos caché y actualizamos en segundo plano
    if (cached) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && (fresh.ok || fresh.type === 'opaque')) {
            await cache.put(req, fresh.clone());
          }
        } catch {}
      })());
      return cached;
    }

    // Si no hay caché, intentamos red y guardamos
    try {
      const fresh = await fetch(req);
      if (fresh && (fresh.ok || fresh.type === 'opaque')) {
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch {
      // No hay red y no había caché
      return new Response('', { status: 204 });
    }
  })());
});
