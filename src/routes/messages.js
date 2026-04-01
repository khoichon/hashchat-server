const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { supabaseAdmin } = require("../lib/supabase");
const { sendPushToRoomMembers } = require("../lib/push");
const { messageLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post("/", messageLimiter, requireAuth, async (req, res) => {
  try {
    const { roomId, content, replyId } = req.body;

    // Input validation — all checks BEFORE the early return
    if (!roomId || !UUID_RE.test(roomId)) {
      return res.status(400).json({ error: "invalid roomId" });
    }
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "missing content" });
    }
    const trimmed = content.trim();
    if (!trimmed) {
      return res.status(400).json({ error: "message is empty" });
    }
    if (trimmed.length > 1000) {
      return res.status(400).json({ error: "message too long — max 1000 chars", code: "TOO_LONG" });
    }
    const lines = trimmed.split("\n").length;
    if (lines > 10) {
      return res.status(400).json({ error: "too many lines — max 10", code: "TOO_MANY_LINES" });
    }
    if (replyId && !UUID_RE.test(replyId)) {
      return res.status(400).json({ error: "invalid replyId" });
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
      return res.status(403).json({ error: "not a member of this room" });
    }

    // Insert message
    const { data: message, error: insertError } = await supabaseAdmin
      .from("messages")
      .insert({
        room_id: roomId,
        user_id: userId,
        content: trimmed,
        reply_id: replyId || null,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Fetch sender + room info
    const [{ data: sender }, { data: room }] = await Promise.all([
      supabaseAdmin.from("users").select("name,hash,color").eq("id", userId).maybeSingle(),
      supabaseAdmin.from("rooms").select("name,is_dm").eq("id", roomId).maybeSingle(),
    ]);

    // Fire push async — don't block response
    sendPushToRoomMembers({
      roomId,
      excludeUserId: userId,
      payload: {
        senderName:  sender?.name || "someone",
        senderHash:  "#" + (sender?.hash || "?"),
        senderColor: sender?.color || "#ffffff",
        content:     trimmed.slice(0, 120),
        roomName:    room?.name || "unknown",
        isDM:        room?.is_dm || false,
        roomId,
      },
    }).catch(err => console.error("Push error:", err));

    res.json({ message });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ error: "failed to send message" });
  }
});

module.exports = router;
