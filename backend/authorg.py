"""
Authorized Organizations — inter-tenant trust management.

CRUD for trust relationships at /api/v2/authorization/trusts,
matching the endpoints the authorg-redesign.ts frontend already calls.
"""

from flask import Blueprint, jsonify, request, g
from db import get_db

authorg_bp = Blueprint('authorg', __name__)


def _row_to_dict(row):
    d = dict(row)
    # Convert date/datetime to ISO strings for JSON
    for key in ('expires_at', 'created_at', 'updated_at'):
        if key in d and d[key] is not None:
            d[key] = str(d[key])
    return d


@authorg_bp.route('/api/v2/authorization/trusts', methods=['GET'])
def list_trusts():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT * FROM auth_org_trusts WHERE tenant_id = %s ORDER BY created_at DESC',
        (g.tenant_id,),
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([_row_to_dict(r) for r in rows])


@authorg_bp.route('/api/v2/authorization/trusts', methods=['POST'])
def create_trust():
    data = request.get_json(force=True) or {}
    if not data.get('org_name'):
        return jsonify({'ok': False, 'error': 'org_name required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        '''INSERT INTO auth_org_trusts
           (tenant_id, org_name, org_id, domain, relationship, scope_roles, divisions, status, expires_at, notes)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           RETURNING *''',
        (
            g.tenant_id,
            data['org_name'],
            data.get('org_id'),
            data.get('domain'),
            data.get('relationship', 'Trustee'),
            data.get('scope_roles', []),
            data.get('divisions', []),
            data.get('status', 'Active'),
            data.get('expires_at'),
            data.get('notes'),
        ),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(_row_to_dict(row)), 201


@authorg_bp.route('/api/v2/authorization/trusts/<int:trust_id>', methods=['GET'])
def get_trust(trust_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT * FROM auth_org_trusts WHERE id = %s AND tenant_id = %s',
        (trust_id, g.tenant_id),
    )
    row = cur.fetchone()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify(_row_to_dict(row))


@authorg_bp.route('/api/v2/authorization/trusts/<int:trust_id>', methods=['PUT', 'PATCH'])
def update_trust(trust_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT * FROM auth_org_trusts WHERE id = %s AND tenant_id = %s',
        (trust_id, g.tenant_id),
    )
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute(
        '''UPDATE auth_org_trusts SET
           org_name = COALESCE(%s, org_name),
           org_id = COALESCE(%s, org_id),
           domain = COALESCE(%s, domain),
           relationship = COALESCE(%s, relationship),
           scope_roles = COALESCE(%s, scope_roles),
           divisions = COALESCE(%s, divisions),
           status = COALESCE(%s, status),
           expires_at = COALESCE(%s, expires_at),
           notes = COALESCE(%s, notes)
           WHERE id = %s AND tenant_id = %s
           RETURNING *''',
        (
            data.get('org_name'),
            data.get('org_id'),
            data.get('domain'),
            data.get('relationship'),
            data.get('scope_roles'),
            data.get('divisions'),
            data.get('status'),
            data.get('expires_at'),
            data.get('notes'),
            trust_id,
            g.tenant_id,
        ),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(_row_to_dict(row))


@authorg_bp.route('/api/v2/authorization/trusts/<int:trust_id>', methods=['DELETE'])
def delete_trust(trust_id):
    conn = get_db()
    cur = conn.cursor()
    hard = request.args.get('hard', 'false').lower() == 'true'

    if hard:
        cur.execute(
            'DELETE FROM auth_org_trusts WHERE id = %s AND tenant_id = %s RETURNING id',
            (trust_id, g.tenant_id),
        )
    else:
        cur.execute(
            "UPDATE auth_org_trusts SET status = 'Revoked' WHERE id = %s AND tenant_id = %s RETURNING id",
            (trust_id, g.tenant_id),
        )

    row = cur.fetchone()
    conn.commit()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify({'ok': True})
