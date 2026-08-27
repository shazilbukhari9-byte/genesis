import re
from datetime import datetime
from calendar import monthrange
from flask import Flask, jsonify, request, g
from flask_cors import CORS
import psycopg2
from psycopg2 import errors as pg_errors
from psycopg2.extras import Json as PgJson
from werkzeug.exceptions import HTTPException

from db import get_db, close_request_connections
from resources import REGISTRY
from interactions import interactions_bp
from acd import acd_bp
from carrier import carrier_bp
from flow import flow_bp
from analytics import analytics_bp, CATALOG as REPORT_CATALOG
from org_settings import org_settings_bp
from auth import auth_bp, register_auth_guard, send_people_invite
from platform_config import platform_config_bp
from telephony import telephony_bp
from alerts import alerts_bp
from directory import directory_bp
from sso import sso_bp
from oauth_clients import oauth_bp
from apps import apps_bp
from authorg import authorg_bp
from adherence import adherence_bp
from canned import canned_bp
from certs import certs_bp
from contactlists import contactlists_bp
from dataact import dataact_bp
from dnclists import dnclists_bp
from catalogue import catalogue_bp
from client_apps import client_apps_bp
from botconnectors import botconnectors_bp
from salesforce_oauth import salesforce_oauth_bp
import config
import init_db

init_db.run()

_SAFE_IDENTIFIER = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')

app = Flask(__name__)
app.secret_key = config.SECRET_KEY
# Every error handler below must win over Flask's interactive HTML debugger
# even when running locally with debug=True (see bottom of this file) — an
# API has no business ever returning an HTML page, in dev or prod.
app.config['PROPAGATE_EXCEPTIONS'] = False
CORS(app, origins=config.CORS_ORIGINS, supports_credentials=True)

# Routes open connections with `conn = get_db()` and close them inline. Any
# exception in between skips that close(), so this teardown rolls back and
# closes whatever the request left open. Connections closed normally are
# skipped, so the happy path is untouched.
app.teardown_appcontext(close_request_connections)


# --- Global error handling (Section: production-readiness) ---
# psycopg2 raises these directly from cur.execute() with no application code
# in between — rather than duplicating the schema's own NOT NULL/UNIQUE/FK
# rules as a second, hand-maintained validation layer in Python (which
# would just drift out of sync with schema.sql over time), every write
# route lets Postgres be the single source of truth for those constraints
# and these handlers translate its errors into the same {'ok': False,
# 'error': ...} JSON shape every route already returns on the happy-path
# failure branches (see resource_create/update/delete above).
# Friendlier text for the unique constraints/indexes a client is actually
# likely to hit — falls back to the raw constraint name for everything else
# rather than guessing at a message for one nobody has hit yet.
_UNIQUE_VIOLATION_MESSAGES = {
    'integration_catalogue_tenant_id_name_key': 'a catalogue entry with this name already exists',
    'idx_installed_integrations_tenant_name': 'this integration is already installed',
    'client_applications_installed_integration_id_key': 'this integration is already registered as a client application',
    'idx_users_email_unique': 'a user with this email already exists',
    'idx_data_actions_tenant_name_ci': 'a data action with this name already exists',
}


@app.errorhandler(pg_errors.UniqueViolation)
def _handle_unique_violation(exc):
    constraint = exc.diag.constraint_name or ''
    message = _UNIQUE_VIOLATION_MESSAGES.get(constraint, f'a record with this {constraint or "value"} already exists')
    return jsonify({'ok': False, 'error': message}), 409


@app.errorhandler(pg_errors.ForeignKeyViolation)
def _handle_fk_violation(exc):
    return jsonify({'ok': False, 'error': 'referenced record does not exist'}), 400


@app.errorhandler(pg_errors.NotNullViolation)
def _handle_not_null_violation(exc):
    column = exc.diag.column_name or 'a required field'
    return jsonify({'ok': False, 'error': f'{column} is required'}), 400


@app.errorhandler(psycopg2.DataError)
def _handle_data_error(exc):
    return jsonify({'ok': False, 'error': 'invalid field value'}), 400


