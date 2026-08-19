"""
Real alert notifications. Alert Rules (Section on ACD alerting) already
fires on real threshold/duration logic in the frontend — it was just
never wired to anything real: "notified X, Y" was cosmetic text, and the
audit_log table this app already has sat unused (the notifications
dropdown reads a separate, in-memory-only list instead). This module is
the wiring: it persists the alert into the real audit_log table and
emails each notified user via SMTP.

SMTP_* env vars are optional (config.py leaves them unset by default) —
_configured() is checked before ever sending, so an alert still logs to
audit_log with no email account configured, just without the email step.
"""

import smtplib
from email.message import EmailMessage
from flask import Blueprint, jsonify, request, g

from db import get_db
import config

alerts_bp = Blueprint('alerts', __name__)


def _configured():
    return bool(config.SMTP_HOST and config.SMTP_USER and config.SMTP_PASSWORD and config.ALERT_EMAIL_FROM)


def _send_email(to_addr, subject, body):
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = config.ALERT_EMAIL_FROM
    msg['To'] = to_addr
    msg.set_content(body)
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT) as server:
        server.starttls()
        server.login(config.SMTP_USER, config.SMTP_PASSWORD)
        server.send_message(msg)


@alerts_bp.route('/api/alerts/status')
def alerts_status():
    return jsonify({'configured': _configured()})


# ── Alert Rules CRUD ────────────────────────────────────────────

@alerts_bp.route('/api/alerts/rules', methods=['GET'])
def list_alert_rules():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM alert_rules WHERE tenant_id = %s ORDER BY name', (g.tenant_id,))
    rows = cur.fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        for key in ('created_at', 'updated_at'):
            if key in d and d[key] is not None:
                d[key] = str(d[key])
        result.append(d)
    return jsonify(result)


@alerts_bp.route('/api/alerts/rules', methods=['POST'])
def create_alert_rule():
    data = request.get_json(force=True) or {}
    if not data.get('name'):
        return jsonify({'ok': False, 'error': 'name required'}), 400
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        '''INSERT INTO alert_rules
           (tenant_id, name, metric, cond, threshold, dur, notify, enabled)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *''',
        (
            g.tenant_id,
            data['name'],
            data.get('metric', 'Interactions waiting'),
            data.get('cond', '>'),
            float(data.get('threshold', 0)),
            int(data.get('dur', 0)),
            data.get('notify', []),
            data.get('enabled', True),
        ),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    d = dict(row)
    for key in ('created_at', 'updated_at'):
        if key in d and d[key] is not None:
            d[key] = str(d[key])
    return jsonify(d), 201


@alerts_bp.route('/api/alerts/rules/<int:rule_id>', methods=['GET'])
def get_alert_rule(rule_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM alert_rules WHERE id = %s AND tenant_id = %s', (rule_id, g.tenant_id))
    row = cur.fetchone()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    d = dict(row)
    for key in ('created_at', 'updated_at'):
        if key in d and d[key] is not None:
            d[key] = str(d[key])
    return jsonify(d)


@alerts_bp.route('/api/alerts/rules/<int:rule_id>', methods=['PUT', 'PATCH'])
def update_alert_rule(rule_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM alert_rules WHERE id = %s AND tenant_id = %s', (rule_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404
    cur.execute(
        '''UPDATE alert_rules SET
           name = COALESCE(%s, name),
           metric = COALESCE(%s, metric),
           cond = COALESCE(%s, cond),
           threshold = COALESCE(%s, threshold),
           dur = COALESCE(%s, dur),
           notify = COALESCE(%s, notify),
           enabled = COALESCE(%s, enabled)
           WHERE id = %s AND tenant_id = %s RETURNING *''',
        (
            data.get('name'), data.get('metric'), data.get('cond'),
            data.get('threshold'), data.get('dur'), data.get('notify'),
            data.get('enabled'),
            rule_id, g.tenant_id,
        ),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    d = dict(row)
    for key in ('created_at', 'updated_at'):
        if key in d and d[key] is not None:
            d[key] = str(d[key])
    return jsonify(d)


@alerts_bp.route('/api/alerts/rules/<int:rule_id>', methods=['DELETE'])
def delete_alert_rule(rule_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM alert_rules WHERE id = %s AND tenant_id = %s RETURNING id', (rule_id, g.tenant_id))
    row = cur.fetchone()
    conn.commit()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify({'ok': True})


@alerts_bp.route('/api/alerts/notify', methods=['POST'])
def notify_alert():
    """Called by the frontend the moment an Alert Rule actually fires."""
    data = request.get_json(force=True) or {}
    title = data.get('title')
    detail = data.get('detail', '')
    emails = [e for e in (data.get('emails') or []) if e]
    if not title:
        return jsonify({'ok': False, 'error': 'title required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, created_at) VALUES (%s,%s,%s, now())',
        (g.user_name, title, detail),
    )
    conn.commit()
    conn.close()

    sent = 0
    if _configured():
        for addr in emails:
            try:
                _send_email(addr, title, detail)
                sent += 1
            except Exception:
                pass

    return jsonify({'ok': True, 'emailed': sent, 'requested': len(emails)})
