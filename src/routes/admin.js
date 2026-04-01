const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();

router.post('/delete-account', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Clean up everything in parallel
    await Promise.all([
      supabaseAdmin.from('messages').delete().eq('user_id', userId),
      supabaseAdmin.from('room_members').delete().eq('user_id', userId),
      supabaseAdmin.from('push_subscriptions').delete().eq('user_id', userId),
      supabaseAdmin.from('undelivered').delete().eq('user_id', userId),
      supabaseAdmin.from('muted_chats').delete().eq('user_id', userId),
      supabaseAdmin.from('invites').delete().or('from_user_id.eq.' + userId + ',to_user_id.eq.' + userId),
    ]);

    await supabaseAdmin.from('users').delete().eq('id', userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'account deletion failed' });
  }
});

module.exports = router;
