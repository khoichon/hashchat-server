// HashChat — main app logic

(async () => {
  const session = await Auth.requireAuth();
  if (!session) return;

  let currentRoomId   = null;
  let currentRoomName = '';
  let currentRoomIsDM = false;
  let replyToMsg      = null;
  let myProfile       = null;
  let realtimeSub     = null;

  const GENERAL_ID = '00000000-0000-0000-0000-000000000001';

  await Notifications.init();
  await loadProfile();
  await ensureGeneralMembership();
  await loadSidebar();
  hideLoading();

  const params = new URLSearchParams(location.search);
  const targetRoom = params.get('room');
  if (targetRoom) selectRoom(targetRoom);
  else selectRoom(GENERAL_ID);

  navigator.serviceWorker?.addEventListener('message', e => {
    if (e.data?.type === 'FOCUS_ROOM') selectRoom(e.data.roomId);
  });

  window.addEventListener('focus', () => Notifications.clearBadge());

  // Profile
  async function loadProfile(retries = 5) {
    for (let i = 0; i < retries; i++) {
      const { data } = await db.from('users').select('*').eq('id', session.user.id).maybeSingle();
      if (data) { myProfile = data; break; }
      await new Promise(r => setTimeout(r, 600));
    }
    if (!myProfile) return;
    const initials = (myProfile.name || '?').slice(0, 2).toUpperCase();
    const av = document.getElementById('user-avatar');
    av.textContent = initials;
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

  // Sidebar
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
    renderRoomList('room-list', rooms);
    await renderDMList('dm-list', dms);
  }

  function renderRoomList(elId, rooms) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    for (const room of rooms) {
      const item = document.createElement('div');
      item.className = 'room-item';
      item.dataset.id = room.id;
      const prefix = document.createElement('span');
      prefix.className = 'room-prefix';
      prefix.textContent = '#';
      const name = document.createElement('span');
      name.textContent = room.name;
      item.appendChild(prefix);
      item.appendChild(name);
      item.onclick = () => selectRoom(room.id);
      el.appendChild(item);
    }
  }

  async function renderDMList(elId, dms) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    for (const room of dms) {
      const parts = room.name.split(':');
      const otherHash = parts[1] === myProfile.hash ? parts[2] : parts[1];
      const { data: other } = await db.from('users').select('name,color').eq('hash', otherHash).maybeSingle();
      const item = document.createElement('div');
      item.className = 'room-item';
      item.dataset.id = room.id;
      const dot = document.createElement('span');
      dot.className = 'room-prefix';
      dot.textContent = '\u00b7';
      dot.style.color = other?.color || '#fff';
      dot.style.opacity = '1';
      const name = document.createElement('span');
      name.textContent = other?.name || otherHash;
      item.appendChild(dot);
      item.appendChild(name);
      item.onclick = () => selectRoom(room.id);
      el.appendChild(item);
    }
  }

  function setActiveRoom(roomId) {
    document.querySelectorAll('.room-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === roomId);
    });
  }

  // Room selection
  async function selectRoom(roomId) {
    currentRoomId = roomId;
    clearReply();
    document.getElementById('no-room').style.display = 'none';
    const cv = document.getElementById('chat-view');
    cv.style.display = 'flex';
    setActiveRoom(roomId);
    showMain();
    const { data: room } = await db.from('rooms').select('*').eq('id', roomId).maybeSingle();
    if (!room) return;
    currentRoomName = room.name;
    currentRoomIsDM = room.is_dm;
    document.getElementById('chat-header-name').textContent = room.is_dm ? dmDisplayName(room.name) : room.name;
    document.getElementById('chat-header-desc').textContent = room.description || '';
    document.getElementById('invite-btn').style.display = room.is_dm ? 'none' : '';
    await loadMessages(roomId);
    subscribeRealtime(roomId);
  }

  function dmDisplayName(name) {
    const parts = name.split(':');
    return parts[1] === myProfile?.hash ? parts[2] : parts[1];
  }

  // Messages
  async function loadMessages(roomId) {
    const wrap = document.getElementById('messages');
    wrap.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<div class="empty-state-big">#</div><div>// no messages yet</div>';
    wrap.appendChild(empty);

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
      appendMessage(wrap, msg, msg.user_id === lastUserId);
      lastUserId = msg.user_id;
    }
    scrollToBottom();
  }

  function appendMessage(wrap, msg, collapsed) {
    const user     = msg.users || {};
    const initials = (user.name || '?').slice(0, 2).toUpperCase();
    const color    = user.color || '#4D96FF';
    const time     = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const el = document.createElement('div');
    el.className = 'msg' + (collapsed ? ' collapsed' : '');
    el.dataset.id = msg.id;
    el.dataset.userId = msg.user_id;

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.style.background = color;
    avatar.textContent = initials;

    // Body
    const body = document.createElement('div');
    body.className = 'msg-body';

    // Meta
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const nameEl = document.createElement('span');
    nameEl.className = 'msg-name';
    nameEl.style.color = color;
    nameEl.textContent = user.name || 'anon';
    const hashEl = document.createElement('span');
    hashEl.className = 'msg-hash-tag';
    hashEl.textContent = '#' + (user.hash || '?');
    const timeEl = document.createElement('span');
    timeEl.className = 'msg-time';
    timeEl.textContent = time;
    meta.appendChild(nameEl);
    meta.appendChild(hashEl);
    meta.appendChild(timeEl);
    body.appendChild(meta);

    // Reply
    if (msg.reply_id) {
      const replyEl = document.createElement('div');
      replyEl.className = 'msg-reply';
      replyEl.textContent = '\u21a9 reply';
      body.appendChild(replyEl);
    }

    // Content
    body.appendChild(renderContent(msg));

    // Actions
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const replyBtn = document.createElement('button');
    replyBtn.className = 'msg-action';
    replyBtn.textContent = 'reply';
    replyBtn.onclick = () => window.replyTo(msg.id, user.name || 'anon');
    actions.appendChild(replyBtn);
    body.appendChild(actions);

    el.appendChild(avatar);
    el.appendChild(body);
    wrap.appendChild(el);
  }

  function renderContent(msg) {
    const wrapper = document.createElement('div');

    // Expired file placeholder
    if (msg.content === '// file expired') {
      const expired = document.createElement('div');
      expired.className = 'msg-text';
      expired.style.color = 'var(--text-muted)';
      expired.style.fontFamily = "'Geist Mono', monospace";
      expired.style.fontSize = '0.72rem';
      expired.textContent = '// file expired';
      wrapper.appendChild(expired);
      return wrapper;
    }

    try {
      const url = new URL(msg.content);
      const ext = url.pathname.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) {
        const img = document.createElement('img');
        img.className = 'msg-image';
        img.src = msg.content;
        img.alt = 'image';
        img.onclick = () => window.open(msg.content);
        wrapper.appendChild(img);
        return wrapper;
      }
      const filename = decodeURIComponent(url.pathname.split('/').pop());
      const link = document.createElement('a');
      link.className = 'msg-file';
      link.href = msg.content;
      link.target = '_blank';
      link.rel = 'noopener';
      const icon = document.createElement('span');
      icon.className = 'msg-file-icon';
      icon.textContent = '\ud83d\udcce';
      const nameEl = document.createElement('span');
      nameEl.className = 'msg-file-name';
      nameEl.textContent = filename;
      link.appendChild(icon);
      link.appendChild(nameEl);
      wrapper.appendChild(link);
      return wrapper;
    } catch {}
    const text = document.createElement('div');
    text.className = 'msg-text';
    text.textContent = msg.content;
    wrapper.appendChild(text);
    return wrapper;
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

  // Realtime
  function subscribeRealtime(roomId) {
    if (realtimeSub) db.removeChannel(realtimeSub);
    realtimeSub = db.channel('room:' + roomId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: 'room_id=eq.' + roomId,
      }, async payload => {
        const msg = payload.new;
        const { data: user } = await db.from('users').select('name,hash,color').eq('id', msg.user_id).maybeSingle();
        msg.users = user;
        const wrap = document.getElementById('messages');
        const lastMsg = wrap.querySelector('.msg:last-child');
        appendMessage(wrap, msg, lastMsg?.dataset?.userId === msg.user_id);
        scrollToBottom();
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

  // Send
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
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.access_token },
        body: JSON.stringify({ roomId: currentRoomId, content, replyId: replyToMsg?.id || null }),
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

  // Reply
  window.replyTo = function(msgId, name) {
    replyToMsg = { id: msgId, name };
    document.getElementById('reply-preview').classList.add('visible');
    document.getElementById('reply-text').textContent = '\u21a9 replying to ' + name;
    document.getElementById('msg-input').focus();
  };

  function clearReply() {
    replyToMsg = null;
    document.getElementById('reply-preview')?.classList.remove('visible');
  }
  window.clearReply = clearReply;
  document.getElementById('reply-cancel').onclick = clearReply;

  // File upload
  document.getElementById('attach-btn').onclick = () => {
    Notifications.showToast({
      senderName: 'system',
      senderColor: 'var(--text-muted)',
      content: 'file uploads temporarily unavailable',
      roomName: 'system',
      isDM: false,
    });
  };
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

    try {
      const { data: { session: s } } = await db.auth.getSession();

      // Step 1: get presigned URL from our server
      const presignRes = await fetch(
        '/upload/presign?filename=' + encodeURIComponent(file.name) +
        '&filetype=' + encodeURIComponent(file.type || 'application/octet-stream'),
        { headers: { 'Authorization': 'Bearer ' + s.access_token } }
      );
      if (!presignRes.ok) throw new Error('failed to get upload url');
      const { uploadUrl, fileUrl } = await presignRes.json();

      fill.style.width = '30%';

      // Step 2: upload directly to Uploadthing from the browser
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('upload to storage failed');

      fill.style.width = '85%';

      // Step 3: send file URL as a message
      const { data: { session: s2 } } = await db.auth.getSession();
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s2.access_token },
        body: JSON.stringify({ roomId: currentRoomId, content: fileUrl }),
      });

      fill.style.width = '100%';
    } catch (err) {
      console.error('Upload error:', err);
      label.textContent = '// upload failed';
    } finally {
      setTimeout(() => { bar.classList.remove('visible'); fill.style.width = '0%'; }, 800);
    }
  };

  // Modals
  function openModal(id)  { document.getElementById(id).classList.add('visible'); }
  function closeModal(id) {
    document.getElementById(id).classList.remove('visible');
    document.getElementById(id).querySelectorAll('.modal-status').forEach(el => el.textContent = '');
  }

  document.getElementById('new-room-btn').onclick = () => openModal('room-modal');
  document.getElementById('room-modal-cancel').onclick = () => closeModal('room-modal');
  document.getElementById('room-modal-create').onclick = async () => {
    const name = document.getElementById('room-name-input').value.trim().toLowerCase();
    const desc = document.getElementById('room-desc-input').value.trim();
    const status = document.getElementById('room-modal-status');
    if (!name) { status.textContent = '// name required'; return; }
    const { data: room, error } = await db.from('rooms').insert({ name, description: desc, is_dm: false }).select().single();
    if (error) { status.textContent = '// ' + error.message; return; }
    await db.from('room_members').insert({ room_id: room.id, user_id: session.user.id });
    closeModal('room-modal');
    document.getElementById('room-name-input').value = '';
    document.getElementById('room-desc-input').value = '';
    await loadSidebar();
    selectRoom(room.id);
  };

  document.getElementById('invite-btn').onclick = () => openModal('invite-modal');
  document.getElementById('invite-modal-cancel').onclick = () => closeModal('invite-modal');
  document.getElementById('invite-modal-add').onclick = async () => {
    const raw = document.getElementById('invite-hash-input').value.trim();
    const status = document.getElementById('invite-modal-status');
    if (!raw) { status.textContent = '// hash required'; return; }
    const btn = document.getElementById('invite-modal-add');
    btn.disabled = true;
    try {
      const { data: { session: s } } = await db.auth.getSession();
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.access_token },
        body: JSON.stringify({ toHash: raw, roomId: currentRoomId }),
      });
      const data = await res.json();
      if (!res.ok) { status.textContent = '// ' + data.error; return; }
      status.textContent = '// invite sent!';
      setTimeout(() => { closeModal('invite-modal'); document.getElementById('invite-hash-input').value = ''; }, 1000);
    } catch (err) {
      status.textContent = '// failed to send invite';
    } finally {
      btn.disabled = false;
    }
  };

  document.getElementById('new-dm-btn').onclick = () => openModal('dm-modal');
  document.getElementById('dm-modal-cancel').onclick = () => closeModal('dm-modal');
  document.getElementById('dm-modal-open').onclick = async () => {
    const raw = document.getElementById('dm-hash-input').value.trim();
    const status = document.getElementById('dm-modal-status');
    if (!raw) { status.textContent = '// hash required'; return; }
    const hash = raw.replace(/^#/, '');
    if (hash === myProfile.hash) { status.textContent = '// that is you'; return; }
    const btn = document.getElementById('dm-modal-open');
    btn.disabled = true;
    try {
      const { data: { session: s } } = await db.auth.getSession();
      // Check if DM room already exists
      const hashes = [myProfile.hash, hash].sort();
      const roomName = 'dm:' + hashes[0] + ':' + hashes[1];
      const { data: existingRoom } = await db.from('rooms').select('id').eq('name', roomName).maybeSingle();
      if (existingRoom) {
        // Already have a DM with this person — just open it
        closeModal('dm-modal');
        document.getElementById('dm-hash-input').value = '';
        await loadSidebar();
        selectRoom(existingRoom.id);
        return;
      }
      // Send a DM invite via server — server creates the room + adds sender, sends push to recipient
      const res = await fetch('/api/invites/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.access_token },
        body: JSON.stringify({ toHash: raw }),
      });
      const data = await res.json();
      if (!res.ok) { status.textContent = '// ' + data.error; return; }
      status.textContent = '// invite sent — waiting for them to accept';
      setTimeout(() => { closeModal('dm-modal'); document.getElementById('dm-hash-input').value = ''; }, 1500);
    } catch (err) {
      status.textContent = '// failed to send dm invite';
    } finally {
      btn.disabled = false;
    }
  };

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('visible'); };
  });

  document.getElementById('signout-btn').onclick = () => Auth.signout();
  document.getElementById('settings-btn').onclick = () => window.location.href = '/settings.html';

  window.autoResize = function(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  document.getElementById('msg-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendMessage(); }
  });
  document.getElementById('msg-input').addEventListener('input', function() { autoResize(this); });

  function showMain() {
    if (window.innerWidth <= 600) {
      document.getElementById('sidebar').classList.add('hidden');
      document.getElementById('main').classList.add('visible');
    }
  }
  window.showSidebar = function() {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('main').classList.remove('visible');
  };
  document.getElementById('back-btn').onclick = window.showSidebar;

  function hideLoading() {
    const el = document.getElementById('loading');
    if (el) { el.classList.add('hidden'); setTimeout(() => el.remove(), 500); }
  }
})();