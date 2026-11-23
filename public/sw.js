// Lyric Lights service worker. It does one thing: if the phone is offline, show a friendly
// "needs an internet connection" page instead of the browser's error page.
// Pages always come from the network first, so updates show up right away. Nothing from
// Spotify or LRCLIB is ever cached (those requests aren't touched at all).

const CACHE = "ll-offline-v1";
const OFFLINE_PAGE = "offline.html";
const OFFLINE_FILES = [OFFLINE_PAGE, "page.css", "icons/icon-192.png"];
const offlineUrls = new Set(OFFLINE_FILES.map((f) => new URL(f, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(OFFLINE_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ll-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(new URL(OFFLINE_PAGE, self.registration.scope).href)));
    return;
  }
  // Only the offline page's own files; everything else goes to the network untouched.
  if (offlineUrls.has(req.url)) {
    event.respondWith(fetch(req).catch(() => caches.match(req.url)));
  }
});
