// Arcanus offline-first service worker.
// - Pages: from the network, so a new deploy shows on the next visit; the cached copy only when offline.
// - Same-origin assets (hashed Next.js chunks, fonts, ARC 1 weights, the ONNX Runtime files in /ort/<version>/):
//   cache first. They are versioned by URL, so a cached copy never goes stale.
// - Files that change under the same URL (the orb's shape) go network first, like pages, so a new deploy shows at once.
// - Model files pass straight through, from Hugging Face or from /models/ here: Transformers.js
//   ("transformers-cache") and the Paradee voice worker ("paradee-v1.2") already keep them in Cache Storage and read
//   that before the network. Caching them here too would store ~250 MB twice.
const CACHE = "arcanus-v2"; // v2: the runtime moved from jsDelivr to /ort/, so the old CDN copies are dropped
const SHELL = ["/", "/geo/countries.json", "/geo/places.json", "/manifest.webmanifest", "/arcane/arc1.onnx", "/arcane/arc1.json", "/vad/silero_vad.onnx", "/icon-192.png", "/icon-512.png"];
// Map tiles you have looked at, so those streets still show offline. Not "arcanus-": a new deploy keeps them.
// ponytail: kept until the browser clears site data, never refreshed or capped. Expire them if the cache grows too big.
const TILES = "map-tiles-v1";
const isTile = (href) => new URL(href).hostname === "tile.openstreetmap.org";
const UNVERSIONED = new Set(["/orb.glb"]); // add a public file here when it is redrawn without changing its name

// /api/ is live (the browser relay): never cached. /models/ is kept by the model caches (above).
const cacheable = (href) => {
  const url = new URL(href);
  return url.origin === self.location.origin && !/^\/(?:sw\.js|api\/|models\/)/.test(url.pathname);
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

async function tile(request) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
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
  else if (isTile(request.url)) event.respondWith(tile(request));
});
