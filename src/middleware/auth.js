// HashChat Service Worker — handles web push notifications

self.addEventListener("install", e => {
  self.skipWaiting(); // activate immediately
});

self.addEventListener("activate", e => {
  e.waitUntil(clients.claim()); // take control of all tabs
});

self.addEventListener("push", e => {
  if (!e.data) return;

  let data;
  try { data = e.data.json(); }
  catch { data = { senderName: "someone", content: e.data.text(), roomName: "chat" }; }

  const { senderName, senderHash, content, roomName, isDM } = data;

  const title = isDM
    ? senderName + " " + senderHash
    : "#" + roomName;

  const body = isDM
    ? content
    : senderName + ": " + content;

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon.png",
      badge: "/badge.png",
      tag: data.roomId,           // group notifications by room
      renotify: true,             // vibrate even if same tag
      data: { roomId: data.roomId },
    })
  );
});

// Clicking a notification opens/focuses the app
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const roomId = e.notification.data?.roomId;

  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      // If app is already open, focus it
      for (const client of list) {
        if (client.url.includes("/app.html") && "focus" in client) {
          client.focus();
          if (roomId) client.postMessage({ type: "FOCUS_ROOM", roomId });
          return;
        }
      }
      // Otherwise open a new tab
      const url = "/app.html" + (roomId ? "?room=" + roomId : "");
      clients.openWindow(url);
    })
  );
});
