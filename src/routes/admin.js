const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();

// POST /admin/delete-account
router.post('/delete-account', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    await supabaseAdmin.from('messages').delete().eq('user_id', userId);
    await supabaseAdmin.from('room_members').delete().eq('user_id', userId);
    await supabaseAdmin.from('push_subscriptions').delete().eq('user_id', userId);
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
