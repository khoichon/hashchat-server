const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { supabaseAdmin } = require("../lib/supabase");

const router = express.Router();

// GET /api/push/vapid-public-key
// Client needs this to create a push subscription
router.get("/vapid-public-key", (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(500).json({ error: "VAPID not configured" });
  res.json({ key });
});

// POST /api/push/subscribe
// Body: { subscription } — the PushSubscription object from the browser
router.post("/subscribe", requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint) {
      return res.status(400).json({ error: "Invalid subscription" });
    }

    const userId = req.user.id;

    // Upsert — same endpoint may re-subscribe after browser update
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert({
        user_id: userId,
        endpoint:    subscription.endpoint,
        p256dh:      subscription.keys.p256dh,
        auth:        subscription.keys.auth,
        updated_at:  new Date().toISOString(),
      }, { onConflict: "endpoint" });

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error("Subscribe error:", err);
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

// DELETE /api/push/subscribe
// Removes subscription when user disables notifications
router.delete("/subscribe", requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", req.user.id)
      .eq("endpoint", endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove subscription" });
  }
});


// GET /api/push/catchup — called by SW on activate to flush undelivered
router.get('/catchup', requireAuth, async (req, res) => {
  try {
    const { sendCatchupNotification } = require('../lib/push');
    await sendCatchupNotification(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Catchup error:', err);
    res.status(500).json({ error: 'catchup failed' });
  }
});

module.exports = router;
