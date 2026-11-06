// Arcanus offline-first service worker.
// - Pages: from the network, so a new deploy shows on the next visit; the cached copy only when offline.
// - Same-origin assets (hashed Next.js chunks, fonts, ARC 1 weights) and the ONNX Runtime files from jsDelivr:
//   cache first. Both are versioned by URL, so a cached copy never goes stale.
// - Files that change under the same URL (the orb's shape) go network first, like pages, so a new deploy shows at once.
// - Hugging Face model files pass straight through: Transformers.js ("transformers-cache") and the Paradee voice
//   worker ("paradee-v1.2") already keep them in Cache Storage and read that before the network. Caching them here
//   too would store ~270 MB twice.
const CACHE = "arcanus-v1";
const SHELL = ["/", "/manifest.webmanifest", "/arcane/arc1.onnx", "/arcane/arc1.json", "/icon-192.png", "/icon-512.png"];
const CDN = "https://cdn.jsdelivr.net";
const UNVERSIONED = new Set(["/orb.glb"]); // add a public file here when it is redrawn without changing its name

// /api/ is live (the browser relay): never cached.
const cacheable = (href) => {
  const url = new URL(href);
  return url.origin === CDN || (url.origin === self.location.origin && !url.pathname.startsWith("/sw.js") && !url.pathname.startsWith("/api/"));
};

async function put(request, response) {
  if (response.ok && response.type !== "opaque") await (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function cacheFirst(request) {
  return (await caches.match(request)) ?? put(request, await fetch(request));
}

async function networkFirst(request) {
  try {
    return await put(request, await fetch(request));
  } catch {
    return (await caches.match(request)) ?? Response.error();
  }
}

const load = (request) => (UNVERSIONED.has(new URL(request.url).pathname) ? networkFirst(request) : cacheFirst(request));

async function page(event) {
  try {
    return await put(event.request, await fetch(event.request));
  } catch {
    return (await caches.match(event.request, { ignoreSearch: true })) ?? (await caches.match("/")) ?? Response.error();
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("arcanus-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

// The page sends the files it loaded before this worker controlled it, so the very first visit works offline too.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache") return;
  const urls = [...new Set(event.data.urls)].filter(cacheable);
  event.waitUntil(Promise.all(urls.map((url) => load(new Request(url)).catch(() => undefined))));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;
  if (request.mode === "navigate") event.respondWith(page(event));
  else if (cacheable(request.url)) event.respondWith(load(request));
});
