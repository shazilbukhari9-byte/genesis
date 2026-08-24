"""
Flow interpreter (Section 11). Architect flows are stored as a jsonb graph
of nodes; run_flow() walks it, emitting TwiML until it must stop and wait
for the caller (a menu) or the call ends (a terminal node).

Canonical graph shape (what the interpreter always operates on):
  {"nodes": {"<id>": {"type": "...", "next": "<id>", ...}}, "start": "<id>"}

Node "type" values are the editor's own NTYPES vocabulary (frontend/src/
mcm/scripts.ts) verbatim — start, play, menu, decision, schedule, data,
acd, user, vm, status, disc — deliberately not a separate backend
vocabulary translated at the boundary, so there is exactly one name per
node kind shared by both sides.

The Architect editor (frontend/src/mcm/flows-redesign.ts) historically
saved a different shape — {"nodes": [...array...], "links": [[from, to,
label], ...], "meta": {...}} — built for the canvas's own drag/connect
model, with no "start" key and no per-type fields the interpreter reads.
Flows saved that way could never actually run a real call: run_flow()
would hit graph.get('start') is None and 400 immediately. _normalize_graph()
below is the reconciliation layer: it detects the legacy editor shape and
losslessly converts it to canonical shape, called at the top of every
route here so the interpreter and validator only ever see canonical
graphs — including for rows saved under the old shape before this file
changed. The editor itself now saves canonical shape directly (see
flows-redesign.ts's toBackendGraph()), so normalization is a read-time
safety net for old data, not the primary path going forward.

data nodes (Call Data Action) are walked over — looked up, not executed —
see that node's handling below for why. schedule nodes check UTC
wall-clock hours rather than the editor's local-only DB.schedGroups
mock/state, since nothing about a schedule group is backend-real; see
that node's handling for the reasoning. A MAX_FLOW_STEPS ceiling guards
against a cycle drawn in the editor; an unknown node type is stepped
over rather than stranding the caller. The interpreter itself is
stateless between requests — the interaction row's meta.flow_position
carries where execution paused, e.g. at a menu waiting on a digit.
"""

from datetime import datetime, timezone
from xml.sax.saxutils import escape
from flask import Blueprint, jsonify, request, g

from db import get_db

flow_bp = Blueprint('flow', __name__)

MAX_FLOW_STEPS = 25

VALID_NODE_TYPES = {'start', 'play', 'menu', 'decision', 'schedule', 'data', 'acd', 'user', 'vm', 'status', 'disc'}
# node types whose single 'next' pointer is mandatory for the flow to
# be publishable (branching/terminal types are checked separately below)
REQUIRES_NEXT = {'start', 'play', 'status', 'data'}
TERMINAL_TYPES = {'acd', 'user', 'vm', 'disc'}
_BRANCH_FIELDS = ('next', 'next_true', 'next_false', 'open_next', 'closed_next')


