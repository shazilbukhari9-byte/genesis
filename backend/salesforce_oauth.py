"""
Salesforce OAuth 2.0 (Web Server Flow) — Integrations Phase 1.
See SALESFORCE_INTEGRATION.md for the full write-up.

Mirrors sso.py's proven shape (the only other real-OAuth code in this
repo): state generated with secrets.token_urlsafe(32), stored server-side
in a short-lived table (salesforce_oauth_states, 10-minute TTL, single-use
— deleted the moment it's read), the token-exchange POST made with
urllib.request + an explicit timeout, and the callback (a bare browser
redirect with no bearer token available) ending in `return redirect(...)`
back to the frontend rather than a JSON response.

One deliberate difference from sso.py: sso_providers.client_secret is
stored in the database in plaintext (that table's own schema comment
admits it's a prototype shortcut). Here, Salesforce's client_id/secret
never touch the database at all — they're read from config (env vars,
optional-at-boot, same pattern as Telnyx/SMTP in config.py) — and the
per-connection access/refresh tokens that DO need to be persisted are
Fernet-encrypted before every write (see _encrypt/_decrypt below).

Routes:
  POST /api/integrations/salesforce/oauth/authorize-url   (auth required)
  GET  /api/integrations/salesforce/oauth/callback         (public — see
       auth.py's PUBLIC_PATHS; Salesforce redirects the bare browser here,
       which cannot carry our Authorization header)
  POST /api/integrations/salesforce/oauth/disconnect       (auth required)
  POST /api/integrations/salesforce/oauth/test             (auth required)
  GET  /api/integrations/salesforce/oauth/status/<id>      (auth required)

get_valid_access_token() is the one function dataact.py imports — it
hands back a ready-to-use (instance_url, access_token) pair, refreshing
first if the stored token is at/past its expiry, and raising
SalesforceNotConnectedError/SalesforceAuthError if there's nothing usable.
Never logs, returns, or embeds a token/secret in any exception message
or JSON response — status/error endpoints return connection_status and a
short last_error string only.
"""

import base64
import secrets
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet, InvalidToken
from flask import Blueprint, jsonify, request, g, redirect
from urllib.parse import urlencode

import config
import salesforce_client as sf
from db import get_db

salesforce_oauth_bp = Blueprint('salesforce_oauth', __name__)

STATE_TTL_MINUTES = 10
# Refresh a bit before the real expiry so a request never races a token
# that's valid when checked but stale by the time the API calls lands.
REFRESH_SKEW_SECONDS = 60
# 'api' lets us call the REST API; 'refresh_token' (+ 'offline_access', the
# alias some orgs require) is what makes Salesforce actually issue one —
# without it the token response has no refresh_token at all.
OAUTH_SCOPES = 'api refresh_token'


class SalesforceNotConnectedError(Exception):
    """No Connected salesforce_connections row exists for this tenant/integration."""


class SalesforceConfigError(Exception):
    """OG_SALESFORCE_* / OG_INTEGRATION_ENCRYPTION_KEY isn't configured."""


def _require_config():
    missing = [
        name for name, value in (
            ('OG_SALESFORCE_CLIENT_ID', config.SALESFORCE_CLIENT_ID),
            ('OG_SALESFORCE_CLIENT_SECRET', config.SALESFORCE_CLIENT_SECRET),
            ('OG_INTEGRATION_ENCRYPTION_KEY', config.INTEGRATION_ENCRYPTION_KEY),
        ) if not value
    ]
    if missing:
        raise SalesforceConfigError(
            'Salesforce integration is not configured on this server (missing: '
            + ', '.join(missing) + '). See backend/.env.example.'
        )


def _fernet():
    try:
        return Fernet(config.INTEGRATION_ENCRYPTION_KEY.encode() if isinstance(config.INTEGRATION_ENCRYPTION_KEY, str) else config.INTEGRATION_ENCRYPTION_KEY)
    except (ValueError, TypeError):
        raise SalesforceConfigError('OG_INTEGRATION_ENCRYPTION_KEY is not a valid Fernet key.')


