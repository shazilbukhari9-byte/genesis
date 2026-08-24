"""
SSO (Single Sign-On) — /api/sso/*

Implements OIDC (OpenID Connect) flow for external identity providers like
Microsoft Entra ID, Google Workspace, Okta, etc.

Flow:
  1. Admin creates an SSO provider via /api/sso/providers (stores client_id,
     client_secret, issuer_url)
  2. User clicks "Sign in with SSO" → frontend calls /api/auth/sso/begin
  3. Backend generates a state token, stores it in sso_states, and returns
     the IdP's authorization URL
  4. User logs in at the IdP → IdP redirects back to /api/auth/sso/callback
     with an authorization code
  5. Backend exchanges the code for tokens, extracts the user's email/name,
     finds or creates the user in the users table, creates a session, and
     redirects the frontend with the bearer token

All provider CRUD is tenant-scoped and requires auth. The begin/callback
endpoints are public (the user hasn't authenticated yet — that's the point).
"""

import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, quote

from flask import Blueprint, jsonify, request, g, redirect
from db import get_db
import config

sso_bp = Blueprint('sso', __name__)

SSO_STATE_TTL_MINUTES = 10


# ---------------------------------------------------------------------------
# Provider CRUD (admin endpoints, require auth)
# ---------------------------------------------------------------------------

@sso_bp.route('/api/sso/providers', methods=['GET'])
def list_providers():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """SELECT id, name, protocol, issuer_url, client_id, discovery_url,
                  metadata_url, entity_id, domain_hint, scopes, enabled,
                  created_at, updated_at
           FROM sso_providers WHERE tenant_id = %s ORDER BY name""",
        (g.tenant_id,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    # Never return client_secret to the frontend
    return jsonify(rows)


@sso_bp.route('/api/sso/providers', methods=['POST'])
def create_provider():
    data = request.get_json(force=True) or {}
    name = data.get('name')
    if not name:
        return jsonify({'ok': False, 'error': 'name required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO sso_providers
           (tenant_id, name, protocol, issuer_url, client_id, client_secret,
            discovery_url, metadata_url, entity_id, domain_hint, scopes, enabled)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
        (
            g.tenant_id, name,
            data.get('protocol', 'oidc'),
            data.get('issuer_url'),
            data.get('client_id'),
            data.get('client_secret'),
            data.get('discovery_url'),
            data.get('metadata_url'),
            data.get('entity_id'),
            data.get('domain_hint'),
            data.get('scopes', 'openid email profile'),
            data.get('enabled', True),
        ),
    )
    row = dict(cur.fetchone())
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Create SSO provider', name, g.tenant_id),
    )
    conn.commit()
    conn.close()
    row.pop('client_secret', None)
    return jsonify(row), 201


@sso_bp.route('/api/sso/providers/<int:pid>', methods=['GET'])
def get_provider(pid):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT * FROM sso_providers WHERE id = %s AND tenant_id = %s',
        (pid, g.tenant_id),
    )
    row = cur.fetchone()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    row = dict(row)
    row.pop('client_secret', None)
    return jsonify(row)


@sso_bp.route('/api/sso/providers/<int:pid>', methods=['PUT', 'PATCH'])
def update_provider(pid):
    data = request.get_json(force=True) or {}
    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        'SELECT id FROM sso_providers WHERE id = %s AND tenant_id = %s',
        (pid, g.tenant_id),
    )
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    # Build dynamic update
    allowed = ['name', 'protocol', 'issuer_url', 'client_id', 'client_secret',
               'discovery_url', 'metadata_url', 'entity_id', 'domain_hint',
               'scopes', 'enabled']
    sets = []
    vals = []
    for col in allowed:
        if col in data:
            sets.append(f'{col} = %s')
            vals.append(data[col])

    if not sets:
        conn.close()
        return jsonify({'ok': False, 'error': 'no fields supplied'}), 400

    vals += [pid, g.tenant_id]
    sql = f"UPDATE sso_providers SET {', '.join(sets)} WHERE id = %s AND tenant_id = %s RETURNING *"
    cur.execute(sql, vals)
    row = dict(cur.fetchone())
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Edit SSO provider', row['name'], g.tenant_id),
    )
    conn.commit()
    conn.close()
    row.pop('client_secret', None)
    return jsonify(row)


