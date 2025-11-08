// ==========================================
// Improved Service Worker with Auto-Update
// ==========================================

const CACHE_NAME = "mqtt-app-cache-v2"; // Increment version on each deploy
const urlsToCache = [
  "/",
  "/index.html",
  "/styles.css",
  "/script.js",
  "/manifest.json",
  // Add static assets like images/icons here
];

// Install event: pre-cache essential assets
self.addEventListener("install", event => {
  console.log("[SW] Installing new version:", CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("[SW] Caching app shell...");
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting(); // Activate new SW immediately
});

// Activate event: clear old caches
self.addEventListener("activate", event => {
  console.log("[SW] Activating and cleaning old caches...");
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim(); // Take control of open pages immediately
});

// Fetch event: network first, then fallback to cache
self.addEventListener("fetch", event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Optionally update cache with latest version of file
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Listen for messages (optional: allows skipWaiting trigger)
self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
