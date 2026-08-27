"""
Auth (Section 13). Everything under /api requires a bearer token except a
short allow-list: /api/health and /api/auth/login (the doc also exempts
Twilio's signature-verified webhooks and /voice/hold-music, but neither
exists here — no Twilio account).

A real JWT needs signing infrastructure this single-server dev backend
doesn't have; an opaque token looked up in `sessions` does the same job
for a bearer-token guard, which is what actually matters here.
"""

import secrets
from datetime import datetime, timedelta, timezone
from flask import Blueprint, jsonify, request, g
from werkzeug.security import generate_password_hash, check_password_hash

from db import get_db
from mailer import mail_configured, send_email
import config

auth_bp = Blueprint('auth', __name__)

INVITE_TTL_DAYS = 7

TOKEN_TTL_HOURS = config.TOKEN_TTL_HOURS

# Paths that never require a token. Prefixes, not exact matches, so
# /api/auth/login itself and /api/health both pass with a simple startswith.
PUBLIC_PATHS = (
    '/api/auth/login', '/api/auth/signup', '/api/health',
    # Telnyx webhooks — Telnyx can't send our bearer token, so these are
    # public and rely on Telnyx's own Ed25519 webhook signature instead
    # (see telephony.py's _verify_telnyx_signature).
    '/api/telephony/sms-webhook', '/api/telephony/voice-webhook',
    # SSO — user hasn't authenticated yet, that's the whole point
    '/api/auth/sso/begin', '/api/auth/sso/callback',
    '/api/auth/sso/providers', '/api/auth/sso/check-domain',
    # Invite acceptance — same reasoning: the invited person has no bearer
    # token yet, that's the whole point of the flow. Both are POST-with-
    # token-in-body (not a dynamic /invite/<token> URL segment), so they
    # fit this exact-match allow-list without needing prefix matching.
    '/api/auth/invite-info', '/api/auth/accept-invite',
    # OAuth token endpoint — client authenticates with its own credentials
    '/api/oauth/token', '/api/oauth/revoke',
    # Salesforce OAuth callback (Integrations Phase 1) — Salesforce
    # redirects the bare browser here with no way to attach our bearer
    # token; tenant/user identity comes from the server-stored state row
    # instead (see salesforce_oauth.py's callback()), same reasoning as
    # the SSO callback above.
    '/api/integrations/salesforce/oauth/callback',
)


def register_auth_guard(app):
    @app.before_request
    def _require_bearer_token():
        path = request.path
        if not path.startswith('/api/') or path in PUBLIC_PATHS or request.method == 'OPTIONS':
            return None

        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return jsonify({'ok': False, 'error': 'missing bearer token'}), 401

        token = header[len('Bearer '):]
        conn = get_db()
        cur = conn.cursor()

        # 1. Try user session token first
        cur.execute(
            """
            SELECT s.user_id, u.name, u.presence, u.tenant_id
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token = %s AND s.expires_at > now()
            """,
            (token,),
        )
        row = cur.fetchone()

        if row is not None:
            conn.close()
            g.user_id = row['user_id']
            g.user_name = row['name']
            g.tenant_id = row['tenant_id']
            return None

        # 2. Try OAuth client token
        cur.execute(
            'SELECT client_id, tenant_id, scopes FROM oauth_tokens WHERE token = %s AND expires_at > now()',
            (token,),
        )
        oauth_row = cur.fetchone()
        conn.close()

        if oauth_row is not None:
            g.user_id = None
            g.user_name = f'oauth:{oauth_row["client_id"]}'
            g.tenant_id = oauth_row['tenant_id']
            g.oauth_scopes = oauth_row['scopes']
            return None

        return jsonify({'ok': False, 'error': 'invalid or expired token'}), 401


