const { createClient } = require('@supabase/supabase-js');

// Service role bypasses RLS — NEVER expose to client
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Anon client used for JWT verification only
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = { supabaseAdmin, supabaseAnon };
