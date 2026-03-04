const express = require('express');
const { UTApi, UTFile } = require('uploadthing/server');
const { requireAuth } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimit');
const { supabaseAdmin } = require('../lib/supabase');

const utapi  = new UTApi();
const router = express.Router();

// ── Lazy cleanup ───────────────────────────────────────────────────────────
async function runCleanup() {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { data: oldMessages } = await supabaseAdmin
      .from('messages')
      .select('id, content')
      .lt('timestamp', cutoff.toISOString())
      .like('content', 'https://utfs.io/%');

    if (!oldMessages?.length) return;

    const toDelete = oldMessages.map(m => {
      try {
        const key = new URL(m.content).pathname.split('/').pop();
        return { msgId: m.id, key };
      } catch { return null; }
    }).filter(Boolean);

    if (!toDelete.length) return;

    await utapi.deleteFiles(toDelete.map(f => f.key));
    await supabaseAdmin
      .from('messages')
      .update({ content: '// file expired' })
      .in('id', toDelete.map(f => f.msgId));

    console.log('[cleanup] expired', toDelete.length, 'files');
  } catch (err) {
    console.error('[cleanup] error:', err);
  }
}

// ── GET /upload/presign ────────────────────────────────────────────────────
// Client calls this to get a presigned URL, then uploads directly to UT
router.get('/presign', requireAuth, uploadLimiter, async (req, res) => {
  try {
    await runCleanup();

    const { filename, filetype } = req.query;
    if (!filename || !filetype) {
      return res.status(400).json({ error: 'missing filename or filetype' });
    }

    // Generate a presigned URL via UTApi
    const presigned = await utapi.generatePresignedUrls([
      { name: filename, type: filetype, size: 50 * 1024 * 1024 }
    ]);

    if (!presigned?.[0]) {
      return res.status(500).json({ error: 'failed to generate presigned url' });
    }

    const { url, key, fileUrl } = presigned[0];
    res.json({ uploadUrl: url, key, fileUrl });
  } catch (err) {
    console.error('Presign error:', err);
    res.status(500).json({ error: 'failed to generate upload url' });
  }
});

// ── DELETE /upload/file ────────────────────────────────────────────────────
router.delete('/file', requireAuth, async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'missing key' });
    await utapi.deleteFiles([key]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'delete failed' });
  }
});

module.exports = router;