@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    """Real auth: looks the user up by email and verifies their password
    hash. Previously accepted any credentials and matched by name, which
    silently logged people into the wrong account whenever the name they
    typed matched someone else — email is unique so that can't happen now."""
    data = request.get_json(force=True) or {}
    email = data.get('email')
    password = data.get('password')
    if not email or not password:
        return jsonify({'ok': False, 'error': 'email and password required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id, name, email, presence, tenant_id, password_hash FROM users WHERE email = %s', (email,))
    user = cur.fetchone()
    if user is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'no account with that email'}), 401
    if not user['password_hash'] or not check_password_hash(user['password_hash'], password):
        conn.close()
        return jsonify({'ok': False, 'error': 'incorrect password'}), 401

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    cur.execute(
        'INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)',
        (token, user['id'], expires_at),
    )
    conn.commit()
    conn.close()

    return jsonify({
        'ok': True,
        'token': token,
        'expires_at': expires_at.isoformat(),
        'user': {'id': user['id'], 'name': user['name'], 'email': user['email'], 'presence': user['presence'], 'tenant_id': user['tenant_id']},
    })


@auth_bp.route('/api/auth/signup', methods=['POST'])
def signup():
    """Real signup — requires a password (hashed, never stored plain), and
    rejects an email that's already registered instead of silently letting
    a second account collide with an existing one under a different name.
    Scoped to the single tenant this app currently supports (config.DEFAULT_TENANT)."""
    data = request.get_json(force=True) or {}
    name = data.get('name')
    email = data.get('email')
    password = data.get('password')
    if not name or not email or not password:
        return jsonify({'ok': False, 'error': 'name, email and password are required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM users WHERE email = %s', (email,))
    if cur.fetchone() is not None:
        conn.close()
        return jsonify({'ok': False, 'error': 'an account with that email already exists'}), 409

    cur.execute('SELECT id FROM tenants WHERE name = %s', (config.DEFAULT_TENANT,))
    tenant = cur.fetchone()

    cur.execute(
        'INSERT INTO users (tenant_id, name, email, password_hash, state) VALUES (%s, %s, %s, %s, %s) RETURNING id, name, email, presence, tenant_id',
        (tenant['id'], name, email, generate_password_hash(password), 'Active'),
    )
    user = cur.fetchone()

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    cur.execute(
        'INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)',
        (token, user['id'], expires_at),
    )
    conn.commit()
    conn.close()

    return jsonify({
        'ok': True,
        'token': token,
        'expires_at': expires_at.isoformat(),
        'user': {'id': user['id'], 'name': user['name'], 'email': user['email'], 'presence': user['presence'], 'tenant_id': user['tenant_id']},
    }), 201


def send_people_invite(user_id, name, email, cur, conn):
    """The real enforcement point behind People & Permissions' "Create &
    invite" / "Send invite" (backend/app.py's resource_create/resource_update
    call this whenever a people write sets state='Pending invite') --
    previously that just wrote the status string with no token, no email, and
    no way for the invited person to ever actually get in. Generates a fresh
    token (invalidating any previous one, so re-clicking "Send invite" is
    always safe -- only the latest link works) and emails it if SMTP is
    configured; if not, the token is still stored so an admin can hand-
    deliver the accept-invite link manually and the flow still completes.

    Returns (token, expires_at) so the caller can patch the API response it
    already built from the pre-invite row -- that row was fetched via
    RETURNING * before this function ran, so without this it would report
    invite_token as still null even though it's genuinely set moments later."""
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)
    cur.execute(
        'UPDATE users SET invite_token = %s, invite_expires_at = %s WHERE id = %s',
        (token, expires_at, user_id),
    )
    conn.commit()

    if email and mail_configured():
        link = f'{config.FRONTEND_URL}/accept-invite?token={token}'
        body = (
            f'Hi {name},\n\n'
            f'You have been invited to MCM Cloud CX. Set up your password to activate your account:\n\n'
            f'{link}\n\n'
            f'This link expires in {INVITE_TTL_DAYS} days.'
        )
        try:
            send_email(email, 'You are invited to MCM Cloud CX', body)
        except Exception:
            pass

    return token, expires_at


