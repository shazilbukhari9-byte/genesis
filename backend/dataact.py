"""
Data Actions Module — backs frontend/src/mcm/dataact-redesign.ts's
Integrations > Data Actions page (Actions tab; Contracts/Test/Run History
tabs are still the original static reference tables from scripts.ts,
untouched here).

Test Action is a deterministic *simulated* call, not a real outbound HTTP
request — this prototype has no real Salesforce/ServiceNow/web-service
backends behind these endpoints, and letting the backend fetch a
client-editable `endpoint` field would be an SSRF risk. See _simulate_test().

Every route is tenant-scoped via g.tenant_id (set by auth.py's bearer-token
guard) — never a client-supplied value, same convention as certs.py/canned.py.
"""

import secrets

from flask import Blueprint, jsonify, request, g

from db import get_db

dataact_bp = Blueprint('dataact', __name__, url_prefix='/api/dataact')

WRITABLE_FIELDS = ('name', 'integration', 'method', 'endpoint', 'contract', 'division')


def _simulate_test(endpoint, method):
    """Deterministic based on endpoint text so re-testing the same action
    without editing it gives a stable, explainable result — 'legacy'
    endpoints always fail (matches the page's original Legacy_Balance_Lookup
    seed row), otherwise latency is derived from endpoint length/method."""
    base = 120 + (len(endpoint or '') * 7) % 500
    if 'legacy' in (endpoint or '').lower():
        return None, 'Failing', 'Connection refused (503)'
    if method == 'POST':
        base += 80
    if base > 900:
        return base, 'Slow', ''
    return base, 'Published', ''


@dataact_bp.route('', methods=['GET'])
def list_actions():
    """?integration=<name>, ?division=<code>, ?status=<Draft|Published|Slow|Failing>
    and ?q=<text> (matched against name/endpoint/contract) are all optional
    and combine — the Search box, Integration chip, Division chip and Status
    chip the page's toolbar exposes."""
    integration = request.args.get('integration')
    division = request.args.get('division')
    status_filter = request.args.get('status')
    q = request.args.get('q')

    conn = get_db()
    cur = conn.cursor()
    where = ['tenant_id = %s']
    params = [g.tenant_id]
    if integration:
        where.append('integration = %s')
        params.append(integration)
    if division:
        where.append('division = %s')
        params.append(division)
    if status_filter:
        where.append('status = %s')
        params.append(status_filter)
    if q:
        where.append('(name ILIKE %s OR endpoint ILIKE %s OR contract ILIKE %s)')
        params += [f'%{q}%', f'%{q}%', f'%{q}%']

    cur.execute(
        'SELECT * FROM data_actions WHERE ' + ' AND '.join(where) + ' ORDER BY name',
        params,
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify(rows)


@dataact_bp.route('', methods=['POST'])
def create_action():
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    endpoint = (data.get('endpoint') or '').strip()
    if not name or not endpoint:
        return jsonify({'ok': False, 'error': 'name and endpoint are required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM data_actions WHERE tenant_id = %s AND LOWER(name) = LOWER(%s)', (g.tenant_id, name))
    if cur.fetchone() is not None:
        conn.close()
        return jsonify({'ok': False, 'error': 'A data action with this name already exists.'}), 400

    new_id = 'da_' + secrets.token_hex(5)
    cur.execute(
        """
        INSERT INTO data_actions (id, tenant_id, name, integration, method, endpoint, contract, division)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            new_id, g.tenant_id, name,
            data.get('integration') or 'Web Services',
            data.get('method') or 'GET',
            endpoint,
            data.get('contract') or '',
            data.get('division') or '',
        ),
    )
    row = cur.fetchone()
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Data action created', name, g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify(row), 201


@dataact_bp.route('/<action_id>', methods=['PUT', 'PATCH'])
def update_action(action_id):
    data = request.get_json(force=True) or {}
    cols = [f for f in WRITABLE_FIELDS if f in data]
    if not cols:
        return jsonify({'ok': False, 'error': 'no writable fields supplied'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM data_actions WHERE id = %s AND tenant_id = %s', (action_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    set_clause = ', '.join(f'{c} = %s' for c in cols)
    cur.execute(
        f'UPDATE data_actions SET {set_clause} WHERE id = %s AND tenant_id = %s RETURNING *',
        [data[c] for c in cols] + [action_id, g.tenant_id],
    )
    row = cur.fetchone()
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Data action updated', row['name'], g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify(row)


@dataact_bp.route('/<action_id>', methods=['DELETE'])
def delete_action(action_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT name FROM data_actions WHERE id = %s AND tenant_id = %s', (action_id, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('DELETE FROM data_actions WHERE id = %s AND tenant_id = %s', (action_id, g.tenant_id))
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Data action deleted', existing['name'], g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@dataact_bp.route('/<action_id>/test', methods=['POST'])
def test_action(action_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM data_actions WHERE id = %s AND tenant_id = %s', (action_id, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    latency, status, error = _simulate_test(existing['endpoint'], existing['method'])
    cur.execute(
        """
        UPDATE data_actions SET avg_latency_ms = %s, status = %s, last_error = %s, last_tested_at = now()
        WHERE id = %s AND tenant_id = %s RETURNING *
        """,
        (latency, status, error, action_id, g.tenant_id),
    )
    row = cur.fetchone()
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Data action tested', f"{row['name']}: {status}", g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify(row)
