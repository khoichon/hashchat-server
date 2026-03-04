// Invite badge + toast — loaded on app.html after app.js
// Checks for pending invites on load, shows toast + badge

(async () => {
  async function checkInvites() {
    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/invites', {
        headers: { 'Authorization': 'Bearer ' + session.access_token }
      });
      if (!res.ok) return;
      const { invites } = await res.json();
      if (!invites?.length) return;

      // Update badge
      const badge = document.getElementById('invite-badge');
      if (badge) {
        badge.textContent = invites.length;
        badge.style.display = 'inline';
      }

      // Show toast for each pending invite
      for (const inv of invites) {
        const from  = inv.from_user || {};
        const room  = inv.rooms || {};
        const label = room.is_dm ? 'direct message from ' + (from.name || '?') : 'invite to #' + room.name;
        Notifications.showToast({
          senderName:  from.name || 'someone',
          senderColor: from.color || '#fff',
          content:     label,
          roomName:    'invites',
          isDM:        false,
        });
      }
    } catch (err) {
      console.error('Invite check error:', err);
    }
  }

  // Check on load and every 30s (realtime for invites would need extra sub)
  await checkInvites();
  setInterval(checkInvites, 30000);
})();
