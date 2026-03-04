const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');
const { sendPushToUser } = require('../lib/push');

const router = express.Router();

// POST /api/invites — send an invite
router.post('/', requireAuth, async (req, res) => {
  try {
    const { toHash, roomId } = req.body;
    if (!toHash || !roomId) return res.status(400).json({ error: 'missing toHash or roomId' });

    const fromUserId = req.user.id;

    // Resolve hash to user
    const hash = toHash.replace(/^#/, '');
    const { data: toUser } = await supabaseAdmin
      .from('users').select('id').eq('hash', hash).maybeSingle();
    if (!toUser) return res.status(404).json({ error: 'user not found' });
    if (toUser.id === fromUserId) return res.status(400).json({ error: 'cannot invite yourself' });

    // Check inviter is actually a member of the room
    const { data: membership } = await supabaseAdmin
      .from('room_members').select('room_id')
      .eq('room_id', roomId).eq('user_id', fromUserId).is('left_at', null).maybeSingle();
    if (!membership) return res.status(403).json({ error: 'you are not in this room' });

    // Check target isn't already a member
    const { data: existing } = await supabaseAdmin
      .from('room_members').select('room_id')
      .eq('room_id', roomId).eq('user_id', toUser.id).is('left_at', null).maybeSingle();
    if (existing) return res.status(409).json({ error: 'user is already in this room' });

    // Create invite
    const { data: invite, error } = await supabaseAdmin
      .from('invites')
      .upsert({ room_id: roomId, from_user_id: fromUserId, to_user_id: toUser.id, status: 'pending' },
               { onConflict: 'room_id,to_user_id' })
      .select().single();
    if (error) throw error;

    // Fetch sender + room info for notification
    const { data: sender } = await supabaseAdmin
      .from('users').select('name,hash,color').eq('id', fromUserId).maybeSingle();
    const { data: room } = await supabaseAdmin
      .from('rooms').select('name,is_dm').eq('id', roomId).maybeSingle();

    // Push notify the recipient
    sendPushToUser({
      userId: toUser.id,
      payload: {
        type: 'invite',
        senderName:  sender?.name || 'someone',
        senderHash:  '#' + (sender?.hash || '?'),
        senderColor: sender?.color || '#fff',
        roomName:    room?.name || 'a room',
        isDM:        room?.is_dm || false,
        content:     (room?.is_dm ? sender?.name : '#' + room?.name) + ' invited you',
        roomId,
      }
    }).catch(console.error);

    res.json({ ok: true, invite });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'failed to send invite' });
  }
});

// GET /api/invites — get my pending invites
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('invites')
      .select('*, rooms(id,name,is_dm), from_user:from_user_id(name,hash,color)')
      .eq('to_user_id', req.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ invites: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'failed to fetch invites' });
  }
});

// POST /api/invites/:id/accept
router.post('/:id/accept', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: invite } = await supabaseAdmin
      .from('invites').select('*').eq('id', id).eq('to_user_id', userId).maybeSingle();
    if (!invite) return res.status(404).json({ error: 'invite not found' });
    if (invite.status !== 'pending') return res.status(409).json({ error: 'invite already resolved' });

    // Add to room
    await supabaseAdmin.from('room_members')
      .upsert({ room_id: invite.room_id, user_id: userId }, { onConflict: 'room_id,user_id' });

    // Mark accepted
    await supabaseAdmin.from('invites').update({ status: 'accepted' }).eq('id', id);

    res.json({ ok: true, roomId: invite.room_id });
  } catch (err) {
    console.error('Accept error:', err);
    res.status(500).json({ error: 'failed to accept invite' });
  }
});

// POST /api/invites/:id/decline
router.post('/:id/decline', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: invite } = await supabaseAdmin
      .from('invites').select('*').eq('id', id).eq('to_user_id', userId).maybeSingle();
    if (!invite) return res.status(404).json({ error: 'invite not found' });

    await supabaseAdmin.from('invites').update({ status: 'declined' }).eq('id', id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed to decline invite' });
  }
});


// POST /api/invites/dm — create a DM room + invite the other person
router.post('/dm', requireAuth, async (req, res) => {
  try {
    const { toHash } = req.body;
    if (!toHash) return res.status(400).json({ error: 'missing toHash' });

    const fromUserId = req.user.id;
    const hash = toHash.replace(/^#/, '');

    const { data: toUser } = await supabaseAdmin
      .from('users').select('id,hash').eq('hash', hash).maybeSingle();
    if (!toUser) return res.status(404).json({ error: 'user not found' });
    if (toUser.id === fromUserId) return res.status(400).json({ error: 'cannot dm yourself' });

    const { data: fromUser } = await supabaseAdmin
      .from('users').select('name,hash,color').eq('id', fromUserId).maybeSingle();

    // Create DM room (canonical name)
    const hashes = [fromUser.hash, toUser.hash].sort();
    const roomName = 'dm:' + hashes[0] + ':' + hashes[1];

    // Check if room already exists
    let { data: room } = await supabaseAdmin
      .from('rooms').select('id').eq('name', roomName).maybeSingle();

    if (!room) {
      const { data: newRoom, error } = await supabaseAdmin
        .from('rooms').insert({ name: roomName, is_dm: true }).select().single();
      if (error) throw error;
      room = newRoom;
      // Add sender to the room immediately
      await supabaseAdmin.from('room_members')
        .insert({ room_id: room.id, user_id: fromUserId });
    }

    // Create invite for recipient
    const { error: inviteError } = await supabaseAdmin
      .from('invites')
      .upsert({ room_id: room.id, from_user_id: fromUserId, to_user_id: toUser.id, status: 'pending' },
               { onConflict: 'room_id,to_user_id' });
    if (inviteError) throw inviteError;

    // Push notify recipient
    sendPushToUser({
      userId: toUser.id,
      payload: {
        type: 'invite',
        senderName:  fromUser?.name || 'someone',
        senderHash:  '#' + (fromUser?.hash || '?'),
        senderColor: fromUser?.color || '#fff',
        roomName:    roomName,
        isDM:        true,
        content:     (fromUser?.name || 'someone') + ' wants to DM you',
        roomId:      room.id,
      }
    }).catch(console.error);

    res.json({ ok: true });
  } catch (err) {
    console.error('DM invite error:', err);
    res.status(500).json({ error: 'failed to create dm invite' });
  }
});

module.exports = router;
