"""
Data Actions Module — backs frontend/src/mcm/dataact-redesign.ts's
Integrations > Data Actions page. All four tabs are served from here:

  Actions      — CRUD over data_actions.
  Contracts    — data_action_contracts, the *structured* form of each
                 action's freeform `contract` string. Derived server-side
                 by _sync_contract_fields() on every create/update, so the
                 string a user types in the drawer and the structured rows
                 can never drift apart. Previously this breakdown was
                 parsed in the browser and never persisted at all, which
                 is why contract detail showed in the UI but nothing
                 existed in PostgreSQL to back it.
  Test         — POST /<id>/test, a deterministic *simulated* call (not a
                 real outbound HTTP request: this prototype has no real
                 Salesforce/ServiceNow backends behind these endpoints,
                 and fetching a client-editable `endpoint` server-side
                 would be an SSRF risk — see _simulate_test). The
                 simulation is only how the *result* is produced; the run
                 itself is genuinely persisted.
  Run History  — data_action_runs, one row written by every test/execute
                 invocation, tagged with which entry point triggered it.

Every route is tenant-scoped via g.tenant_id (set by auth.py's bearer-token
guard) — never a client-supplied value, same convention as certs.py/canned.py.
"""

import re
import secrets

from flask import Blueprint, jsonify, request, g

from db import get_db

dataact_bp = Blueprint('dataact', __name__, url_prefix='/api/dataact')

WRITABLE_FIELDS = ('name', 'integration', 'method', 'endpoint', 'contract', 'division')

# Which entry points may trigger a run, recorded on data_action_runs so the
# Run History log shows how each run was started.
TRIGGER_SOURCES = ('test', 'test-tab', 'execute')

# Splits a contract string into its input and output halves. Accepts the
# Unicode arrow the drawer's placeholder suggests ("ani → tier, name", used
# by the seeded actions) and a plain ASCII "->", which a user will just as
# naturally type.
_CONTRACT_ARROW = re.compile(r'\s*(?:→|->)\s*')
# "phone (string)" -> name 'phone', type 'string'. A bare "phone" keeps the
# 'string' default, matching the column default.
_FIELD_WITH_TYPE = re.compile(r'^(.*?)\s*\(\s*([^)]+?)\s*\)$')


def parse_contract(text):
    """Freeform contract string -> [{direction, field_name, field_type,
    position}]. Server-side on purpose: this is the single definition of
    what a contract *means*, so the Contracts tab, the stored rows and any
    future caller all agree. Returns [] for an empty/arrow-less string."""
    halves = _CONTRACT_ARROW.split(str(text or '').strip(), maxsplit=1)
    fields = []
    for direction, half in (('input', halves[0] if halves else ''),
                            ('output', halves[1] if len(halves) > 1 else '')):
        position = 0
        for raw in half.split(','):
            token = raw.strip()
            if not token:
                continue
            match = _FIELD_WITH_TYPE.match(token)
            if match and match.group(1).strip():
                name, ftype = match.group(1).strip(), match.group(2).strip()
            else:
                name, ftype = token, 'string'
            fields.append({'direction': direction, 'field_name': name,
                           'field_type': ftype, 'position': position})
            position += 1
    return fields


def _sync_contract_fields(cur, action_id, contract_text):
    """Rewrite an action's structured contract rows to match its contract
    string. Replace-in-full rather than diffing: a contract is a short,
    ordered field list, so recreating it is simpler and cannot leave a
    stale field behind. Runs inside the caller's transaction, so the
    action row and its contract rows commit together or not at all."""
    cur.execute('DELETE FROM data_action_contracts WHERE data_action_id = %s AND tenant_id = %s',
                (action_id, g.tenant_id))
    for field in parse_contract(contract_text):
        cur.execute(
            """
            INSERT INTO data_action_contracts
                (tenant_id, data_action_id, direction, field_name, field_type, position)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (data_action_id, direction, field_name) DO UPDATE
                SET field_type = EXCLUDED.field_type, position = EXCLUDED.position
            """,
            (g.tenant_id, action_id, field['direction'], field['field_name'],
             field['field_type'], field['position']),
        )


