/* Service Worker para modo offline + caché (incluye videos) */
const CACHE = 'efx-cache-v3.1'; // <-- SUBIMOS la versión para forzar actualización

// Ajusta estos nombres si tus archivos se llaman distinto o están en otra carpeta
const VIDEO_ASSETS = [
  './videos/stroop.mp4',
  './videos/hanoi.mp4',
  './videos/corsi.mp4',
  './videos/digit.mp4',
];

const ASSETS = [
  './',
  './index.html',
  './sw.js',
  ...VIDEO_ASSETS,

  // CDNs (se almacenan como respuestas "opaque")
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.development.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.development.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    try {
      const requests = ASSETS.map((u) => {
        const isRemote = /^https?:\/\//i.test(u);
        // Para remotos: no-cors; para locales: normal
        return isRemote ? new Request(u, { mode: 'no-cors' }) : new Request(u);
      });

      await cache.addAll(requests);
    } catch (e) {
      // Si un recurso falla, no tumbamos toda la instalación
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

// --- Helper: responder videos cacheados incluso si el navegador pide "por partes" (Range) ---
async function respondWithRange_(req, cachedResponse) {
  const rangeHeader = req.headers.get('range');

  // Si NO hay range, devolvemos el video completo
  if (!rangeHeader) return cachedResponse;

  // Si hay range, devolvemos sólo el pedazo que pide el navegador
  const buf = await cachedResponse.arrayBuffer();
  const size = buf.byteLength;

  // Formato típico: "bytes=0-"
  const m = /bytes=(\d+)-(\d+)?/.exec(rangeHeader);
  if (!m) return cachedResponse;

  const start = Number(m[1]);
  let end = m[2] ? Number(m[2]) : (size - 1);
  if (isNaN(start) || isNaN(end) || start > end || start >= size) {
    return new Response(null, { status: 416 }); // Range Not Satisfiable
  }
  end = Math.min(end, size - 1);

  const chunk = buf.slice(start, end + 1);

  // Intentamos conservar Content-Type del caché
  const contentType = cachedResponse.headers.get('content-type') || 'video/mp4';

  return new Response(chunk, {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(chunk.byteLength),
    },
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Sólo cacheamos GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  const isVideo =
    (req.destination === 'video') ||
    (isSameOrigin && url.pathname.toLowerCase().endsWith('.mp4'));

  // 1) Navegación: usar red si hay, y si no, index.html cacheado
  if (req.mode === 'navigate' || req.destination === 'document') {
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

        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Offline</title><p>Sin conexión. Intenta de nuevo cuando vuelva el Internet.</p>',
          { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
        );
      }
    })());
    return;
  }

  // 2) Videos: servir desde caché (incluyendo Range) y actualizar en segundo plano
  if (isVideo) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);

      // Para videos locales, ignoramos parámetros (?v=...) si existieran
      const cacheKey = isSameOrigin ? new Request(url.pathname, { headers: req.headers }) : req;

      const cached = await cache.match(cacheKey, { ignoreSearch: true });

      if (cached) {
        // Actualizar en segundo plano (si hay internet)
        fetch(req).then(res => {
          if (res && res.ok) cache.put(cacheKey, res.clone());
        }).catch(() => {});

        return respondWithRange_(req, cached);
      }

      // Si no está cacheado aún, intentamos red; si sale bien, lo guardamos
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(cacheKey, res.clone());
        return res;
      } catch {
        // Sin caché y sin red: no hay video para mostrar
        return new Response('', { status: 204 });
      }
    })());
    return;
  }

  // 3) Resto de recursos: cache-first + actualización en segundo plano
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    if (cached) {
      fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      }).catch(() => {});
      return cached;
    }

    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 204 });
    }
  })());
});
