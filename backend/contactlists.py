"""
Contact Lists Module — backs frontend/src/mcm/contactlists-redesign.ts's
Outbound > Contact Lists page (list + per-list contact detail view).

Each list owns its own column set (cols); per-contact field values live in
a JSONB `data` blob keyed by those column names rather than fixed columns —
same shape scripts.ts's original in-memory DB.contactLists used (l.cols /
ct.data). Status ('Not attempted' | 'Contacted' | 'DNC' | 'Complete' ...) is
a free-text column, not an enum, matching the original prototype.

Every route is tenant-scoped via g.tenant_id (set by auth.py's bearer-token
guard) — never a client-supplied value, same convention as certs.py/canned.py.
"""

import re
import secrets

from flask import Blueprint, jsonify, request, g

from db import get_db

contactlists_bp = Blueprint('contactlists', __name__, url_prefix='/api/contactlists')

PHONE_RE = re.compile(r'^\+\d{7,15}$')


def _list_summary(row, count, status_counts):
    row = dict(row)
    row['contact_count'] = count
    row['status_summary'] = status_counts
    return row


def _fetch_status_counts(cur, list_id, tenant_id):
    cur.execute(
        'SELECT status, COUNT(*) AS n FROM contacts WHERE list_id = %s AND tenant_id = %s GROUP BY status',
        (list_id, tenant_id),
    )
    return {r['status']: r['n'] for r in cur.fetchall()}


@contactlists_bp.route('', methods=['GET'])
def list_contact_lists():
    """?division=<code> and ?q=<text> (matched against list name) are both
    optional and combine — the same Search box and Division filter the
    page's toolbar exposes."""
    division = request.args.get('division')
    q = request.args.get('q')

    conn = get_db()
    cur = conn.cursor()
    where = ['tenant_id = %s']
    params = [g.tenant_id]
    if division:
        where.append('division = %s')
        params.append(division)
    if q:
        where.append('name ILIKE %s')
        params.append(f'%{q}%')

    cur.execute(
        'SELECT * FROM contact_lists WHERE ' + ' AND '.join(where) + ' ORDER BY name',
        params,
    )
    lists = cur.fetchall()

    out = []
    for lst in lists:
        cur.execute('SELECT COUNT(*) AS n FROM contacts WHERE list_id = %s AND tenant_id = %s', (lst['id'], g.tenant_id))
        count = cur.fetchone()['n']
        status_counts = _fetch_status_counts(cur, lst['id'], g.tenant_id)
        out.append(_list_summary(lst, count, status_counts))
    conn.close()
    return jsonify(out)


@contactlists_bp.route('/<list_id>', methods=['GET'])
def get_contact_list(list_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM contact_lists WHERE id = %s AND tenant_id = %s', (list_id, g.tenant_id))
    lst = cur.fetchone()
    if lst is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute(
        'SELECT * FROM contacts WHERE list_id = %s AND tenant_id = %s ORDER BY created_at',
        (list_id, g.tenant_id),
    )
    contacts = cur.fetchall()
    conn.close()

    result = dict(lst)
    result['contacts'] = contacts
    return jsonify(result)


@contactlists_bp.route('', methods=['POST'])
def create_contact_list():
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    if len(name) < 2:
        return jsonify({'ok': False, 'error': 'List name is required.'}), 400

    cols = data.get('cols')
    if not isinstance(cols, list) or not cols:
        cols = ['FirstName', 'LastName', 'Phone']
    if 'Phone' not in cols:
        return jsonify({'ok': False, 'error': 'Columns must include "Phone".'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM contact_lists WHERE tenant_id = %s AND LOWER(name) = LOWER(%s)', (g.tenant_id, name))
    if cur.fetchone() is not None:
        conn.close()
        return jsonify({'ok': False, 'error': 'A list with this name already exists.'}), 400

    new_id = 'cl_' + secrets.token_hex(5)
    cur.execute(
        'INSERT INTO contact_lists (id, tenant_id, name, division, cols) VALUES (%s,%s,%s,%s,%s) RETURNING *',
        (new_id, g.tenant_id, name, data.get('division') or '', cols),
    )
    row = dict(cur.fetchone())
    row['contact_count'] = 0
    row['status_summary'] = {}
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, created_at) VALUES (%s,%s,%s, now())',
        (g.user_name, 'Create contact list', name),
    )
    conn.commit()
    conn.close()
    return jsonify(row), 201


@contactlists_bp.route('/<list_id>', methods=['PUT', 'PATCH'])
def update_contact_list(list_id):
    data = request.get_json(force=True) or {}
    cols_writable = [f for f in ('name', 'division', 'cols') if f in data]
    if not cols_writable:
        return jsonify({'ok': False, 'error': 'no writable fields supplied'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM contact_lists WHERE id = %s AND tenant_id = %s', (list_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    set_clause = ', '.join(f'{c} = %s' for c in cols_writable)
    cur.execute(
        f'UPDATE contact_lists SET {set_clause} WHERE id = %s AND tenant_id = %s RETURNING *',
        [data[c] for c in cols_writable] + [list_id, g.tenant_id],
    )
    row = dict(cur.fetchone())
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, created_at) VALUES (%s,%s,%s, now())',
        (g.user_name, 'Update contact list', row['name']),
    )
    conn.commit()
    conn.close()
    return jsonify(row)


@contactlists_bp.route('/<list_id>', methods=['DELETE'])
def delete_contact_list(list_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT name FROM contact_lists WHERE id = %s AND tenant_id = %s', (list_id, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('DELETE FROM contact_lists WHERE id = %s AND tenant_id = %s', (list_id, g.tenant_id))
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, created_at) VALUES (%s,%s,%s, now())',
        (g.user_name, 'Delete contact list', existing['name']),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@contactlists_bp.route('/<list_id>/contacts', methods=['POST'])
def add_contact(list_id):
    data = request.get_json(force=True) or {}
    fields = data.get('data') or {}
    phone = (fields.get('Phone') or '').strip()
    if not PHONE_RE.match(phone):
        return jsonify({'ok': False, 'error': 'Phone must be E.164 (e.g. +447700900123).'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM contact_lists WHERE id = %s AND tenant_id = %s', (list_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute(
        'SELECT id FROM contacts WHERE list_id = %s AND tenant_id = %s AND data->>%s = %s',
        (list_id, g.tenant_id, 'Phone', phone),
    )
    if cur.fetchone() is not None:
        conn.close()
        return jsonify({'ok': False, 'error': 'This phone number is already in the list.'}), 400

    new_id = 'ct_' + secrets.token_hex(5)
    cur.execute(
        'INSERT INTO contacts (id, tenant_id, list_id, data) VALUES (%s,%s,%s,%s) RETURNING *',
        (new_id, g.tenant_id, list_id, fields),
    )
    row = cur.fetchone()
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, created_at) VALUES (%s,%s,%s, now())',
        (g.user_name, 'Add contact', f'{list_id} › {phone}'),
    )
    conn.commit()
    conn.close()
    return jsonify(row), 201


