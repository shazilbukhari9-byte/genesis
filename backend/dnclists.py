"""
DNC Lists Module — backs frontend/src/mcm/dnclists-redesign.ts's
Outbound > DNC Compliance Lists page (list view + per-list number view +
Number Lookup drawer).

Numbers live in their own table, not a TEXT[] column on dnc_lists, so a
number can be looked up across every list in the tenant in one indexed
query (GET /api/dnclists/lookup) — the same job the page's own client-side
Number Lookup drawer already did over the in-memory DB.dncLists array.

Every route is tenant-scoped via g.tenant_id (set by auth.py's bearer-token
guard) — never a client-supplied value, same convention as certs.py/
contactlists.py.
"""

import re
import secrets

from flask import Blueprint, jsonify, request, g

from db import get_db

dnclists_bp = Blueprint('dnclists', __name__, url_prefix='/api/dnclists')

PHONE_RE = re.compile(r'^\+\d{7,15}$')


@dnclists_bp.route('', methods=['GET'])
def list_dnc_lists():
    """?q=<text> (matched against list name) is optional — the Search box
    the page's toolbar exposes."""
    q = request.args.get('q')

    conn = get_db()
    cur = conn.cursor()
    where = ['tenant_id = %s']
    params = [g.tenant_id]
    if q:
        where.append('name ILIKE %s')
        params.append(f'%{q}%')

    cur.execute(
        'SELECT * FROM dnc_lists WHERE ' + ' AND '.join(where) + ' ORDER BY name',
        params,
    )
    lists = cur.fetchall()

    out = []
    for lst in lists:
        cur.execute('SELECT COUNT(*) AS n FROM dnc_numbers WHERE list_id = %s AND tenant_id = %s', (lst['id'], g.tenant_id))
        row = dict(lst)
        row['number_count'] = cur.fetchone()['n']
        out.append(row)
    conn.close()
    return jsonify(out)


@dnclists_bp.route('/<list_id>', methods=['GET'])
def get_dnc_list(list_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM dnc_lists WHERE id = %s AND tenant_id = %s', (list_id, g.tenant_id))
    lst = cur.fetchone()
    if lst is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute(
        'SELECT * FROM dnc_numbers WHERE list_id = %s AND tenant_id = %s ORDER BY created_at',
        (list_id, g.tenant_id),
    )
    numbers = cur.fetchall()
    conn.close()

    result = dict(lst)
    result['numbers'] = numbers
    return jsonify(result)


@dnclists_bp.route('', methods=['POST'])
def create_dnc_list():
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    if len(name) < 2:
        return jsonify({'ok': False, 'error': 'A unique name is required.'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM dnc_lists WHERE tenant_id = %s AND LOWER(name) = LOWER(%s)', (g.tenant_id, name))
    if cur.fetchone() is not None:
        conn.close()
        return jsonify({'ok': False, 'error': 'A unique name is required.'}), 400

    new_id = 'dnc_' + secrets.token_hex(5)
    cur.execute(
        'INSERT INTO dnc_lists (id, tenant_id, name) VALUES (%s,%s,%s) RETURNING *',
        (new_id, g.tenant_id, name),
    )
    row = dict(cur.fetchone())
    row['number_count'] = 0
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Create DNC list', name, g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify(row), 201


@dnclists_bp.route('/<list_id>', methods=['DELETE'])
def delete_dnc_list(list_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT name FROM dnc_lists WHERE id = %s AND tenant_id = %s', (list_id, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('DELETE FROM dnc_lists WHERE id = %s AND tenant_id = %s', (list_id, g.tenant_id))
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Delete DNC list', existing['name'], g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@dnclists_bp.route('/<list_id>/numbers', methods=['POST'])
def add_numbers(list_id):
    """Bulk add — accepts {numbers: ['+447700900123', ...]} pre-split by the
    frontend from pasted/typed text (one per line or comma separated), same
    validation the original dncSaveNums() did client-side: E.164, deduped
    against the list's existing numbers and the batch itself."""
    data = request.get_json(force=True) or {}
    numbers = data.get('numbers')
    if not isinstance(numbers, list) or not numbers:
        return jsonify({'ok': False, 'error': 'no numbers supplied'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id, name FROM dnc_lists WHERE id = %s AND tenant_id = %s', (list_id, g.tenant_id))
    lst = cur.fetchone()
    if lst is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('SELECT phone FROM dnc_numbers WHERE list_id = %s AND tenant_id = %s', (list_id, g.tenant_id))
    existing = {r['phone'] for r in cur.fetchall()}

    added = 0
    invalid = 0
    seen = set()
    for n in numbers:
        n = (n or '').strip()
        if not PHONE_RE.match(n):
            invalid += 1
            continue
        if n in existing or n in seen:
            continue
        new_id = 'dcn_' + secrets.token_hex(5)
        cur.execute(
            'INSERT INTO dnc_numbers (id, tenant_id, list_id, phone) VALUES (%s,%s,%s,%s)',
            (new_id, g.tenant_id, list_id, n),
        )
        seen.add(n)
        added += 1

    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Add DNC numbers', f"{lst['name']}: {added} added", g.tenant_id),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'added': added, 'invalid': invalid})


@dnclists_bp.route('/<list_id>/numbers/<number_id>', methods=['DELETE'])
def remove_number(list_id, number_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT id FROM dnc_numbers WHERE id = %s AND list_id = %s AND tenant_id = %s',
        (number_id, list_id, g.tenant_id),
    )
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('DELETE FROM dnc_numbers WHERE id = %s AND list_id = %s AND tenant_id = %s', (number_id, list_id, g.tenant_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@dnclists_bp.route('/lookup', methods=['GET'])
def lookup_number():
    """?number=<E.164> — which DNC lists in this tenant suppress it."""
    number = (request.args.get('number') or '').strip()
    if not number:
        return jsonify({'ok': False, 'error': 'number is required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT dl.id, dl.name FROM dnc_numbers dn
        JOIN dnc_lists dl ON dl.id = dn.list_id
        WHERE dn.tenant_id = %s AND dn.phone = %s
        """,
        (g.tenant_id, number),
    )
    hits = cur.fetchall()
    conn.close()
    return jsonify({'number': number, 'hits': hits})
