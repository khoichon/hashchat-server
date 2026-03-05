// Auth helpers
const Auth = (() => {
  async function login(email, password) {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signup(email, password) {
    const { data, error } = await db.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signout() {
    await db.auth.signOut();
    window.location.href = '/index.html';
  }

  // Redirect to login if no session — also checks onboarding status
  async function requireAuth() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { window.location.href = '/index.html'; return null; }

    // Check onboarded — skip check if already on onboarding page
    if (!window.location.pathname.includes('onboarding')) {
      const { data: profile } = await db.from('users').select('onboarded').eq('id', session.user.id).maybeSingle();
      if (profile && !profile.onboarded) {
        window.location.href = '/onboarding.html';
        return null;
      }
    }

    return session;
  }

  async function redirectIfAuthed() {
    const { data: { session } } = await db.auth.getSession();
    if (session) window.location.href = '/app.html';
  }

  return { login, signup, signout, requireAuth, redirectIfAuthed };
})();
