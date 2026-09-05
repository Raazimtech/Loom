const CACHE_NAME='lunar-v1';
const FILES=['./','./index.html','./app.html','./app.js','./logo.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(FILES)))});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim())});
self.addEventListener('fetch',event=>{if(event.request.method==='GET'){event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)))}});