def _normalize_graph(graph):
    """Accepts either the canonical shape (nodes is a dict) or the
    legacy editor shape (nodes is a list, edges live in a parallel
    'links' array, per-type config lives in meta.*For maps keyed by
    node id — the same maps flows-redesign.ts's property panel writes)
    and always returns canonical shape. Idempotent."""
    if not isinstance(graph, dict):
        return {'nodes': {}, 'start': None}

    nodes = graph.get('nodes')
    if isinstance(nodes, dict):
        return graph  # already canonical

    if not isinstance(nodes, list):
        return {'nodes': {}, 'start': None}

    links = graph.get('links') or []
    meta = graph.get('meta') or {}
    queue_for = meta.get('queueFor') or {}
    transfer_for = meta.get('transferFor') or {}
    decision_for = meta.get('decisionFor') or {}
    schedule_for = meta.get('scheduleFor') or {}
    action_for = meta.get('actionFor') or {}

    out_nodes = {}
    start_id = None

    for n in nodes:
        if not isinstance(n, dict) or 'id' not in n:
            continue
        nid = n['id']
        ntype = n.get('type')
        node = {'type': ntype, 'x': n.get('x'), 'y': n.get('y'), 'label': n.get('t')}
        if ntype == 'play':
            node['text'] = n.get('b', '')
        elif ntype == 'menu':
            node['prompt'] = n.get('b', '')
        elif ntype == 'acd':
            node['queue_id'] = queue_for.get(nid)
        elif ntype in ('user', 'vm'):
            node['target'] = transfer_for.get(nid)
        elif ntype == 'decision':
            cfg = decision_for.get(nid) or {}
            node['field'] = cfg.get('field')
            node['op'] = cfg.get('op', 'equals')
            node['value'] = cfg.get('value')
        elif ntype == 'schedule':
            cfg = schedule_for.get(nid) or {}
            node['open_hour'] = cfg.get('open_hour', 9)
            node['close_hour'] = cfg.get('close_hour', 17)
        elif ntype == 'data':
            node['action_id'] = action_for.get(nid)
        out_nodes[nid] = node
        if ntype == 'start':
            start_id = nid

    outgoing = {}
    for link in links:
        if not isinstance(link, (list, tuple)) or len(link) < 2:
            continue
        frm, to = link[0], link[1]
        label = (link[2] if len(link) > 2 else '') or ''
        outgoing.setdefault(frm, []).append((to, label))

    for nid, node in out_nodes.items():
        edges = outgoing.get(nid, [])
        ntype = node['type']
        if ntype == 'menu':
            options = {}
            for to, label in edges:
                if label:
                    options[label] = to
            node['options'] = options
            if edges and not options:
                node['next'] = edges[0][0]
        elif ntype == 'decision':
            for to, label in edges:
                low = (label or '').lower()
                if low in ('true', 'yes'):
                    node['next_true'] = to
                elif low in ('false', 'no'):
                    node['next_false'] = to
        elif ntype == 'schedule':
            for to, label in edges:
                low = (label or '').lower()
                if low == 'open':
                    node['open_next'] = to
                elif low == 'closed':
                    node['closed_next'] = to
        elif edges:
            node['next'] = edges[0][0]

    return {'nodes': out_nodes, 'start': start_id}


def _evaluate_condition(ctx_value, op, value):
    if op == 'not_equals':
        return str(ctx_value) != str(value)
    if op == 'contains':
        return value is not None and str(value) in str(ctx_value or '')
    if op == 'exists':
        return ctx_value not in (None, '')
    return str(ctx_value) == str(value)  # 'equals' and unrecognised ops both fall back to equals


def _is_within_schedule(open_hour, close_hour):
    """UTC wall-clock check. The editor's own schedule concept
    (DB.schedGroups) is local-only mock data with a hand-set Open/
    Closed state, not a real backend schedule — there is nothing real
    to check a live call against, so this is a deliberate, documented
    simplification rather than reading a nonexistent source of truth."""
    try:
        open_hour, close_hour = int(open_hour), int(close_hour)
    except (TypeError, ValueError):
        return True
    hour = datetime.now(timezone.utc).hour
    if open_hour <= close_hour:
        return open_hour <= hour < close_hour
    return hour >= open_hour or hour < close_hour  # window crosses midnight


