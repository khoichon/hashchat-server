const express = require('express');
const multer  = require('multer');
const { requireAuth } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimit');
const { supabaseAdmin } = require('../lib/supabase');

const router  = express.Router();
const storage = multer.memoryStorage();
const upload  = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB

// POST /upload/file
router.post('/file', uploadLimiter, requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { roomId } = req.body;
    if (!req.file || !roomId) return res.status(400).json({ error: 'missing file or roomId' });

    const ext      = req.file.originalname.split('.').pop();
    const fileName = req.user.id + '/' + Date.now() + '.' + ext;
    const bucket   = 'chat-uploads';

    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabaseAdmin.storage.from(bucket).getPublicUrl(fileName);
    res.json({ url: publicUrl, name: req.file.originalname, size: req.file.size });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'upload failed' });
  }
});

// DELETE /upload/file
router.delete('/file', requireAuth, async (req, res) => {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'missing path' });
    if (!path.startsWith(req.user.id + '/')) return res.status(403).json({ error: 'not your file' });
    const { error } = await supabaseAdmin.storage.from('chat-uploads').remove([path]);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'delete failed' });
  }
});

module.exports = router;
