const { supabaseAnon } = require('../lib/supabase');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing or malformed token' });
  }
  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabaseAnon.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
  req.user = user;
  next();
}

module.exports = { requireAuth };
