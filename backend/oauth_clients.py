"""
OAuth Clients — /api/oauth/*

Lets admins register external applications that can access MCM's API
using the client_credentials grant (machine-to-machine). Each client
gets a client_id + client_secret pair and a set of allowed scopes.

Flow (client_credentials):
  1. Admin creates a client via /api/oauth/clients → gets client_id + secret
  2. External app POSTs to /api/oauth/token with client_id + client_secret
  3. Backend verifies credentials, returns a short-lived access token
  4. External app uses that token as a bearer token on MCM API calls
  5. Token expires after 1 hour; the app requests a new one

Scopes control what the token can do:
  - 'read'  → GET endpoints only
  - 'write' → GET + POST/PUT/PATCH
  - 'admin' → full access including DELETE
"""

import secrets
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request, g
from werkzeug.security import generate_password_hash, check_password_hash
from db import get_db

oauth_bp = Blueprint('oauth', __name__)

OAUTH_TOKEN_TTL_HOURS = 1


# ---------------------------------------------------------------------------
# Client CRUD (admin endpoints, require auth)
# ---------------------------------------------------------------------------

@oauth_bp.route('/api/oauth/clients', methods=['GET'])
def list_clients():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """SELECT id, name, client_id, scopes, redirect_uris, grant_types,
                  enabled, created_by, created_at, updated_at
           FROM oauth_clients WHERE tenant_id = %s ORDER BY name""",
        (g.tenant_id,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    # Fix arrays
    for r in rows:
        if r.get('redirect_uris') is not None:
            r['redirect_uris'] = list(r['redirect_uris'])
    # Never return client_secret_hash
    return jsonify(rows)


@oauth_bp.route('/api/oauth/clients', methods=['POST'])
def create_client():
    data = request.get_json(force=True) or {}
    name = data.get('name')
    if not name:
        return jsonify({'ok': False, 'error': 'name required'}), 400

    # Generate credentials
    client_id = 'mcm_' + secrets.token_urlsafe(16)
    client_secret = secrets.token_urlsafe(32)
    secret_hash = generate_password_hash(client_secret)

    scopes = data.get('scopes', 'read')
    redirect_uris = data.get('redirect_uris', [])
    if isinstance(redirect_uris, str):
        redirect_uris = [redirect_uris]
    grant_types = data.get('grant_types', 'client_credentials')

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO oauth_clients
           (tenant_id, name, client_id, client_secret_hash, scopes,
            redirect_uris, grant_types, enabled, created_by)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
           RETURNING id, name, client_id, scopes, redirect_uris, grant_types,
                     enabled, created_by, created_at""",
        (
            g.tenant_id, name, client_id, secret_hash, scopes,
            redirect_uris, grant_types, True, g.user_id,
        ),
    )
    row = dict(cur.fetchone())
    if row.get('redirect_uris') is not None:
        row['redirect_uris'] = list(row['redirect_uris'])
    conn.commit()
    conn.close()

    # Return the secret ONCE — it can never be retrieved again
    row['client_secret'] = client_secret
    row['_notice'] = 'Save the client_secret now — it cannot be retrieved again.'

    return jsonify(row), 201


@oauth_bp.route('/api/oauth/clients/<int:cid>', methods=['GET'])
def get_client(cid):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """SELECT id, name, client_id, scopes, redirect_uris, grant_types,
                  enabled, created_by, created_at, updated_at
           FROM oauth_clients WHERE id = %s AND tenant_id = %s""",
        (cid, g.tenant_id),
    )
    row = cur.fetchone()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    row = dict(row)
    if row.get('redirect_uris') is not None:
        row['redirect_uris'] = list(row['redirect_uris'])
    return jsonify(row)


@oauth_bp.route('/api/oauth/clients/<int:cid>', methods=['PUT', 'PATCH'])
def update_client(cid):
    data = request.get_json(force=True) or {}
    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        'SELECT id FROM oauth_clients WHERE id = %s AND tenant_id = %s',
        (cid, g.tenant_id),
    )
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    allowed = ['name', 'scopes', 'redirect_uris', 'grant_types', 'enabled']
    sets = []
    vals = []
    for col in allowed:
        if col in data:
            v = data[col]
            if col == 'redirect_uris' and isinstance(v, str):
                v = [v]
            sets.append(f'{col} = %s')
            vals.append(v)

    if not sets:
        conn.close()
        return jsonify({'ok': False, 'error': 'no fields supplied'}), 400

    vals += [cid, g.tenant_id]
    sql = f"""UPDATE oauth_clients SET {', '.join(sets)}
              WHERE id = %s AND tenant_id = %s
              RETURNING id, name, client_id, scopes, redirect_uris, grant_types,
                        enabled, created_by, created_at, updated_at"""
    cur.execute(sql, vals)
    row = dict(cur.fetchone())
    if row.get('redirect_uris') is not None:
        row['redirect_uris'] = list(row['redirect_uris'])
    conn.commit()
    conn.close()
    return jsonify(row)


@oauth_bp.route('/api/oauth/clients/<int:cid>', methods=['DELETE'])
def delete_client(cid):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT id FROM oauth_clients WHERE id = %s AND tenant_id = %s',
        (cid, g.tenant_id),
    )
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('DELETE FROM oauth_clients WHERE id = %s', (cid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@oauth_bp.route('/api/oauth/clients/<int:cid>/rotate-secret', methods=['POST'])
def rotate_secret(cid):
    """Generate a new secret for the client. The old secret stops working
    immediately. Returns the new secret once."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT id, client_id FROM oauth_clients WHERE id = %s AND tenant_id = %s',
        (cid, g.tenant_id),
    )
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    new_secret = secrets.token_urlsafe(32)
    cur.execute(
        'UPDATE oauth_clients SET client_secret_hash = %s WHERE id = %s',
        (generate_password_hash(new_secret), cid),
    )
    # Revoke all existing tokens for this client
    cur.execute(
        'DELETE FROM oauth_tokens WHERE client_id = %s',
        (existing['client_id'],),
    )
    conn.commit()
    conn.close()

    return jsonify({
        'ok': True,
        'client_id': existing['client_id'],
        'client_secret': new_secret,
        '_notice': 'Save the new client_secret now — it cannot be retrieved again. All existing tokens have been revoked.',
    })


