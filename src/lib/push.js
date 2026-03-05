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
  await Promise.allSettled(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        notification,
        { TTL: 60 * 60 }
      );
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) deadEndpoints.push(sub.endpoint);
    }
  }));
  if (deadEndpoints.length) {
    await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', deadEndpoints);
  }
}

// Send push to all members of a room except one user, respecting muted_chats
async function sendPushToRoomMembers({ roomId, excludeUserId, payload }) {
  const { data: members } = await supabaseAdmin
    .from('room_members').select('user_id')
    .eq('room_id', roomId).is('left_at', null).neq('user_id', excludeUserId);
  if (!members?.length) return;

  const memberIds = members.map(m => m.user_id);

  // Fetch users who have muted this room
  const { data: muted } = await supabaseAdmin
    .from('muted_chats').select('user_id')
    .eq('room_id', roomId).in('user_id', memberIds);

  const mutedIds = new Set((muted || []).map(m => m.user_id));
  const activeIds = memberIds.filter(id => !mutedIds.has(id));
  if (!activeIds.length) return;

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions').select('endpoint,p256dh,auth')
    .in('user_id', activeIds);
  if (!subs?.length) return;
  await _sendToSubs(subs, payload);
}

// Send push to a single user
async function sendPushToUser({ userId, payload }) {
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', userId);
  if (!subs?.length) return;
  await _sendToSubs(subs, payload);
}

module.exports = { sendPushToRoomMembers, sendPushToUser };