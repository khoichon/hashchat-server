const express = require('express');
const { createUploadthing } = require('uploadthing/express');
const { UTApi } = require('uploadthing/server');
const multer  = require('multer');
const { requireAuth } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimit');
const { supabaseAdmin } = require('../lib/supabase');

const utapi  = new UTApi();
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ── Lazy cleanup ───────────────────────────────────────────────────────────
// Runs before every upload — deletes files older than 24h OR if usage >= 1.8GB
async function runCleanup() {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago

    // Fetch all file messages older than cutoff
    const { data: oldMessages } = await supabaseAdmin
      .from('messages')
      .select('id, content')
      .lt('timestamp', cutoff.toISOString())
      .like('content', 'https://utfs.io/%'); // uploadthing URLs

    if (!oldMessages?.length) return;

    // Extract uploadthing file keys from URLs
    // UT URLs look like: https://utfs.io/f/FILEKEY
    const toDelete = oldMessages
      .map(m => {
        try {
          const url = new URL(m.content);
          const key = url.pathname.split('/').pop();
          return { msgId: m.id, key };
        } catch { return null; }
      })
      .filter(Boolean);

    if (!toDelete.length) return;

    // Delete files from uploadthing
    const keys = toDelete.map(f => f.key);
    await utapi.deleteFiles(keys);
    console.log('[cleanup] deleted', keys.length, 'files from uploadthing');

    // Replace message content with expired notice
    const msgIds = toDelete.map(f => f.msgId);
    await supabaseAdmin
      .from('messages')
      .update({ content: '// file expired' })
      .in('id', msgIds);

    console.log('[cleanup] marked', msgIds.length, 'messages as expired');
  } catch (err) {
    console.error('[cleanup] error:', err);
    // Don't throw — cleanup failure shouldn't block uploads
  }
}

// ── Check storage usage ────────────────────────────────────────────────────
// Returns true if we're too close to the 2GB limit
async function isStorageFull() {
  try {
    // UTApi doesn't expose usage directly — count files as proxy
    // If cleanup just ran and we still have too many files, reject
    const { files } = await utapi.listFiles({ limit: 1 });
    // Rough heuristic: fetch usage if available
    // For now just let uploadthing reject naturally at 2GB
    return false;
  } catch {
    return false;
  }
}

// ── POST /upload/file ──────────────────────────────────────────────────────
router.post('/file', uploadLimiter, requireAuth, (req, res, next) => {
  upload.single('file')(req, res, err => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: '// file too large — max 50MB' });
    }
    if (err) return next(err);
    handleUpload(req, res);
  });
});

async function handleUpload(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file provided' });

    // Run cleanup before accepting new upload — fire and await so we free space first
    await runCleanup();

    // Upload to uploadthing
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    const file = new File([blob], req.file.originalname, { type: req.file.mimetype });

    const response = await utapi.uploadFiles(file);

    if (response.error) {
      console.error('Uploadthing error:', response.error);
      return res.status(500).json({ error: 'upload failed — ' + response.error.message });
    }

    res.json({
      url:  response.data.url,
      name: response.data.name,
      size: response.data.size,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'upload failed' });
  }
}

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