def run_flow(graph, start_node_id, digit=None, context=None):
    """
    Walks the graph from start_node_id. Returns (twiml, stopped_at, done)
    where stopped_at is the node id execution paused at (a menu waiting on
    digit input) or None if the flow reached a natural end, and done is
    True once the interaction should be considered no-longer-in-the-IVR.
    context is an optional dict of caller/interaction fields decision
    nodes can branch on (e.g. {"ani": "+1..."}) — Test Mode passes a
    user-supplied mock context; real calls currently pass none, so
    decision nodes fall through to next_false against an empty context
    until real caller-data plumbing exists.
    """
    nodes = graph.get('nodes', {})
    context = context or {}
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

        if node_type == 'play':
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

        if node_type in ('user', 'vm'):
            target = escape(str(node.get('target') or ''))
            twiml_parts.append(f"<Dial>{target}</Dial>" if node_type == 'user' else f"<!-- routed to voicemail: {target} -->")
            stopped_at = node_id
            done = True
            break

        if node_type == 'status':
            # informational only — nothing to emit, keep walking
            node_id = node.get('next')
            continue

        if node_type == 'disc':
            twiml_parts.append('<Hangup/>')
            done = True
            break

        if node_type == 'decision':
            result = _evaluate_condition(context.get(node.get('field')), node.get('op'), node.get('value'))
            node_id = node.get('next_true') if result else node.get('next_false')
            continue

        if node_type == 'schedule':
            is_open = _is_within_schedule(node.get('open_hour', 9), node.get('close_hour', 17))
            node_id = node.get('open_next') if is_open else node.get('closed_next')
            continue

        if node_type == 'data':
            # Walked over, not executed — see dataact.py's own docstring:
            # letting the backend fetch a client-editable endpoint is an
            # SSRF risk this prototype deliberately doesn't take. Real
            # execution would need the same sandboxed-fetch design
            # dataact.py explicitly avoids, so a flow's data node
            # continues without calling out, same honesty tradeoff as
            # Data Actions' own simulated Test Action.
            node_id = node.get('next')
            continue

        # unknown node type: step over it rather than stranding the caller
        node_id = node.get('next')

    twiml_parts.append('</Response>')
    return ''.join(twiml_parts), stopped_at, done


def validate_graph(graph):
    """Returns a list of {node_id, message} problems; empty list means
    the graph is publishable. node_id is None for flow-level problems
    (no start node at all) so the frontend can distinguish "select a
    node" from "nothing to select"."""
    errors = []
    nodes = graph.get('nodes') or {}
    start = graph.get('start')

    if not nodes:
        return [{'node_id': None, 'message': 'This flow has no nodes yet.'}]

    if not start or start not in nodes:
        errors.append({'node_id': None, 'message': 'Flow has no valid Start node.'})

    start_nodes = [nid for nid, n in nodes.items() if n.get('type') == 'start']
    if len(start_nodes) > 1:
        for extra in start_nodes[1:]:
            errors.append({'node_id': extra, 'message': 'Only one Start node is allowed per flow.'})

    ids = set(nodes.keys())
    for nid, n in nodes.items():
        ntype = n.get('type')
        if ntype not in VALID_NODE_TYPES:
            errors.append({'node_id': nid, 'message': f'Unknown node type "{ntype}".'})
            continue

        if ntype in REQUIRES_NEXT and not n.get('next'):
            errors.append({'node_id': nid, 'message': 'This node has no outgoing connection.'})

        if ntype == 'menu':
            options = n.get('options') or {}
            if not options and not n.get('next'):
                errors.append({'node_id': nid, 'message': 'Menu has no branches configured.'})
            for digit, target in options.items():
                if target not in ids:
                    errors.append({'node_id': nid, 'message': f'Menu branch "{digit}" points to a missing node.'})

        if ntype == 'decision' and not (n.get('next_true') and n.get('next_false')):
            errors.append({'node_id': nid, 'message': 'Decision node needs both a True and a False branch.'})

        if ntype == 'schedule' and not (n.get('open_next') and n.get('closed_next')):
            errors.append({'node_id': nid, 'message': 'Schedule node needs both an Open and a Closed branch.'})

        if ntype == 'acd' and not n.get('queue_id'):
            errors.append({'node_id': nid, 'message': 'Queue/ACD node has no queue selected.'})

        if ntype in ('user', 'vm') and not n.get('target'):
            errors.append({'node_id': nid, 'message': 'Transfer node has no destination configured.'})

        if ntype == 'data' and not n.get('action_id'):
            errors.append({'node_id': nid, 'message': 'Data Action node has no action selected.'})

        for field in _BRANCH_FIELDS:
            target = n.get(field)
            if target and target not in ids:
                errors.append({'node_id': nid, 'message': 'A connection from this node points to a missing node.'})

    # reachability from Start
    if start in nodes:
        seen = set()
        stack = [start]
        while stack:
            cur = stack.pop()
            if cur in seen or cur not in nodes:
                continue
            seen.add(cur)
            n = nodes[cur]
            for field in _BRANCH_FIELDS:
                t = n.get(field)
                if t:
                    stack.append(t)
            for t in (n.get('options') or {}).values():
                stack.append(t)
        for nid in ids - seen:
            errors.append({'node_id': nid, 'message': 'This node is unreachable from Start.'})

    return errors


