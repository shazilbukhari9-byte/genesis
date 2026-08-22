"""
Digital Certificates Module — backs frontend/src/mcm/certs-redesign.ts's
Telephony > Digital Certificates page (Certificates tab; the page's Trust
Store / Expiry Monitor tabs are still the original static reference tables
from scripts.ts, untouched here). status is computed on every read from
expires_at/alert_before_days rather than stored, so it's always accurate —
see _status_and_days().

Every route is tenant-scoped via g.tenant_id (set by auth.py's bearer-token
guard) — never a client-supplied value, same convention as apps.py/canned.py.
"""

import secrets
from datetime import date

from flask import Blueprint, jsonify, request, g

from db import get_db

certs_bp = Blueprint('certs', __name__, url_prefix='/api/certs')

WRITABLE_FIELDS = (
    'name', 'purpose', 'issued_to', 'issuer', 'division',
    'valid_from', 'expires_at', 'alert_before_days', 'email_alert', 'auto_renew',
)


def _status_and_days(expires_at, alert_before_days):
    if expires_at is None:
        return 'Valid', None
    exp = expires_at if isinstance(expires_at, date) else date.fromisoformat(str(expires_at))
    days_left = (exp - date.today()).days
    if days_left < 0:
        return 'Expired', days_left
    if days_left <= (alert_before_days or 30):
        return 'Expiring', days_left
    return 'Valid', days_left


def _with_status(row):
    row = dict(row)
    row['status'], row['days_left'] = _status_and_days(row['expires_at'], row['alert_before_days'])
    return row


@certs_bp.route('', methods=['GET'])
def list_certs():
    """?division=<code>, ?status=<Valid|Expiring|Expired> and ?q=<text>
    (matched against name/issued_to/issuer) are all optional and combine —
    the same three filters the page's Search box, Division chip and Status
    chip already expose in the UI."""
    division = request.args.get('division')
    status_filter = request.args.get('status')
    q = request.args.get('q')

    conn = get_db()
    cur = conn.cursor()
    where = ['tenant_id = %s']
    params = [g.tenant_id]
    if division:
        where.append('division = %s')
        params.append(division)
    if q:
        where.append('(name ILIKE %s OR issued_to ILIKE %s OR issuer ILIKE %s)')
        params += [f'%{q}%', f'%{q}%', f'%{q}%']

    cur.execute(
        'SELECT * FROM certificates WHERE ' + ' AND '.join(where) + ' ORDER BY expires_at',
        params,
    )
    rows = [_with_status(r) for r in cur.fetchall()]
    conn.close()

    if status_filter:
        rows = [r for r in rows if r['status'] == status_filter]
    return jsonify(rows)


@certs_bp.route('', methods=['POST'])
def create_cert():
    """Metadata-only "upload" — matches the existing drawer, which never
    actually handled real file bytes either (its file/key/chain inputs were
    decorative placeholders before this endpoint existed). Real certificate
    file storage is a separate, larger feature this endpoint doesn't add."""
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    expires_at = data.get('expires_at')
    if not name or not expires_at:
        return jsonify({'ok': False, 'error': 'name and expires_at are required'}), 400

    new_id = 'cert_' + secrets.token_hex(5)
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO certificates (id, tenant_id, name, purpose, issued_to, issuer, division,
                                   valid_from, expires_at, alert_before_days, email_alert, auto_renew)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            new_id, g.tenant_id, name,
            data.get('purpose') or 'BYOC trunk',
            data.get('issued_to') or '',
            data.get('issuer') or '',
            data.get('division') or '',
            data.get('valid_from') or None,
            expires_at,
            int(data.get('alert_before_days') or 30),
            bool(data.get('email_alert', True)),
            bool(data.get('auto_renew', False)),
        ),
    )
    row = _with_status(cur.fetchone())
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Certificate uploaded', name, g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify(row), 201


@certs_bp.route('/<cert_id>', methods=['PUT', 'PATCH'])
def update_cert(cert_id):
    data = request.get_json(force=True) or {}
    cols = [f for f in WRITABLE_FIELDS if f in data]
    if not cols:
        return jsonify({'ok': False, 'error': 'no writable fields supplied'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM certificates WHERE id = %s AND tenant_id = %s', (cert_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    set_clause = ', '.join(f'{c} = %s' for c in cols)
    cur.execute(
        f'UPDATE certificates SET {set_clause} WHERE id = %s AND tenant_id = %s RETURNING *',
        [data[c] for c in cols] + [cert_id, g.tenant_id],
    )
    row = _with_status(cur.fetchone())
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Certificate updated', row['name'], g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify(row)


@certs_bp.route('/<cert_id>', methods=['DELETE'])
def delete_cert(cert_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT name FROM certificates WHERE id = %s AND tenant_id = %s', (cert_id, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('DELETE FROM certificates WHERE id = %s AND tenant_id = %s', (cert_id, g.tenant_id))
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Certificate deleted', existing['name'], g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})
