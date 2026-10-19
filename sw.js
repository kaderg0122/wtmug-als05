const CACHE_NAME = 'kamera-cevirmeni-v1';
const RUNTIME_CACHE = 'kamera-runtime-v1';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* Tesseract CDN'den yükleniyor — SW'ye takılmasın */
const CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'tessdata.projectnaptha.com'];

/* ---------- INSTALL ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] Önbelleklenemedi:', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

/* ---------- ACTIVATE ---------- */
self.addEventListener('activate', (event) => {
  const keep = [CACHE_NAME, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // CDN istekleri (Tesseract) → ağdan geç, cache'e dokunma
  if (CDN_HOSTS.some((h) => url.hostname.includes(h))) {
    return;
  }

  // Aynı origin değilse dokunma
  if (url.origin !== self.location.origin) return;

  // MyMemory API → ağ öncelikli
  if (url.hostname.includes('mymemory.translated.net')) {
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type === 'basic') {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Çevrimdışı', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}