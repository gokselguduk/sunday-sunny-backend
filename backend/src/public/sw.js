/* Sunday/Sunny SW — v9: fetch YOK — sadece push. Sayfa/iOS önbelleği SW üzerinden takılmaz. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

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
