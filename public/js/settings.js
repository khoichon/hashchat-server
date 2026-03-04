// Auth helpers — login, signup, session guard
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

  // Redirect to login if no session — call at top of protected pages
  async function requireAuth() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      window.location.href = '/index.html';
      return null;
    }
    return session;
  }

  // Redirect to app if already logged in — call on login page
  async function redirectIfAuthed() {
    const { data: { session } } = await db.auth.getSession();
    if (session) window.location.href = '/app.html';
  }

  return { login, signup, signout, requireAuth, redirectIfAuthed };
})();