@app.errorhandler(Exception)
def _handle_unexpected_error(exc):
    # Real HTTP errors Flask/Werkzeug already knows how to raise (malformed
    # JSON body, 404 on an unmatched route, 405 on a wrong method, ...) keep
    # their own status code and message, just re-shaped into the same JSON
    # envelope every other route already returns — this is a JSON API, it
    # has no business ever sending an HTML error page back, in dev or prod.
    if isinstance(exc, HTTPException):
        return jsonify({'ok': False, 'error': exc.description or exc.name}), exc.code
    app.logger.exception('unhandled error')
    return jsonify({'ok': False, 'error': 'internal server error'}), 500


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
app.register_blueprint(sso_bp)
app.register_blueprint(oauth_bp)
app.register_blueprint(apps_bp)
app.register_blueprint(authorg_bp)
app.register_blueprint(adherence_bp)
app.register_blueprint(canned_bp)
app.register_blueprint(certs_bp)
app.register_blueprint(contactlists_bp)
app.register_blueprint(dataact_bp)
app.register_blueprint(dnclists_bp)
app.register_blueprint(catalogue_bp)
app.register_blueprint(client_apps_bp)
app.register_blueprint(botconnectors_bp)
app.register_blueprint(salesforce_oauth_bp)
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
        'sso': [
            'GET    /api/sso/providers         (admin — list configured providers)',
            'POST   /api/sso/providers         (admin — create provider)',
            'GET    /api/sso/providers/<id>     (admin — get provider)',
            'PUT    /api/sso/providers/<id>     (admin — update provider)',
            'DELETE /api/sso/providers/<id>     (admin — delete provider)',
            'GET    /api/auth/sso/providers     (public — list enabled providers for login page)',
            'POST   /api/auth/sso/begin         (public — start SSO flow)',
            'GET    /api/auth/sso/callback      (public — IdP redirect callback)',
            'POST   /api/auth/sso/check-domain  (public — check if SSO exists for email)',
        ],
        'oauth': [
            'GET    /api/oauth/clients          (admin — list clients)',
            'POST   /api/oauth/clients          (admin — create client, returns secret once)',
            'GET    /api/oauth/clients/<id>      (admin — get client)',
            'PUT    /api/oauth/clients/<id>      (admin — update client)',
            'DELETE /api/oauth/clients/<id>      (admin — delete client)',
            'POST   /api/oauth/clients/<id>/rotate-secret  (admin — generate new secret)',
            'POST   /api/oauth/token             (public — exchange credentials for token)',
            'POST   /api/oauth/revoke            (public — revoke a token)',
        ],
        'config': [
            'GET /api/config   (secrets_set only, never real secret values)',
            'PUT /api/config   (blank value on a secret field leaves it unchanged)',
        ],
        'authorg': [
            'GET    /api/v2/authorization/trusts          (list trusts)',
            'POST   /api/v2/authorization/trusts          (create trust)',
            'GET    /api/v2/authorization/trusts/<id>     (get trust)',
            'PUT    /api/v2/authorization/trusts/<id>     (update trust)',
            'DELETE /api/v2/authorization/trusts/<id>     (delete/revoke trust)',
        ],
        'alert_rules': [
            'GET    /api/alerts/rules          (list rules)',
            'POST   /api/alerts/rules          (create rule)',
            'GET    /api/alerts/rules/<id>     (get rule)',
            'PUT    /api/alerts/rules/<id>     (update rule)',
            'DELETE /api/alerts/rules/<id>     (delete rule)',
        ],
        'adherence': [
            'GET/POST   /api/wfm/activity-codes          (list/create activity codes)',
            'PUT/DELETE /api/wfm/activity-codes/<id>     (update/delete activity code)',
            'GET/POST   /api/wfm/management-units        (list/create management units)',
            'PUT/DELETE /api/wfm/management-units/<id>   (update/delete management unit)',
            'GET/POST   /api/wfm/schedules               (list/create schedules)',
            'PUT/DELETE /api/wfm/schedules/<id>          (update/delete schedule)',
        ],
        'apps': [
            'GET    /api/apps/installed',
            'GET    /api/apps/available',
            'POST   /api/apps/available/<id>/install',
            'PUT    /api/apps/installed/<id>',
            'DELETE /api/apps/installed/<id>',
        ],
        'canned': [
            'GET    /api/canned  (optional ?category=, ?q=)',
            'POST   /api/canned',
            'PUT    /api/canned/<id>',
            'DELETE /api/canned/<id>',
        ],
        'prompts': [
            'GET/POST   /api/prompts',
            'GET/PUT/DELETE /api/prompts/<id>',
        ],
        'base_settings': [
            'GET/POST   /api/base-settings',
            'GET/PUT/DELETE /api/base-settings/<id>',
        ],
        'phones': [
            'GET/POST   /api/phones',
            'GET/PUT/DELETE /api/phones/<id>',
        ],
        'number_plans': [
            'GET/POST   /api/number-plans  (filter: ?site_name=)',
            'GET/PUT/DELETE /api/number-plans/<id>',
        ],
        'outbound_routes': [
            'GET/POST   /api/outbound-routes  (filter: ?site_name=)',
            'GET/PUT/DELETE /api/outbound-routes/<id>',
        ],
        'message_channels': [
            'GET/POST   /api/message-channels  (filter: ?channel_type=)',
            'GET/PUT/DELETE /api/message-channels/<id>',
        ],
        'certs': [
            'GET    /api/certs  (optional ?division=, ?status=, ?q=)',
            'POST   /api/certs',
            'PUT    /api/certs/<id>',
            'DELETE /api/certs/<id>',
        ],
        'contactlists': [
            'GET    /api/contactlists  (optional ?division=, ?q=)',
            'GET    /api/contactlists/<id>  (includes contacts)',
            'POST   /api/contactlists',
            'PUT    /api/contactlists/<id>',
            'DELETE /api/contactlists/<id>',
            'POST   /api/contactlists/<id>/contacts',
            'POST   /api/contactlists/<id>/contacts/import',
            'DELETE /api/contactlists/<id>/contacts/<contact_id>',
            'PATCH  /api/contactlists/<id>/contacts/<contact_id>/dnc',
        ],
        'bot_connectors': [
            'GET    /api/bot-connectors  (optional ?q=, ?status=, ?platform=, ?lifecycle=, ?division=)',
            'GET    /api/bot-connectors/<id>',
            'POST   /api/bot-connectors',
            'PUT    /api/bot-connectors/<id>',
            'DELETE /api/bot-connectors/<id>',
            'POST   /api/bot-connectors/<id>/connect',
            'POST   /api/bot-connectors/<id>/disconnect',
            'POST   /api/bot-connectors/<id>/test',
            'GET    /api/bot-connectors/intents  (optional ?bot_connector_id=)',
            'POST   /api/bot-connectors/<id>/intents',
            'DELETE /api/bot-connectors/intents/<intent_id>',
            'POST   /api/bot-connectors/match-intent',
        ],
        'dataact': [
            'GET    /api/dataact  (optional ?integration=, ?division=, ?status=, ?q=)',
            'GET    /api/dataact/runs  (Run History tab, optional ?limit=)',
            'GET    /api/dataact/contracts  (optional ?data_action_id=)',
            'GET    /api/dataact/<id>',
            'GET    /api/dataact/<id>/contract',
            'PUT    /api/dataact/<id>/contract',
            'POST   /api/dataact',
            'PUT    /api/dataact/<id>',
            'DELETE /api/dataact/<id>',
            'POST   /api/dataact/<id>/test',
        ],
        'dnclists': [
            'GET    /api/dnclists  (optional ?q=)',
            'GET    /api/dnclists/<id>  (includes numbers)',
            'POST   /api/dnclists',
            'DELETE /api/dnclists/<id>',
            'POST   /api/dnclists/<id>/numbers',
            'DELETE /api/dnclists/<id>/numbers/<number_id>',
            'GET    /api/dnclists/lookup  (?number=)',
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
        _log_resource_audit(cur, 'Create division', name)
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
        # Move any users still assigned to this division back to Home first
        # (same as the UI prototype's delDivision()) — division is a bare
        # text tag on users.division with no FK, so skipping this would
        # leave those rows pointing at a division code that no longer exists.
        cur.execute('SELECT code FROM divisions WHERE tenant_id = %s AND is_home = true', (g.tenant_id,))
        home = cur.fetchone()
        if home:
            cur.execute(
                'UPDATE users SET division = %s WHERE tenant_id = %s AND division = %s',
                (home['code'], g.tenant_id, code),
            )
        cur.execute('DELETE FROM divisions WHERE code = %s', (code,))
        _log_resource_audit(cur, 'Delete division', existing['name'])
        conn.commit()
        conn.close()
        return jsonify({'ok': True})

    data = request.get_json(force=True) or {}
    cur.execute(
        'UPDATE divisions SET name = COALESCE(%s, name), description = COALESCE(%s, description), is_home = COALESCE(%s, is_home) WHERE code = %s RETURNING *',
        (data.get('name'), data.get('description'), data.get('is_home'), code),
    )
    row = cur.fetchone()
    _log_resource_audit(cur, 'Edit division', row['name'])
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


def _get_subscription_state(cur):
    """Lazily creates the tenant's subscription_state row on first read —
    same pattern as org_settings.py's fetch_org_settings()."""
    cur.execute('SELECT status, autopay FROM subscription_state WHERE tenant_id = %s', (g.tenant_id,))
    row = cur.fetchone()
    if row is None:
        cur.execute(
            'INSERT INTO subscription_state (tenant_id) VALUES (%s) RETURNING status, autopay',
            (g.tenant_id,),
        )
        row = cur.fetchone()
    return dict(row)


@app.route('/api/subscription/overview')
def overview():
    conn = get_db()
    cur = conn.cursor()
    sub_state = _get_subscription_state(cur)
    conn.commit()
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

    # Fixed monthly AI Experience token allotment included with the plan —
    # there's no separate "buy AI tokens" flow or table (unlike seats, which
    # really are purchasable via add_seats()/remove_seats() below), so this
    # is a plan constant, not a query. ai_used (from usage_log) is the only
    # real per-tenant number here.
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
        'subStatus': sub_state['status'],
        'autopay': sub_state['autopay'],
    })


