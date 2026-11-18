const CACHE_VERSION = 'zhapp-v1.0.0';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './data.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ==== INSTALL ====
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ==== ACTIVATE ====
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ==== FETCH (cache-first cho assets, network-first cho API) ====
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  
  // Bỏ qua API requests (không cache)
  if (url.pathname.startsWith('/api/')) return;
  
  // Cache-first cho assets tĩnh
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Cache động các file mới
        if (res.ok && e.request.method === 'GET') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

// ==== PUSH NOTIFICATION ====
self.addEventListener('push', e => {
  let data = { title: '学中文', body: 'Đến giờ học tiếng Trung rồi! 🔥' };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch (err) {}
  
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'daily-reminder',
      renotify: true,
      data: { url: './index.html' }
    })
  );
});

// ==== CLICK NOTIFICATION ====
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = e.notification.data?.url || './index.html';
  
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(clientList => {
      // Nếu có tab đang mở thì focus
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      // Không có thì mở mới
      return clients.openWindow(targetUrl);
    })
  );
});