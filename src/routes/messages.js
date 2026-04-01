const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { supabaseAdmin } = require("../lib/supabase");
const { sendPushToRoomMembers } = require("../lib/push");
const { messageLimiter } = require("../middleware/rateLimit");

const router = express.Router();

// POST /api/messages
// Body: { roomId, content, replyId? }
// Saves message then fires web push to all room members (except sender)
router.post("/", messageLimiter, requireAuth, async (req, res) => {
  try {
    const { roomId, content, replyId } = req.body;
    if (!roomId || !content?.trim()) {
      return res.status(400).json({ error: "Missing roomId or content" });
      if (!content || typeof content !== 'string') return res.status(400).json({ error: 'missing content' });
      if (content.length > 200) return res.status(400).json({ error: 'message too long — max 200 chars' });
      const lines = content.split('\n').length;
      if (lines > 10) return res.status(400).json({ error: 'too many lines — max 10' });
    }

    const userId = req.user.id;

    // Verify sender is actually a member
    const { data: membership } = await supabaseAdmin
      .from("room_members")
      .select("room_id")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .is("left_at", null)
      .maybeSingle();

    if (!membership) {
      return res.status(403).json({ error: "Not a member of this room" });
    }

    // Insert message
    const { data: message, error: insertError } = await supabaseAdmin
      .from("messages")
      .insert({
        room_id: roomId,
        user_id: userId,
        content: content.trim(),
        reply_id: replyId || null,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Fetch sender profile for notification payload
    const { data: sender } = await supabaseAdmin
      .from("users")
      .select("name, hash, color")
      .eq("id", userId)
      .maybeSingle();

    // Fetch room info
    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("name, is_dm")
      .eq("id", roomId)
      .maybeSingle();

    // Fire push notifications async — don't block the response
    sendPushToRoomMembers({
      roomId,
      excludeUserId: userId,
      payload: {
        senderName: sender?.name || "someone",
        senderHash: "#" + (sender?.hash || "?"),
        senderColor: sender?.color || "#ffffff",
        content: content.trim().slice(0, 120),
        roomName: room?.name || "unknown",
        isDM: room?.is_dm || false,
        roomId,
      },
    }).catch(err => console.error("Push error:", err));

    res.json({ message });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

module.exports = router;
