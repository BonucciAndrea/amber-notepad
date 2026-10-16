/* sw.js - offline support. Network first: online, every file comes fresh (and refreshes the cache),
   so an update needs no version bump; offline, the cached copy is served. The whole app is cached at
   install, so it works offline from the first launch. */
const CACHE = "amber-phone";
const FILES = ["./", "index.html", "app.css", "app.js", "rt.js", "keys.js", "amber.wasm", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: true })));
});
