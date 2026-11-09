const CACHE = 'frumos-space-shell-v6';
const APP_FILES = ['./', './index.html', './manifest.webmanifest', './icons/frumos-space.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_FILES);
    const page = await cache.match(new URL('./index.html', self.location.href));
    const html = await page.text();
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/gi)]
      .map((match) => new URL(match[1], self.location.href).href);
    if (scripts.length) await cache.addAll(scripts);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
  )));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    } catch {
      return caches.match(new URL('./index.html', self.location.href));
    }
  })());
});

