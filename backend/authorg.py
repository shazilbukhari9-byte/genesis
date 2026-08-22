"""
Authorized Organizations — inter-tenant trust management.

CRUD for trust relationships at /api/v2/authorization/trusts,
matching the endpoints the authorg-redesign.ts frontend already calls.
"""

from flask import Blueprint, jsonify, request, g
from db import get_db

authorg_bp = Blueprint('authorg', __name__)

# Matches the fixed set of values authorg-redesign.ts's own dropdowns and
# status-transition helpers ever send (Relationship Type select, and the
# Extend/Revoke/Reactivate/Delete actions) — anything else was previously
# accepted and stored with no check, silently breaking that frontend's
# status/relationship-branching logic (mapApiTrust()) on direct API access.
VALID_RELATIONSHIPS = {'Owner', 'Trustor', 'Trustee'}
VALID_STATUSES = {'Active', 'Owner', 'Expiring soon', 'Revoked'}


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
    if data.get('relationship') is not None and data['relationship'] not in VALID_RELATIONSHIPS:
        return jsonify({'ok': False, 'error': f"invalid relationship {data['relationship']!r}"}), 400
    if data.get('status') is not None and data['status'] not in VALID_STATUSES:
        return jsonify({'ok': False, 'error': f"invalid status {data['status']!r}"}), 400

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
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Authorize organization', row['org_name'], g.tenant_id),
    )
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
    if data.get('relationship') is not None and data['relationship'] not in VALID_RELATIONSHIPS:
        return jsonify({'ok': False, 'error': f"invalid relationship {data['relationship']!r}"}), 400
    if data.get('status') is not None and data['status'] not in VALID_STATUSES:
        return jsonify({'ok': False, 'error': f"invalid status {data['status']!r}"}), 400

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
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Edit authorized organization', row['org_name'], g.tenant_id),
    )
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
            'DELETE FROM auth_org_trusts WHERE id = %s AND tenant_id = %s RETURNING id, org_name',
            (trust_id, g.tenant_id),
        )
    else:
        cur.execute(
            "UPDATE auth_org_trusts SET status = 'Revoked' WHERE id = %s AND tenant_id = %s RETURNING id, org_name",
            (trust_id, g.tenant_id),
        )

    row = cur.fetchone()
    if row is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Delete authorized organization' if hard else 'Revoke authorized organization', row['org_name'], g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})
