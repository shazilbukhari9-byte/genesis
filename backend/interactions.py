"""
Interactions — the fact table and its state machine (Section 09 of the
reference doc). Hand-written on purpose: this has real behaviour (joins,
state transitions, concurrency-safe claiming), so it is deliberately NOT
in the generic resource registry (see resources.py's own comment on that).

State machine (mirrors the reference doc):

  Queued            Active, agent_id NULL
  Talking           Active, answered_at set
  Wrap-up pending   Handled, wrapup = ''
  Closed            Handled, wrapup set
  Abandoned         terminal

  create          -> Queued
  claim-next/answer -> Talking      (answered_at set, agent assigned)
  end             -> Handled (wrapup='') if answered, else Abandoned
  wrapup          -> Closed         (wrapup text set, acw_s computed)
  transfer        -> Queued again   (answered_at cleared, queue changed,
                                      history kept — nothing is deleted)
  sweep-stale     -> Abandoned      (queued past max_wait_s with no answer)
"""

from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, g
from psycopg2.extras import Json

from db import get_db
from acd import reset_agent_routing_status, sweep_stale_queued

interactions_bp = Blueprint('interactions', __name__)


def _row_to_dict(row):
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d


def _seconds_between(a, b):
    if a is None or b is None:
        return None
    return max(0, round((b - a).total_seconds()))


SEARCH_COLUMNS = ['customer_name', 'ani', 'dnis', 'queue_name', 'agent_name']


@interactions_bp.route('/api/interactions')
def list_interactions():
    """Paged search: date range, queue, agent, media, result, free text
    across five columns (customer_name, ani, dnis, queue_name, agent_name)."""
    conn = get_db()
    cur = conn.cursor()
    sweep_stale_queued(cur)  # opportunistic, like workspace/wallboard reads in the doc
    conn.commit()
    where, params = [], []

    where.append('tenant_id = %s')
    params.append(g.tenant_id)

    for key in ('result', 'queue_id', 'agent_id', 'media'):
        val = request.args.get(key)
        if val:
            where.append(f'{key} = %s')
            params.append(val)

    frm = request.args.get('from')
    to = request.args.get('to')
    if frm:
        where.append('started_at >= %s')
        params.append(frm)
    if to:
        where.append('started_at <= %s')
        params.append(to)

    q = request.args.get('q')
    if q:
        where.append('(' + ' OR '.join(f'{c} ILIKE %s' for c in SEARCH_COLUMNS) + ')')
        params += [f'%{q}%'] * len(SEARCH_COLUMNS)

    where_sql = (' WHERE ' + ' AND '.join(where)) if where else ''

    cur.execute(f'SELECT COUNT(*) AS n FROM interactions{where_sql}', params)
    total = cur.fetchone()['n']

    limit = min(int(request.args.get('limit', 100)), 2000)
    offset = int(request.args.get('offset', 0))
    cur.execute(
        f'SELECT * FROM interactions{where_sql} ORDER BY started_at DESC LIMIT %s OFFSET %s',
        params + [limit, offset],
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify({
        'data': [_row_to_dict(r) for r in rows],
        'row_count': total,
        'limit': limit,
        'offset': offset,
    })


@interactions_bp.route('/api/interactions/<uuid:interaction_id>')
def get_interaction(interaction_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT * FROM interactions WHERE id = %s AND tenant_id = %s',
        (str(interaction_id), g.tenant_id),
    )
    row = cur.fetchone()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify(_row_to_dict(row))


@interactions_bp.route('/api/interactions', methods=['POST'])
def create_interaction():
    data = request.get_json(force=True) or {}
    tenant_id = g.tenant_id

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO interactions
          (tenant_id, provider_sid, direction, media, customer_name, ani, dnis,
           queue_id, queue_name, flow_id, campaign_id, result)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'Active')
        RETURNING *
        """,
        (
            tenant_id, data.get('provider_sid'), data.get('direction', 'inbound'),
            data.get('media', 'Voice'), data.get('customer_name'), data.get('ani'),
            data.get('dnis'), data.get('queue_id'), data.get('queue_name'),
            data.get('flow_id'), data.get('campaign_id'),
        ),
    )
    row = cur.fetchone()
    cur.execute(
        "INSERT INTO interaction_segments (interaction_id, type) VALUES (%s, 'queue')",
        (row['id'],),
    )
    conn.commit()
    conn.close()
    return jsonify(_row_to_dict(row)), 201


@interactions_bp.route('/api/interactions/claim-next', methods=['POST'])
def claim_next():
    """
    An agent asks for the next waiting interaction in a queue. Uses
    FOR UPDATE SKIP LOCKED so concurrent agents claiming at the same time
    never grab the same row or block on each other.
    """
    data = request.get_json(force=True) or {}
    queue_id = data.get('queue_id')
    agent_id = data.get('agent_id')
    agent_name = data.get('agent_name')
    if not queue_id or not agent_id:
        return jsonify({'ok': False, 'error': 'queue_id and agent_id required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id FROM interactions
        WHERE queue_id = %s AND answered_at IS NULL AND result = 'Active'
        ORDER BY started_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
        """,
        (queue_id,),
    )
    claimed = cur.fetchone()
    if claimed is None:
        conn.close()
        return jsonify({'ok': True, 'interaction': None})

    now = datetime.now(timezone.utc)
    cur.execute(
        """
        UPDATE interactions
        SET agent_id = %s, agent_name = %s, answered_at = %s
        WHERE id = %s
        RETURNING *, EXTRACT(EPOCH FROM (%s - started_at)) AS wait_seconds
        """,
        (agent_id, agent_name, now, claimed['id'], now),
    )
    row = cur.fetchone()
    wait_s = round(row.pop('wait_seconds'))
    cur.execute('UPDATE interactions SET wait_s = %s WHERE id = %s', (wait_s, row['id']))
    cur.execute(
        "INSERT INTO interaction_segments (interaction_id, type) VALUES (%s, 'talk')",
        (row['id'],),
    )
    conn.commit()
    row['wait_s'] = wait_s
    conn.close()
    return jsonify({'ok': True, 'interaction': _row_to_dict(row)})


