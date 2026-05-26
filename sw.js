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

// Notification interactions: open the real app shell.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const chatId = data.chatId ? `?chat=${encodeURIComponent(data.chatId)}` : "";
  const url = `./app.html${chatId}`;

  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Prefer focusing an existing app tab.
      for (const client of clientsArr) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.pathname.endsWith("/app.html") || clientUrl.pathname.endsWith("\\app.html")) {
            await client.focus();
            client.postMessage({ type: "loom:openChat", chatId: data.chatId || null });
            return;
          }
        } catch {
          // ignore
        }
      }
      // Otherwise, open a new window.
      const newClient = await self.clients.openWindow(url);
      if (newClient) {
        newClient.postMessage({ type: "loom:openChat", chatId: data.chatId || null });
      }
    })()
  );
});
