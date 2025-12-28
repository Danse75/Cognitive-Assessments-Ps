// sw.js — Service Worker para cachear la app y funcionar offline
const VERSION = 'v3';
const PRECACHE = `precache-${VERSION}`;
const RUNTIME  = `runtime-${VERSION}`;

// Archivos locales mínimos para poder abrir la app sin internet
// (coloca aquí el nombre EXACTO de tu HTML)
const PRECACHE_URLS = [
  './index_with_moves.html',
  './sw.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Que el nuevo SW tome control lo antes posible
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Limpia caches antiguos
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n !== PRECACHE && n !== RUNTIME)
        .map(n => caches.delete(n))
    );
    // Activa navigation preload si existe (mejora en conexiones lentas)
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
  })());
  self.clients.claim();
});

// Estrategias:
// 1) Navegación (página): sirve la versión cacheada de index si no hay red.
// 2) Recursos del mismo origen: cache-first.
// 3) Recursos de otros orígenes (CDN): network-first con fallback a cache.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const isNavigation = req.mode === 'navigate';

  if (isNavigation) {
    event.respondWith((async () => {
      // Intenta usar navigation preload (si el navegador lo soporta)
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
      } catch {}

      // Intenta red primero
      try {
        const net = await fetch(req);
        // Si carga bien, actualiza cache de la página principal
        const cache = await caches.open(PRECACHE);
        cache.put('./index_with_moves.html', net.clone());
        return net;
      } catch {
        // Sin red: sirve la copia cacheada de la app
        const cached = await caches.match('./index_with_moves.html');
        if (cached) return cached;
        return new Response('<h1>Sin conexión</h1>', { headers: { 'Content-Type':'text/html' }});
      }
    })());
    return;
  }

  // Misma-origen: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const net = await fetch(req);
        const runtime = await caches.open(RUNTIME);
        runtime.put(req, net.clone());
        return net;
      } catch (e) {
        // Si falla, intenta al menos devolver algo del cache
        const fallback = await caches.match('./index_with_moves.html');
        return fallback || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Cross-origin (CDN de React, Tailwind, Babel, etc.): network-first
  event.respondWith((async () => {
    try {
      const net = await fetch(req);
      const runtime = await caches.open(RUNTIME);
      // Respuestas opacas (no-cors) también se pueden guardar
      runtime.put(req, net.clone());
      return net;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Último recurso: no hay nada
      return new Response('', { status: 504 });
    }
  })());
});