@auth_bp.route('/api/auth/invite-info', methods=['POST'])
def invite_info():
    """Looks up an invite token without requiring auth (the invited person
    doesn't have a bearer token yet) -- lets the accept-invite page greet the
    right person and confirm the link is still valid before showing the
    password form."""
    data = request.get_json(force=True) or {}
    token = data.get('token')
    if not token:
        return jsonify({'ok': False, 'error': 'token required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT name, email, invite_expires_at FROM users WHERE invite_token = %s', (token,))
    user = cur.fetchone()
    conn.close()
    if user is None:
        return jsonify({'ok': False, 'error': 'invalid or already-used invite link'}), 404
    if user['invite_expires_at'] is None or user['invite_expires_at'] < datetime.now(timezone.utc):
        return jsonify({'ok': False, 'error': 'this invite link has expired'}), 410

    return jsonify({'ok': True, 'name': user['name'], 'email': user['email']})


@auth_bp.route('/api/auth/accept-invite', methods=['POST'])
def accept_invite():
    """Exchanges a valid invite token for a password + Active state, then
    signs the person in immediately (same response shape as login()/signup()
    above) -- this is the step that never existed before, which is why an
    invited person could never actually get into their own account."""
    data = request.get_json(force=True) or {}
    token = data.get('token')
    password = data.get('password')
    if not token or not password:
        return jsonify({'ok': False, 'error': 'token and password are required'}), 400
    if len(password) < 8:
        return jsonify({'ok': False, 'error': 'password must be at least 8 characters'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT id, name, email, presence, tenant_id, invite_expires_at FROM users WHERE invite_token = %s',
        (token,),
    )
    user = cur.fetchone()
    if user is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'invalid or already-used invite link'}), 404
    if user['invite_expires_at'] is None or user['invite_expires_at'] < datetime.now(timezone.utc):
        conn.close()
        return jsonify({'ok': False, 'error': 'this invite link has expired'}), 410

    cur.execute(
        "UPDATE users SET password_hash = %s, state = 'Active', invite_token = NULL, invite_expires_at = NULL WHERE id = %s",
        (generate_password_hash(password), user['id']),
    )

    session_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    cur.execute(
        'INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)',
        (session_token, user['id'], expires_at),
    )
    conn.commit()
    conn.close()

    return jsonify({
        'ok': True,
        'token': session_token,
        'expires_at': expires_at.isoformat(),
        'user': {'id': user['id'], 'name': user['name'], 'email': user['email'], 'presence': user['presence'], 'tenant_id': user['tenant_id']},
    })


@auth_bp.route('/api/auth/me')
def me():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT id, name, presence, on_queue, routing_status, tenant_id FROM users WHERE id = %s',
        (g.user_id,),
    )
    user = cur.fetchone()
    conn.close()
    return jsonify(dict(user))


@auth_bp.route('/api/auth/logout', methods=['POST'])
def logout():
    header = request.headers.get('Authorization', '')
    token = header[len('Bearer '):] if header.startswith('Bearer ') else None

    conn = get_db()
    cur = conn.cursor()
    if token:
        cur.execute('DELETE FROM sessions WHERE token = %s', (token,))
        conn.commit()
    conn.close()
    return jsonify({'ok': True})


@auth_bp.route('/api/health')
def health():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT 1')
        cur.fetchone()
        conn.close()
        db_status = 'up'
        status_code = 200
    except Exception:
        db_status = 'down'
        status_code = 503

    return jsonify({
        'status': 'ok' if db_status == 'up' else 'degraded',
        'db': db_status,
        'time': datetime.now(timezone.utc).isoformat(),
    }), status_code


@auth_bp.route('/api/bootstrap')
def bootstrap():
    """All SPA reference data in one call — scoped to what this app actually
    has to offer (not a literal copy of the doc's full reference set, which
    covers modules we haven't built)."""
    conn = get_db()
    cur = conn.cursor()

    cur.execute('SELECT id, name, presence, on_queue, routing_status FROM users WHERE id = %s', (g.user_id,))
    user = cur.fetchone()

    cur.execute('SELECT id, name, default_dial_prefix FROM tenants WHERE id = %s', (g.tenant_id,))
    tenant = cur.fetchone()

    cur.execute('SELECT code, label, purchased, unit_price FROM licenses ORDER BY code')
    licenses = cur.fetchall()

    cur.execute('SELECT id, name, max_wait_s, service_level_threshold_s FROM queues ORDER BY name')
    queues = cur.fetchall()

    conn.close()
    return jsonify({
        'user': dict(user) if user else None,
        'tenant': dict(tenant) if tenant else None,
        'licenses': [dict(r) for r in licenses],
        'queues': [dict(r) for r in queues],
    })
