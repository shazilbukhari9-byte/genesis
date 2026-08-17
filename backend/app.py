import sqlite3
from datetime import datetime
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


if __name__ == '__main__':
    app.run(port=5000, debug=True)
