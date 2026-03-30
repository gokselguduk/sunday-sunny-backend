/* Sunday/Sunny SW — v3 (2026-03-30): HTML/navigasyon no-store; güncellemelerin telefona yansıması için */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** Ana belge ve HTML isteklerinde önbelleği atla; PWA / Safari’de eski sürüm kalmasını azaltır */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  const isNavigate = req.mode === 'navigate';
  const accept = req.headers.get('accept') || '';
  const isHtml = accept.includes('text/html');

  if (isNavigate || (isHtml && (url.pathname === '/' || /\.html$/i.test(url.pathname)))) {
    event.respondWith(
      fetch(req, {
        cache: 'no-store',
        redirect: 'follow',
        headers: req.headers
      })
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = data.title || 'Sunday/Sunny';
  const options = {
    body: data.body || 'Yeni sinyal guncellemesi var.',
    icon: '/icon-sun.svg',
    badge: '/icon-sun.svg',
    vibrate: data.vibrate || [200, 100, 200],
    data: { url: data.url || '/' },
    renotify: true,
    tag: data.tag || 'sunday-sunny-scan'
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification?.data?.url || '/';
  const targetUrl = new URL(raw, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (!client.url || !('focus' in client)) continue;
        try {
          if (typeof client.navigate === 'function') {
            await client.navigate(raw).catch(() => {});
          }
        } catch (e) {}
        return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return null;
    })
  );
});
