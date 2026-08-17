import json
import sqlite3
import uuid
from datetime import datetime, timedelta
from calendar import monthrange
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=['http://localhost:8080'])


def get_db():
    conn = sqlite3.connect('subscription.db')
    conn.row_factory = sqlite3.Row
    return conn


@app.route('/')
def index():
    return jsonify({
        'service': 'MCM Cloud CX subscription API',
        'endpoints': [
            'GET  /api/subscription/overview',
            'POST /api/subscription/plan-change',
            'POST /api/subscription/seats',
            'GET  /api/subscription/audit',
            'GET    /api/v2/authorization/trusts',
            'POST   /api/v2/authorization/trusts',
            'GET    /api/v2/authorization/trusts/<id>',
            'PUT    /api/v2/authorization/trusts/<id>',
            'DELETE /api/v2/authorization/trusts/<id>',
            'GET    /api/v2/authorization/audit-logs',
        ],
    })


@app.route('/api/subscription/overview')
def overview():
    conn = get_db()
    licenses = conn.execute('SELECT * FROM licenses').fetchall()
    invoices = conn.execute('SELECT * FROM invoices ORDER BY id DESC LIMIT 3').fetchall()
    usage_rows = conn.execute('SELECT metric, SUM(amount) AS total FROM usage_log GROUP BY metric').fetchall()
    conn.close()

    pool = {r['code']: r['purchased'] for r in licenses}
    unit_price = {r['code']: r['unit_price'] for r in licenses}
    label = {r['code']: r['label'] for r in licenses}

    used_map = {}
    for r in licenses:
        conn2 = get_db()
        row = conn2.execute(
            "SELECT COUNT(*) AS n FROM users WHERE license_code = ? AND state = 'Active'",
            (r['code'],),
        ).fetchone()
        conn2.close()
        used_map[r['code']] = row['n']

    total_seats_cost = sum(used_map[c] * unit_price[c] for c in pool)

    usage = {row['metric']: row['total'] for row in usage_rows}
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
    conn.execute(
        'INSERT INTO audit_log (who, action, detail, created_at) VALUES (?,?,?,?)',
        ('Faisal Khan', 'Plan change requested', note, datetime.now().isoformat()),
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
    existing = conn.execute('SELECT purchased FROM licenses WHERE code = ?', (lic,)).fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown licence code'}), 404

    conn.execute('UPDATE licenses SET purchased = purchased + ? WHERE code = ?', (qty, lic))
    new_total = conn.execute('SELECT purchased FROM licenses WHERE code = ?', (lic,)).fetchone()['purchased']
    conn.execute(
        'INSERT INTO audit_log (who, action, detail, created_at) VALUES (?,?,?,?)',
        ('Faisal Khan', 'Seats requested', f'+{qty} {lic} (pool now {new_total})', datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'total': new_total})


@app.route('/api/subscription/audit')
def audit_log():
    conn = get_db()
    rows = conn.execute('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


def serialize_trust(row):
    d = dict(row)
    d['scope_roles'] = json.loads(d['scope_roles']) if d['scope_roles'] else []
    d['divisions'] = json.loads(d['divisions']) if d['divisions'] else []
    return d


def log_trust_audit(conn, org_domain, actor_name, action_text):
    conn.execute(
        'INSERT INTO authorized_org_audit_logs (timestamp, org_domain, actor_name, action_text) VALUES (?,?,?,?)',
        (datetime.now().isoformat(), org_domain, actor_name, action_text),
    )


@app.route('/api/v2/authorization/trusts')
def list_trusts():
    relationship = request.args.get('relationship')
    division = request.args.get('division')
    status = request.args.get('status')
    search = (request.args.get('search') or '').strip().lower()

    query = 'SELECT * FROM authorized_organizations WHERE 1=1'
    params = []
    if relationship:
        query += ' AND relationship = ?'
        params.append(relationship)
    if status:
        query += ' AND status = ?'
        params.append(status)
    if division and division.lower() != 'all':
        query += ' AND divisions LIKE ?'
        params.append(f'%{division}%')
    query += ' ORDER BY id'

    conn = get_db()
    rows = [serialize_trust(r) for r in conn.execute(query, params).fetchall()]
    conn.close()

    if search:
        def matches(t):
            haystack = ' '.join([
                t['org_name'], t['org_id'], t['relationship'], t['status'],
                ' '.join(t['scope_roles']), ' '.join(t['divisions']),
            ]).lower()
            return search in haystack
        rows = [t for t in rows if matches(t)]

    return jsonify(rows)


@app.route('/api/v2/authorization/trusts', methods=['POST'])
def create_trust():
    data = request.get_json(force=True) or {}
    org_name = (data.get('org_name') or '').strip()
    if not org_name:
        return jsonify({'ok': False, 'error': 'org_name is required'}), 400

    org_id = data.get('org_id') or str(uuid.uuid4())
    domain = data.get('domain', '')
    relationship = data.get('relationship', 'Trustee')
    scope_roles = data.get('scope_roles') or []
    divisions = data.get('divisions') or []
    expires_at = data.get('expires_at')
    status = data.get('status', 'Active')
    notes = data.get('notes', '')
    now = datetime.now()

    conn = get_db()
    existing = conn.execute('SELECT id FROM authorized_organizations WHERE org_id = ?', (org_id,)).fetchone()
    if existing is not None:
        conn.close()
        return jsonify({'ok': False, 'error': 'org_id already exists'}), 409

    cur = conn.execute(
        '''INSERT INTO authorized_organizations
           (org_name, org_id, domain, relationship, scope_roles, divisions, expires_at, status, notes, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)''',
        (org_name, org_id, domain, relationship, json.dumps(scope_roles), json.dumps(divisions),
         expires_at, status, notes, now.isoformat()),
    )
    new_id = cur.lastrowid
    log_trust_audit(conn, domain, data.get('actor', 'Faisal Khan'), f'Trust authorized for {org_name}')
    conn.commit()
    row = conn.execute('SELECT * FROM authorized_organizations WHERE id = ?', (new_id,)).fetchone()
    conn.close()
    return jsonify(serialize_trust(row)), 201


@app.route('/api/v2/authorization/trusts/<int:trust_id>')
def get_trust(trust_id):
    conn = get_db()
    row = conn.execute('SELECT * FROM authorized_organizations WHERE id = ?', (trust_id,)).fetchone()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify(serialize_trust(row))


@app.route('/api/v2/authorization/trusts/<int:trust_id>', methods=['PUT'])
def update_trust(trust_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    existing = conn.execute('SELECT * FROM authorized_organizations WHERE id = ?', (trust_id,)).fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    fields = dict(existing)
    for key in ('org_name', 'domain', 'relationship', 'expires_at', 'status', 'notes'):
        if key in data:
            fields[key] = data[key]
    if 'scope_roles' in data:
        fields['scope_roles'] = json.dumps(data['scope_roles'])
    if 'divisions' in data:
        fields['divisions'] = json.dumps(data['divisions'])

    # Convenience: extend expiry by N days from today and reactivate.
    if 'extend_days' in data:
        days = int(data['extend_days'])
        fields['expires_at'] = (datetime.now() + timedelta(days=days)).strftime('%Y-%m-%d')
        fields['status'] = 'Active'

    conn.execute(
        '''UPDATE authorized_organizations SET
           org_name = ?, domain = ?, relationship = ?, scope_roles = ?, divisions = ?,
           expires_at = ?, status = ?, notes = ?
           WHERE id = ?''',
        (fields['org_name'], fields['domain'], fields['relationship'], fields['scope_roles'],
         fields['divisions'], fields['expires_at'], fields['status'], fields['notes'], trust_id),
    )
    log_trust_audit(conn, fields['domain'], data.get('actor', 'Faisal Khan'), f'Trust updated for {fields["org_name"]}')
    conn.commit()
    row = conn.execute('SELECT * FROM authorized_organizations WHERE id = ?', (trust_id,)).fetchone()
    conn.close()
    return jsonify(serialize_trust(row))


@app.route('/api/v2/authorization/trusts/<int:trust_id>', methods=['DELETE'])
def delete_trust(trust_id):
    hard = request.args.get('hard', 'false').lower() == 'true'
    actor = request.args.get('actor', 'Faisal Khan')

    conn = get_db()
    existing = conn.execute('SELECT * FROM authorized_organizations WHERE id = ?', (trust_id,)).fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    if hard:
        conn.execute('DELETE FROM authorized_organizations WHERE id = ?', (trust_id,))
        log_trust_audit(conn, existing['domain'], actor, f'Trust permanently deleted for {existing["org_name"]}')
        conn.commit()
        conn.close()
        return jsonify({'ok': True, 'deleted': True})

    conn.execute("UPDATE authorized_organizations SET status = 'Revoked' WHERE id = ?", (trust_id,))
    log_trust_audit(conn, existing['domain'], actor, f'Trust revoked for {existing["org_name"]}')
    conn.commit()
    row = conn.execute('SELECT * FROM authorized_organizations WHERE id = ?', (trust_id,)).fetchone()
    conn.close()
    return jsonify(serialize_trust(row))


@app.route('/api/v2/authorization/audit-logs')
def trust_audit_logs():
    conn = get_db()
    rows = conn.execute(
        'SELECT * FROM authorized_org_audit_logs ORDER BY id DESC LIMIT 200'
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


if __name__ == '__main__':
    app.run(port=5000, debug=True)