@app.route('/api/subscription/plan-change', methods=['POST'])
def plan_change():
    data = request.get_json(force=True) or {}
    note = data.get('note', '')
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s,%s)',
        (g.user_name, 'Plan change requested', note, g.tenant_id, datetime.now()),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/subscription/seats', methods=['POST'])
def add_seats():
    """The actual purchase action behind Subscription's dummy checkout —
    the frontend collects fake card details purely for the UI, nothing here
    validates or charges anything real. A successful buy both raises the
    real seat pool immediately and writes a real row into `purchases`, so
    subscription spend shows up in the Purchases history/expense tracker
    exactly like any other purchase, instead of being a parallel thing the
    two pages never reconcile."""
    data = request.get_json(force=True) or {}
    lic = data.get('licence')
    qty = int(data.get('qty', 0))
    if not lic or qty <= 0:
        return jsonify({'ok': False, 'error': 'licence and positive qty required'}), 400

    conn = get_db()
    cur = conn.cursor()
    sub_state = _get_subscription_state(cur)
    conn.commit()
    if sub_state['status'] == 'Cancelled':
        conn.close()
        return jsonify({'ok': False, 'error': 'Subscription is cancelled — reactivate it before buying seats'}), 409

    cur.execute('SELECT label, purchased, unit_price FROM licenses WHERE code = %s', (lic,))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown licence code'}), 404

    cur.execute('UPDATE licenses SET purchased = purchased + %s WHERE code = %s', (qty, lic))
    cur.execute('SELECT purchased FROM licenses WHERE code = %s', (lic,))
    new_total = cur.fetchone()['purchased']
    cost = round(qty * existing['unit_price'], 2)
    cur.execute(
        'INSERT INTO purchases (tenant_id, item, category, price, purchased_at) VALUES (%s,%s,%s,%s,%s)',
        (g.tenant_id, f"{existing['label']} — {qty} seat(s)", 'Licence', cost, datetime.now().isoformat()),
    )
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s,%s)',
        (g.user_name, 'Seats purchased', f'+{qty} {lic} for £{cost:.2f} (pool now {new_total})', g.tenant_id, datetime.now()),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'total': new_total, 'cost': cost})


@app.route('/api/subscription/seats/remove', methods=['POST'])
def remove_seats():
    """Symmetric to add_seats() — lets a tenant shed licence seats they no
    longer need. Blocked from dropping the pool below however many are
    currently assigned (the same 'active users on this licence' count
    overview()'s usedMap reports), so a removal can never orphan an
    assigned agent. Records a credit (negative-price) row in `purchases`,
    same table add_seats() writes to, so the reduction shows up in spend
    history/the expense tracker instead of being invisible."""
    data = request.get_json(force=True) or {}
    lic = data.get('licence')
    qty = int(data.get('qty', 0))
    if not lic or qty <= 0:
        return jsonify({'ok': False, 'error': 'licence and positive qty required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT label, purchased, unit_price FROM licenses WHERE code = %s', (lic,))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown licence code'}), 404

    cur.execute("SELECT COUNT(*) AS n FROM users WHERE license_code = %s AND state = 'Active'", (lic,))
    assigned = cur.fetchone()['n']
    free = existing['purchased'] - assigned
    if qty > free:
        conn.close()
        return jsonify({
            'ok': False,
            'error': f'Only {free} seat(s) are free to remove — {assigned} of {existing["purchased"]} are currently assigned',
        }), 409

    cur.execute('UPDATE licenses SET purchased = purchased - %s WHERE code = %s', (qty, lic))
    credit = round(qty * existing['unit_price'], 2)
    cur.execute(
        'INSERT INTO purchases (tenant_id, item, category, price, purchased_at) VALUES (%s,%s,%s,%s,%s)',
        (g.tenant_id, f"{existing['label']} — {qty} seat(s) removed", 'Licence', -credit, datetime.now().isoformat()),
    )
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s,%s)',
        (g.user_name, 'Seats removed', f'-{qty} {lic}, pool now {existing["purchased"] - qty}', g.tenant_id, datetime.now()),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'total': existing['purchased'] - qty, 'credit': credit})


