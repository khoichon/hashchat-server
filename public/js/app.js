// HashChat — main app logic
// Handles: rooms, DMs, messages, realtime, file uploads, reply, modals

(async () => {
  // ── Auth guard ────────────────────────────────────────────────────────────
  const session = await Auth.requireAuth();
  if (!session) return;

  // ── State ─────────────────────────────────────────────────────────────────
  let currentRoomId   = null;
  let currentRoomName = '';
  let currentRoomIsDM = false;
  let replyToMsg      = null;
  let myProfile       = null;
  let realtimeSub     = null;

  const GENERAL_ID = '00000000-0000-0000-0000-000000000001';

  // ── Init ──────────────────────────────────────────────────────────────────
  await Notifications.init();
  await loadProfile();
  await ensureGeneralMembership();
  await loadSidebar();
  hideLoading();

  // Check for ?room= query param (from push notification click)
  const params = new URLSearchParams(location.search);
  const targetRoom = params.get('room');
  if (targetRoom) selectRoom(targetRoom);
  else selectRoom(GENERAL_ID);

  // Listen for service worker FOCUS_ROOM messages
  navigator.serviceWorker?.addEventListener('message', e => {
    if (e.data?.type === 'FOCUS_ROOM') selectRoom(e.data.roomId);
  });

  window.addEventListener('focus', () => Notifications.clearBadge());

  // ── Profile ───────────────────────────────────────────────────────────────
  async function loadProfile(retries = 5) {
    for (let i = 0; i < retries; i++) {
      const { data } = await db.from('users').select('*').eq('id', session.user.id).maybeSingle();
      if (data) { myProfile = data; break; }
      await new Promise(r => setTimeout(r, 600));
    }
    if (!myProfile) return;
    const initials = (myProfile.name || '?').slice(0, 2).toUpperCase();
    const av = document.getElementById('user-avatar');
    av.textContent    = initials;
    av.style.background = myProfile.color || '#4D96FF';
    document.getElementById('user-name').textContent = myProfile.name || 'anon';
    document.getElementById('user-hash').textContent = '#' + myProfile.hash;
    document.getElementById('user-hash').onclick = () => {
      navigator.clipboard.writeText('#' + myProfile.hash);
    };
  }

  async function ensureGeneralMembership() {
    const { data } = await db.from('room_members').select('room_id')
      .eq('room_id', GENERAL_ID).eq('user_id', session.user.id).is('left_at', null).maybeSingle();
    if (!data) {
      await db.from('room_members').upsert({ room_id: GENERAL_ID, user_id: session.user.id });
    }
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  async function loadSidebar() {
    const { data: memberships } = await db.from('room_members')
      .select('room_id, rooms(id, name, description, is_dm)')
      .eq('user_id', session.user.id).is('left_at', null);

    if (!memberships) return;

    const rooms = [], dms = [];
    for (const m of memberships) {
      if (!m.rooms) continue;
      m.rooms.is_dm ? dms.push(m.rooms) : rooms.push(m.rooms);
    }

    renderRoomList('room-list', rooms, false);
    renderDMList('dm-list', dms);
  }

  function renderRoomList(elId, rooms, isDM) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    for (const room of rooms) {
      const item = document.createElement('div');
      item.className = 'room-item';
      item.dataset.id = room.id;
      item.innerHTML =
        '<span class="room-prefix">#</span>' +
        '<span>' + esc(room.name) + '</span>';
      item.onclick = () => selectRoom(room.id);
      el.appendChild(item);
    }
  }

  async function renderDMList(elId, dms) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    for (const room of dms) {
      // Resolve the other person's name from the dm:hash1:hash2 format
      const parts = room.name.split(':'); // ['dm','hash1','hash2']
      const otherHash = parts[1] === myProfile.hash ? parts[2] : parts[1];
      const { data: other } = await db.from('users').select('name,color').eq('hash', otherHash).maybeSingle();
      const item = document.createElement('div');
      item.className = 'room-item';
      item.dataset.id = room.id;
      item.innerHTML =
        '<span class="room-prefix" style="color:' + (other?.color || '#fff') + ';opacity:1">·</span>' +
        '<span>' + esc(other?.name || otherHash) + '</span>';
      item.onclick = () => selectRoom(room.id);
      el.appendChild(item);
    }
  }

  function setActiveRoom(roomId) {
    document.querySelectorAll('.room-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === roomId);
    });
  }

  // ── Room selection ────────────────────────────────────────────────────────
  async function selectRoom(roomId) {
    currentRoomId = roomId;
    clearReply();

    // Show chat view
    document.getElementById('no-room').style.display  = 'none';
    const cv = document.getElementById('chat-view');
    cv.style.display = 'flex';

    setActiveRoom(roomId);
    showMain(); // mobile

    // Fetch room info
    const { data: room } = await db.from('rooms').select('*').eq('id', roomId).maybeSingle();
    if (!room) return;

    currentRoomName = room.name;
    currentRoomIsDM = room.is_dm;

    document.getElementById('chat-header-name').textContent = room.is_dm
      ? dmDisplayName(room.name) : room.name;
    document.getElementById('chat-header-desc').textContent = room.description || '';
    document.getElementById('invite-btn').style.display = room.is_dm ? 'none' : '';

    await loadMessages(roomId);
    subscribeRealtime(roomId);
  }

  function dmDisplayName(name) {
    const parts = name.split(':');
    return parts[1] === myProfile?.hash ? parts[2] : parts[1];
  }

  // ── Messages ──────────────────────────────────────────────────────────────
  async function loadMessages(roomId) {
    const wrap = document.getElementById('messages');
    wrap.innerHTML = '<div class="empty-state"><div class="empty-state-big">#</div><div>// no messages yet</div></div>';

    const { data: msgs } = await db.from('messages')
      .select('*, users(name, hash, color)')
      .eq('room_id', roomId)
      .order('timestamp', { ascending: true })
      .limit(100);

    if (!msgs?.length) return;
    wrap.innerHTML = '';
    let lastUserId = null, lastDate = null;

    for (const msg of msgs) {
      const date = new Date(msg.timestamp).toDateString();
      if (date !== lastDate) {
        appendDateDivider(wrap, msg.timestamp);
        lastDate = date;
        lastUserId = null;
      }
      const collapsed = msg.user_id === lastUserId;
      appendMessage(wrap, msg, collapsed);
      lastUserId = msg.user_id;
    }
    scrollToBottom();
  }

  function appendMessage(wrap, msg, collapsed = false) {
    // Resolve reply
    let replyHTML = '';
    if (msg.reply_id) {
      replyHTML = '<div class="msg-reply" data-reply-id="' + msg.reply_id + '">↩ reply</div>';
    }

    const user     = msg.users || {};
    const initials = (user.name || '?').slice(0, 2).toUpperCase();
    const color    = user.color || '#4D96FF';
    const time     = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const el = document.createElement('div');
    el.className = 'msg' + (collapsed ? ' collapsed' : '');
    el.dataset.id = msg.id;
    el.innerHTML =
      '<div class="msg-avatar" style="background:' + color + '">' + esc(initials) + '</div>' +
      '<div class="msg-body">' +
        '<div class="msg-meta">' +
          '<span class="msg-name" style="color:' + color + '">' + esc(user.name || 'anon') + '</span>' +
          '<span class="msg-hash-tag">#' + esc(user.hash || '?') + '</span>' +
          '<span class="msg-time">' + time + '</span>' +
        '</div>' +
        replyHTML +
        renderContent(msg) +
        '<div class="msg-actions">' +
          '<button class="msg-action" onclick="window.replyTo('' + msg.id + '','' + esc(user.name) + '')">reply</button>' +
        '</div>' +
      '</div>';

    wrap.appendChild(el);
  }

  function renderContent(msg) {
    // Detect if content is a file URL from our server
    try {
      const url = new URL(msg.content);
      const ext = url.pathname.split('.').pop().toLowerCase();
      const imageExts = ['jpg','jpeg','png','gif','webp','svg'];
      if (imageExts.includes(ext)) {
        return '<img class="msg-image" src="' + esc(msg.content) + '" alt="image" onclick="window.open(this.src)" />';
      }
      const filename = decodeURIComponent(url.pathname.split('/').pop());
      return '<a class="msg-file" href="' + esc(msg.content) + '" target="_blank" rel="noopener">' +
        '<span class="msg-file-icon">📎</span>' +
        '<span class="msg-file-name">' + esc(filename) + '</span>' +
      '</a>';
    } catch {}
    return '<div class="msg-text">' + esc(msg.content) + '</div>';
  }

  function appendDateDivider(wrap, timestamp) {
    const d = document.createElement('div');
    d.className = 'date-divider';
    d.textContent = new Date(timestamp).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    wrap.appendChild(d);
  }

  function scrollToBottom() {
    const wrap = document.getElementById('messages');
    wrap.scrollTop = wrap.scrollHeight;
  }

  // ── Realtime ──────────────────────────────────────────────────────────────
  function subscribeRealtime(roomId) {
    if (realtimeSub) db.removeChannel(realtimeSub);
    realtimeSub = db.channel('room:' + roomId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: 'room_id=eq.' + roomId,
      }, async payload => {
        const msg = payload.new;
        // Fetch user profile for the new message
        const { data: user } = await db.from('users').select('name,hash,color').eq('id', msg.user_id).maybeSingle();
        msg.users = user;

        const wrap = document.getElementById('messages');
        const lastMsg = wrap.querySelector('.msg:last-child');
        const lastUserId = lastMsg?.dataset?.userId;
        appendMessage(wrap, msg, msg.user_id === lastUserId);
        scrollToBottom();

        // Notify if not sent by us
        if (msg.user_id !== session.user.id) {
          Notifications.notify({
            senderName:  user?.name || 'someone',
            senderHash:  '#' + (user?.hash || '?'),
            senderColor: user?.color || '#fff',
            content:     msg.content,
            roomName:    currentRoomName,
            isDM:        currentRoomIsDM,
          });
        }
      })
      .subscribe();
  }

  // ── Send message ──────────────────────────────────────────────────────────
  window.sendMessage = async function() {
    const input = document.getElementById('msg-input');
    const content = input.value.trim();
    if (!content || !currentRoomId) return;

    const btn = document.getElementById('send-btn');
    btn.disabled = true;
    input.value = '';
    autoResize(input);

    try {
      const { data: { session: s } } = await db.auth.getSession();
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + s.access_token,
        },
        body: JSON.stringify({
          roomId: currentRoomId,
          content,
          replyId: replyToMsg?.id || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      clearReply();
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      btn.disabled = false;
      input.focus();
    }
  };

  // ── Reply ─────────────────────────────────────────────────────────────────
  window.replyTo = function(msgId, name) {
    replyToMsg = { id: msgId, name };
    const bar = document.getElementById('reply-preview');
    bar.classList.add('visible');
    document.getElementById('reply-text').textContent = '↩ replying to ' + name;
    document.getElementById('msg-input').focus();
  };

  window.clearReply = function() {
    replyToMsg = null;
    document.getElementById('reply-preview')?.classList.remove('visible');
  };

  document.getElementById('reply-cancel').onclick = clearReply;

  // ── File upload ───────────────────────────────────────────────────────────
  document.getElementById('attach-btn').onclick = () =>
    document.getElementById('file-input').click();

  document.getElementById('file-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !currentRoomId) return;
    e.target.value = '';

    const bar   = document.getElementById('upload-bar');
    const fill  = document.getElementById('upload-fill');
    const label = document.getElementById('upload-label');
    bar.classList.add('visible');
    label.textContent = 'uploading ' + file.name + '…';
    fill.style.width = '0%';

    // Fake progress — XHR would give real progress but fetch is simpler
    let prog = 0;
    const tick = setInterval(() => {
      prog = Math.min(prog + 10, 85);
      fill.style.width = prog + '%';
    }, 200);

    try {
      const { data: { session: s } } = await db.auth.getSession();
      const form = new FormData();
      form.append('file', file);
      form.append('roomId', currentRoomId);

      const res = await fetch('/upload/file', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + s.access_token },
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed');
      const { url } = await res.json();

      fill.style.width = '100%';
      clearInterval(tick);

      // Send the URL as a message — renderContent detects it as file/image
      await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + s.access_token,
        },
        body: JSON.stringify({ roomId: currentRoomId, content: url }),
      });
    } catch (err) {
      console.error('Upload error:', err);
      label.textContent = '// upload failed';
    } finally {
      clearInterval(tick);
      setTimeout(() => { bar.classList.remove('visible'); fill.style.width = '0%'; }, 800);
    }
  };

  // ── Modals ────────────────────────────────────────────────────────────────
  function openModal(id)  { document.getElementById(id).classList.add('visible'); }
  function closeModal(id) { document.getElementById(id).classList.remove('visible'); }

  // New room
  document.getElementById('new-room-btn').onclick = () => openModal('room-modal');
  document.getElementById('room-modal-cancel').onclick = () => closeModal('room-modal');
  document.getElementById('room-modal-create').onclick = async () => {
    const name = document.getElementById('room-name-input').value.trim().toLowerCase();
    const desc = document.getElementById('room-desc-input').value.trim();
    const status = document.getElementById('room-modal-status');
    if (!name) { status.textContent = '// name required'; return; }

    const { data: room, error } = await db.from('rooms')
      .insert({ name, description: desc, is_dm: false })
      .select().single();
    if (error) { status.textContent = '// ' + error.message; return; }

    await db.from('room_members').insert({ room_id: room.id, user_id: session.user.id });
    closeModal('room-modal');
    document.getElementById('room-name-input').value = '';
    document.getElementById('room-desc-input').value = '';
    await loadSidebar();
    selectRoom(room.id);
  };

  // Invite
  document.getElementById('invite-btn').onclick = () => openModal('invite-modal');
  document.getElementById('invite-modal-cancel').onclick = () => closeModal('invite-modal');
  document.getElementById('invite-modal-add').onclick = async () => {
    const raw = document.getElementById('invite-hash-input').value.trim().replace(/^#/, '');
    const status = document.getElementById('invite-modal-status');
    if (!raw) { status.textContent = '// hash required'; return; }

    const { data: user } = await db.from('users').select('id').eq('hash', raw).maybeSingle();
    if (!user) { status.textContent = '// user not found'; return; }

    const { error } = await db.from('room_members')
      .upsert({ room_id: currentRoomId, user_id: user.id }, { onConflict: 'room_id,user_id' });
    if (error) { status.textContent = '// ' + error.message; return; }

    closeModal('invite-modal');
    document.getElementById('invite-hash-input').value = '';
  };

  // DM
  document.getElementById('new-dm-btn').onclick = () => openModal('dm-modal');
  document.getElementById('dm-modal-cancel').onclick = () => closeModal('dm-modal');
  document.getElementById('dm-modal-open').onclick = async () => {
    const raw = document.getElementById('dm-hash-input').value.trim().replace(/^#/, '');
    const status = document.getElementById('dm-modal-status');
    if (!raw) { status.textContent = '// hash required'; return; }
    if (raw === myProfile.hash) { status.textContent = '// that\'s you'; return; }

    const { data: other } = await db.from('users').select('id,hash').eq('hash', raw).maybeSingle();
    if (!other) { status.textContent = '// user not found'; return; }

    // Canonical room name: dm:smaller:larger
    const hashes = [myProfile.hash, other.hash].sort();
    const roomName = 'dm:' + hashes[0] + ':' + hashes[1];

    let { data: room } = await db.from('rooms').select('*').eq('name', roomName).maybeSingle();
    if (!room) {
      const { data: newRoom, error } = await db.from('rooms')
        .insert({ name: roomName, is_dm: true }).select().single();
      if (error) { status.textContent = '// ' + error.message; return; }
      room = newRoom;
      await db.from('room_members').insert([
        { room_id: room.id, user_id: session.user.id },
        { room_id: room.id, user_id: other.id },
      ]);
    }

    closeModal('dm-modal');
    document.getElementById('dm-hash-input').value = '';
    await loadSidebar();
    selectRoom(room.id);
  };

  // ── Sign out ──────────────────────────────────────────────────────────────
  document.getElementById('signout-btn').onclick = () => Auth.signout();
  document.getElementById('settings-btn').onclick = () => window.location.href = '/settings.html';

  // ── Input helpers ─────────────────────────────────────────────────────────
  window.autoResize = function(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  document.getElementById('msg-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      window.sendMessage();
    }
  });

  document.getElementById('msg-input').addEventListener('input', function() {
    autoResize(this);
  });

  // ── Mobile ────────────────────────────────────────────────────────────────
  function showMain() {
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('main').classList.add('visible');
  }
  window.showSidebar = function() {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('main').classList.remove('visible');
  };
  document.getElementById('back-btn').onclick = window.showSidebar;

  // ── Utils ─────────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hideLoading() {
    const el = document.getElementById('loading');
    if (el) { el.classList.add('hidden'); setTimeout(() => el.remove(), 500); }
  }
})();
