const webpush = require('web-push');
const { supabaseAdmin } = require('./supabase');

webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_EMAIL || 'admin@hashchat.app'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function _sendToSubs(subs, payload) {
  const notification = JSON.stringify(payload);
  const deadEndpoints = [];
  const results = await Promise.allSettled(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        notification,
        { TTL: 60 * 60 }
      );
      return { userId: sub.user_id, success: true };
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) deadEndpoints.push(sub.endpoint);
      return { userId: sub.user_id, success: false };
    }
  }));

  // Clean dead subscriptions
  if (deadEndpoints.length) {
    await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', deadEndpoints);
  }

  return results.map(r => r.value || { success: false });
}

// Send push to all members of a room except one user, respecting muted_chats
// Tracks undelivered counts for users whose push failed
async function sendPushToRoomMembers({ roomId, excludeUserId, payload }) {
  const { data: members } = await supabaseAdmin
    .from('room_members').select('user_id')
    .eq('room_id', roomId).is('left_at', null).neq('user_id', excludeUserId);
  if (!members?.length) return;

  const memberIds = members.map(m => m.user_id);

  // Filter muted users
  const { data: muted } = await supabaseAdmin
    .from('muted_chats').select('user_id')
    .eq('room_id', roomId).in('user_id', memberIds);
  const mutedIds = new Set((muted || []).map(m => m.user_id));
  const activeIds = memberIds.filter(id => !mutedIds.has(id));
  if (!activeIds.length) return;

  // Fetch subs — include user_id so we can track failures
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions').select('endpoint,p256dh,auth,user_id')
    .in('user_id', activeIds);
  if (!subs?.length) {
    // No subs at all — all undelivered
    await _trackUndelivered(activeIds, roomId);
    return;
  }

  const results = await _sendToSubs(subs, payload);

  // Users with no sub or failed push → mark undelivered
  const subsUserIds = new Set(subs.map(s => s.user_id));
  const failedUserIds = [
    ...activeIds.filter(id => !subsUserIds.has(id)), // no sub
    ...results.filter(r => !r.success).map(r => r.userId).filter(Boolean), // push failed
  ];

  if (failedUserIds.length) {
    await _trackUndelivered(failedUserIds, roomId);
  }
}

// Upsert undelivered count — increment by 1 per room per user
async function _trackUndelivered(userIds, roomId) {
  if (!userIds.length) return;
  const now = new Date().toISOString();
  const rows = userIds.map(user_id => ({ user_id, room_id: roomId, count: 1, last_updated: now }));

  // upsert with count increment via raw SQL
  for (const row of rows) {
    await supabaseAdmin.rpc('increment_undelivered', {
      p_user_id: row.user_id,
      p_room_id: row.room_id,
    });
  }
}

// Send push to a single user
async function sendPushToUser({ userId, payload }) {
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions').select('endpoint,p256dh,auth,user_id').eq('user_id', userId);
  if (!subs?.length) return;
  await _sendToSubs(subs, payload);
}

// Send catchup notification to a user — called when SW wakes up
async function sendCatchupNotification(userId) {
  // Fetch all undelivered rows for this user
  const { data: rows } = await supabaseAdmin
    .from('undelivered').select('room_id, count')
    .eq('user_id', userId);
  if (!rows?.length) return;

  // Fetch room names
  const roomIds = rows.map(r => r.room_id);
  const { data: rooms } = await supabaseAdmin
    .from('rooms').select('id, name, is_dm').in('id', roomIds);

  const roomMap = Object.fromEntries((rooms || []).map(r => [r.id, r]));

  // Build grouped message
  const lines = rows.map(r => {
    const room = roomMap[r.room_id];
    const label = room?.is_dm ? 'dm' : '#' + (room?.name || '?');
    return r.count + ' new in ' + label;
  });

  const body = lines.join(', ');
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  // Send the catchup push
  await sendPushToUser({
    userId,
    payload: {
      type: 'catchup',
      title: '// ' + total + ' missed message' + (total === 1 ? '' : 's'),
      content: body,
      roomId: rows.length === 1 ? rows[0].room_id : null,
    },
  });

  // Clear undelivered rows
  await supabaseAdmin.from('undelivered').delete().eq('user_id', userId);
}

module.exports = { sendPushToRoomMembers, sendPushToUser, sendCatchupNotification };