def _encrypt(plaintext):
    if not plaintext:
        return None
    return _fernet().encrypt(plaintext.encode()).decode()


def _decrypt(ciphertext):
    if not ciphertext:
        return None
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        # Key rotated/mismatched — treat as "no usable token" rather than
        # crashing the request; the connect flow will fix it on reconnect.
        return None


def _audit(cur, action, detail):
    cur.execute(
        'INSERT INTO audit_log (tenant_id, who, action, detail, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.tenant_id, g.user_name, action, detail),
    )


def _load_installed_integration(cur, installed_integration_id):
    cur.execute(
        'SELECT id, name FROM installed_integrations WHERE id = %s AND tenant_id = %s',
        (installed_integration_id, g.tenant_id),
    )
    return cur.fetchone()


def _load_connection(cur, installed_integration_id):
    cur.execute(
        'SELECT * FROM salesforce_connections WHERE installed_integration_id = %s AND tenant_id = %s',
        (installed_integration_id, g.tenant_id),
    )
    return cur.fetchone()


# ---------------------------------------------------------------------------
# 1) Admin clicks Connect -> we hand back Salesforce's authorization URL
# ---------------------------------------------------------------------------

@salesforce_oauth_bp.route('/api/integrations/salesforce/oauth/authorize-url', methods=['POST'])
def authorize_url():
    try:
        _require_config()
    except SalesforceConfigError as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

    data = request.get_json(force=True) or {}
    installed_integration_id = data.get('installed_integration_id')
    if not installed_integration_id:
        return jsonify({'ok': False, 'error': 'installed_integration_id is required'}), 400

    conn = get_db()
    cur = conn.cursor()
    integration = _load_installed_integration(cur, installed_integration_id)
    if integration is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown installed integration'}), 404

    state = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=STATE_TTL_MINUTES)
    frontend_redirect = data.get('redirect_uri') or config.PUBLIC_BASE_URL

    cur.execute(
        """
        INSERT INTO salesforce_oauth_states
            (state, tenant_id, installed_integration_id, user_id, redirect_uri, expires_at)
        VALUES (%s,%s,%s,%s,%s,%s)
        """,
        (state, g.tenant_id, installed_integration_id, g.user_id, frontend_redirect, expires_at),
    )

    # Mark "Connecting" immediately so the UI can reflect it before the
    # round trip to Salesforce even completes.
    cur.execute(
        """
        INSERT INTO salesforce_connections (tenant_id, installed_integration_id, connection_status, last_error)
        VALUES (%s,%s,'Connecting','')
        ON CONFLICT (installed_integration_id) DO UPDATE
            SET connection_status = 'Connecting', last_error = ''
        """,
        (g.tenant_id, installed_integration_id),
    )
    conn.commit()
    conn.close()

    callback_url = config.PUBLIC_BASE_URL.rstrip('/') + '/api/integrations/salesforce/oauth/callback'
    params = {
        'response_type': 'code',
        'client_id': config.SALESFORCE_CLIENT_ID,
        'redirect_uri': callback_url,
        'scope': OAUTH_SCOPES,
        'state': state,
    }
    authorize_url_ = config.SALESFORCE_LOGIN_BASE_URL.rstrip('/') + '/services/oauth2/authorize?' + urlencode(params)
    return jsonify({'ok': True, 'authorize_url': authorize_url_})


# ---------------------------------------------------------------------------
# 2) Salesforce redirects the bare browser back here with ?code=&state=
# ---------------------------------------------------------------------------

