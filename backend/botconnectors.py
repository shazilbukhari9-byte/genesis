"""
Bot Connectors Module — backs the Admin > Integrations > Bot Connectors
page (frontend/src/mcm/scripts.ts's renderBotsFx and friends).

Replaces the generic resources.py registry entry this table used to be
served by. The registry gives column-for-column CRUD and nothing else,
but this page needs real behaviour the registry can't express: name
validation and duplicate rejection, a platform whitelist, webhook-URL
validation, and — most importantly — connect/disconnect/test actions that
own the `status` column. Status was previously a plain writable field, so
a client could simply declare itself "Connected"; here it is derived only
from an action's outcome and is never accepted from the client.

The page has exactly three sections and they map to exactly three
tables: bot_connectors (Bots), bot_intents (Intents) and
bot_intent_utterances (the training phrases Test Utterances matches
against). A bot_connector_events log table used to exist here to back a
"Connection History" tab; that tab was removed when the page was aligned
to the prototype, which left the table written but never read, so it has
been dropped rather than kept as dead weight. A connect/test attempt's
durable outcome lives on the connector row itself - status,
last_connected_at and last_error.

Connect/test are deterministic *simulations*, not real outbound HTTP
requests: this prototype has no real Dialogflow/Lex/Bot Framework behind
these webhooks, and fetching a client-supplied `webhook_url` server-side
would be an SSRF vector — exactly the same reasoning as dataact.py's
_simulate_test. The simulation only decides the outcome; everything
around it (status transition, error text, history row) is genuinely
persisted.

Every route is tenant-scoped via g.tenant_id (set by auth.py's bearer
guard) — never a client-supplied value.
"""

from flask import Blueprint, jsonify, request, g

from db import get_db

botconnectors_bp = Blueprint('botconnectors', __name__, url_prefix='/api/bot-connectors')

# Providers the page's Add-Bot form offers, matching the "Provider" column
# the list displays. Kept server-side too so a hand-crafted request can't
# store a provider the UI can't render.
PLATFORMS = (
    'Custom', 'Custom webhook', 'Dialogflow', 'Dialogflow CX',
    'Amazon Lex', 'Amazon Lex V2', 'Microsoft Bot Framework', 'MCM Native',
)

# The Status column / Status filter on the list — a bot's lifecycle, which
# is separate from `status` (whether it is currently Connected).
LIFECYCLES = ('Live', 'Training', 'Retired')

# status is deliberately NOT here — it is owned by the connect/disconnect/
# test endpoints below, not by create/update.
WRITABLE_FIELDS = ('name', 'platform', 'webhook_url', 'notes', 'language',
                   'channels', 'confidence_threshold', 'division', 'lifecycle')

STATUS_DISCONNECTED = 'Disconnected'
STATUS_CONNECTED = 'Connected'
STATUS_ERROR = 'Error'


def _validate(data, partial=False):
    """Returns (cleaned_dict, error_message). Shared by create and update
    so both enforce identical rules."""
    cleaned = {}

    if not partial or 'name' in data:
        name = (data.get('name') or '').strip()
        if len(name) < 2:
            return None, 'name is required (at least 2 characters)'
        cleaned['name'] = name

    if not partial or 'platform' in data:
        platform = (data.get('platform') or 'Custom').strip()
        if platform not in PLATFORMS:
            return None, f"platform must be one of: {', '.join(PLATFORMS)}"
        cleaned['platform'] = platform

    if not partial or 'webhook_url' in data:
        webhook = (data.get('webhook_url') or '').strip()
        # Optional at create time (a connector can be registered before its
        # webhook is known) but must be a real http(s) URL when supplied —
        # connect/test below refuse to run without one.
        if webhook and not webhook.lower().startswith(('http://', 'https://')):
            return None, 'webhook_url must start with http:// or https://'
        cleaned['webhook_url'] = webhook

    if 'notes' in data:
        cleaned['notes'] = (data.get('notes') or '').strip()

    if not partial or 'language' in data:
        cleaned['language'] = (data.get('language') or 'en-GB').strip() or 'en-GB'

    if not partial or 'channels' in data:
        # Free text ("Voice, Web Messenger") — the column is a display list,
        # not a controlled vocabulary anywhere else in the app.
        cleaned['channels'] = (data.get('channels') or '').strip()

    if not partial or 'division' in data:
        cleaned['division'] = (data.get('division') or '').strip()

    if not partial or 'lifecycle' in data:
        lifecycle = (data.get('lifecycle') or 'Training').strip()
        if lifecycle not in LIFECYCLES:
            return None, f"lifecycle must be one of: {', '.join(LIFECYCLES)}"
        cleaned['lifecycle'] = lifecycle

    if not partial or 'confidence_threshold' in data:
        raw = data.get('confidence_threshold', 0.70)
        try:
            threshold = float(raw if raw not in ('', None) else 0.70)
        except (TypeError, ValueError):
            return None, 'confidence_threshold must be a number between 0 and 1'
        if not 0 <= threshold <= 1:
            return None, 'confidence_threshold must be between 0 and 1'
        cleaned['confidence_threshold'] = round(threshold, 2)

    return cleaned, None