@sso_bp.route('/api/sso/providers/<int:pid>', methods=['DELETE'])
def delete_provider(pid):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT id, name FROM sso_providers WHERE id = %s AND tenant_id = %s',
        (pid, g.tenant_id),
    )
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('DELETE FROM sso_providers WHERE id = %s', (pid,))
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Delete SSO provider', existing['name'], g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# SSO Login Flow (public endpoints — user isn't authenticated yet)
# ---------------------------------------------------------------------------

@sso_bp.route('/api/auth/sso/providers', methods=['GET'])
def public_providers():
    """Public list of enabled SSO providers (for the login page button).
    No secrets, no tenant auth needed — the frontend needs to know what
    SSO options to show before the user is logged in."""
    conn = get_db()
    cur = conn.cursor()
    # Show all enabled providers across all tenants (login page doesn't
    # know which tenant yet — domain_hint resolves that)
    cur.execute(
        """SELECT id, name, protocol, domain_hint, issuer_url
           FROM sso_providers WHERE enabled = true ORDER BY name"""
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


@sso_bp.route('/api/auth/sso/begin', methods=['POST'])
def sso_begin():
    """Step 1: Frontend calls this with { provider_id } or { domain }.
    Returns the IdP authorization URL the frontend should redirect to."""
    data = request.get_json(force=True) or {}

    conn = get_db()
    cur = conn.cursor()

    provider_id = data.get('provider_id')
    domain = data.get('domain')

    if provider_id:
        cur.execute('SELECT * FROM sso_providers WHERE id = %s AND enabled = true', (provider_id,))
    elif domain:
        cur.execute('SELECT * FROM sso_providers WHERE domain_hint = %s AND enabled = true', (domain,))
    else:
        conn.close()
        return jsonify({'ok': False, 'error': 'provider_id or domain required'}), 400

    provider = cur.fetchone()
    if provider is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'SSO provider not found or disabled'}), 404

    provider = dict(provider)

    if provider['protocol'] != 'oidc':
        conn.close()
        return jsonify({'ok': False, 'error': 'only OIDC is supported currently'}), 400

    # Generate state for CSRF protection
    state = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=SSO_STATE_TTL_MINUTES)

    frontend_redirect = data.get('redirect_uri', config.PUBLIC_BASE_URL)

    cur.execute(
        'INSERT INTO sso_states (state, provider_id, redirect_uri, expires_at) VALUES (%s,%s,%s,%s)',
        (state, provider['id'], frontend_redirect, expires_at),
    )
    conn.commit()
    conn.close()

    # Build the OIDC authorization URL
    auth_url = provider['issuer_url'].rstrip('/') + '/authorize'
    # If discovery_url is provided, we'd fetch the auth endpoint from it.
    # For now, Entra ID's authorize endpoint follows a standard pattern.
    if 'microsoftonline.com' in (provider['issuer_url'] or ''):
        auth_url = provider['issuer_url'].rstrip('/') + '/authorize'
    elif provider.get('discovery_url'):
        # In production, fetch discovery_url and extract authorization_endpoint
        auth_url = provider['issuer_url'].rstrip('/') + '/authorize'

    callback_url = config.PUBLIC_BASE_URL.rstrip('/') + '/api/auth/sso/callback'

    params = {
        'client_id': provider['client_id'],
        'response_type': 'code',
        'redirect_uri': callback_url,
        'scope': provider['scopes'] or 'openid email profile',
        'state': state,
        'response_mode': 'query',
    }

    authorization_url = auth_url + '?' + urlencode(params)

    return jsonify({
        'ok': True,
        'authorization_url': authorization_url,
        'state': state,
    })


