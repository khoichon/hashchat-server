// HashChat settings page logic
(async () => {
  const COLORS = ['#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#FF6BFF','#FF9F43','#00D2D3','#A29BFE','#fd79a8','#55efc4','#fdcb6e','#74b9ff'];

  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = '/index.html'; return; }

  let profile = null;
  let selectedColor = null;

  // ── Load profile ──────────────────────────────────────────────────────────
  async function loadProfile() {
    const { data } = await db.from('users').select('*').eq('id', session.user.id).maybeSingle();
    if (!data) return;
    profile = data;
    selectedColor = data.color;

    document.getElementById('preview-name').textContent = data.name || 'anon';
    document.getElementById('preview-hash').textContent = '#' + data.hash;
    document.getElementById('name-input').value = data.name || '';

    const av = document.getElementById('preview-avatar');
    av.textContent    = (data.name || '?').slice(0, 2).toUpperCase();
    av.style.background = data.color || '#4D96FF';

    renderColors();
  }

  // ── Color swatches ────────────────────────────────────────────────────────
  function renderColors() {
    const grid = document.getElementById('color-grid');
    grid.innerHTML = '';
    for (const color of COLORS) {
      const sw = document.createElement('div');
      sw.className = 'swatch' + (color === selectedColor ? ' selected' : '');
      sw.style.background = color;
      sw.onclick = () => selectColor(color);
      grid.appendChild(sw);
    }
  }

  async function selectColor(color) {
    selectedColor = color;
    renderColors();
    document.getElementById('preview-avatar').style.background = color;

    const { error } = await db.from('users').update({ color }).eq('id', session.user.id);
    setStatus('color-status', error ? '// ' + error.message : '// saved', error ? 'error' : 'success');
  }

  // ── Save name ─────────────────────────────────────────────────────────────
  window.saveName = async function() {
    const name = document.getElementById('name-input').value.trim();
    if (!name) { setStatus('name-status', '// name required', 'error'); return; }

    const { error } = await db.from('users').update({ name }).eq('id', session.user.id);
    if (!error) {
      document.getElementById('preview-name').textContent = name;
      document.getElementById('preview-avatar').textContent = name.slice(0, 2).toUpperCase();
    }
    setStatus('name-status', error ? '// ' + error.message : '// saved', error ? 'error' : 'success');
  };

  // ── Notifications ─────────────────────────────────────────────────────────
  async function initNotifToggle() {
    const toggle = document.getElementById('notif-toggle');
    const desc   = document.getElementById('notif-desc');

    if (!('Notification' in window)) {
      desc.textContent = '// not supported in this browser';
      toggle.disabled = true;
      return;
    }
    if (Notification.permission === 'denied') {
      desc.textContent = '// blocked — enable in browser settings';
      toggle.disabled = true;
      return;
    }
    toggle.checked = Notification.permission === 'granted';
  }

  window.toggleNotifications = async function(el) {
    if (el.checked) {
      const granted = await Notifications.requestPermission();
      el.checked = granted;
      if (!granted) document.getElementById('notif-desc').textContent = '// permission denied';
    } else {
      await Notifications.unsubscribe();
    }
  };

  // ── Change password ───────────────────────────────────────────────────────
  window.changePassword = async function() {
    const pw  = document.getElementById('new-password').value;
    const pw2 = document.getElementById('confirm-password').value;
    if (!pw)       { setStatus('password-status', '// password required', 'error'); return; }
    if (pw !== pw2) { setStatus('password-status', '// passwords do not match', 'error'); return; }
    if (pw.length < 8) { setStatus('password-status', '// min 8 characters', 'error'); return; }

    const { error } = await db.auth.updateUser({ password: pw });
    setStatus('password-status', error ? '// ' + error.message : '// password updated', error ? 'error' : 'success');
    if (!error) { document.getElementById('new-password').value = ''; document.getElementById('confirm-password').value = ''; }
  };

  // ── 2FA ───────────────────────────────────────────────────────────────────
  window.toggle2FA = async function() {
    const { data } = await db.auth.mfa.listFactors();
    const totpFactor = data?.totp?.[0];

    if (totpFactor?.status === 'verified') {
      // Unenroll
      await db.auth.mfa.unenroll({ factorId: totpFactor.id });
      document.getElementById('twofa-badge').className = 'badge off';
      document.getElementById('twofa-badge').textContent = 'off';
      document.getElementById('twofa-btn').textContent = 'enable';
    } else {
      // Enroll — show QR (simplified: open supabase flow)
      const { data: enroll, error } = await db.auth.mfa.enroll({ factorType: 'totp', issuer: 'HashChat' });
      if (error) { alert('// 2FA error: ' + error.message); return; }
      // In a real implementation you'd show enroll.totp.qr_code in a modal
      // For now, open it in a new window
      const win = window.open('', '_blank');
      win.document.write('<img src="' + enroll.totp.qr_code + '" /><p>Scan with your authenticator app</p>');
    }
  };

  async function load2FAStatus() {
    const { data } = await db.auth.mfa.listFactors();
    const verified = data?.totp?.some(f => f.status === 'verified');
    document.getElementById('twofa-badge').className = 'badge ' + (verified ? 'on' : 'off');
    document.getElementById('twofa-badge').textContent = verified ? 'on' : 'off';
    document.getElementById('twofa-btn').textContent = verified ? 'disable' : 'enable';
  }

  // ── Delete account ────────────────────────────────────────────────────────
  window.deleteAccount = async function() {
    if (!confirm('// permanently delete your account and all data?\n\nthis cannot be undone.')) return;

    const { data: { session: s } } = await db.auth.getSession();
    const res = await fetch('/admin/delete-account', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + s.access_token },
    });
    if (res.ok) {
      await db.auth.signOut();
      window.location.href = '/index.html';
    } else {
      alert('// delete failed, try again');
    }
  };

  // ── Utils ─────────────────────────────────────────────────────────────────
  function setStatus(id, msg, type) {
    const el = document.getElementById(id);
    el.textContent  = msg;
    el.className    = 's-status ' + (type || '');
    setTimeout(() => { el.textContent = ''; el.className = 's-status'; }, 4000);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  await loadProfile();
  await initNotifToggle();
  await load2FAStatus();
})();
