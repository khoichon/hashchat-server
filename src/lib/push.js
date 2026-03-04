const webpush = require("web-push");
const { supabaseAdmin } = require("./supabase");

// Configure VAPID — set these in .env
webpush.setVapidDetails(
  "mailto:" + (process.env.VAPID_EMAIL || "admin@hashchat.app"),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Send a web push notification to all members of a room except the sender.
 * Dead subscriptions (410 Gone) are automatically cleaned up.
 */
async function sendPushToRoomMembers({ roomId, excludeUserId, payload }) {
  // Get all current room members except sender
  const { data: members, error } = await supabaseAdmin
    .from("room_members")
    .select("user_id")
    .eq("room_id", roomId)
    .is("left_at", null)
    .neq("user_id", excludeUserId);

  if (error || !members?.length) return;

  const userIds = members.map(m => m.user_id);

  // Fetch their push subscriptions
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("user_id", userIds);

  if (!subs?.length) return;

  const notification = JSON.stringify(payload);
  const deadEndpoints = [];

  await Promise.allSettled(
    subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notification,
          { TTL: 60 * 60 } // 1 hour TTL — expire if device offline
        );
      } catch (err) {
        // 410 = subscription expired/unsubscribed — clean it up
        if (err.statusCode === 410 || err.statusCode === 404) {
          deadEndpoints.push(sub.endpoint);
        } else {
          console.error("Push send failed:", err.statusCode, sub.endpoint.slice(0, 40));
        }
      }
    })
  );

  // Remove dead subscriptions
  if (deadEndpoints.length) {
    await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .in("endpoint", deadEndpoints);
    console.log("Cleaned", deadEndpoints.length, "dead push subscriptions");
  }
}

module.exports = { sendPushToRoomMembers };
