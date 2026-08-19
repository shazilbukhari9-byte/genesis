import re
from datetime import datetime
from calendar import monthrange
from flask import Flask, jsonify, request, g
from flask_cors import CORS

from db import get_db
from resources import REGISTRY
from interactions import interactions_bp
from acd import acd_bp
from carrier import carrier_bp
from flow import flow_bp
from analytics import analytics_bp, CATALOG as REPORT_CATALOG
from org_settings import org_settings_bp
from auth import auth_bp, register_auth_guard
from platform_config import platform_config_bp
from telephony import telephony_bp
from alerts import alerts_bp
from directory import directory_bp
import config
import init_db

init_db.run()

_SAFE_IDENTIFIER = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')

app = Flask(__name__)
app.secret_key = config.SECRET_KEY
CORS(app, origins=['http://localhost:8080', 'https://genesis-eta-six.vercel.app'], supports_credentials=True)
app.register_blueprint(interactions_bp)
app.register_blueprint(acd_bp)
app.register_blueprint(carrier_bp)
app.register_blueprint(flow_bp)
app.register_blueprint(analytics_bp)
app.register_blueprint(org_settings_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(platform_config_bp)
app.register_blueprint(telephony_bp)
app.register_blueprint(alerts_bp)
app.register_blueprint(directory_bp)
register_auth_guard(app)


@app.route('/')
def index():
    return jsonify({
        'service': 'MCM Cloud CX subscription API',
        'endpoints': [
            'GET  /api/subscription/overview',
            'POST /api/subscription/plan-change',
            'POST /api/subscription/seats',
            'GET  /api/subscription/audit',
        ],
        'resource_registry': {
            resource: ['GET /api/' + resource, 'GET /api/' + resource + '/<id>',
                       'POST /api/' + resource, 'PUT|PATCH /api/' + resource + '/<id>',
                       'DELETE /api/' + resource + '/<id>']
            for resource in REGISTRY
        },
        'interactions': [
            'GET  /api/interactions',
            'GET  /api/interactions/<id>',
            'POST /api/interactions',
            'POST /api/interactions/claim-next',
            'POST /api/interactions/<id>/answer',
            'POST /api/interactions/<id>/end',
            'POST /api/interactions/<id>/wrapup',
            'POST /api/interactions/<id>/transfer',
            'POST /api/interactions/<id>/messages',
            'POST /api/interactions/sweep-stale',
        ],
        'acd': [
            'POST /api/acd/presence',
            'POST /api/acd/sweep',
            'POST /api/acd/campaigns/<id>/dial',
            'GET  /api/acd/campaigns/<id>/monitor',
        ],
        'carrier': [
            'POST /api/carrier/normalise',
            'GET  /api/byoc/route',
            'GET  /api/call-routes/resolve',
        ],
        'flows': [
            'POST /api/flows/<id>/run',
            'POST /api/flows/menu',
        ],
        'analytics': [
            'GET /api/live/queues',
            'GET /api/live/agents',
            'GET /api/live/summary',
            'GET /api/reports/<key>  (catalog: ' + ', '.join(sorted(REPORT_CATALOG)) + ')',
        ],
        'auth': [
            'POST /api/auth/login   (public)',
            'GET  /api/auth/me',
            'POST /api/auth/logout',
            'GET  /api/bootstrap',
            'GET  /api/health       (public)',
            '--- everything else under /api requires Authorization: Bearer <token> ---',
        ],
        'directory': [
            'GET/POST /api/directory/<entity>  (people|groups|locations|profile-fields|external-contacts|workspaces)',
            'GET/PUT/DELETE /api/directory/<entity>/<id>',
            'GET/PUT /api/directory/favourites[/<id>]',
            'GET/POST /api/directory/threads/<id>/messages',
            'POST /api/directory/calls  PUT /api/directory/calls/<id>',
            'POST /api/directory/emails',
            'PUT /api/directory/me/presence',
            'POST /api/directory/seed',
        ],
        'config': [
            'GET /api/config   (secrets_set only, never real secret values)',
            'PUT /api/config   (blank value on a secret field leaves it unchanged)',
        ],
    })


def _slugify_division_name(name):
    slug = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
    return slug or 'division'


@app.route('/api/divisions', methods=['GET', 'POST'])
def divisions_collection():
    """Dedicated (not generic-registry) routes — divisions.code is a text
    primary key, not the int id the registry's routes assume."""
    conn = get_db()
    cur = conn.cursor()

    if request.method == 'POST':
        data = request.get_json(force=True) or {}
        name = data.get('name')
        if not name:
            conn.close()
            return jsonify({'ok': False, 'error': 'name required'}), 400
        base = _slugify_division_name(name)
        code = base
        suffix = 1
        while True:
            cur.execute('SELECT 1 FROM divisions WHERE code = %s', (code,))
            if cur.fetchone() is None:
                break
            suffix += 1
            code = f'{base}_{suffix}'
        cur.execute(
            'INSERT INTO divisions (code, tenant_id, name, description, is_home) VALUES (%s,%s,%s,%s,%s) RETURNING *',
            (code, g.tenant_id, name, data.get('description', ''), bool(data.get('is_home', False))),
        )
        row = cur.fetchone()
        conn.commit()
        conn.close()
        return jsonify(dict(row)), 201

    cur.execute('SELECT * FROM divisions WHERE tenant_id = %s ORDER BY name', (g.tenant_id,))
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/divisions/<code>', methods=['PUT', 'PATCH', 'DELETE'])
def divisions_item(code):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM divisions WHERE code = %s AND tenant_id = %s', (code, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    if request.method == 'DELETE':
        if existing['is_home']:
            conn.close()
            return jsonify({'ok': False, 'error': 'the default division cannot be deleted'}), 409
        cur.execute('DELETE FROM divisions WHERE code = %s', (code,))
        conn.commit()
        conn.close()
        return jsonify({'ok': True})

    data = request.get_json(force=True) or {}
    cur.execute(
        'UPDATE divisions SET name = COALESCE(%s, name), description = COALESCE(%s, description), is_home = COALESCE(%s, is_home) WHERE code = %s RETURNING *',
        (data.get('name'), data.get('description'), data.get('is_home'), code),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(dict(row))


@app.route('/api/licenses')
def list_licenses():
    """Plain list of the licenses table — kept outside the generic resource
    registry since that table's primary key is `code` (text), not an
    integer id, so the registry's <int:row_id> routes don't fit it."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT code, label, purchased, unit_price FROM licenses ORDER BY code')
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/subscription/overview')
def overview():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM licenses')
    licenses = cur.fetchall()
    cur.execute('SELECT * FROM invoices ORDER BY id DESC LIMIT 3')
    invoices = cur.fetchall()
    cur.execute('SELECT metric, SUM(amount) AS total FROM usage_log GROUP BY metric')
    usage_rows = cur.fetchall()

    pool = {r['code']: r['purchased'] for r in licenses}
    unit_price = {r['code']: r['unit_price'] for r in licenses}
    label = {r['code']: r['label'] for r in licenses}

    used_map = {}
    for r in licenses:
        cur.execute(
            "SELECT COUNT(*) AS n FROM users WHERE license_code = %s AND state = 'Active'",
            (r['code'],),
        )
        used_map[r['code']] = cur.fetchone()['n']

    conn.close()

    total_seats_cost = sum(used_map[c] * unit_price[c] for c in pool)

    usage = {row['metric']: float(row['total']) for row in usage_rows}
    voice_min = usage.get('voice_min', 0)
    msg_n = usage.get('sms', 0)
    stor_gb = usage.get('storage_gb', 0)
    ai_used = usage.get('ai_tokens', 0)
    voice_cost = round(voice_min * 1.2) / 100
    msg_cost = round(msg_n * 4) / 100
    stor_cost = round(stor_gb * 35) / 100
    ai_cost = round(ai_used * 15) / 100
    usage_total = voice_cost + msg_cost + stor_cost + ai_cost
    grand_total = total_seats_cost + round(usage_total)

    now = datetime.now()
    days_in_month = monthrange(now.year, now.month)[1]
    days_left = days_in_month - now.day + 1
    bill_period = now.strftime('%b %Y')
    next_month = now.month % 12 + 1
    next_year = now.year + (1 if now.month == 12 else 0)
    next_inv_date = datetime(next_year, next_month, 1).strftime('%d %b %Y')

    at_risk = [c for c in pool if pool[c] > 0 and round(100 * used_map[c] / pool[c]) >= 95]

    ai_purchased = 182500
    ai_pct = round(100 * ai_used / ai_purchased) if ai_purchased else 0
    ai_remaining = ai_purchased - ai_used

    return jsonify({
        'pool': pool,
        'unitPrice': unit_price,
        'label': label,
        'usedMap': used_map,
        'totalSeats': total_seats_cost,
        'voiceMin': voice_min,
        'msgN': msg_n,
        'recN': msg_n,
        'storGb': stor_gb,
        'aiUsed': ai_used,
        'voiceCost': voice_cost,
        'msgCost': msg_cost,
        'storCost': stor_cost,
        'aiCost': ai_cost,
        'usageTotal': usage_total,
        'grandTotal': grand_total,
        'daysLeft': days_left,
        'billPeriod': bill_period,
        'nextInvDate': next_inv_date,
        'atRisk': at_risk,
        'inv': [
            {'lbl': r['period_label'], 'ref': r['reference'], 'tot': r['total'], 'status': r['status']}
            for r in invoices
        ],
        'aiPurchased': ai_purchased,
        'aiPct': ai_pct,
        'aiRemaining': ai_remaining,
    })


@app.route('/api/subscription/plan-change', methods=['POST'])
def plan_change():
    data = request.get_json(force=True) or {}
    note = data.get('note', '')
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, created_at) VALUES (%s,%s,%s,%s)',
        (g.user_name, 'Plan change requested', note, datetime.now()),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/subscription/seats', methods=['POST'])
def add_seats():
    data = request.get_json(force=True) or {}
    lic = data.get('licence')
    qty = int(data.get('qty', 0))
    if not lic or qty <= 0:
        return jsonify({'ok': False, 'error': 'licence and positive qty required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT purchased FROM licenses WHERE code = %s', (lic,))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown licence code'}), 404

    cur.execute('UPDATE licenses SET purchased = purchased + %s WHERE code = %s', (qty, lic))
    cur.execute('SELECT purchased FROM licenses WHERE code = %s', (lic,))
    new_total = cur.fetchone()['purchased']
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, created_at) VALUES (%s,%s,%s,%s)',
        (g.user_name, 'Seats requested', f'+{qty} {lic} (pool now {new_total})', datetime.now()),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'total': new_total})


@app.route('/api/subscription/audit', methods=['GET', 'POST'])
def audit_log():
    if request.method == 'POST':
        data = request.get_json(force=True) or {}
        action = data.get('action')
        if not action:
            return jsonify({'ok': False, 'error': 'action required'}), 400
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            'INSERT INTO audit_log (who, action, detail, created_at) VALUES (%s,%s,%s,%s) RETURNING *',
            (g.user_name, action, data.get('detail', ''), datetime.now()),
        )
        row = cur.fetchone()
        conn.commit()
        conn.close()
        return jsonify(dict(row)), 201

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200')
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# Resource registry — 5 generic CRUD routes shared by every entity in
# resources.REGISTRY. See resources.py for what each entity declares.
# ---------------------------------------------------------------------------

def _safe_order(requested, spec):
    """Validate ?order= against the entity's own declared columns (plus id)
    instead of interpolating the query param straight into ORDER BY — an
    attacker-controlled column list previously only had to avoid a handful
    of punctuation characters, not name a real column."""
    if not requested:
        return spec['order']
    allowed = set(spec['fields']) | {'id'}
    terms = [t.strip() for t in requested.split(',') if t.strip()]
    if not terms:
        return spec['order']
    for term in terms:
        parts = term.split()
        if len(parts) == 1:
            col = parts[0]
        elif len(parts) == 2 and parts[1].upper() in ('ASC', 'DESC'):
            col = parts[0]
        else:
            return spec['order']
        if col not in allowed:
            return spec['order']
    return ', '.join(terms)


def _tenant_scoped(spec):
    """Tables that carry tenant_id are scoped to g.tenant_id on every read
    and write below — never to a client-supplied value. A client can't read,
    filter, create-into, or move a row into a tenant that isn't its own."""
    return 'tenant_id' in spec['fields']


@app.route('/api/<resource>')
def resource_list(resource):
    spec = REGISTRY.get(resource)
    if spec is None:
        return jsonify({'ok': False, 'error': 'unknown resource'}), 404

    conn = get_db()
    cur = conn.cursor()
    where, params = [], []

    q = request.args.get('q')
    if q and spec['search']:
        where.append('(' + ' OR '.join(f'{col} ILIKE %s' for col in spec['search']) + ')')
        params += [f'%{q}%'] * len(spec['search'])

    for key, value in request.args.items():
        if key in ('q', 'limit', 'offset', 'order', 'tenant_id'):
            continue
        # only columns the entity actually declared are filterable — an
        # unlisted "*_id" query param used to pass straight through into the
        # WHERE clause as a bare column name
        if key in spec['fields'] and _SAFE_IDENTIFIER.match(key):
            where.append(f'{key} = %s')
            params.append(value)

    if _tenant_scoped(spec):
        where.append('tenant_id = %s')
        params.append(g.tenant_id)

    limit = min(int(request.args.get('limit', 100)), 2000)
    offset = int(request.args.get('offset', 0))
    order = _safe_order(request.args.get('order'), spec)

    sql = f"SELECT * FROM {spec['table']}"
    if where:
        sql += ' WHERE ' + ' AND '.join(where)
    sql += f' ORDER BY {order} LIMIT %s OFFSET %s'
    params += [limit, offset]

    cur.execute(sql, params)
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/<resource>/<int:row_id>')
def resource_get(resource, row_id):
    spec = REGISTRY.get(resource)
    if spec is None:
        return jsonify({'ok': False, 'error': 'unknown resource'}), 404

    conn = get_db()
    cur = conn.cursor()
    sql = f"SELECT * FROM {spec['table']} WHERE id = %s"
    params = [row_id]
    if _tenant_scoped(spec):
        sql += ' AND tenant_id = %s'
        params.append(g.tenant_id)
    cur.execute(sql, params)
    row = cur.fetchone()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify(dict(row))


@app.route('/api/<resource>', methods=['POST'])
def resource_create(resource):
    spec = REGISTRY.get(resource)
    if spec is None:
        return jsonify({'ok': False, 'error': 'unknown resource'}), 404

    data = request.get_json(force=True) or {}
    cols = [f for f in spec['fields'] if f in data and f != 'tenant_id']
    if not cols:
        return jsonify({'ok': False, 'error': 'no writable fields supplied'}), 400

    values = [data[c] for c in cols]
    if _tenant_scoped(spec):
        cols = cols + ['tenant_id']
        values = values + [g.tenant_id]

    conn = get_db()
    cur = conn.cursor()
    placeholders = ', '.join('%s' for _ in cols)
    sql = f"INSERT INTO {spec['table']} ({', '.join(cols)}) VALUES ({placeholders}) RETURNING *"
    cur.execute(sql, values)
    new_row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(dict(new_row)), 201


@app.route('/api/<resource>/<int:row_id>', methods=['PUT', 'PATCH'])
def resource_update(resource, row_id):
    spec = REGISTRY.get(resource)
    if spec is None:
        return jsonify({'ok': False, 'error': 'unknown resource'}), 404

    data = request.get_json(force=True) or {}
    # tenant_id is never client-settable — a row can't be moved to another
    # tenant, whether or not the caller even owns it
    cols = [f for f in spec['fields'] if f in data and f != 'tenant_id']
    if not cols:
        return jsonify({'ok': False, 'error': 'no writable fields supplied'}), 400

    conn = get_db()
    cur = conn.cursor()
    check_sql = f"SELECT id FROM {spec['table']} WHERE id = %s"
    check_params = [row_id]
    if _tenant_scoped(spec):
        check_sql += ' AND tenant_id = %s'
        check_params.append(g.tenant_id)
    cur.execute(check_sql, check_params)
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    set_clause = ', '.join(f'{c} = %s' for c in cols)
    update_sql = f"UPDATE {spec['table']} SET {set_clause} WHERE id = %s"
    update_params = [data[c] for c in cols] + [row_id]
    if _tenant_scoped(spec):
        update_sql += ' AND tenant_id = %s'
        update_params.append(g.tenant_id)
    update_sql += ' RETURNING *'
    cur.execute(update_sql, update_params)
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(dict(row))


@app.route('/api/<resource>/<int:row_id>', methods=['DELETE'])
def resource_delete(resource, row_id):
    spec = REGISTRY.get(resource)
    if spec is None:
        return jsonify({'ok': False, 'error': 'unknown resource'}), 404

    conn = get_db()
    cur = conn.cursor()
    check_sql = f"SELECT id FROM {spec['table']} WHERE id = %s"
    check_params = [row_id]
    if _tenant_scoped(spec):
        check_sql += ' AND tenant_id = %s'
        check_params.append(g.tenant_id)
    cur.execute(check_sql, check_params)
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    delete_sql = f"DELETE FROM {spec['table']} WHERE id = %s"
    delete_params = [row_id]
    if _tenant_scoped(spec):
        delete_sql += ' AND tenant_id = %s'
        delete_params.append(g.tenant_id)
    cur.execute(delete_sql, delete_params)
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


if __name__ == '__main__':
    app.run(host=config.HOST, port=config.PORT, debug=True)
