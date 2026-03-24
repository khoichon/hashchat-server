const CACHE_NAME = 'hashchat-sw-v1';

// On activate — signal server to send catchup notification
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Get auth token from clients
      const clients = await self.clients.matchAll({ type: 'window' });
      let token = null;

      for (const client of clients) {
        // Ask the client for its auth token
        const tokenPromise = new Promise(resolve => {
          const channel = new MessageChannel();
          channel.port1.onmessage = e => resolve(e.data?.token || null);
          client.postMessage({ type: 'GET_TOKEN' }, [channel.port2]);
        });
        token = await Promise.race([
          tokenPromise,
          new Promise(r => setTimeout(() => r(null), 500)),
        ]);
        if (token) break;
      }

      if (token) {
        try {
          await fetch('/api/push/catchup', {
            headers: { 'Authorization': 'Bearer ' + token },
          });
        } catch (e) {
          console.warn('[SW] catchup failed:', e);
        }
      }
    })()
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