# ---------------------------------------------------------------------------
# Token endpoint (public — client authenticates with its own credentials)
# ---------------------------------------------------------------------------

@oauth_bp.route('/api/oauth/token', methods=['POST'])
def issue_token():
    """Exchange client_id + client_secret for an access token.
    Supports client_credentials grant type."""
    data = request.get_json(force=True) or {}

    grant_type = data.get('grant_type', 'client_credentials')
    client_id = data.get('client_id')
    client_secret = data.get('client_secret')

    if not client_id or not client_secret:
        return jsonify({'ok': False, 'error': 'client_id and client_secret required'}), 400

    if grant_type != 'client_credentials':
        return jsonify({'ok': False, 'error': 'unsupported grant_type (use client_credentials)'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT * FROM oauth_clients WHERE client_id = %s AND enabled = true',
        (client_id,),
    )
    client = cur.fetchone()

    if client is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'invalid client_id'}), 401

    client = dict(client)

    if not check_password_hash(client['client_secret_hash'], client_secret):
        conn.close()
        return jsonify({'ok': False, 'error': 'invalid client_secret'}), 401

    # Issue token
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=OAUTH_TOKEN_TTL_HOURS)

    cur.execute(
        """INSERT INTO oauth_tokens (token, client_id, tenant_id, scopes, expires_at)
           VALUES (%s, %s, %s, %s, %s)""",
        (token, client_id, client['tenant_id'], client['scopes'], expires_at),
    )
    conn.commit()
    conn.close()

    return jsonify({
        'access_token': token,
        'token_type': 'Bearer',
        'expires_in': OAUTH_TOKEN_TTL_HOURS * 3600,
        'scope': client['scopes'],
    })


# ---------------------------------------------------------------------------
# Token revocation
# ---------------------------------------------------------------------------

@oauth_bp.route('/api/oauth/revoke', methods=['POST'])
def revoke_token():
    """Revoke an OAuth token."""
    data = request.get_json(force=True) or {}
    token = data.get('token')
    if not token:
        return jsonify({'ok': False, 'error': 'token required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM oauth_tokens WHERE token = %s', (token,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})
