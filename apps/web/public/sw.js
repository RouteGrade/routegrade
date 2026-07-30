/**
 * RouteGrade service worker.
 *
 * Deliberately conservative. Its only jobs are (a) making the app installable
 * and (b) keeping the shell usable when the network drops mid-run. It is *not*
 * a data cache: anything authenticated or live goes straight to the network so
 * a stale response can never masquerade as a fresh run, route, or session.
 *
 * Caching rules, in order:
 *   - non-GET, cross-origin, /api/*, /auth/*  -> not handled at all
 *   - /_next/static/*                         -> cache-first (content-hashed,
 *                                                so a hit is always correct)
 *   - navigations                             -> network-first, falling back to
 *                                                the cached page, then /offline
 *   - other same-origin GETs (icons, svg)     -> stale-while-revalidate
 */

// Bump this to invalidate every cached asset on the next activation.
const VERSION = "v1";
const STATIC_CACHE = `routegrade-static-${VERSION}`;
const PAGES_CACHE = `routegrade-pages-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      // Individually, not addAll: one 404 must not fail the whole install and
      // leave the app with no offline page at all.
      .then((cache) =>
        Promise.all(
          PRECACHE.map((url) => cache.add(url).catch(() => undefined)),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== PAGES_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Requests the worker must never touch. */
function isBypassed(url, request) {
  if (request.method !== "GET") return true;
  // Cross-origin: Supabase, the map tile provider, fonts. Their own caching
  // headers are correct and we must not hold auth responses.
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname.startsWith("/auth/")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (isBypassed(url, request)) return;

  // Immutable build output — a cache hit is definitionally the right file.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Network-first, so a signed-in user never gets served someone else's cached
 * HTML and an updated build is picked up immediately. The cache is only a
 * fallback for a dead network.
 */
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PAGES_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(cacheName);
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  const response = cached ?? (await network);
  if (response) return response;

  return new Response("Offline", {
    status: 503,
    headers: { "Content-Type": "text/plain" },
  });
}