@interactions_bp.route('/api/interactions/<uuid:interaction_id>/answer', methods=['POST'])
def answer_interaction(interaction_id):
    """Answer a specific interaction directly (skips the queue-pick step)."""
    data = request.get_json(force=True) or {}
    agent_id = data.get('agent_id')
    agent_name = data.get('agent_name')
    if not agent_id:
        return jsonify({'ok': False, 'error': 'agent_id required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM interactions WHERE id = %s FOR UPDATE', (str(interaction_id),))
    row = cur.fetchone()
    if row is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404
    if row['answered_at'] is not None:
        conn.close()
        return jsonify({'ok': False, 'error': 'already answered'}), 409

    now = datetime.now(timezone.utc)
    wait_s = _seconds_between(row['started_at'], now)
    cur.execute(
        """
        UPDATE interactions
        SET agent_id = %s, agent_name = %s, answered_at = %s, wait_s = %s
        WHERE id = %s RETURNING *
        """,
        (agent_id, agent_name, now, wait_s, str(interaction_id)),
    )
    updated = cur.fetchone()
    cur.execute(
        "INSERT INTO interaction_segments (interaction_id, type) VALUES (%s, 'talk')",
        (str(interaction_id),),
    )
    conn.commit()
    conn.close()
    return jsonify(_row_to_dict(updated))


@interactions_bp.route('/api/interactions/<uuid:interaction_id>/end', methods=['POST'])
def end_interaction(interaction_id):
    """Answered but not yet closed becomes Handled; never answered becomes Abandoned."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM interactions WHERE id = %s FOR UPDATE', (str(interaction_id),))
    row = cur.fetchone()
    if row is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404
    if row['ended_at'] is not None:
        conn.close()
        return jsonify({'ok': False, 'error': 'already ended'}), 409

    now = datetime.now(timezone.utc)
    talk_s = _seconds_between(row['answered_at'], now)
    result = 'Handled' if row['answered_at'] is not None else 'Abandoned'
    wrapup = '' if result == 'Handled' else None

    cur.execute(
        """
        UPDATE interactions
        SET ended_at = %s, talk_s = %s, result = %s, wrapup = %s
        WHERE id = %s RETURNING *
        """,
        (now, talk_s, result, wrapup, str(interaction_id)),
    )
    updated = cur.fetchone()
    seg_type = 'talk' if result == 'Handled' else 'queue'
    cur.execute(
        "UPDATE interaction_segments SET ended_at = %s "
        "WHERE interaction_id = %s AND type = %s AND ended_at IS NULL",
        (now, str(interaction_id), seg_type),
    )
    reset_agent_routing_status(cur, row['agent_id'])
    conn.commit()
    conn.close()
    return jsonify(_row_to_dict(updated))


@interactions_bp.route('/api/interactions/<uuid:interaction_id>/wrapup', methods=['POST'])
def wrapup_interaction(interaction_id):
    """Sets wrapup text and closes the interaction. This is the only field
    that distinguishes a finished interaction from one still in after-call work."""
    data = request.get_json(force=True) or {}
    wrapup_text = data.get('wrapup', '')

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM interactions WHERE id = %s FOR UPDATE', (str(interaction_id),))
    row = cur.fetchone()
    if row is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404
    if row['result'] != 'Handled':
        conn.close()
        return jsonify({'ok': False, 'error': 'only Handled interactions can be wrapped up'}), 409

    now = datetime.now(timezone.utc)
    acw_s = _seconds_between(row['ended_at'], now)
    cur.execute(
        'UPDATE interactions SET wrapup = %s, acw_s = %s WHERE id = %s RETURNING *',
        (wrapup_text, acw_s, str(interaction_id)),
    )
    updated = cur.fetchone()
    cur.execute(
        "INSERT INTO interaction_segments (interaction_id, type, ended_at) VALUES (%s, 'acw', %s)",
        (str(interaction_id), now),
    )
    conn.commit()
    conn.close()
    return jsonify(_row_to_dict(updated))


@interactions_bp.route('/api/interactions/<uuid:interaction_id>/transfer', methods=['POST'])
def transfer_interaction(interaction_id):
    """Transfer to a queue clears answered_at, returning the row to the
    waiting list without losing its history — nothing is deleted."""
    data = request.get_json(force=True) or {}
    queue_id = data.get('queue_id')
    queue_name = data.get('queue_name')
    if not queue_id:
        return jsonify({'ok': False, 'error': 'queue_id required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM interactions WHERE id = %s FOR UPDATE', (str(interaction_id),))
    row = cur.fetchone()
    if row is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    previous_agent_id = row['agent_id']
    cur.execute(
        """
        UPDATE interactions
        SET queue_id = %s, queue_name = %s, agent_id = NULL, agent_name = NULL,
            answered_at = NULL, result = 'Active'
        WHERE id = %s RETURNING *
        """,
        (queue_id, queue_name, str(interaction_id)),
    )
    updated = cur.fetchone()
    cur.execute(
        "INSERT INTO interaction_segments (interaction_id, type, meta) VALUES (%s, 'transfer', %s)",
        (str(interaction_id), Json({'to_queue_id': queue_id, 'to_queue_name': queue_name})),
    )
    reset_agent_routing_status(cur, previous_agent_id)
    conn.commit()
    conn.close()
    return jsonify(_row_to_dict(updated))


@interactions_bp.route('/api/interactions/<uuid:interaction_id>/messages', methods=['POST'])
def post_message(interaction_id):
    """
    Chat/SMS/WhatsApp/Email share this lifecycle. An agent reply with
    complete=true ends the interaction in the same request — the
    email-style pattern, where sending the reply is the resolution.
    """
    data = request.get_json(force=True) or {}
    from_agent = bool(data.get('from_agent', False))
    body = data.get('body', '')
    complete = bool(data.get('complete', False))

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM interactions WHERE id = %s FOR UPDATE', (str(interaction_id),))
    interaction = cur.fetchone()
    if interaction is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute(
        'INSERT INTO messages (interaction_id, from_agent, body, complete) VALUES (%s,%s,%s,%s) RETURNING *',
        (str(interaction_id), from_agent, body, complete),
    )
    message = cur.fetchone()

    ended_interaction = None
    if from_agent and complete and interaction['ended_at'] is None:
        now = datetime.now(timezone.utc)
        talk_s = _seconds_between(interaction['answered_at'], now)
        cur.execute(
            "UPDATE interactions SET ended_at = %s, talk_s = %s, result = 'Handled', wrapup = '' "
            "WHERE id = %s RETURNING *",
            (now, talk_s, str(interaction_id)),
        )
        ended_interaction = cur.fetchone()
        reset_agent_routing_status(cur, interaction['agent_id'])

    conn.commit()
    conn.close()
    return jsonify({
        'ok': True,
        'message': _row_to_dict(message),
        'interaction': _row_to_dict(ended_interaction) if ended_interaction else None,
    })


@interactions_bp.route('/api/interactions/sweep-stale', methods=['POST'])
def sweep_stale_endpoint():
    """Kept as an alias of the real sweep for backward compatibility with
    anything already calling this path — POST /api/acd/sweep is the same
    logic (carrier-call exclusion, stamps ended_at at the limit)."""
    conn = get_db()
    cur = conn.cursor()
    abandoned = sweep_stale_queued(cur)
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'abandoned': abandoned})
