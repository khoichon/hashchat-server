const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();

// Helper: get member with role
async function getMember(roomId, userId) {
  const { data } = await supabaseAdmin
    .from('room_members').select('role,left_at')
    .eq('room_id', roomId).eq('user_id', userId).maybeSingle();
  return data;
}

// Helper: post system message
async function systemMessage(roomId, content) {
  await supabaseAdmin.from('messages').insert({
    room_id: roomId, user_id: null, content, is_system: true
  });
}

// GET /api/rooms/:id/members
router.get('/:id/members', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('room_members')
      .select('role, joined_at, users(id, name, hash, color)')
      .eq('room_id', req.params.id)
      .is('left_at', null)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    res.json({ members: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'failed to fetch members' });
  }
});

// PATCH /api/rooms/:id/description
router.patch('/:id/description', requireAuth, async (req, res) => {
  try {
    const { description } = req.body;
    const member = await getMember(req.params.id, req.user.id);
    if (!member || !['owner','admin'].includes(member.role)) {
      return res.status(403).json({ error: 'admin only' });
    }
    const { error } = await supabaseAdmin
      .from('rooms').update({ description }).eq('id', req.params.id);
    if (error) throw error;

    const { data: actor } = await supabaseAdmin
      .from('users').select('name').eq('id', req.user.id).maybeSingle();
    await systemMessage(req.params.id, '// ' + (actor?.name || 'someone') + ' updated the room description');

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed to update description' });
  }
});

// POST /api/rooms/:id/promote — owner promotes member to admin
router.post('/:id/promote', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    const actor = await getMember(req.params.id, req.user.id);
    if (!actor || actor.role !== 'owner') return res.status(403).json({ error: 'owner only' });

    await supabaseAdmin.from('room_members')
      .update({ role: 'admin' })
      .eq('room_id', req.params.id).eq('user_id', userId);

    const { data: target } = await supabaseAdmin.from('users').select('name').eq('id', userId).maybeSingle();
    const { data: actorUser } = await supabaseAdmin.from('users').select('name').eq('id', req.user.id).maybeSingle();
    await systemMessage(req.params.id, '// ' + (actorUser?.name || 'owner') + ' made ' + (target?.name || 'someone') + ' an admin');

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed to promote' });
  }
});

// POST /api/rooms/:id/demote — owner demotes admin to member
router.post('/:id/demote', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    const actor = await getMember(req.params.id, req.user.id);
    if (!actor || actor.role !== 'owner') return res.status(403).json({ error: 'owner only' });

    await supabaseAdmin.from('room_members')
      .update({ role: 'member' })
      .eq('room_id', req.params.id).eq('user_id', userId);

    const { data: target } = await supabaseAdmin.from('users').select('name').eq('id', userId).maybeSingle();
    await systemMessage(req.params.id, '// ' + (target?.name || 'someone') + ' is no longer an admin');

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed to demote' });
  }
});

// POST /api/rooms/:id/kick
router.post('/:id/kick', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    const actor = await getMember(req.params.id, req.user.id);
    if (!actor || !['owner','admin'].includes(actor.role)) {
      return res.status(403).json({ error: 'admin only' });
    }
    const target = await getMember(req.params.id, userId);
    // Admins can't kick other admins or owner
    if (actor.role === 'admin' && ['admin','owner'].includes(target?.role)) {
      return res.status(403).json({ error: 'cannot kick admins' });
    }
    // Owner can't be kicked
    if (target?.role === 'owner' && actor.role !== 'owner') {
      return res.status(403).json({ error: 'cannot kick owner' });
    }

    await supabaseAdmin.from('room_members')
      .update({ left_at: new Date().toISOString() })
      .eq('room_id', req.params.id).eq('user_id', userId);

    const { data: targetUser } = await supabaseAdmin.from('users').select('name').eq('id', userId).maybeSingle();
    const { data: actorUser }  = await supabaseAdmin.from('users').select('name').eq('id', req.user.id).maybeSingle();
    await systemMessage(req.params.id, '// ' + (targetUser?.name || 'someone') + ' was kicked by ' + (actorUser?.name || 'admin'));

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed to kick' });
  }
});

// POST /api/rooms/:id/leave
router.post('/:id/leave', requireAuth, async (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = req.user.id;
    const member = await getMember(roomId, userId);
    if (!member) return res.status(404).json({ error: 'not in room' });

    // If owner leaving, transfer ownership to next oldest member
    if (member.role === 'owner') {
      const { data: next } = await supabaseAdmin
        .from('room_members').select('user_id')
        .eq('room_id', roomId).neq('user_id', userId).is('left_at', null)
        .order('joined_at', { ascending: true }).limit(1).maybeSingle();

      if (next) {
        await supabaseAdmin.from('room_members')
          .update({ role: 'owner' })
          .eq('room_id', roomId).eq('user_id', next.user_id);
        const { data: newOwner } = await supabaseAdmin.from('users').select('name').eq('id', next.user_id).maybeSingle();
        await systemMessage(roomId, '// ownership transferred to ' + (newOwner?.name || 'someone'));
      } else {
        // Last person leaving — delete the room
        await supabaseAdmin.from('rooms').delete().eq('id', roomId);
        return res.json({ ok: true, deleted: true });
      }
    }

    await supabaseAdmin.from('room_members')
      .update({ left_at: new Date().toISOString() })
      .eq('room_id', roomId).eq('user_id', userId);

    const { data: user } = await supabaseAdmin.from('users').select('name').eq('id', userId).maybeSingle();
    await systemMessage(roomId, '// ' + (user?.name || 'someone') + ' left the room');

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed to leave' });
  }
});

module.exports = router;
