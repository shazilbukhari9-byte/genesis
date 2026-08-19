"""
ACD engine (Section 10) — agent state and interaction assignment, entirely
in SQL: no in-memory routing table, so a restart loses nothing.

Only the simulated campaign dialer is built here (acd.campaign_dial). The
doc's live dialer (twilio_voice.campaign_dial_live) needs a real Twilio
account and enforces max_attempts/calling_hours/answering-machine detection
on top of DNC — none of that is built, since there's no Twilio account
configured to place real calls with.
"""

from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, g

from db import get_db

acd_bp = Blueprint('acd', __name__)

# Presences that keep an agent eligible for queue work. Anything else
# (Away, Break, Meeting, Training, ...) forces on_queue off.
QUEUE_ELIGIBLE_PRESENCE = 'Available'


def reset_agent_routing_status(cur, agent_id):
    """The guarded update every interaction-ending handler must run: derives
    routing_status from whether the agent still holds an active interaction,
    rather than trusting any client claim. The NOT EXISTS clause is what
    keeps an agent on two concurrent chats from going Idle when only one ends."""
    if agent_id is None:
        return
    cur.execute(
        """
        UPDATE users
        SET routing_status = CASE WHEN on_queue THEN 'Idle' ELSE 'Off Queue' END
        WHERE id = %s AND NOT EXISTS (
            SELECT 1 FROM interactions WHERE agent_id = %s AND result = 'Active')
        """,
        (agent_id, agent_id),
    )


@acd_bp.route('/api/acd/presence', methods=['POST'])
def set_presence():
    data = request.get_json(force=True) or {}
    user_id = data.get('user_id')
    presence = data.get('presence')
    if not user_id or not presence:
        return jsonify({'ok': False, 'error': 'user_id and presence required'}), 400

    on_queue = bool(data.get('on_queue', presence == QUEUE_ELIGIBLE_PRESENCE))
    if presence != QUEUE_ELIGIBLE_PRESENCE:
        on_queue = False  # can't stay on queue while Away/Meeting/etc.

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'UPDATE users SET presence = %s, on_queue = %s WHERE id = %s',
        (presence, on_queue, user_id),
    )
    reset_agent_routing_status(cur, user_id)
    cur.execute('SELECT presence, on_queue, routing_status FROM users WHERE id = %s', (user_id,))
    row = cur.fetchone()
    if row is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown user'}), 404

    cur.execute(
        'INSERT INTO presence_events (user_id, presence, on_queue, routing_status) VALUES (%s,%s,%s,%s)',
        (user_id, row['presence'], row['on_queue'], row['routing_status']),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, **row})


def sweep_stale_queued(cur):
    """
    Abandons any simulated interaction past its queue's max_wait_s, and
    stamps ended_at at the limit (started_at + max_wait_s), not at the
    moment the sweep noticed.

    Carrier calls are excluded (provider_sid IS NULL is required to match):
    a live caller is released at the limit by the hold-music handler and
    closed by Twilio's status callback, which knows when they actually hung
    up. Without the exclusion this would close rows out from under active
    real calls — there's no Twilio integration here, but the guard is kept
    so nothing has to change if one gets added later.
    """
    cur.execute(
        """
        UPDATE interactions i
        SET result = 'Abandoned',
            ended_at = i.started_at + (q.max_wait_s || ' seconds')::interval
        FROM queues q
        WHERE i.queue_id = q.id
          AND i.answered_at IS NULL
          AND i.result = 'Active'
          AND i.provider_sid IS NULL
          AND i.started_at < now() - (q.max_wait_s || ' seconds')::interval
        RETURNING i.id
        """
    )
    return [str(r['id']) for r in cur.fetchall()]


@acd_bp.route('/api/acd/sweep', methods=['POST'])
def sweep_endpoint():
    conn = get_db()
    cur = conn.cursor()
    abandoned = sweep_stale_queued(cur)
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'abandoned': abandoned})


@acd_bp.route('/api/acd/campaigns/<int:campaign_id>/dial', methods=['POST'])
def campaign_dial(campaign_id):
    """
    Simulation/load version: creates an interaction row without placing a
    call (provider_sid stays NULL). Checks DNC before dialling, same as the
    live version — max_attempts/calling_hours/AMD are only enforced by the
    live Twilio path, which isn't built here.
    """
    data = request.get_json(force=True) or {}
    tenant_id = g.tenant_id
    phone_number = data.get('phone_number')
    customer_name = data.get('customer_name')
    if not phone_number:
        return jsonify({'ok': False, 'error': 'phone_number required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT 1 FROM dnc_list WHERE tenant_id = %s AND phone_number = %s',
        (tenant_id, phone_number),
    )
    if cur.fetchone():
        conn.close()
        return jsonify({'ok': False, 'error': 'number is on the DNC list', 'dialed': False}), 200

    cur.execute(
        """
        INSERT INTO interactions
          (tenant_id, direction, media, customer_name, dnis, campaign_id, result)
        VALUES (%s, 'outbound', 'Voice', %s, %s, %s, 'Active')
        RETURNING *
        """,
        (tenant_id, customer_name, phone_number, campaign_id),
    )
    row = cur.fetchone()
    cur.execute(
        "INSERT INTO interaction_segments (interaction_id, type) VALUES (%s, 'queue')",
        (row['id'],),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'dialed': True, 'interaction': {**row, 'id': str(row['id'])}})


@acd_bp.route('/api/acd/campaigns/<int:campaign_id>/monitor')
def campaign_monitor(campaign_id):
    """Counters derived live from interaction rows, never a running tally —
    so they survive a restart and always agree with the reports."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT result, COUNT(*) AS n FROM interactions WHERE campaign_id = %s GROUP BY result',
        (campaign_id,),
    )
    counts = {r['result']: r['n'] for r in cur.fetchall()}
    conn.close()
    return jsonify({'campaign_id': campaign_id, 'counts': counts})