@salesforce_oauth_bp.route('/api/integrations/salesforce/oauth/callback', methods=['GET'])
def callback():
    code = request.args.get('code')
    state = request.args.get('state')
    idp_error = request.args.get('error')

    conn = get_db()
    cur = conn.cursor()

    cur.execute('SELECT * FROM salesforce_oauth_states WHERE state = %s AND expires_at > now()', (state or '',))
    state_row = cur.fetchone()
    if state_row is None:
        conn.close()
        # No verified redirect target for an unrecognised/expired state —
        # a JSON 400 is the safe fallback rather than bouncing to a
        # frontend URL we can't confirm the caller is entitled to.
        return jsonify({'ok': False, 'error': 'invalid or expired state'}), 400

    state_row = dict(state_row)
    cur.execute('DELETE FROM salesforce_oauth_states WHERE state = %s', (state,))

    tenant_id = state_row['tenant_id']
    installed_integration_id = state_row['installed_integration_id']
    redirect_base = state_row['redirect_uri']
    separator = '&' if '?' in redirect_base else '?'

    def _fail(reason):
        cur.execute(
            """
            UPDATE salesforce_connections
            SET connection_status = 'Authentication Failed', last_error = %s
            WHERE installed_integration_id = %s AND tenant_id = %s
            """,
            (reason[:500], installed_integration_id, tenant_id),
        )
        conn.commit()
        conn.close()
        query = urlencode({'salesforce': 'failed', 'error': reason[:200]})
        return redirect(f'{redirect_base}{separator}{query}')

    if idp_error:
        return _fail(f'Salesforce declined authorization: {idp_error}')

    if not code:
        return _fail('Salesforce did not return an authorization code.')

    try:
        _require_config()
        callback_url = config.PUBLIC_BASE_URL.rstrip('/') + '/api/integrations/salesforce/oauth/callback'
        token_response = sf.exchange_code_for_token(
            config.SALESFORCE_LOGIN_BASE_URL, config.SALESFORCE_CLIENT_ID,
            config.SALESFORCE_CLIENT_SECRET, code, callback_url,
        )
    except SalesforceConfigError as e:
        return _fail(str(e))
    except sf.SalesforceError as e:
        return _fail(f'Token exchange failed: {e}')
    except Exception as e:  # noqa: BLE001 — last-resort net, same posture as sso.py's callback
        return _fail(f'Token exchange failed: {e}')

    access_token = token_response.get('access_token')
    refresh_token = token_response.get('refresh_token')
    instance_url = token_response.get('instance_url')
    if not access_token or not instance_url:
        return _fail('Salesforce token response was missing access_token/instance_url.')

    # Salesforce access tokens don't carry a machine-readable TTL in this
    # response; treat them as valid for 2 hours (comfortably inside every
    # documented Salesforce session-timeout default) and let a real 401
    # from an API call trigger an immediate refresh regardless.
    expires_at = datetime.now(timezone.utc) + timedelta(hours=2)

    cur.execute(
        """
        UPDATE salesforce_connections
        SET access_token_encrypted = %s, refresh_token_encrypted = %s, instance_url = %s,
            token_type = %s, scope = %s, expires_at = %s,
            connection_status = 'Connected', last_error = '', connected_at = now()
        WHERE installed_integration_id = %s AND tenant_id = %s
        """,
        (
            _encrypt(access_token),
            _encrypt(refresh_token) if refresh_token else None,
            instance_url,
            token_response.get('token_type') or 'Bearer',
            token_response.get('scope') or OAUTH_SCOPES,
            expires_at,
            installed_integration_id, tenant_id,
        ),
    )
    # This route is public (see auth.py's PUBLIC_PATHS), so the auth guard
    # never populated g.tenant_id/g.user_name — _audit() needs them, so set
    # them here from the state row (server-verified, not client input).
    g.tenant_id = tenant_id
    who = 'unknown'
    if state_row.get('user_id'):
        cur.execute('SELECT name FROM users WHERE id = %s', (state_row['user_id'],))
        user_row = cur.fetchone()
        if user_row:
            who = user_row['name']
    g.user_name = who
    _audit(cur, 'Connect integration', 'Salesforce')
    conn.commit()
    conn.close()
    return redirect(f'{redirect_base}{separator}salesforce=connected')


# ---------------------------------------------------------------------------
# 3) Disconnect — best-effort revoke, then clear the stored tokens
# ---------------------------------------------------------------------------