def _simulate_connection(webhook_url, platform):
    """Deterministic from the webhook text so the same connector always
    gives the same, explainable result: a URL containing 'unreachable' or
    'invalid' always fails (so failure paths are testable without a real
    outbound call), everything else succeeds with a latency derived from
    the URL length. Returns (ok, duration_ms, detail)."""
    url = (webhook_url or '').lower()
    if 'unreachable' in url:
        return False, None, 'Connection refused (503)'
    if 'invalid' in url:
        return False, None, 'Handshake failed: invalid credentials (401)'
    duration = 90 + (len(webhook_url or '') * 11) % 400
    if platform == 'Custom':
        duration += 40
    return True, duration, f'{platform} handshake OK'


def _audit(cur, action, detail):
    cur.execute(
        'INSERT INTO audit_log (tenant_id, who, action, detail, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.tenant_id, g.user_name, action, detail),
    )


def _load(cur, connector_id):
    cur.execute('SELECT * FROM bot_connectors WHERE id = %s AND tenant_id = %s',
                (connector_id, g.tenant_id))
    return cur.fetchone()


# --------------------------------------------------------------------- #
# Read
# --------------------------------------------------------------------- #

_INTENT_SELECT = """
    SELECT i.id, i.bot_connector_id, i.name, i.confidence, i.created_at, i.updated_at,
           b.name AS connector_name,
           COALESCE(u.n, 0) AS utterance_count
    FROM bot_intents i
    JOIN bot_connectors b ON b.id = i.bot_connector_id
    LEFT JOIN (
        SELECT bot_intent_id, COUNT(*) AS n FROM bot_intent_utterances GROUP BY bot_intent_id
    ) u ON u.bot_intent_id = i.id
"""


@botconnectors_bp.route('/intents', methods=['GET'])
def list_intents():
    """Backs the Intents tab (Intent / Utterances / Confidence). The
    Utterances figure is a live COUNT of bot_intent_utterances, not a
    stored number. Optional ?bot_connector_id= narrows to one bot."""
    connector_id = request.args.get('bot_connector_id')
    where = ['i.tenant_id = %s']
    params = [g.tenant_id]
    if connector_id:
        where.append('i.bot_connector_id = %s')
        params.append(connector_id)

    conn = get_db()
    cur = conn.cursor()
    cur.execute(_INTENT_SELECT + ' WHERE ' + ' AND '.join(where) + ' ORDER BY i.name', params)
    rows = cur.fetchall()
    conn.close()
    return jsonify(rows)