@sso_bp.route('/api/auth/sso/callback', methods=['GET', 'POST'])
def sso_callback():
    """Step 2: IdP redirects here with ?code=...&state=...
    We exchange the code for tokens, extract user info, find/create the user,
    create a session, and redirect the frontend with the bearer token."""

    code = request.args.get('code') or (request.get_json(force=True) or {}).get('code')
    state = request.args.get('state') or (request.get_json(force=True) or {}).get('state')
    error = request.args.get('error')

    if error:
        return jsonify({'ok': False, 'error': f'IdP error: {error}', 'description': request.args.get('error_description')}), 400

    if not code or not state:
        return jsonify({'ok': False, 'error': 'code and state required'}), 400

    conn = get_db()
    cur = conn.cursor()

    # Validate state (CSRF check)
    cur.execute(
        'SELECT * FROM sso_states WHERE state = %s AND expires_at > now()',
        (state,),
    )
    sso_state = cur.fetchone()
    if sso_state is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'invalid or expired state'}), 400

    sso_state = dict(sso_state)

    # Clean up the state
    cur.execute('DELETE FROM sso_states WHERE state = %s', (state,))

    # Get the provider
    cur.execute('SELECT * FROM sso_providers WHERE id = %s', (sso_state['provider_id'],))
    provider = cur.fetchone()
    if provider is None:
        conn.commit()
        conn.close()
        return jsonify({'ok': False, 'error': 'provider not found'}), 404

    provider = dict(provider)

    # Exchange code for tokens
    # In a real implementation, we'd POST to the token endpoint with the code.
    # For this prototype, we'll simulate the token exchange:
    # The real flow would use `requests` library to call the IdP's token endpoint.
    try:
        import urllib.request
        import json

        token_url = provider['issuer_url'].rstrip('/') + '/token'
        callback_url = config.PUBLIC_BASE_URL.rstrip('/') + '/api/auth/sso/callback'

        token_data = urlencode({
            'grant_type': 'authorization_code',
            'client_id': provider['client_id'],
            'client_secret': provider['client_secret'],
            'code': code,
            'redirect_uri': callback_url,
            'scope': provider['scopes'] or 'openid email profile',
        }).encode()

        req = urllib.request.Request(token_url, data=token_data, headers={
            'Content-Type': 'application/x-www-form-urlencoded',
        })
        resp = urllib.request.urlopen(req, timeout=10)
        token_response = json.loads(resp.read())

        # Decode the ID token (simplified — in production use a JWT library
        # to verify the signature against the IdP's public keys)
        id_token = token_response.get('id_token', '')
        import base64
        # JWT has 3 parts: header.payload.signature
        parts = id_token.split('.')
        if len(parts) >= 2:
            # Add padding
            payload = parts[1] + '=' * (4 - len(parts[1]) % 4)
            claims = json.loads(base64.urlsafe_b64decode(payload))
            email = claims.get('email') or claims.get('preferred_username') or claims.get('upn')
            name = claims.get('name') or claims.get('given_name', '') + ' ' + claims.get('family_name', '')
        else:
            email = None
            name = None

    except Exception as e:
        # If token exchange fails, return the error
        conn.commit()
        conn.close()
        return jsonify({'ok': False, 'error': f'token exchange failed: {str(e)}'}), 502

    if not email:
        conn.commit()
        conn.close()
        return jsonify({'ok': False, 'error': 'could not extract email from IdP response'}), 400

    # Find or create user
    cur.execute('SELECT id, name, email, presence, tenant_id FROM users WHERE email = %s', (email,))
    user = cur.fetchone()

    if user is None:
        # Auto-create user in the provider's tenant
        from werkzeug.security import generate_password_hash
        # SSO users get a random password (they'll never use it — they log in via SSO)
        random_pw = secrets.token_urlsafe(24)
        cur.execute(
            """INSERT INTO users (tenant_id, name, email, password_hash, state)
               VALUES (%s, %s, %s, %s, 'Active')
               RETURNING id, name, email, presence, tenant_id""",
            (provider['tenant_id'], name.strip(), email, generate_password_hash(random_pw)),
        )
        user = cur.fetchone()

    user = dict(user)

    # Create a session (same as normal login)
    token = secrets.token_urlsafe(32)
    token_ttl = int(config.TOKEN_TTL_HOURS)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=token_ttl)
    cur.execute(
        'INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)',
        (token, user['id'], expires_at),
    )
    conn.commit()
    conn.close()

    # Redirect to frontend with the token
    frontend_url = sso_state.get('redirect_uri', config.PUBLIC_BASE_URL)
    separator = '&' if '?' in frontend_url else '?'
    redirect_url = f"{frontend_url}{separator}sso_token={token}"

    return redirect(redirect_url)


# ---------------------------------------------------------------------------
# Convenience: check if SSO is available for a given email domain
# ---------------------------------------------------------------------------

@sso_bp.route('/api/auth/sso/check-domain', methods=['POST'])
def check_domain():
    """Given an email, check if SSO is configured for that domain."""
    data = request.get_json(force=True) or {}
    email = data.get('email', '')
    domain = email.split('@')[-1] if '@' in email else ''

    if not domain:
        return jsonify({'sso_available': False})

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT id, name, protocol FROM sso_providers WHERE domain_hint = %s AND enabled = true',
        (domain,),
    )
    provider = cur.fetchone()
    conn.close()

    if provider:
        return jsonify({'sso_available': True, 'provider': dict(provider)})
    return jsonify({'sso_available': False})
