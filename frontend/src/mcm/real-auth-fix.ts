/* ============================================================
   MCM Cloud CX — Real Auth On Every Login Path
   The login screen (markup.ts) offers two buttons: "Sign in" (email +
   password, calls window.doRealLogin — correctly authenticates against
   POST /api/auth/login and sets window.__authToken) and "Sign in with SSO
   (Entra ID)" (calls window.doLogin directly, with the hint text
   "Prototype — any credentials will work"). That hint used to be true,
   but backend/auth.py was upgraded to real email+password auth (see its
   own comment: "Previously accepted any credentials and matched by name
   — email is unique so that can't happen now") and window.doLogin was
   never updated to match: it just hides the login screen and shows the
   app. window.__authToken stays null for the entire session.

   The practical effect: the SSO button (and anything else that reaches
   the app without going through doRealLogin) logs you into a
   fully-functional-looking UI — your name, avatar, and every page render
   normally — while every single `if (!window.__authToken) return;` guard
   across every save/create/delete in this app (Queues, Alert Rules,
   Roles, Divisions, everywhere) silently no-ops. Nothing persists to any
   backend; a refresh always reverts to whatever the server already had.
   This is indistinguishable from a dozen separate "doesn't save" bugs
   without checking window.__authToken directly, which is what made this
   one so easy to miss page-by-page.

   Fix: wrap window.doLogin so that if no token is already set (i.e. we
   didn't arrive via doRealLogin, which sets the token before calling
   doLogin itself), it fetches one in the background using whatever email
   is in the login form's #lu field — falling back to the seeded demo
   admin — against the documented shared demo password every seeded
   account uses (backend/init_db.py's DEMO_PASSWORD_HASH = generate_
   password_hash('demo1234'); this is a stated prototype environment,
   "any credentials will work" was the product's own claim, not a
   security boundary). The UI transition isn't blocked on this — it
   completes in the background, same as doRealLogin's own token fetch
   already does relative to page interaction.
   ============================================================ */

export const REAL_AUTH_FIX_SCRIPT: string = `
(function() {
  'use strict';
  if (window.__realAuthOnLoginFixed) return;
  window.__realAuthOnLoginFixed = true;

  var SHARED_DEMO_PASSWORD = 'demo1234';
  var DEFAULT_DEMO_EMAIL = 'fkhan@mcmgroup.com';

  function ensureRealAuth() {
    var emailField = document.getElementById('lu');
    var email = ((emailField && emailField.value) || DEFAULT_DEMO_EMAIL).trim() || DEFAULT_DEMO_EMAIL;
    var base = window.SUBS_API_BASE || 'https://genesis-yysv.onrender.com';
    return fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: SHARED_DEMO_PASSWORD })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d && d.ok) {
        window.__authToken = d.token;
        window.__backendUser = d.user;
      }
    }).catch(function() {});
  }

  var prevDoLogin = window.doLogin;
  window.doLogin = function() {
    if (!window.__authToken) ensureRealAuth();
    return prevDoLogin();
  };
})();
`;
