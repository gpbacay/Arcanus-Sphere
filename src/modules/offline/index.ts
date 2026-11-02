"use client";

import { useSyncExternalStore } from "react";

/**
 * Register the offline service worker and resolve once it controls the page, so every download the engines start
 * (worker chunks, the ONNX runtime, ARC 1) goes through it and is cached. Development unregisters it instead, so
 * stale caches never hide code changes. Never rejects: without a service worker Arcanus still runs, just not offline.
 */
export async function offlineReady() {
  if (!("serviceWorker" in navigator)) return;
  try {
    if (process.env.NODE_ENV !== "production") {
      for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
      return;
    }
    // Ask the browser not to evict ~270 MB of models under storage pressure.
    void navigator.storage?.persist?.();
    await navigator.serviceWorker.register("/sw.js");
    if (!navigator.serviceWorker.controller) {
      await Promise.race([
        new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true })),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    }
    // Files this page loaded before the worker took over (first visit): cache them too.
    navigator.serviceWorker.controller?.postMessage({
      type: "cache",
      urls: [location.href, ...performance.getEntriesByType("resource").map((e) => e.name)],
    });
  } catch {
    /* no offline support in this browser session */
  }
}

const subscribe = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
};

export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