@botconnectors_bp.route('/<int:connector_id>/intents', methods=['POST'])
def create_intent(connector_id):
    """Create an intent (and optionally its training utterances) for a
    connector. utterances is a list of phrases; they are what
    /match-intent later matches against."""
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'ok': False, 'error': 'name is required'}), 400

    raw_conf = data.get('confidence', 0.90)
    try:
        confidence = round(float(raw_conf if raw_conf not in ('', None) else 0.90), 2)
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'confidence must be a number between 0 and 1'}), 400
    if not 0 <= confidence <= 1:
        return jsonify({'ok': False, 'error': 'confidence must be between 0 and 1'}), 400

    utterances = data.get('utterances') or []
    if not isinstance(utterances, list):
        return jsonify({'ok': False, 'error': 'utterances must be a list'}), 400

    conn = get_db()
    cur = conn.cursor()
    if _load(cur, connector_id) is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute('SELECT id FROM bot_intents '
                'WHERE tenant_id = %s AND bot_connector_id = %s AND LOWER(name) = LOWER(%s)',
                (g.tenant_id, connector_id, name))
    if cur.fetchone() is not None:
        conn.close()
        return jsonify({'ok': False, 'error': 'an intent with this name already exists for this bot'}), 409

    cur.execute(
        'INSERT INTO bot_intents (tenant_id, bot_connector_id, name, confidence) '
        'VALUES (%s,%s,%s,%s) RETURNING id',
        (g.tenant_id, connector_id, name, confidence),
    )
    intent_id = cur.fetchone()['id']

    for phrase in utterances:
        text = (phrase or '').strip() if isinstance(phrase, str) else ''
        if not text:
            continue
        cur.execute(
            'INSERT INTO bot_intent_utterances (tenant_id, bot_intent_id, text) VALUES (%s,%s,%s) '
            'ON CONFLICT (bot_intent_id, text) DO NOTHING',
            (g.tenant_id, intent_id, text),
        )

    cur.execute(_INTENT_SELECT + ' WHERE i.id = %s AND i.tenant_id = %s', (intent_id, g.tenant_id))
    row = cur.fetchone()
    _audit(cur, 'Bot intent created', f'{name}')
    conn.commit()
    conn.close()
    return jsonify(row), 201