@contactlists_bp.route('/<list_id>/contacts/import', methods=['POST'])
def import_contacts(list_id):
    """Bulk import — accepts {rows: [{col: value, ...}, ...]} pre-parsed by
    the frontend from pasted CSV text (same validation the original
    clRunImport() did client-side: Phone required/E.164, duplicates
    rejected against both the list's existing contacts and the batch
    itself)."""
    data = request.get_json(force=True) or {}
    rows = data.get('rows')
    if not isinstance(rows, list) or not rows:
        return jsonify({'ok': False, 'error': 'no rows supplied'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM contact_lists WHERE id = %s AND tenant_id = %s', (list_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('SELECT data->>%s AS phone FROM contacts WHERE list_id = %s AND tenant_id = %s', ('Phone', list_id, g.tenant_id))
    existing_phones = {r['phone'] for r in cur.fetchall() if r['phone']}

    ok = 0
    fail = []
    seen_in_batch = set()
    for i, fields in enumerate(rows):
        phone = (fields.get('Phone') or '').strip()
        if not PHONE_RE.match(phone):
            fail.append(f'Row {i + 1}: invalid phone')
            continue
        if phone in existing_phones or phone in seen_in_batch:
            fail.append(f'Row {i + 1}: duplicate {phone}')
            continue
        new_id = 'ct_' + secrets.token_hex(5)
        cur.execute(
            'INSERT INTO contacts (id, tenant_id, list_id, data) VALUES (%s,%s,%s,%s)',
            (new_id, g.tenant_id, list_id, fields),
        )
        seen_in_batch.add(phone)
        ok += 1

    cur.execute(
        'INSERT INTO audit_log (who, action, detail, created_at) VALUES (%s,%s,%s, now())',
        (g.user_name, 'Import contacts', f'{list_id}: {ok} added, {len(fail)} rejected'),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'imported': ok, 'failed': fail})


@contactlists_bp.route('/<list_id>/contacts/<contact_id>', methods=['DELETE'])
def delete_contact(list_id, contact_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT id FROM contacts WHERE id = %s AND list_id = %s AND tenant_id = %s',
        (contact_id, list_id, g.tenant_id),
    )
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('DELETE FROM contacts WHERE id = %s AND list_id = %s AND tenant_id = %s', (contact_id, list_id, g.tenant_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@contactlists_bp.route('/<list_id>/contacts/<contact_id>/dnc', methods=['PATCH'])
def mark_contact_dnc(list_id, contact_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "UPDATE contacts SET status = 'DNC', last_result = 'Marked DNC by admin' "
        'WHERE id = %s AND list_id = %s AND tenant_id = %s RETURNING *',
        (contact_id, list_id, g.tenant_id),
    )
    row = cur.fetchone()
    if row is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute(
        'INSERT INTO audit_log (who, action, detail, created_at) VALUES (%s,%s,%s, now())',
        (g.user_name, 'Mark DNC', row['data'].get('Phone', '')),
    )
    conn.commit()
    conn.close()
    return jsonify(row)
