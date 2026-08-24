"""
Canned Responses Module — backs frontend/src/mcm/canned-redesign.ts's
Canned Responses library (/api/canned). category_label and
substitution_fields are always derived server-side from category/body on
every write, never accepted from the client — the same "derived, not
hand-maintained" rule the frontend's own extractSubstitutionFields()
follows, so the two can never drift out of sync with each other.

Every route is tenant-scoped via g.tenant_id (set by auth.py's bearer-token
guard) — never a client-supplied value, same convention as apps.py and
every other module in this backend.
"""

import re
import secrets

from flask import Blueprint, jsonify, request, g

from db import get_db

canned_bp = Blueprint('canned', __name__, url_prefix='/api/canned')

CANNED_CATEGORY_LABELS = {
    'greetings': 'Greetings',
    'billing': 'Billing',
    'technical': 'Technical Support',
    'escalation': 'Escalation',
    'closing': 'Closing',
    'general': 'General',
}

_SUBSTITUTION_RE = re.compile(r'\{\{\s*([^}]+?)\s*\}\}')


def _category_label(code):
    return CANNED_CATEGORY_LABELS.get(code, 'General')


def _extract_substitution_fields(body):
    seen = []
    for m in _SUBSTITUTION_RE.finditer(body or ''):
        token = m.group(1).strip()
        if token and token not in seen:
            seen.append(token)
    return seen


@canned_bp.route('', methods=['GET'])
def list_canned():
    """?category=<code> and ?q=<text> (matched against name or body) are
    both optional and combine with AND — same filters the frontend's own
    filteredCanned() applies client-side, offered here too for any caller
    that wants the server to do the filtering instead."""
    category = request.args.get('category')
    q = request.args.get('q')

    conn = get_db()
    cur = conn.cursor()
    where = ['tenant_id = %s']
    params = [g.tenant_id]
    if category:
        where.append('category = %s')
        params.append(category)
    if q:
        where.append('(name ILIKE %s OR body ILIKE %s)')
        params += [f'%{q}%', f'%{q}%']

    cur.execute(
        'SELECT * FROM canned_responses WHERE ' + ' AND '.join(where) + ' ORDER BY name',
        params,
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@canned_bp.route('', methods=['POST'])
def create_canned():
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    category = data.get('category') or 'general'
    body = (data.get('body') or '').strip()
    if not name or not body:
        return jsonify({'ok': False, 'error': 'name and body are required'}), 400

    new_id = 'cr_' + secrets.token_hex(5)
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO canned_responses (id, tenant_id, name, category, category_label, body, substitution_fields)
        VALUES (%s,%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (new_id, g.tenant_id, name, category, _category_label(category), body, _extract_substitution_fields(body)),
    )
    row = cur.fetchone()
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Canned response created', name, g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify(dict(row)), 201


@canned_bp.route('/<canned_id>', methods=['PUT', 'PATCH'])
def update_canned(canned_id):
    data = request.get_json(force=True) or {}

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM canned_responses WHERE id = %s AND tenant_id = %s', (canned_id, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    name = (data.get('name') or existing['name']).strip()
    category = data.get('category') or existing['category']
    body = data.get('body') if data.get('body') is not None else existing['body']
    body = body.strip() if isinstance(body, str) else existing['body']
    if not name or not body:
        conn.close()
        return jsonify({'ok': False, 'error': 'name and body are required'}), 400

    cur.execute(
        """
        UPDATE canned_responses
        SET name = %s, category = %s, category_label = %s, body = %s, substitution_fields = %s
        WHERE id = %s AND tenant_id = %s
        RETURNING *
        """,
        (name, category, _category_label(category), body, _extract_substitution_fields(body), canned_id, g.tenant_id),
    )
    row = cur.fetchone()
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Canned response updated', name, g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify(dict(row))


@canned_bp.route('/<canned_id>', methods=['DELETE'])
def delete_canned(canned_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT name FROM canned_responses WHERE id = %s AND tenant_id = %s', (canned_id, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('DELETE FROM canned_responses WHERE id = %s AND tenant_id = %s', (canned_id, g.tenant_id))
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Canned response deleted', existing['name'], g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})
