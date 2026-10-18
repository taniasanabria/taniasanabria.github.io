/*
 * Service worker del Panel de Tania (alcance: /admin/).
 * - Muestra las notificaciones push de solicitudes nuevas, aunque el panel esté cerrado.
 * - Al tocar la notificación abre (o enfoca) el panel en "Citas".
 * No guarda nada en caché: el panel siempre se carga fresco desde internet.
 */
const PANEL = new URL('./#citas', self.registration.scope).href;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { cuerpo: e.data && e.data.text() }; }
  const titulo = d.titulo || 'Nueva solicitud de reserva';
  const op = {
    body: d.cuerpo || 'Tocá para verla en el panel.',
    tag: d.tag || 'reserva',
    renotify: true,
    requireInteraction: true,
    icon: '../img/icono-192.png',
    badge: '../img/favicon-32.png',
    vibrate: [200, 100, 200],
    data: { url: d.url || PANEL },
  };
  e.waitUntil((async () => {
    if (typeof d.pendientes === 'number' && self.navigator.setAppBadge) {
      try { d.pendientes ? await self.navigator.setAppBadge(d.pendientes) : await self.navigator.clearAppBadge(); } catch { /* sin insignia */ }
    }
    // Si el panel está abierto y visible, que se actualice solo (igual se muestra la notificación).
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    abiertas.forEach((c) => c.postMessage({ tipo: 'reserva-nueva' }));
    await self.registration.showNotification(titulo, op);
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = (e.notification.data && e.notification.data.url) || PANEL;
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const panel = abiertas.find((c) => c.url.startsWith(self.registration.scope));
    if (panel) { await panel.focus(); panel.postMessage({ tipo: 'ir-a', tab: new URL(destino).hash.slice(1) || 'citas' }); return; }
    await self.clients.openWindow(destino);
  })());
});