@flow_bp.route('/api/flows/<int:flow_id>/validate', methods=['POST'])
def validate_flow_endpoint(flow_id):
    """Read-only — validates the graph in the request body (the editor's
    in-progress, possibly-unsaved state) without touching the stored row,
    so Validate can be called on unsaved edits."""
    data = request.get_json(force=True) or {}
    graph = _normalize_graph(data.get('graph') or {})
    errors = validate_graph(graph)
    return jsonify({'ok': len(errors) == 0, 'errors': errors})


@flow_bp.route('/api/flows/<int:flow_id>/publish', methods=['POST'])
def publish_flow_endpoint(flow_id):
    """Validates first — publish only ever succeeds if validate_graph()
    returns no errors — then persists graph + status + a server-owned
    version counter (ver lives inside the graph jsonb blob, like the
    editor's other metadata, since the flows table has no separate
    status/ver columns; see resources.py's REGISTRY entry)."""
    data = request.get_json(force=True) or {}
    graph = _normalize_graph(data.get('graph') or {})
    errors = validate_graph(graph)
    if errors:
        return jsonify({'ok': False, 'errors': errors}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT graph FROM flows WHERE id = %s AND tenant_id = %s', (flow_id, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    prev_graph = existing['graph'] or {}
    next_ver = (prev_graph.get('ver') or 0) + 1
    graph['status'] = 'Published'
    graph['ver'] = next_ver

    cur.execute(
        'UPDATE flows SET graph = %s WHERE id = %s AND tenant_id = %s RETURNING *',
        (graph, flow_id, g.tenant_id),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(dict(row))


@flow_bp.route('/api/flows/<int:flow_id>/run', methods=['POST'])
def run_flow_endpoint(flow_id):
    data = request.get_json(force=True) or {}
    interaction_id = data.get('interaction_id')
    context = data.get('context') if isinstance(data.get('context'), dict) else None

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT graph FROM flows WHERE id = %s AND tenant_id = %s', (flow_id, g.tenant_id))
    flow = cur.fetchone()
    if flow is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown flow'}), 404

    graph = _normalize_graph(flow['graph'])
    start_node_id = graph.get('start')
    if start_node_id is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'flow has no start node'}), 400

    twiml, stopped_at, done = run_flow(graph, start_node_id, context=context)

    if interaction_id:
        cur.execute(
            'SELECT id FROM interactions WHERE id = %s AND tenant_id = %s',
            (interaction_id, g.tenant_id),
        )
        if cur.fetchone() is None:
            conn.close()
            return jsonify({'ok': False, 'error': 'unknown interaction'}), 404
        cur.execute(
            "UPDATE interactions SET meta = meta || %s::jsonb WHERE id = %s AND tenant_id = %s",
            ('{"flow_position": ' + (f'"{stopped_at}"' if stopped_at else 'null') + '}', interaction_id, g.tenant_id),
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
    cur.execute('SELECT graph FROM flows WHERE id = %s AND tenant_id = %s', (flow_id, g.tenant_id))
    flow = cur.fetchone()
    cur.execute('SELECT meta FROM interactions WHERE id = %s AND tenant_id = %s', (interaction_id, g.tenant_id))
    interaction = cur.fetchone()
    if flow is None or interaction is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown flow or interaction'}), 404

    position = interaction['meta'].get('flow_position')
    if position is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'interaction is not waiting at a menu'}), 409

    graph = _normalize_graph(flow['graph'])
    twiml, stopped_at, done = run_flow(graph, position, digit=digit)

    cur.execute(
        "UPDATE interactions SET meta = meta || %s::jsonb WHERE id = %s AND tenant_id = %s",
        ('{"flow_position": ' + (f'"{stopped_at}"' if stopped_at else 'null') + '}', interaction_id, g.tenant_id),
    )
    conn.commit()
    conn.close()

    return jsonify({'ok': True, 'twiml': twiml, 'stopped_at': stopped_at, 'done': done})
