/* Sunday/Sunny SW — v4: tüm kök/HTML GET no-store; iOS/PWA eski kabuk */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function wantsFreshDocument(req) {
  if (req.method !== 'GET') return false;
  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return false;
  }
  if (url.origin !== self.location.origin) return false;
  if (req.mode === 'navigate') return true;
  if (req.destination === 'document') return true;
  const accept = req.headers.get('accept') || '';
  if (!accept.includes('text/html')) return false;
  const p = url.pathname;
  return p === '/' || p === '' || /\.html$/i.test(p);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!wantsFreshDocument(req)) return;
  event.respondWith(
    fetch(req, { cache: 'no-store', redirect: 'follow' }).catch(() =>
      fetch(req.url, { cache: 'reload', redirect: 'follow', mode: 'cors', credentials: 'same-origin' })
    )
  );
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