@salesforce_oauth_bp.route('/api/integrations/salesforce/oauth/disconnect', methods=['POST'])
def disconnect():
    data = request.get_json(force=True) or {}
    installed_integration_id = data.get('installed_integration_id')
    if not installed_integration_id:
        return jsonify({'ok': False, 'error': 'installed_integration_id is required'}), 400

    conn = get_db()
    cur = conn.cursor()
    row = _load_connection(cur, installed_integration_id)
    if row is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not connected'}), 404
    row = dict(row)

    access_token = _decrypt(row['access_token_encrypted'])
    if access_token and config.SALESFORCE_LOGIN_BASE_URL:
        try:
            sf.revoke_token(config.SALESFORCE_LOGIN_BASE_URL, access_token)
        except sf.SalesforceError:
            # Revocation is best-effort — Salesforce being unreachable
            # shouldn't block the user from disconnecting locally.
            pass

    cur.execute(
        """
        UPDATE salesforce_connections
        SET access_token_encrypted = NULL, refresh_token_encrypted = NULL, instance_url = NULL,
            expires_at = NULL, connection_status = 'Disconnected', last_error = ''
        WHERE installed_integration_id = %s AND tenant_id = %s
        """,
        (installed_integration_id, g.tenant_id),
    )
    _audit(cur, 'Disconnect integration', 'Salesforce')
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'connection_status': 'Disconnected'})


# ---------------------------------------------------------------------------
# 4) Test Connection — a real, lightweight API call, not a DB-row check
# ---------------------------------------------------------------------------

@salesforce_oauth_bp.route('/api/integrations/salesforce/oauth/test', methods=['POST'])
def test_connection():
    data = request.get_json(force=True) or {}
    installed_integration_id = data.get('installed_integration_id')
    if not installed_integration_id:
        return jsonify({'ok': False, 'error': 'installed_integration_id is required'}), 400

    conn = get_db()
    cur = conn.cursor()
    try:
        instance_url, access_token = get_valid_access_token(cur, g.tenant_id, installed_integration_id)
        result = sf.soql_query(instance_url, access_token, 'SELECT Id FROM Organization LIMIT 1')
        ok = bool(result.get('records'))
        cur.execute(
            """
            UPDATE salesforce_connections SET connection_status = 'Connected', last_error = ''
            WHERE installed_integration_id = %s AND tenant_id = %s
            """,
            (installed_integration_id, g.tenant_id),
        )
        conn.commit()
        conn.close()
        return jsonify({'ok': True, 'connection_status': 'Connected', 'verified': ok})
    except SalesforceNotConnectedError:
        conn.close()
        return jsonify({'ok': False, 'error': 'not connected', 'connection_status': 'Not Connected'}), 409
    except SalesforceConfigError as e:
        conn.close()
        return jsonify({'ok': False, 'error': str(e)}), 500
    except sf.SalesforceAuthError as e:
        cur.execute(
            """
            UPDATE salesforce_connections SET connection_status = 'Token Expired', last_error = %s
            WHERE installed_integration_id = %s AND tenant_id = %s
            """,
            (str(e)[:500], installed_integration_id, g.tenant_id),
        )
        conn.commit()
        conn.close()
        return jsonify({'ok': False, 'error': 'Authentication with Salesforce failed.', 'connection_status': 'Token Expired'}), 401
    except sf.SalesforceError as e:
        cur.execute(
            """
            UPDATE salesforce_connections SET connection_status = 'Authentication Failed', last_error = %s
            WHERE installed_integration_id = %s AND tenant_id = %s
            """,
            (str(e)[:500], installed_integration_id, g.tenant_id),
        )
        conn.commit()
        conn.close()
        return jsonify({'ok': False, 'error': 'Could not verify the Salesforce connection.', 'connection_status': 'Authentication Failed'}), 502


# ---------------------------------------------------------------------------
# 5) Status — for the Installed-integration drawer to render on open
# ---------------------------------------------------------------------------

