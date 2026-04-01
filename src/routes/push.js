const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { supabaseAdmin } = require("../lib/supabase");

const router = express.Router();

router.get("/vapid-public-key", (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(500).json({ error: "VAPID not configured" });
  res.json({ key });
});

router.post("/subscribe", requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: "invalid subscription" });
    }
    // Sanity check endpoint is a real URL
    try { new URL(subscription.endpoint); } catch {
      return res.status(400).json({ error: "invalid endpoint url" });
    }

    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert({
        user_id:    req.user.id,
        endpoint:   subscription.endpoint,
        p256dh:     subscription.keys.p256dh,
        auth:       subscription.keys.auth,
        updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error("Subscribe error:", err);
    res.status(500).json({ error: "failed to save subscription" });
  }
});

router.delete("/subscribe", requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: "missing endpoint" });
    await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", req.user.id)
      .eq("endpoint", endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "failed to remove subscription" });
  }
});

// User-keyed catchup limiter — applied after auth so we key by user ID not IP
const { rateLimit } = require('express-rate-limit');
const userCatchupLimiter = rateLimit({
  windowMs: 60 * 1000, max: 1,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'catchup already requested — try again in a minute' },
});

router.get("/catchup", requireAuth, userCatchupLimiter, async (req, res) => {
  try {
    const { sendCatchupNotification } = require("../lib/push");
    await sendCatchupNotification(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("Catchup error:", err);
    res.status(500).json({ error: "catchup failed" });
  }
});

module.exports = router;
