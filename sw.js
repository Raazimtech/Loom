/* Loom Service Worker
 * Basic offline support for static assets.
 * Note: This app uses browser storage; messages won't sync across devices offline.
 */

const CACHE_NAME = "loom-static-v1";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./app.html",
  "./manifest.webmanifest",
  "./logo.png",
  "./des1.png",
  "./des2.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS.filter(Boolean));
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const fresh = await fetch(req);
        // Cache same-origin static files
        const url = new URL(req.url);
        if (url.origin === self.location.origin) {
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        // As a fallback, try cached app shell
        const fallback = await cache.match("./app.html");
        return fallback || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })()
  );
});

