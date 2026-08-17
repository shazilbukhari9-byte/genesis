"""
Tenant-scoped settings (Section 14, second half). Per-tenant carrier
settings live in platform_config (tenant_id, key, value) under twilio.*.
tenant_config() reads the table first, falls back to TWILIO_* environment
variables, then applies defaults for hold music, voice and language.

auth_token and api_key_secret are never returned to the browser — GET
/api/config reports only whether each is set. A blank value on PUT leaves
a stored secret alone, so clearing the input box in a form can't
accidentally wipe a working credential.
"""

import os
from flask import Blueprint, jsonify, request, g

from db import get_db

platform_config_bp = Blueprint('platform_config', __name__)

SECRET_KEYS = ('auth_token', 'api_key_secret')

DEFAULTS = {
    'hold_music': 'https://demo.twilio.com/docs/classic.mp3',
    'voice': 'alice',
    'language': 'en-GB',
}


def tenant_config(tenant_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT key, value FROM platform_config WHERE tenant_id = %s AND key LIKE 'twilio.%%'", (tenant_id,))
    rows = cur.fetchall()
    conn.close()

    cfg = {r['key'][len('twilio.'):]: r['value'] for r in rows}

    for key in ('account_sid', 'auth_token', 'api_key_sid', 'api_key_secret', 'hold_music', 'voice', 'language'):
        if cfg.get(key):
            continue
        env_val = os.environ.get(f'TWILIO_{key.upper()}')
        if env_val:
            cfg[key] = env_val

    for key, default in DEFAULTS.items():
        cfg.setdefault(key, default)

    return cfg


def _public_config(tenant_id):
    cfg = tenant_config(tenant_id)
    secrets_set = {k: bool(cfg.get(k)) for k in SECRET_KEYS}
    public = {k: v for k, v in cfg.items() if k not in SECRET_KEYS}
    public['secrets_set'] = secrets_set
    return public


@platform_config_bp.route('/api/config')
def get_config():
    return jsonify(_public_config(g.tenant_id))


@platform_config_bp.route('/api/config', methods=['PUT'])
def update_config():
    body = request.get_json(force=True) or {}
    tenant_id = g.tenant_id

    conn = get_db()
    cur = conn.cursor()
    for key, value in body.items():
        if key in ('tenant_id',):
            continue
        # a blank value on a secret field leaves the stored secret alone —
        # never write an empty string over a working credential
        if key in SECRET_KEYS and not value:
            continue
        cur.execute(
            """
            INSERT INTO platform_config (tenant_id, key, value) VALUES (%s, %s, %s)
            ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value
            """,
            (tenant_id, f'twilio.{key}', value),
        )
    conn.commit()
    conn.close()

    return jsonify(_public_config(tenant_id))