def _record_run(cur, action_id, action_name, latency, result_text, trigger_source):
    """Single place that writes Run History, so every path that executes an
    action logs it the same way."""
    cur.execute(
        """
        INSERT INTO data_action_runs
            (tenant_id, data_action_id, action_name, duration_ms, result, trigger_source)
        VALUES (%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (g.tenant_id, action_id, action_name, latency, result_text,
         trigger_source if trigger_source in TRIGGER_SOURCES else 'test'),
    )
    return cur.fetchone()


def _result_text(status, error):
    """The HTTP-style outcome string Run History displays."""
    if status == 'Failing':
        return error or 'Failed'
    return 'Timeout retry' if status == 'Slow' else '200 OK'


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


_CONTRACT_SELECT = """
    SELECT c.id, c.data_action_id, c.direction, c.field_name, c.field_type,
           c.position, c.created_at, c.updated_at, a.name AS action_name
    FROM data_action_contracts c
    JOIN data_actions a ON a.id = c.data_action_id
"""


@dataact_bp.route('/contracts', methods=['GET'])
def list_contracts():
    """Backs the Contracts tab — every structured contract field for this
    tenant, joined to its action's name. Ordered so each action's input
    fields come before its output fields, in the order they were written.
    Optional ?data_action_id= narrows it to a single action."""
    action_id = request.args.get('data_action_id')
    conn = get_db()
    cur = conn.cursor()
    where = ['c.tenant_id = %s']
    params = [g.tenant_id]
    if action_id:
        where.append('c.data_action_id = %s')
        params.append(action_id)
    cur.execute(
        _CONTRACT_SELECT + ' WHERE ' + ' AND '.join(where) +
        " ORDER BY a.name, (c.direction = 'output'), c.position",
        params,
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify(rows)


@dataact_bp.route('/<action_id>/contract', methods=['GET'])
def get_action_contract(action_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM data_actions WHERE id = %s AND tenant_id = %s', (action_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404
    cur.execute(
        _CONTRACT_SELECT + " WHERE c.data_action_id = %s AND c.tenant_id = %s"
        " ORDER BY (c.direction = 'output'), c.position",
        (action_id, g.tenant_id),
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify(rows)


@dataact_bp.route('/<action_id>/contract', methods=['PUT'])
def replace_action_contract(action_id):
    """Set an action's contract from a structured field list, for callers
    that want to define fields (and their types) directly rather than
    through the drawer's freeform string. The human-readable
    data_actions.contract string is regenerated from the fields here, so
    whichever way a contract is written the two stay consistent."""
    data = request.get_json(force=True) or {}
    fields = data.get('fields')
    if not isinstance(fields, list):
        return jsonify({'ok': False, 'error': 'fields must be a list'}), 400

    cleaned = []
    for field in fields:
        if not isinstance(field, dict):
            return jsonify({'ok': False, 'error': 'each field must be an object'}), 400
        direction = (field.get('direction') or '').strip().lower()
        name = (field.get('field_name') or '').strip()
        if direction not in ('input', 'output'):
            return jsonify({'ok': False, 'error': "direction must be 'input' or 'output'"}), 400
        if not name:
            return jsonify({'ok': False, 'error': 'field_name is required'}), 400
        cleaned.append({'direction': direction, 'field_name': name,
                        'field_type': (field.get('field_type') or 'string').strip() or 'string'})

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM data_actions WHERE id = %s AND tenant_id = %s', (action_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('DELETE FROM data_action_contracts WHERE data_action_id = %s AND tenant_id = %s',
                (action_id, g.tenant_id))
    counters = {'input': 0, 'output': 0}
    for field in cleaned:
        cur.execute(
            """
            INSERT INTO data_action_contracts
                (tenant_id, data_action_id, direction, field_name, field_type, position)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (data_action_id, direction, field_name) DO UPDATE
                SET field_type = EXCLUDED.field_type, position = EXCLUDED.position
            """,
            (g.tenant_id, action_id, field['direction'], field['field_name'],
             field['field_type'], counters[field['direction']]),
        )
        counters[field['direction']] += 1

    def _join(direction):
        return ', '.join(f['field_name'] for f in cleaned if f['direction'] == direction)

    cur.execute('UPDATE data_actions SET contract = %s WHERE id = %s AND tenant_id = %s',
                (f'{_join("input")} → {_join("output")}'.strip(' →'), action_id, g.tenant_id))

    cur.execute(
        _CONTRACT_SELECT + " WHERE c.data_action_id = %s AND c.tenant_id = %s"
        " ORDER BY (c.direction = 'output'), c.position",
        (action_id, g.tenant_id),
    )
    rows = cur.fetchall()
    conn.commit()
    conn.close()
    return jsonify(rows)


@dataact_bp.route('/<action_id>', methods=['GET'])
def get_action(action_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM data_actions WHERE id = %s AND tenant_id = %s', (action_id, g.tenant_id))
    row = cur.fetchone()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify(row)


@dataact_bp.route('/runs', methods=['GET'])
def list_runs():
    """Backs the page's 'Run History' tab — every real Test Action
    invocation, most recent first. ?limit= caps how many (default 50,
    same convention as the generic registry's list endpoints)."""
    # Malformed ?limit= is a 400, not a 500 raised out of int().
    try:
        limit = min(max(int(request.args.get('limit', 50)), 0), 500)
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'limit must be an integer'}), 400
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT id, data_action_id, action_name, duration_ms, result, trigger_source, ran_at '
        'FROM data_action_runs WHERE tenant_id = %s ORDER BY ran_at DESC LIMIT %s',
        (g.tenant_id, limit),
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify(rows)


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
        # 409 Conflict, not 400 — matches every other duplicate-record
        # response in this backend (installed_integrations, integration_
        # catalogue via app.py's UniqueViolation handler); this one's
        # still a friendlier app-level pre-check ahead of the DB's own
        # idx_data_actions_tenant_name_ci unique index, which is what
        # actually catches the race-condition case that check can't.
        return jsonify({'ok': False, 'error': 'a data action with this name already exists'}), 409

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
    # Persist the structured contract alongside the action, in the same
    # transaction — an action and its contract rows are never half-written.
    _sync_contract_fields(cur, new_id, row['contract'])
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
    # Re-derive the structured contract whenever the contract string is
    # part of this update, so the two representations stay in lockstep.
    if 'contract' in cols:
        _sync_contract_fields(cur, action_id, row['contract'])
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
    """Execute a data action and persist the run. The *result* is
    simulated (see _simulate_test and this module's docstring for why),
    but everything around it is real: the action's status/latency are
    updated in PostgreSQL and a Run History row is written, in one
    transaction, so a run can never be reported to the caller without
    also being recorded. ?source= / {"source": ...} records which entry
    point triggered it (drawer 'test' vs Test tab 'test-tab')."""
    payload = request.get_json(silent=True) or {}
    trigger_source = request.args.get('source') or payload.get('source') or 'test'

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

    run = _record_run(cur, action_id, row['name'], latency,
                      _result_text(status, error), trigger_source)

    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, 'Data action tested', f"{row['name']}: {status}", g.tenant_id),
    )
    conn.commit()
    conn.close()
    # The run row is returned too, so a caller can prove the execution was
    # persisted without a second round-trip to Run History.
    return jsonify({**dict(row), 'run': dict(run)})
