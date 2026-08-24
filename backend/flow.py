"""
Flow interpreter (Section 11). Architect flows are stored as a jsonb graph
of nodes; run_flow() walks it, emitting TwiML until it must stop and wait
for the caller (a menu) or the call ends (disconnect/acd).

Graph shape (kept intentionally simple):
  {"nodes": {"<id>": {"type": "...", "next": "<id>", ...}}, "start": "<id>"}

Handles start, say, menu, acd, status and disconnect nodes. A
MAX_FLOW_STEPS ceiling guards against a cycle drawn in the editor; an
unknown node type is stepped over rather than stranding the caller. The
interpreter itself is stateless between requests — the interaction row's
meta.flow_position carries where execution paused, e.g. at a menu waiting
on a digit.
"""

from xml.sax.saxutils import escape
from flask import Blueprint, jsonify, request

from db import get_db

flow_bp = Blueprint('flow', __name__)

MAX_FLOW_STEPS = 25


def run_flow(graph, start_node_id, digit=None):
    """
    Walks the graph from start_node_id. Returns (twiml, stopped_at, done)
    where stopped_at is the node id execution paused at (a menu waiting on
    digit input) or None if the flow reached a natural end, and done is
    True once the interaction should be considered no-longer-in-the-IVR.
    """
    nodes = graph.get('nodes', {})
    twiml_parts = ['<Response>']
    node_id = start_node_id
    steps = 0
    stopped_at = None
    done = False

    # a menu node re-entered with a digit resumes at the branch chosen,
    # not at the menu node itself
    if digit is not None and node_id in nodes and nodes[node_id].get('type') == 'menu':
        options = nodes[node_id].get('options', {})
        node_id = options.get(digit, nodes[node_id].get('next'))

    while node_id is not None:
        steps += 1
        if steps > MAX_FLOW_STEPS:
            twiml_parts.append('<Say>We are unable to complete your call. Goodbye.</Say><Hangup/>')
            done = True
            break

        node = nodes.get(node_id)
        if node is None:
            break  # dead link — nothing more to walk

        node_type = node.get('type')

        if node_type == 'start':
            node_id = node.get('next')
            continue

        if node_type == 'say':
            twiml_parts.append(f"<Say>{escape(node.get('text', ''))}</Say>")
            node_id = node.get('next')
            continue

        if node_type == 'menu':
            prompt = escape(node.get('prompt', ''))
            twiml_parts.append(
                f'<Gather numDigits="1" action="/api/flows/menu" method="POST">'
                f'<Say>{prompt}</Say></Gather>'
            )
            stopped_at = node_id
            break

        if node_type == 'acd':
            twiml_parts.append(f"<!-- routed to queue {escape(str(node.get('queue_id')))} -->")
            stopped_at = node_id
            done = True
            break

        if node_type == 'status':
            # informational only — nothing to emit, keep walking
            node_id = node.get('next')
            continue

        if node_type == 'disconnect':
            twiml_parts.append('<Hangup/>')
            done = True
            break

        # unknown node type: step over it rather than stranding the caller
        node_id = node.get('next')

    twiml_parts.append('</Response>')
    return ''.join(twiml_parts), stopped_at, done


@flow_bp.route('/api/flows/<int:flow_id>/run', methods=['POST'])
def run_flow_endpoint(flow_id):
    data = request.get_json(force=True) or {}
    interaction_id = data.get('interaction_id')

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT graph FROM flows WHERE id = %s', (flow_id,))
    flow = cur.fetchone()
    if flow is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown flow'}), 404

    graph = flow['graph']
    start_node_id = graph.get('start')
    if start_node_id is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'flow has no start node'}), 400

    twiml, stopped_at, done = run_flow(graph, start_node_id)

    if interaction_id:
        cur.execute(
            "UPDATE interactions SET meta = meta || %s::jsonb WHERE id = %s",
            ('{"flow_position": ' + (f'"{stopped_at}"' if stopped_at else 'null') + '}', interaction_id),
        )
        conn.commit()
    conn.close()

    return jsonify({'ok': True, 'twiml': twiml, 'stopped_at': stopped_at, 'done': done})


@flow_bp.route('/api/flows/menu', methods=['POST'])
def flow_menu_continue():
    """Re-enters the interpreter at the branch the caller selected."""
    data = request.get_json(force=True) or {}
    interaction_id = data.get('interaction_id')
    flow_id = data.get('flow_id')
    digit = data.get('digit')
    if not interaction_id or not flow_id or digit is None:
        return jsonify({'ok': False, 'error': 'interaction_id, flow_id and digit required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT graph FROM flows WHERE id = %s', (flow_id,))
    flow = cur.fetchone()
    cur.execute('SELECT meta FROM interactions WHERE id = %s', (interaction_id,))
    interaction = cur.fetchone()
    if flow is None or interaction is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown flow or interaction'}), 404

    position = interaction['meta'].get('flow_position')
    if position is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'interaction is not waiting at a menu'}), 409

    twiml, stopped_at, done = run_flow(flow['graph'], position, digit=digit)

    cur.execute(
        "UPDATE interactions SET meta = meta || %s::jsonb WHERE id = %s",
        ('{"flow_position": ' + (f'"{stopped_at}"' if stopped_at else 'null') + '}', interaction_id),
    )
    conn.commit()
    conn.close()

    return jsonify({'ok': True, 'twiml': twiml, 'stopped_at': stopped_at, 'done': done})
