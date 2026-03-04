// HashChat Notifications
// Handles: service worker registration, web push subscriptions, toasts, tab badge

const Notifications = (() => {
  let _swRegistration = null;
  let _unreadCount = 0;
  const _originalTitle = document.title;

  // ── Init ─────────────────────────────────────────────────────────────────
  // Call once on app load — registers SW and (if permission granted) subscribes
  async function init() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.warn("Push not supported in this browser");
      return;
    }

    try {
      _swRegistration = await navigator.serviceWorker.register("/sw.js");
      console.log("[SW] registered");

      // If already permitted, silently re-subscribe (handles SW updates)
      if (Notification.permission === "granted") {
        await _subscribe();
      }
    } catch (err) {
      console.error("[SW] registration failed", err);
    }
  }

  // ── Permission & subscribe ────────────────────────────────────────────────
  async function requestPermission() {
    if (!("Notification" in window)) return false;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
    await _subscribe();
    return true;
  }

  async function unsubscribe() {
    if (!_swRegistration) return;
    const sub = await _swRegistration.pushManager.getSubscription();
    if (!sub) return;
    await _callServer("DELETE", "/api/push/subscribe", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }

  async function _subscribe() {
    if (!_swRegistration) return;

    // Get VAPID public key from server
    const res = await fetch("/api/push/vapid-public-key");
    if (!res.ok) return;
    const { key } = await res.json();

    const applicationServerKey = _urlBase64ToUint8Array(key);

    let sub = await _swRegistration.pushManager.getSubscription();
    if (!sub) {
      sub = await _swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    // Send subscription to server
    await _callServer("POST", "/api/push/subscribe", { subscription: sub.toJSON() });
  }

  // ── In-app toast (shown when tab is active) ───────────────────────────────
  function showToast({ senderName, senderColor, content, roomName, isDM }) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML =
      '<div class="toast-dot" style="background:' + senderColor + '"></div>' +
      '<div class="toast-body">' +
        '<div class="toast-title">' + esc(isDM ? senderName : "#" + roomName) + '</div>' +
        '<div class="toast-msg">' + esc(isDM ? content : senderName + ": " + content) + '</div>' +
      '</div>';

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ── Tab badge ─────────────────────────────────────────────────────────────
  function incrementBadge() {
    _unreadCount++;
    document.title = "(" + _unreadCount + ") " + _originalTitle;
  }
  function clearBadge() {
    _unreadCount = 0;
    document.title = _originalTitle;
  }

  // ── Main notify entry point ───────────────────────────────────────────────
  // Called from app.js whenever a new message arrives via realtime
  function notify(payload) {
    if (document.hasFocus()) {
      showToast(payload);
    } else {
      incrementBadge();
      // OS notification is handled by the service worker via web push.
      // This fallback fires only if web push is unavailable (e.g. Firefox private).
      if (Notification.permission === "granted" && !_swRegistration) {
        const title = payload.isDM ? payload.senderName : "#" + payload.roomName;
        const body  = payload.isDM ? payload.content : payload.senderName + ": " + payload.content;
        new Notification(title, { body, icon: "/icon.png" });
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function _callServer(method, url, body) {
    const session = await _getSession();
    return fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: "Bearer " + session.access_token } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function _getSession() {
    try {
      const { data } = await db.auth.getSession();
      return data?.session;
    } catch { return null; }
  }

  function _urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  return { init, requestPermission, unsubscribe, notify, showToast, clearBadge, incrementBadge };
})();
