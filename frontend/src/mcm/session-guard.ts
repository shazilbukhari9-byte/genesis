/* ============================================================
   MCM Cloud CX — Session guard

   Fixes a signed-in session that has stopped being valid.

   The session-persistence block in scripts.ts saves the bearer token to
   localStorage and, on the next boot, restores it straight into
   window.__authToken and replays doLogin() — without ever asking the
   backend whether that token is still good. Tokens are opaque random
   strings kept in the `sessions` table with an expires_at (see
   backend/auth.py), so a token stops working when it expires
   (OG_TOKEN_TTL_HOURS, 12h by default), when the row is removed, or when
   the frontend is pointed at a different backend/database than the one
   that issued it.

   When that happened the app still *looked* signed in: the shell rendered,
   every page loaded, and each API call quietly came back
   401 {"error":"invalid or expired token"}. Pages surfaced that as their own
   error ("Could not load installed integrations (401)"), so the user saw a
   data-loading failure rather than an expired session, and nothing ever
   cleared the dead token — reloading just restored it again. The only way
   out was to clear site data by hand.

   This does three things, none of which weaken authentication:

     1. Validates a restored token once on boot against GET /api/auth/me
        (an authenticated route) and drops the session if it is rejected.
     2. Treats a 401 from any later API call as "this session is over":
        clears it and returns to sign-in with an explanation, so an
        expiry mid-session self-heals instead of wedging the UI.
     3. Reports the specific misconfiguration where a deployed frontend is
        still pointing at http://127.0.0.1:5000 because VITE_API_BASE was
        never set for the build, which otherwise shows up as an
        indistinguishable network error or 401.

   Everything here is client-side session hygiene. Tokens are still issued
   and verified entirely by the backend; nothing is bypassed, and no request
   is retried without a valid token.
   ============================================================ */

export const SESSION_GUARD_SCRIPT = `
(function(){
  var SESSION_KEY = 'mcm_session';
  var apiBase = window.__GENESIS_API_BASE || window.SUBS_API_BASE || '';

  /* A 401 from the login/signup routes is a normal "wrong credentials"
     answer, not a dead session — never treat those as an expiry. */
  function isAuthEntryPoint(url){
    return url.indexOf('/api/auth/login') > -1
        || url.indexOf('/api/auth/signup') > -1
        || url.indexOf('/api/auth/sso/') > -1
        || url.indexOf('/api/oauth/token') > -1;
  }

  function isOurApi(url){
    if (url.indexOf('/api/') === -1) return false;
    if (url.charAt(0) === '/') return true;
    return apiBase && url.indexOf(apiBase) === 0;
  }

  /* The deployed-frontend-without-a-backend case. A page served from a
     real host whose API base is loopback is talking to whatever happens to
     be on the *visitor's* machine, which is a build configuration problem
     (VITE_API_BASE unset at build time), not a credentials problem. */
  function apiBaseIsLoopback(){
    return /^https?:\\/\\/(127\\.0\\.0\\.1|localhost|\\[::1\\])(:|\\/|$)/i.test(apiBase || '');
  }
  function pageIsRemote(){
    return !/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/i.test(location.hostname);
  }
  var MISCONFIGURED = pageIsRemote() && apiBaseIsLoopback();

  function misconfigMessage(){
    return 'This deployment has no backend configured: it is calling '
      + apiBase + ', which is not reachable from a hosted page. '
      + 'Set VITE_API_BASE to the deployed backend URL and rebuild.';
  }
  window.__mcmApiMisconfigured = MISCONFIGURED;
  window.__mcmMisconfigMessage = MISCONFIGURED ? misconfigMessage() : '';

  if (MISCONFIGURED && window.console && console.error) {
    console.error('[MCM] ' + misconfigMessage());
  }

  var clearing = false;

  /* Drop every trace of the session and return to the sign-in screen.
     Deliberately does NOT call /api/auth/logout: the token is already
     rejected, so there is nothing on the server left to revoke. */
  function endDeadSession(reason){
    if (clearing) return;
    clearing = true;
    try { localStorage.removeItem(SESSION_KEY); } catch(e){}
    window.__authToken = null;
    window.__backendUser = null;
    try { if (window.signOut) window.signOut(); } catch(e){}
    var message = MISCONFIGURED ? misconfigMessage() : reason;
    try {
      if (window.toast) window.toast('\\u2717 ' + message);
    } catch(e){}
    showSignInNotice(message);
    /* Let a later successful sign-in re-arm the guard. */
    setTimeout(function(){ clearing = false; }, 1500);
  }
  window.__mcmEndDeadSession = endDeadSession;

  /* Puts the reason on the login screen itself, so the user is told why
     they are being asked to sign in again instead of just landing there. */
  function showSignInNotice(message){
    try {
      var login = document.getElementById('login');
      if (!login) return;
      var box = document.getElementById('mcm_session_notice');
      if (!box) {
        box = document.createElement('div');
        box.id = 'mcm_session_notice';
        box.style.cssText = 'margin:0 0 14px;padding:10px 12px;border-radius:8px;'
          + 'background:#fdeceb;border:1px solid #f3c6c2;color:#b3261e;'
          + 'font-size:13px;line-height:1.45;max-width:420px';
        var card = login.querySelector('.card') || login.firstElementChild || login;
        card.insertBefore(box, card.firstChild);
      }
      box.textContent = message;
    } catch(e){}
  }

  /* ---- 1. Validate a restored token once, on boot ---------------------
     scripts.ts has already replayed doLogin() by this point, so the shell
     is up; this confirms the token behind it is real and tears the session
     down if it is not. */
  function validateRestoredSession(){
    if (!window.__authToken) return;
    if (MISCONFIGURED) {
      endDeadSession(misconfigMessage());
      return;
    }
    fetch(apiBase + '/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + window.__authToken }
    }).then(function(r){
      if (r.status === 401) {
        endDeadSession('Your session has expired. Please sign in again.');
      }
      /* Any other status (200, or a 5xx/network blip) leaves the session
         alone — only an explicit 401 means the token is no longer valid. */
    }).catch(function(){
      /* Backend unreachable is not an authentication failure. Leave the
         session intact so a transient outage doesn't sign the user out. */
    });
  }

  /* ---- 2. Any later 401 ends the session ------------------------------ */
  var nativeFetch = window.fetch;
  window.fetch = function(input, init){
    var url = '';
    try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch(e){}
    var watch = isOurApi(url) && !isAuthEntryPoint(url);
    return nativeFetch.apply(this, arguments).then(function(response){
      if (watch && response.status === 401 && window.__authToken) {
        endDeadSession('Your session has expired. Please sign in again.');
      }
      return response;
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(validateRestoredSession, 0); });
  } else {
    setTimeout(validateRestoredSession, 0);
  }
})();
`;
