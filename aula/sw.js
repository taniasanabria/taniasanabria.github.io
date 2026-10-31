// Service worker del Aula: la app abre aunque la señal sea mala (los datos siempre se piden en línea).
const CACHE = 'aula-tania-v2';
const BASE = ['./', 'index.html', 'aula.css', 'aula.js', 'camara.js', 'manifest.webmanifest', '../admin/vendor/supabase.js',
  '../js/config.js', '../img/logo-96.webp', '../img/logo-192.webp', '../img/retrato-540.webp', '../img/marmol-800.webp',
  '../fonts/cinzel-latin.woff2', '../fonts/montserrat-latin.woff2'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // Supabase: siempre en línea
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
