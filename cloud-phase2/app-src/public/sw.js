const CACHE_NAME = "jarvis-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/jarvis-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/agents/") || url.pathname.startsWith("/app/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put("/", copy)).catch(() => {});
      return response;
    }).catch(() => caches.match("/")));
    return;
  }
  if (["script", "style", "image", "font"].includes(request.destination) ||
      /\.(?:js|css|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())).catch(() => {});
          return response;
        });
        return cached || network;
      })
    );
  }
});
