const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();

// POST /admin/delete-account
// Nukes auth user (service role required) — RLS alone can't do this
router.post('/delete-account', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Clean up DB rows first (messages, memberships, profile)
    await supabaseAdmin.from('messages').delete().eq('user_id', userId);
    await supabaseAdmin.from('room_members').delete().eq('user_id', userId);
    await supabaseAdmin.from('users').delete().eq('id', userId);

    // Delete the auth user — only possible with service role
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Account deletion failed' });
  }
});

module.exports = router;