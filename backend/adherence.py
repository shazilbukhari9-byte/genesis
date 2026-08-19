"""
Adherence / WFM — activity codes, management units, and schedules.

CRUD at /api/wfm/* matching the data structures in scripts.ts:
  DB.actCodes    → /api/wfm/activity-codes
  DB.wfm.mus     → /api/wfm/management-units
  DB.wfmSchedules → /api/wfm/schedules
"""

import json
from flask import Blueprint, jsonify, request, g
from db import get_db

adherence_bp = Blueprint('adherence', __name__)


def _row_dict(row):
    d = dict(row)
    for key in ('created_at', 'updated_at'):
        if key in d and d[key] is not None:
            d[key] = str(d[key])
    return d


# ── Activity Codes ──────────────────────────────────────────────

@adherence_bp.route('/api/wfm/activity-codes', methods=['GET'])
def list_activity_codes():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM activity_codes WHERE tenant_id = %s ORDER BY name', (g.tenant_id,))
    rows = cur.fetchall()
    conn.close()
    return jsonify([_row_dict(r) for r in rows])


@adherence_bp.route('/api/wfm/activity-codes', methods=['POST'])
def create_activity_code():
    data = request.get_json(force=True) or {}
    if not data.get('name'):
        return jsonify({'ok': False, 'error': 'name required'}), 400
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        '''INSERT INTO activity_codes (tenant_id, name, category, paid, adherence_rule)
           VALUES (%s, %s, %s, %s, %s) RETURNING *''',
        (g.tenant_id, data['name'], data.get('category', 'On Queue'),
         data.get('paid', True), data.get('adherence_rule', 'Adherent when On Queue')),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(_row_dict(row)), 201


@adherence_bp.route('/api/wfm/activity-codes/<int:code_id>', methods=['PUT', 'PATCH'])
def update_activity_code(code_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM activity_codes WHERE id = %s AND tenant_id = %s', (code_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404
    cur.execute(
        '''UPDATE activity_codes SET
           name = COALESCE(%s, name),
           category = COALESCE(%s, category),
           paid = COALESCE(%s, paid),
           adherence_rule = COALESCE(%s, adherence_rule)
           WHERE id = %s AND tenant_id = %s RETURNING *''',
        (data.get('name'), data.get('category'), data.get('paid'),
         data.get('adherence_rule'), code_id, g.tenant_id),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(_row_dict(row))


@adherence_bp.route('/api/wfm/activity-codes/<int:code_id>', methods=['DELETE'])
def delete_activity_code(code_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM activity_codes WHERE id = %s AND tenant_id = %s RETURNING id', (code_id, g.tenant_id))
    row = cur.fetchone()
    conn.commit()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify({'ok': True})


# ── Management Units ────────────────────────────────────────────

@adherence_bp.route('/api/wfm/management-units', methods=['GET'])
def list_management_units():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM management_units WHERE tenant_id = %s ORDER BY name', (g.tenant_id,))
    rows = cur.fetchall()
    conn.close()
    return jsonify([_row_dict(r) for r in rows])


@adherence_bp.route('/api/wfm/management-units', methods=['POST'])
def create_management_unit():
    data = request.get_json(force=True) or {}
    if not data.get('name'):
        return jsonify({'ok': False, 'error': 'name required'}), 400
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO management_units (tenant_id, name, agents) VALUES (%s, %s, %s) RETURNING *',
        (g.tenant_id, data['name'], data.get('agents', [])),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(_row_dict(row)), 201


@adherence_bp.route('/api/wfm/management-units/<int:mu_id>', methods=['PUT', 'PATCH'])
def update_management_unit(mu_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM management_units WHERE id = %s AND tenant_id = %s', (mu_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404
    cur.execute(
        '''UPDATE management_units SET
           name = COALESCE(%s, name),
           agents = COALESCE(%s, agents)
           WHERE id = %s AND tenant_id = %s RETURNING *''',
        (data.get('name'), data.get('agents'), mu_id, g.tenant_id),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(_row_dict(row))


@adherence_bp.route('/api/wfm/management-units/<int:mu_id>', methods=['DELETE'])
def delete_management_unit(mu_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM management_units WHERE id = %s AND tenant_id = %s RETURNING id', (mu_id, g.tenant_id))
    row = cur.fetchone()
    conn.commit()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify({'ok': True})


# ── Schedules ───────────────────────────────────────────────────

@adherence_bp.route('/api/wfm/schedules', methods=['GET'])
def list_schedules():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM wfm_schedules WHERE tenant_id = %s ORDER BY week DESC', (g.tenant_id,))
    rows = cur.fetchall()
    conn.close()
    result = []
    for r in rows:
        d = _row_dict(r)
        if isinstance(d.get('entries'), str):
            try:
                d['entries'] = json.loads(d['entries'])
            except Exception:
                pass
        result.append(d)
    return jsonify(result)


@adherence_bp.route('/api/wfm/schedules', methods=['POST'])
def create_schedule():
    data = request.get_json(force=True) or {}
    if not data.get('week'):
        return jsonify({'ok': False, 'error': 'week required'}), 400
    conn = get_db()
    cur = conn.cursor()
    entries = data.get('entries', {})
    if isinstance(entries, dict):
        entries = json.dumps(entries)
    cur.execute(
        'INSERT INTO wfm_schedules (tenant_id, week, status, entries) VALUES (%s, %s, %s, %s) RETURNING *',
        (g.tenant_id, data['week'], data.get('status', 'Draft'), entries),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    d = _row_dict(row)
    if isinstance(d.get('entries'), str):
        try:
            d['entries'] = json.loads(d['entries'])
        except Exception:
            pass
    return jsonify(d), 201


@adherence_bp.route('/api/wfm/schedules/<int:sched_id>', methods=['PUT', 'PATCH'])
def update_schedule(sched_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM wfm_schedules WHERE id = %s AND tenant_id = %s', (sched_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    entries = data.get('entries')
    if isinstance(entries, dict):
        entries = json.dumps(entries)

    cur.execute(
        '''UPDATE wfm_schedules SET
           week = COALESCE(%s, week),
           status = COALESCE(%s, status),
           entries = COALESCE(%s, entries)
           WHERE id = %s AND tenant_id = %s RETURNING *''',
        (data.get('week'), data.get('status'), entries, sched_id, g.tenant_id),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    d = _row_dict(row)
    if isinstance(d.get('entries'), str):
        try:
            d['entries'] = json.loads(d['entries'])
        except Exception:
            pass
    return jsonify(d)


@adherence_bp.route('/api/wfm/schedules/<int:sched_id>', methods=['DELETE'])
def delete_schedule(sched_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM wfm_schedules WHERE id = %s AND tenant_id = %s RETURNING id', (sched_id, g.tenant_id))
    row = cur.fetchone()
    conn.commit()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify({'ok': True})
