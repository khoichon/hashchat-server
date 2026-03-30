const CACHE_NAME = 'hashchat-sw-v1';

// Keep SW alive — browser kills SWs with no fetch handler
self.addEventListener('fetch', event => {
  // passthrough — we just need this handler to exist
});

// Force immediate activation when updated
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Claim all clients immediately on activate
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      self.registration.navigationPreload?.enable(),
    ])
  );
});

// Handle incoming push
self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { return; }

  const title = data.type === 'catchup'
    ? (data.title || '// missed messages')
    : (data.isDM ? data.senderName : '# ' + data.roomName);

  const body = data.type === 'catchup'
    ? data.content
    : (data.senderName + ': ' + (data.content?.slice(0, 80) || ''));

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  '/icon.png',
      badge: '/badge.png',
      tag:   data.roomId || 'hashchat',
      data:  { roomId: data.roomId },
    })
  );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const roomId = event.notification.data?.roomId;
  const url = roomId ? '/app.html?room=' + roomId : '/app.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes('/app.html')) {
          client.focus();
          if (roomId) client.postMessage({ type: 'FOCUS_ROOM', roomId });
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