@botconnectors_bp.route('/intents/<int:intent_id>', methods=['DELETE'])
def delete_intent(intent_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT name FROM bot_intents WHERE id = %s AND tenant_id = %s', (intent_id, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404
    cur.execute('DELETE FROM bot_intents WHERE id = %s AND tenant_id = %s', (intent_id, g.tenant_id))
    _audit(cur, 'Bot intent deleted', existing['name'])
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


def _tokens(text):
    return {t for t in ''.join(ch.lower() if ch.isalnum() else ' ' for ch in (text or '')).split() if t}


@botconnectors_bp.route('/match-intent', methods=['POST'])
def match_intent():
    """Test Utterances tab. Scores the supplied phrase against every
    training utterance stored for this tenant and returns the best match.

    The scoring is a plain token-overlap (Jaccard) calculation done here in
    the backend against real bot_intent_utterances rows — deliberately not
    an NLU model, but equally deliberately not a frontend fake: the answer
    depends entirely on data in PostgreSQL, so an intent only matches if
    someone actually trained it."""
    data = request.get_json(force=True) or {}
    utterance = (data.get('utterance') or '').strip()
    if not utterance:
        return jsonify({'ok': False, 'error': 'utterance is required'}), 400

    connector_id = data.get('bot_connector_id')

    conn = get_db()
    cur = conn.cursor()
    where = ['u.tenant_id = %s']
    params = [g.tenant_id]
    if connector_id:
        where.append('i.bot_connector_id = %s')
        params.append(connector_id)
    cur.execute(
        """
        SELECT u.text, i.id AS intent_id, i.name AS intent_name, i.confidence,
               b.id AS bot_connector_id, b.name AS connector_name, b.confidence_threshold
        FROM bot_intent_utterances u
        JOIN bot_intents i ON i.id = u.bot_intent_id
        JOIN bot_connectors b ON b.id = i.bot_connector_id
        WHERE """ + ' AND '.join(where),
        params,
    )
    rows = cur.fetchall()
    conn.close()

    if not rows:
        return jsonify({'ok': True, 'matched': False,
                        'reason': 'no trained utterances exist yet — add intents to a bot first',
                        'utterance': utterance})

    probe = _tokens(utterance)
    best, best_score = None, 0.0
    for row in rows:
        candidate = _tokens(row['text'])
        if not candidate or not probe:
            continue
        score = len(probe & candidate) / len(probe | candidate)
        if score > best_score:
            best, best_score = row, score

    if best is None or best_score <= 0:
        return jsonify({'ok': True, 'matched': False,
                        'reason': 'no intent matched this utterance', 'utterance': utterance})

    threshold = float(best['confidence_threshold'] or 0)
    score = round(best_score, 2)
    return jsonify({
        'ok': True,
        'matched': score >= threshold,
        'utterance': utterance,
        'intent': best['intent_name'],
        'intent_id': best['intent_id'],
        'bot_connector_id': best['bot_connector_id'],
        'connector_name': best['connector_name'],
        'score': score,
        'confidence_threshold': threshold,
        'closest_utterance': best['text'],
    })


@botconnectors_bp.route('', methods=['GET'])
def list_connectors():
    """?q= (name/platform/webhook), ?status=, ?platform= — the filters the
    page's toolbar exposes, applied server-side so a large tenant isn't
    filtered in the browser."""
    q = request.args.get('q')
    status = request.args.get('status')
    platform = request.args.get('platform')
    lifecycle = request.args.get('lifecycle')
    division = request.args.get('division')

    where = ['b.tenant_id = %s']
    params = [g.tenant_id]
    if status:
        where.append('b.status = %s')
        params.append(status)
    if lifecycle:
        where.append('b.lifecycle = %s')
        params.append(lifecycle)
    if division:
        where.append('b.division = %s')
        params.append(division)
    if platform:
        where.append('b.platform = %s')
        params.append(platform)
    if q:
        where.append('(b.name ILIKE %s OR b.platform ILIKE %s OR b.channels ILIKE %s'
                     ' OR COALESCE(b.webhook_url, %s) ILIKE %s)')
        params += [f'%{q}%', f'%{q}%', f'%{q}%', '', f'%{q}%']

    conn = get_db()
    cur = conn.cursor()
    # intent_count is counted live rather than stored, so the list's
    # "Intents" column can never drift from the intents actually held.
    cur.execute(
        """
        SELECT b.*, COALESCE(i.n, 0) AS intent_count
        FROM bot_connectors b
        LEFT JOIN (
            SELECT bot_connector_id, COUNT(*) AS n FROM bot_intents GROUP BY bot_connector_id
        ) i ON i.bot_connector_id = b.id
        WHERE """ + ' AND '.join(where) + ' ORDER BY b.name',
        params,
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify(rows)


@botconnectors_bp.route('/<int:connector_id>', methods=['GET'])
def get_connector(connector_id):
    conn = get_db()
    cur = conn.cursor()
    row = _load(cur, connector_id)
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify(row)


# --------------------------------------------------------------------- #
# Write
# --------------------------------------------------------------------- #

@botconnectors_bp.route('', methods=['POST'])
def create_connector():
    cleaned, error = _validate(request.get_json(force=True) or {})
    if error:
        return jsonify({'ok': False, 'error': error}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM bot_connectors WHERE tenant_id = %s AND LOWER(name) = LOWER(%s)',
                (g.tenant_id, cleaned['name']))
    if cur.fetchone() is not None:
        conn.close()
        return jsonify({'ok': False, 'error': 'a bot connector with this name already exists'}), 409

    cur.execute(
        """
        INSERT INTO bot_connectors
            (tenant_id, name, platform, status, webhook_url, notes,
             language, channels, confidence_threshold, division, lifecycle)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (g.tenant_id, cleaned['name'], cleaned['platform'], STATUS_DISCONNECTED,
         cleaned.get('webhook_url') or None, cleaned.get('notes') or None,
         cleaned['language'], cleaned['channels'], cleaned['confidence_threshold'],
         cleaned['division'], cleaned['lifecycle']),
    )
    row = cur.fetchone()
    _audit(cur, 'Bot connector created', row['name'])
    conn.commit()
    conn.close()
    return jsonify(row), 201


@botconnectors_bp.route('/<int:connector_id>', methods=['PUT', 'PATCH'])
def update_connector(connector_id):
    data = request.get_json(force=True) or {}
    if not any(f in data for f in WRITABLE_FIELDS):
        return jsonify({'ok': False, 'error': 'no writable fields supplied'}), 400

    cleaned, error = _validate(data, partial=True)
    if error:
        return jsonify({'ok': False, 'error': error}), 400

    conn = get_db()
    cur = conn.cursor()
    existing = _load(cur, connector_id)
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    if 'name' in cleaned:
        cur.execute(
            'SELECT id FROM bot_connectors WHERE tenant_id = %s AND LOWER(name) = LOWER(%s) AND id <> %s',
            (g.tenant_id, cleaned['name'], connector_id),
        )
        if cur.fetchone() is not None:
            conn.close()
            return jsonify({'ok': False, 'error': 'a bot connector with this name already exists'}), 409

    cols = list(cleaned.keys())
    set_clause = ', '.join(f'{c} = %s' for c in cols)
    cur.execute(
        f'UPDATE bot_connectors SET {set_clause} WHERE id = %s AND tenant_id = %s RETURNING *',
        [cleaned[c] for c in cols] + [connector_id, g.tenant_id],
    )
    row = cur.fetchone()
    _audit(cur, 'Bot connector updated', row['name'])
    conn.commit()
    conn.close()
    return jsonify(row)


@botconnectors_bp.route('/<int:connector_id>', methods=['DELETE'])
def delete_connector(connector_id):
    conn = get_db()
    cur = conn.cursor()
    existing = _load(cur, connector_id)
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    # The connector's intents (and each intent's training utterances)
    # go with it via ON DELETE CASCADE (see database/schema.sql), so a
    # delete never leaves orphaned bot_intents/bot_intent_utterances rows.
    cur.execute('DELETE FROM bot_connectors WHERE id = %s AND tenant_id = %s', (connector_id, g.tenant_id))
    _audit(cur, 'Bot connector deleted', existing['name'])
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# --------------------------------------------------------------------- #
# Actions — the only writers of `status`
# --------------------------------------------------------------------- #

@botconnectors_bp.route('/<int:connector_id>/connect', methods=['POST'])
def connect_connector(connector_id):
    conn = get_db()
    cur = conn.cursor()
    existing = _load(cur, connector_id)
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    if not existing['webhook_url']:
        cur.execute(
            "UPDATE bot_connectors SET status = %s, last_error = %s WHERE id = %s AND tenant_id = %s",
            (STATUS_ERROR, 'No webhook URL configured', connector_id, g.tenant_id),
        )
        conn.commit()
        conn.close()
        return jsonify({'ok': False, 'error': 'a webhook URL is required before connecting'}), 400

    ok, duration, detail = _simulate_connection(existing['webhook_url'], existing['platform'])
    cur.execute(
        """
        UPDATE bot_connectors
        SET status = %s, last_error = %s, last_connected_at = CASE WHEN %s THEN now() ELSE last_connected_at END
        WHERE id = %s AND tenant_id = %s
        RETURNING *
        """,
        (STATUS_CONNECTED if ok else STATUS_ERROR, '' if ok else detail, ok, connector_id, g.tenant_id),
    )
    row = cur.fetchone()
    _audit(cur, 'Bot connector connect', f"{row['name']}: {'success' if ok else detail}")
    conn.commit()
    conn.close()
    return jsonify({'ok': ok, 'connector': dict(row), 'detail': detail,
                    'duration_ms': duration}), (200 if ok else 502)


@botconnectors_bp.route('/<int:connector_id>/disconnect', methods=['POST'])
def disconnect_connector(connector_id):
    conn = get_db()
    cur = conn.cursor()
    existing = _load(cur, connector_id)
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute(
        'UPDATE bot_connectors SET status = %s, last_error = %s WHERE id = %s AND tenant_id = %s RETURNING *',
        (STATUS_DISCONNECTED, '', connector_id, g.tenant_id),
    )
    row = cur.fetchone()
    _audit(cur, 'Bot connector disconnect', row['name'])
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'connector': dict(row), 'detail': 'Disconnected'})


@botconnectors_bp.route('/<int:connector_id>/test', methods=['POST'])
def test_connector(connector_id):
    """Probe the connector without changing whether it is connected —
    a test records its outcome and any error, but only connect/disconnect
    move a connector in or out of the Connected state."""
    conn = get_db()
    cur = conn.cursor()
    existing = _load(cur, connector_id)
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    if not existing['webhook_url']:
        conn.close()
        return jsonify({'ok': False, 'error': 'a webhook URL is required before testing'}), 400

    ok, duration, detail = _simulate_connection(existing['webhook_url'], existing['platform'])
    cur.execute(
        'UPDATE bot_connectors SET last_error = %s WHERE id = %s AND tenant_id = %s RETURNING *',
        ('' if ok else detail, connector_id, g.tenant_id),
    )
    row = cur.fetchone()
    _audit(cur, 'Bot connector test', f"{row['name']}: {'success' if ok else detail}")
    conn.commit()
    conn.close()
    return jsonify({'ok': ok, 'connector': dict(row), 'detail': detail,
                    'duration_ms': duration}), (200 if ok else 502)