@app.route('/api/subscription/cancel', methods=['POST'])
def cancel_subscription():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO subscription_state (tenant_id, status, updated_at) VALUES (%s, 'Cancelled', now())
        ON CONFLICT (tenant_id) DO UPDATE SET status = 'Cancelled', updated_at = now()
        """,
        (g.tenant_id,),
    )
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s,%s)',
        (g.user_name, 'Subscription cancelled', '', g.tenant_id, datetime.now()),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'status': 'Cancelled'})


@app.route('/api/subscription/reactivate', methods=['POST'])
def reactivate_subscription():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO subscription_state (tenant_id, status, updated_at) VALUES (%s, 'Active', now())
        ON CONFLICT (tenant_id) DO UPDATE SET status = 'Active', updated_at = now()
        """,
        (g.tenant_id,),
    )
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s,%s)',
        (g.user_name, 'Subscription reactivated', '', g.tenant_id, datetime.now()),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'status': 'Active'})


@app.route('/api/subscription/autopay', methods=['POST'])
def set_autopay():
    data = request.get_json(force=True) or {}
    enabled = bool(data.get('enabled'))
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO subscription_state (tenant_id, autopay, updated_at) VALUES (%s, %s, now())
        ON CONFLICT (tenant_id) DO UPDATE SET autopay = EXCLUDED.autopay, updated_at = now()
        """,
        (g.tenant_id, enabled),
    )
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s,%s)',
        (g.user_name, 'Autopay ' + ('enabled' if enabled else 'disabled'), '', g.tenant_id, datetime.now()),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'autopay': enabled})


def _guess_card_brand(number):
    first = number[0] if number else ''
    return {'4': 'Visa', '5': 'Mastercard', '3': 'Amex', '6': 'Discover'}.get(first, 'Card')


def _validate_card(data):
    """Returns an error string, or None if every field is acceptable.
    Frontend runs the same checks first (see subscription-redesign.ts's
    validateCardInput) so this is the real enforcement point, not the only
    one — a direct API call bypassing the UI still can't save garbage.

    Deliberately no Luhn checksum: this is a pure demo checkout with no
    real payment processor behind it, and requiring a checksum-valid
    number just meant anyone testing with a made-up number kept getting
    rejected. Length/expiry/CVV shape checks still catch obvious garbage
    (a 3-digit "card number", an already-expired date) without requiring
    a genuine card number."""
    name = (data.get('cardholder_name') or '').strip()
    number = re.sub(r'\D', '', data.get('card_number') or '')
    exp_month = data.get('exp_month')
    exp_year = data.get('exp_year')
    cvv = re.sub(r'\D', '', str(data.get('cvv') or ''))

    if not name:
        return 'Cardholder name is required'
    if not (13 <= len(number) <= 19):
        return 'Card number must be 13–19 digits'
    if not isinstance(exp_month, int) or not (1 <= exp_month <= 12):
        return 'Expiry month must be 1–12'
    if not isinstance(exp_year, int):
        return 'Expiry year is required'
    now = datetime.now()
    if (exp_year, exp_month) < (now.year, now.month):
        return 'Card has expired'
    if not (3 <= len(cvv) <= 4):
        return 'CVV must be 3 or 4 digits'
    return None


@app.route('/api/subscription/payment-method', methods=['GET', 'PUT', 'DELETE'])
def payment_method():
    """The dummy card on file for Subscription's checkout — see
    payment_methods' schema.sql comment for why only brand/last4/expiry/name
    are ever stored, never a full card number, even a fake one."""
    conn = get_db()
    cur = conn.cursor()
    if request.method == 'PUT':
        data = request.get_json(force=True) or {}
        error = _validate_card(data)
        if error:
            conn.close()
            return jsonify({'ok': False, 'error': error}), 400
        name = data['cardholder_name'].strip()
        number = re.sub(r'\D', '', data.get('card_number') or '')
        exp_month = data['exp_month']
        exp_year = data['exp_year']
        brand = _guess_card_brand(number)
        last4 = number[-4:]
        cur.execute(
            """
            INSERT INTO payment_methods (tenant_id, brand, last4, exp_month, exp_year, cardholder_name, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s, now())
            ON CONFLICT (tenant_id) DO UPDATE SET
              brand = EXCLUDED.brand, last4 = EXCLUDED.last4, exp_month = EXCLUDED.exp_month,
              exp_year = EXCLUDED.exp_year, cardholder_name = EXCLUDED.cardholder_name, updated_at = now()
            RETURNING brand, last4, exp_month, exp_year, cardholder_name
            """,
            (g.tenant_id, brand, last4, exp_month, exp_year, name),
        )
        row = cur.fetchone()
        cur.execute(
            'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s,%s)',
            (g.user_name, 'Payment method updated', f'{brand} •••• {last4}', g.tenant_id, datetime.now()),
        )
        conn.commit()
        conn.close()
        return jsonify(dict(row))

    if request.method == 'DELETE':
        cur.execute('DELETE FROM payment_methods WHERE tenant_id = %s', (g.tenant_id,))
        deleted = cur.rowcount > 0
        if deleted:
            cur.execute(
                'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s,%s)',
                (g.user_name, 'Payment method removed', '', g.tenant_id, datetime.now()),
            )
        conn.commit()
        conn.close()
        return jsonify({'ok': True})

    cur.execute(
        'SELECT brand, last4, exp_month, exp_year, cardholder_name FROM payment_methods WHERE tenant_id = %s',
        (g.tenant_id,),
    )
    row = cur.fetchone()
    conn.close()
    return jsonify(dict(row) if row else None)


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
            'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s,%s) RETURNING *',
            (g.user_name, action, data.get('detail', ''), g.tenant_id, datetime.now()),
        )
        row = cur.fetchone()
        conn.commit()
        conn.close()
        return jsonify(dict(row)), 201

    conn = get_db()
    cur = conn.cursor()
    # Tenant-scoped: this used to return the newest 200 rows across every
    # tenant, exposing other tenants' integration installs, data-action names
    # and bot-connector names to any signed-in user.
    cur.execute(
        'SELECT * FROM audit_log WHERE tenant_id = %s ORDER BY id DESC LIMIT 200',
        (g.tenant_id,),
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/purchases/budget', methods=['GET', 'PUT'])
def purchases_budget():
    """One overall monthly spending limit per tenant, for the Purchases
    page's budget tool — hand-written GET/PUT rather than a resources.py
    registry entry since it's a single settings row, not a list of
    entities (same reasoning as /api/subscription/* and /api/org-settings)."""
    conn = get_db()
    cur = conn.cursor()
    if request.method == 'PUT':
        data = request.get_json(force=True) or {}
        limit = data.get('monthly_limit')
        if limit is not None and (not isinstance(limit, (int, float)) or isinstance(limit, bool) or limit < 0):
            conn.close()
            return jsonify({'ok': False, 'error': 'monthly_limit must be a non-negative number or null'}), 400
        cur.execute(
            """
            INSERT INTO purchase_budgets (tenant_id, monthly_limit) VALUES (%s, %s)
            ON CONFLICT (tenant_id) DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit
            """,
            (g.tenant_id, limit),
        )
        conn.commit()
        conn.close()
        return jsonify({'monthly_limit': limit})

    cur.execute('SELECT monthly_limit FROM purchase_budgets WHERE tenant_id = %s', (g.tenant_id,))
    row = cur.fetchone()
    conn.close()
    return jsonify({'monthly_limit': row['monthly_limit'] if row else None})


# ---------------------------------------------------------------------------
# Admin > Contact Center > Utilization — one settings row per tenant (which
# media types can interrupt which, and their max concurrent-interaction
# caps), not a list of entities, so it's a hand-written GET/PUT rather than
# a resources.REGISTRY entry, same reasoning as /api/subscription/* above.
# ---------------------------------------------------------------------------

DEFAULT_UTILIZATION = {
    'Voice': {'cap': 1, 'intBy': []},
    'Callback': {'cap': 1, 'intBy': ['Voice']},
    'Chat': {'cap': 2, 'intBy': ['Voice']},
    'Email': {'cap': 3, 'intBy': ['Voice', 'Chat']},
    'Message': {'cap': 2, 'intBy': ['Voice']},
}


@app.route('/api/utilization')
def get_utilization():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT data FROM utilization_settings WHERE tenant_id = %s', (g.tenant_id,))
    row = cur.fetchone()
    conn.close()
    return jsonify(row['data'] if row else DEFAULT_UTILIZATION)


@app.route('/api/utilization', methods=['PUT', 'PATCH'])
def put_utilization():
    data = request.get_json(force=True) or {}
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO utilization_settings (tenant_id, data, updated_at) VALUES (%s, %s, now())
        ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        RETURNING data
        """,
        (g.tenant_id, data),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(row['data'])


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


# Friendlier singular labels for resources whose REGISTRY key wouldn't read
# well in an audit action ("Create simple-entities") — anything not listed
# here just gets its key title-cased with hyphens turned to spaces.
_RESOURCE_LABELS = {
    'people': 'person',
    'purchases': 'purchase',
    'simple-entities': 'ACD entity',
    'did-assignments': 'DID assignment',
    'wrapup-codes': 'wrap-up code',
    'eval-forms': 'evaluation form',
    'byoc-trunks': 'BYOC trunk',
    'wfm-schedules': 'WFM schedule',
    'call-routes': 'call route',
    'extension-pools': 'extension pool',
    'emergency-groups': 'emergency group',
    'email-domains': 'email domain',
    'email-addresses': 'email address',
    'base-settings': 'base setting',
    'phone-base-settings': 'phone base setting',
    'number-plans': 'number plan',
    'outbound-routes': 'outbound route',
    'message-channels': 'message channel',
    'recording-policies': 'recording policy',
    'schedule-groups': 'schedule group',
    'planning-groups': 'planning group',
    'service-goals': 'service goal',
    'gamification-profiles': 'gamification profile',
    'installed-integrations': 'installed integration',
    'integration-credentials': 'integration credential',
    'work-plans': 'work plan',
    'activity-codes': 'activity code',
    'time-off-requests': 'time-off request',
    'shift-trades': 'shift trade',
    'calibrations': 'calibration',
    'bot-connectors': 'bot connector',
}

# Tried in order for a human-readable identifier to put in the audit detail —
# the first one present and non-empty on the row wins, else it falls back to
# the row's id.
_DISPLAY_NAME_FIELDS = (
    'name', 'item', 'customer_name', 'from_name', 'phone_number', 'addr',
    'domain', 'week', 'agent_ref',
)


def _resource_label(resource):
    return _RESOURCE_LABELS.get(resource, resource.replace('-', ' '))


def _resource_display_name(row):
    for field in _DISPLAY_NAME_FIELDS:
        value = row.get(field)
        if value:
            return value
    return f"#{row['id']}"


def _log_resource_audit(cur, action, detail):
    cur.execute(
        'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.user_name, action, detail, g.tenant_id),
    )


_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


_UNSET = object()  # distinguishes "field not supplied" from an explicit None/'' clear


def _people_duplicate_exists(cur, tenant_id, column, value, exclude_row_id=None):
    sql = f'SELECT id FROM users WHERE tenant_id = %s AND lower({column}) = lower(%s)'
    params = [tenant_id, value]
    if exclude_row_id is not None:
        sql += ' AND id != %s'
        params.append(exclude_row_id)
    cur.execute(sql, params)
    return cur.fetchone() is not None


def _picklist_value_exists(cur, tenant_id, kind, name):
    cur.execute(
        'SELECT id FROM simple_entities WHERE tenant_id = %s AND kind = %s AND lower(name) = lower(%s)',
        (tenant_id, kind, name),
    )
    return cur.fetchone() is not None


def _validate_people_fields(cur, tenant_id, name, email, title=_UNSET, dept=_UNSET, exclude_row_id=None):
    """Returns an error string, or None if every supplied field is
    acceptable. Frontend runs the same checks first (PeoplePage.tsx's
    validate()) so this is the real enforcement point, not the only one --
    the generic resource_create/resource_update routes below have no
    per-field validation at all otherwise, so a bulk CSV import (which
    posts straight to /api/people per row with no client-side check of its
    own) or any other direct API call could save an unparseable "email"
    like a bare username, a name/email that collides with an existing
    person's, or a title/department that isn't one of the managed picklist
    values -- whether or not that field is even being changed in this
    request (each is checked only when supplied).

    title/dept default to a sentinel (_UNSET), not None, because None/blank
    is itself a valid value for them (both columns are nullable and the
    form never marked them required) -- callers pass the sentinel to mean
    "field not supplied at all" and an explicit '' or None to mean "clear
    it", and only a genuinely non-blank value gets checked against the
    picklist."""
    if name is not None:
        name = name.strip()
        if len(name) < 2:
            return 'Full name is required'
        if _people_duplicate_exists(cur, tenant_id, 'name', name, exclude_row_id):
            return f'Name "{name}" is already used by another person'
    if email is not None:
        email = (email or '').strip()
        if not _EMAIL_RE.match(email):
            return 'A valid email address is required'
        if _people_duplicate_exists(cur, tenant_id, 'email', email, exclude_row_id):
            return f'Email {email} is already in use'
    if title is not _UNSET and (title or '').strip():
        if not _picklist_value_exists(cur, tenant_id, 'title', title.strip()):
            return f'"{title.strip()}" is not a recognised job title -- add it first or pick an existing one'
    if dept is not _UNSET and (dept or '').strip():
        if not _picklist_value_exists(cur, tenant_id, 'dept', dept.strip()):
            return f'"{dept.strip()}" is not a recognised department -- add it first or pick an existing one'
    return None


def _prep_value(col, value, spec):
    """psycopg2 only auto-adapts dict -> jsonb (see db.py); a bare Python
    list adapts to a Postgres ARRAY literal instead, which several TEXT[]
    columns here rely on (roles.perms, trunks.codecs, ...). A JSONB column
    that stores a list at its top level (eval_forms.groups) needs to opt
    out of that via spec['json_fields'] so it round-trips as JSON, not an
    array literal that happens to also parse as '{}' for an empty list."""
    if isinstance(value, list) and col in spec.get('json_fields', ()):
        return PgJson(value)
    return value


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

    # A non-numeric or negative ?limit=/?offset= used to raise straight out of
    # int() and surface as a generic 500; a malformed query string is the
    # caller's mistake, so it gets a 400 that says which parameter was wrong.
    try:
        limit = min(max(int(request.args.get('limit', 100)), 0), 2000)
        offset = max(int(request.args.get('offset', 0)), 0)
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'limit and offset must be integers'}), 400
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

    conn = get_db()
    cur = conn.cursor()

    if resource == 'people' and ('name' in cols or 'email' in cols or 'title' in cols or 'dept' in cols):
        error = _validate_people_fields(
            cur, g.tenant_id, data.get('name'), data.get('email'),
            title=data.get('title') if 'title' in cols else _UNSET,
            dept=data.get('dept') if 'dept' in cols else _UNSET,
        )
        if error:
            conn.close()
            return jsonify({'ok': False, 'error': error}), 400

    values = [_prep_value(c, data[c], spec) for c in cols]
    if _tenant_scoped(spec):
        cols = cols + ['tenant_id']
        values = values + [g.tenant_id]

    placeholders = ', '.join('%s' for _ in cols)
    sql = f"INSERT INTO {spec['table']} ({', '.join(cols)}) VALUES ({placeholders}) RETURNING *"
    cur.execute(sql, values)
    new_row = cur.fetchone()
    _log_resource_audit(cur, f'Create {_resource_label(resource)}', _resource_display_name(dict(new_row)))
    conn.commit()

    # The real enforcement point behind "Create & invite" -- previously this
    # only ever wrote the state string, no email, no password, no way for
    # the invited person to ever get in (see send_people_invite in auth.py).
    resp = dict(new_row)
    if resource == 'people' and new_row.get('state') == 'Pending invite':
        invite_token, invite_expires_at = send_people_invite(new_row['id'], new_row['name'], new_row['email'], cur, conn)
        resp['invite_token'] = invite_token
        resp['invite_expires_at'] = invite_expires_at.isoformat()

    conn.close()
    return jsonify(resp), 201


def _propagate_skill_in_flows(cur, tenant_id, old_name, new_name):
    """Renaming/deleting a skill has to reach flows.graph.meta.skills too —
    a node-id-keyed object of skill-name arrays (Transfer-to-ACD skill
    requirements), same as the UI prototype's propagateSkill(). This is
    nested inside jsonb at arbitrary node ids, so it's easier to mutate in
    Python than to write as a single jsonb-path SQL statement."""
    cur.execute('SELECT id, graph FROM flows WHERE tenant_id = %s', (tenant_id,))
    hits = 0
    for row in cur.fetchall():
        graph = row['graph'] or {}
        skills_by_node = (graph.get('meta') or {}).get('skills') or {}
        changed = False
        for node_id, names in list(skills_by_node.items()):
            if not isinstance(names, list) or old_name not in names:
                continue
            changed = True
            hits += 1
            if new_name is not None:
                skills_by_node[node_id] = [new_name if n == old_name else n for n in names]
            else:
                skills_by_node[node_id] = [n for n in names if n != old_name]
        if changed:
            cur.execute('UPDATE flows SET graph = %s WHERE id = %s', (PgJson(graph), row['id']))
    return hits


def _propagate_skill_in_queues(cur, tenant_id, old_name, new_name):
    """Same idea for queues.config.rings[].drop — the bullseye rings' list
    of skills to drop at each ring, as arrays inside a jsonb array."""
    cur.execute('SELECT id, config FROM queues WHERE tenant_id = %s', (tenant_id,))
    hits = 0
    for row in cur.fetchall():
        config = row['config'] or {}
        rings = config.get('rings') or []
        changed = False
        for ring in rings:
            drop = ring.get('drop') if isinstance(ring, dict) else None
            if not isinstance(drop, list) or old_name not in drop:
                continue
            changed = True
            hits += 1
            if new_name is not None:
                ring['drop'] = [new_name if n == old_name else n for n in drop]
            else:
                ring['drop'] = [n for n in drop if n != old_name]
        if changed:
            cur.execute('UPDATE queues SET config = %s WHERE id = %s', (PgJson(config), row['id']))
    return hits


def _propagate_simple_entity(cur, tenant_id, kind, old_name, new_name):
    """Mirrors the UI prototype's propagateSkill()/propagateLang(): a
    skill/language rename or delete (new_name=None) has to reach every place
    that references it by name, not just users — planning groups, Architect
    flows and queue bullseye rings for skills; planning groups and queue
    language requirement for languages. Returns the total reference count
    touched, for a same-shape audit/toast as the prototype's."""
    hits = 0
    if kind == 'skill':
        if new_name is not None:
            cur.execute(
                'UPDATE users SET skills = (skills - %s) || jsonb_build_object(%s, skills -> %s) '
                'WHERE tenant_id = %s AND skills ? %s',
                (old_name, new_name, old_name, tenant_id, old_name),
            )
        else:
            cur.execute(
                'UPDATE users SET skills = skills - %s WHERE tenant_id = %s AND skills ? %s',
                (old_name, tenant_id, old_name),
            )
        hits += cur.rowcount

        if new_name is not None:
            cur.execute(
                'UPDATE planning_groups SET skills = array_replace(skills, %s, %s) '
                'WHERE tenant_id = %s AND %s = ANY(skills)',
                (old_name, new_name, tenant_id, old_name),
            )
        else:
            cur.execute(
                'UPDATE planning_groups SET skills = array_remove(skills, %s) '
                'WHERE tenant_id = %s AND %s = ANY(skills)',
                (old_name, tenant_id, old_name),
            )
        hits += cur.rowcount

        hits += _propagate_skill_in_flows(cur, tenant_id, old_name, new_name)
        hits += _propagate_skill_in_queues(cur, tenant_id, old_name, new_name)
    elif kind in ('title', 'dept'):
        # A single scalar column on both users and dir_people (the Directory
        # module's own, separately-stored copy of the same fields) -- much
        # simpler than skills/langs' jsonb/array handling. Propagating into
        # both tables keeps a rename consistent everywhere the value shows
        # up, even though new values are still written independently per
        # surface (see dir_people's own validation in directory.py).
        col = kind
        new_value = new_name if new_name is not None else None
        cur.execute(
            f'UPDATE users SET {col} = %s WHERE tenant_id = %s AND {col} = %s',
            (new_value, tenant_id, old_name),
        )
        hits += cur.rowcount
        cur.execute(
            f'UPDATE dir_people SET {col} = %s WHERE tenant_id = %s AND {col} = %s',
            (new_value, tenant_id, old_name),
        )
        hits += cur.rowcount
    else:
        if new_name is not None:
            cur.execute(
                'UPDATE users SET langs = array_replace(langs, %s, %s) WHERE tenant_id = %s AND %s = ANY(langs)',
                (old_name, new_name, tenant_id, old_name),
            )
        else:
            cur.execute(
                'UPDATE users SET langs = array_remove(langs, %s) WHERE tenant_id = %s AND %s = ANY(langs)',
                (old_name, tenant_id, old_name),
            )
        hits += cur.rowcount

        # lang_proficiency is keyed by language name too (see its column
        # comment in schema.sql) — carry the rating along the same way a
        # skill's proficiency survives a rename.
        if new_name is not None:
            cur.execute(
                'UPDATE users SET lang_proficiency = (lang_proficiency - %s) || '
                'jsonb_build_object(%s, lang_proficiency -> %s) '
                'WHERE tenant_id = %s AND lang_proficiency ? %s',
                (old_name, new_name, old_name, tenant_id, old_name),
            )
        else:
            cur.execute(
                'UPDATE users SET lang_proficiency = lang_proficiency - %s '
                'WHERE tenant_id = %s AND lang_proficiency ? %s',
                (old_name, tenant_id, old_name),
            )

        if new_name is not None:
            cur.execute(
                'UPDATE planning_groups SET langs = array_replace(langs, %s, %s) '
                'WHERE tenant_id = %s AND %s = ANY(langs)',
                (old_name, new_name, tenant_id, old_name),
            )
        else:
            cur.execute(
                'UPDATE planning_groups SET langs = array_remove(langs, %s) '
                'WHERE tenant_id = %s AND %s = ANY(langs)',
                (old_name, tenant_id, old_name),
            )
        hits += cur.rowcount

        # queues.config.lang is a single name, not an array — the prototype
        # blanks it out on delete rather than removing the key.
        cur.execute(
            "UPDATE queues SET config = jsonb_set(config, '{lang}', %s) "
            "WHERE tenant_id = %s AND config ->> 'lang' = %s",
            (PgJson(new_name if new_name is not None else ''), tenant_id, old_name),
        )
        hits += cur.rowcount

    return hits


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
    # people also fetches title/dept here so the picklist check below can be
    # skipped when they're unchanged (see the comment there) -- every other
    # resource just needs the existence check.
    check_cols = 'id, title, dept' if resource == 'people' else 'id'
    check_sql = f"SELECT {check_cols} FROM {spec['table']} WHERE id = %s"
    check_params = [row_id]
    if _tenant_scoped(spec):
        check_sql += ' AND tenant_id = %s'
        check_params.append(g.tenant_id)
    cur.execute(check_sql, check_params)
    current = cur.fetchone()
    if current is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    if resource == 'people' and ('name' in cols or 'email' in cols or 'title' in cols or 'dept' in cols):
        # Only validate title/dept against the picklist when the value is
        # actually changing -- these columns held arbitrary free text before
        # this picklist existed, so re-saving a person's *unrelated* field
        # (e.g. their licence) must not suddenly fail just because their
        # pre-existing title/dept isn't a recognised picklist entry yet.
        title_changed = 'title' in cols and data.get('title') != current['title']
        dept_changed = 'dept' in cols and data.get('dept') != current['dept']
        error = _validate_people_fields(
            cur, g.tenant_id, data.get('name'), data.get('email'),
            title=data.get('title') if title_changed else _UNSET,
            dept=data.get('dept') if dept_changed else _UNSET,
            exclude_row_id=row_id,
        )
        if error:
            conn.close()
            return jsonify({'ok': False, 'error': error}), 400

    # ACD Skills / Languages are referenced from users by *name*, not by id —
    # users.skills is a jsonb object keyed by skill name and users.langs a
    # text[] of language names (no FK either way). A rename therefore has to
    # carry those references along, exactly as the UI prototype's saveSimple()
    # does, or every existing assignment silently detaches.
    rename_from = None
    rename_kind = None
    if resource == 'simple-entities' and 'name' in cols:
        cur.execute(
            'SELECT kind, name FROM simple_entities WHERE id = %s AND tenant_id = %s',
            (row_id, g.tenant_id),
        )
        prev = cur.fetchone()
        if prev is not None and prev['name'] != data['name']:
            rename_from = prev['name']
            rename_kind = prev['kind']

    set_clause = ', '.join(f'{c} = %s' for c in cols)
    update_sql = f"UPDATE {spec['table']} SET {set_clause} WHERE id = %s"
    update_params = [_prep_value(c, data[c], spec) for c in cols] + [row_id]
    if _tenant_scoped(spec):
        update_sql += ' AND tenant_id = %s'
        update_params.append(g.tenant_id)
    update_sql += ' RETURNING *'
    cur.execute(update_sql, update_params)
    row = cur.fetchone()
    _log_resource_audit(cur, f'Edit {_resource_label(resource)}', _resource_display_name(dict(row)))

    rename_hits = 0
    if rename_from is not None:
        rename_hits = _propagate_simple_entity(cur, g.tenant_id, rename_kind, rename_from, row['name'])
        if rename_hits:
            cur.execute(
                'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
                (
                    g.user_name,
                    f'{rename_kind.capitalize()} rename propagated',
                    f'{rename_from} → {row["name"]} ({rename_hits} reference(s))',
                    g.tenant_id,
                ),
            )

    conn.commit()

    # Same enforcement point as resource_create above -- this is what makes
    # the existing "Send invite" button (which just re-PUTs state='Pending
    # invite') actually do something: every click generates a fresh token
    # and re-sends, invalidating whatever link was sent before.
    resp = dict(row)
    if resource == 'people' and 'state' in cols and data.get('state') == 'Pending invite':
        invite_token, invite_expires_at = send_people_invite(row['id'], row['name'], row['email'], cur, conn)
        resp['invite_token'] = invite_token
        resp['invite_expires_at'] = invite_expires_at.isoformat()

    conn.close()
    if rename_from is not None:
        resp['_propagatedHits'] = rename_hits
    return jsonify(resp)


@app.route('/api/<resource>/<int:row_id>', methods=['DELETE'])
def resource_delete(resource, row_id):
    spec = REGISTRY.get(resource)
    if spec is None:
        return jsonify({'ok': False, 'error': 'unknown resource'}), 404

    conn = get_db()
    cur = conn.cursor()
    check_sql = f"SELECT * FROM {spec['table']} WHERE id = %s"
    check_params = [row_id]
    if _tenant_scoped(spec):
        check_sql += ' AND tenant_id = %s'
        check_params.append(g.tenant_id)
    cur.execute(check_sql, check_params)
    existing_row = cur.fetchone()
    if existing_row is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404
    _log_resource_audit(cur, f'Delete {_resource_label(resource)}', _resource_display_name(dict(existing_row)))

    # Read the skill/language name before the row goes away — the cascade
    # below needs it (see the rename cascade in resource_update for why the
    # references are by name).
    removed = None
    if resource == 'simple-entities':
        cur.execute(
            'SELECT kind, name FROM simple_entities WHERE id = %s AND tenant_id = %s',
            (row_id, g.tenant_id),
        )
        removed = cur.fetchone()

    delete_sql = f"DELETE FROM {spec['table']} WHERE id = %s"
    delete_params = [row_id]
    if _tenant_scoped(spec):
        delete_sql += ' AND tenant_id = %s'
        delete_params.append(g.tenant_id)
    cur.execute(delete_sql, delete_params)

    # A deleted role would otherwise linger as a dangling id inside every
    # assigned user's users.roles array (no FK there — see schema.sql) —
    # strip it the same way the UI prototype's delRole() does.
    if resource == 'roles':
        cur.execute(
            'UPDATE users SET roles = array_remove(roles, %s) WHERE tenant_id = %s',
            (row_id, g.tenant_id),
        )

    # Same for a deleted skill/language: drop it from every place that
    # referenced it by name — users, planning groups, Architect flows and
    # queue bullseye rings — the way the prototype's delSimple() +
    # propagateSkill()/propagateLang() do together.
    delete_hits = 0
    if removed is not None:
        delete_hits = _propagate_simple_entity(cur, g.tenant_id, removed['kind'], removed['name'], None)
        if delete_hits:
            cur.execute(
                'INSERT INTO audit_log (who, action, detail, tenant_id, created_at) VALUES (%s,%s,%s,%s, now())',
                (
                    g.user_name,
                    f"{removed['kind'].capitalize()} delete propagated",
                    f"{removed['name']} removed ({delete_hits} reference(s))",
                    g.tenant_id,
                ),
            )

    conn.commit()
    conn.close()
    resp = {'ok': True}
    if removed is not None:
        resp['_propagatedHits'] = delete_hits
    return jsonify(resp)


if __name__ == '__main__':
    app.run(host=config.HOST, port=config.PORT, debug=True)