@salesforce_oauth_bp.route('/api/integrations/salesforce/oauth/status/<int:installed_integration_id>', methods=['GET'])
def status(installed_integration_id):
    conn = get_db()
    cur = conn.cursor()
    row = _load_connection(cur, installed_integration_id)
    conn.close()
    if row is None:
        return jsonify({'ok': True, 'connection_status': 'Not Connected', 'last_error': '', 'connected_at': None})
    row = dict(row)
    return jsonify({
        'ok': True,
        'connection_status': row['connection_status'],
        'last_error': row['last_error'],
        'connected_at': row['connected_at'].isoformat() if row['connected_at'] else None,
    })


# ---------------------------------------------------------------------------
# Shared helper — the one thing dataact.py imports from this module
# ---------------------------------------------------------------------------

def get_valid_access_token(cur, tenant_id, installed_integration_id):
    """Return (instance_url, access_token), refreshing first if the stored
    token is at/past expiry. Raises SalesforceNotConnectedError if there's
    no Connected row, SalesforceConfigError if env vars are missing, or
    whatever salesforce_client raised if a refresh attempt itself fails."""
    _require_config()

    cur.execute(
        'SELECT * FROM salesforce_connections WHERE installed_integration_id = %s AND tenant_id = %s',
        (installed_integration_id, tenant_id),
    )
    row = cur.fetchone()
    if row is None or row['connection_status'] not in ('Connected', 'Token Expired'):
        raise SalesforceNotConnectedError('This integration is not connected to Salesforce.')
    row = dict(row)

    access_token = _decrypt(row['access_token_encrypted'])
    needs_refresh = (
        not access_token
        or row['expires_at'] is None
        or row['expires_at'] <= datetime.now(timezone.utc) + timedelta(seconds=REFRESH_SKEW_SECONDS)
    )
    if not needs_refresh:
        return row['instance_url'], access_token

    refresh_token = _decrypt(row['refresh_token_encrypted'])
    if not refresh_token:
        cur.execute(
            """
            UPDATE salesforce_connections SET connection_status = 'Token Expired',
                last_error = 'Access token expired and no refresh token is stored.'
            WHERE installed_integration_id = %s AND tenant_id = %s
            """,
            (installed_integration_id, tenant_id),
        )
        # Commit immediately: this status change must survive even if the
        # caller's own transaction later rolls back for an unrelated
        # reason — it reflects a real fact (no usable token) discovered
        # right now, not a side effect of whatever the caller was doing.
        cur.connection.commit()
        raise SalesforceNotConnectedError('The Salesforce access token expired and cannot be refreshed automatically.')

    try:
        token_response = sf.refresh_access_token(
            config.SALESFORCE_LOGIN_BASE_URL, config.SALESFORCE_CLIENT_ID,
            config.SALESFORCE_CLIENT_SECRET, refresh_token,
        )
    except sf.SalesforceError as e:
        cur.execute(
            """
            UPDATE salesforce_connections SET connection_status = 'Token Expired', last_error = %s
            WHERE installed_integration_id = %s AND tenant_id = %s
            """,
            (str(e)[:500], installed_integration_id, tenant_id),
        )
        cur.connection.commit()
        raise

    new_access_token = token_response.get('access_token')
    new_instance_url = token_response.get('instance_url') or row['instance_url']
    if not new_access_token:
        cur.execute(
            """
            UPDATE salesforce_connections SET connection_status = 'Token Expired',
                last_error = 'Salesforce refresh did not return a new access token.'
            WHERE installed_integration_id = %s AND tenant_id = %s
            """,
            (installed_integration_id, tenant_id),
        )
        cur.connection.commit()
        raise sf.SalesforceAuthError('Salesforce refresh did not return a new access token.')

    new_expires_at = datetime.now(timezone.utc) + timedelta(hours=2)
    cur.execute(
        """
        UPDATE salesforce_connections
        SET access_token_encrypted = %s, instance_url = %s, expires_at = %s,
            connection_status = 'Connected', last_error = ''
        WHERE installed_integration_id = %s AND tenant_id = %s
        """,
        (_encrypt(new_access_token), new_instance_url, new_expires_at, installed_integration_id, tenant_id),
    )
    cur.connection.commit()
    return new_instance_url, new_access_token
