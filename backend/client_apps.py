"""
Client Applications module — backs the Admin > Integrations >
Integrations page's "Client Applications" tab. A client application isn't
a distinct kind of data; it's an installed_integrations row whose
free-text `type` column mentions "client application"
(frontend/src/mcm/scripts.ts's old renderClientAppsTab() computed exactly
that, purely in the browser, on every render).

client_applications makes that membership an explicit, queryable fact
instead of a string match repeated in JS: one row per qualifying
installed_integrations row. _reconcile() runs at the top of every read in
this module and adds/removes rows so membership can never drift out of
sync, no matter which path last touched the underlying `type` — this
module's own register_client_app, catalogue.py's install endpoint, or the
generic installed_integrations PUT/DELETE in app.py (which this module
intentionally never modifies, so existing Installed-tab editing keeps
working exactly as before).

Tenant-scoped via g.tenant_id throughout, same convention as apps.py and
canned.py.
"""

from flask import Blueprint, jsonify, request, g

from db import get_db

client_apps_bp = Blueprint('client_apps', __name__, url_prefix='/api/client-applications')

_CLIENT_APP_MATCH = '%client application%'


def _reconcile(cur):
    """Add an 'auto' client_applications row for every installed_integrations
    row that now qualifies but doesn't have one yet, and remove 'auto' rows
    whose installed_integrations row no longer qualifies (edited away from
    "client application", or type cleared). Deleting the installed
    integration itself is handled by the FK's ON DELETE CASCADE, not here.

    Only ever touches source='auto' rows — a 'manual' row (registered via
    POST below specifically to be independent of what `type` says) must
    survive this regardless of the parent's type, or register_client_app's
    whole reason to exist is defeated the next time anything calls GET."""
    cur.execute(
        """
        INSERT INTO client_applications (tenant_id, installed_integration_id, source)
        SELECT tenant_id, id, 'auto' FROM installed_integrations
        WHERE tenant_id = %s AND type ILIKE %s
        ON CONFLICT (installed_integration_id) DO NOTHING
        """,
        (g.tenant_id, _CLIENT_APP_MATCH),
    )
    cur.execute(
        """
        DELETE FROM client_applications ca
        USING installed_integrations ii
        WHERE ca.installed_integration_id = ii.id
          AND ca.tenant_id = %s
          AND ca.source = 'auto'
          AND ii.type NOT ILIKE %s
        """,
        (g.tenant_id, _CLIENT_APP_MATCH),
    )


_ROW_SELECT = """
    SELECT ca.id, ca.installed_integration_id, ca.created_at,
           ii.name, ii.category, ii.type, ii.credentials, ii.used_by, ii.division, ii.status
    FROM client_applications ca
    JOIN installed_integrations ii ON ii.id = ca.installed_integration_id
"""


@client_apps_bp.route('', methods=['GET'])
def list_client_apps():
    conn = get_db()
    cur = conn.cursor()
    _reconcile(cur)
    conn.commit()
    cur.execute(_ROW_SELECT + ' WHERE ca.tenant_id = %s ORDER BY ii.name', (g.tenant_id,))
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@client_apps_bp.route('/<int:client_app_id>', methods=['GET'])
def get_client_app(client_app_id):
    conn = get_db()
    cur = conn.cursor()
    _reconcile(cur)
    conn.commit()
    cur.execute(_ROW_SELECT + ' WHERE ca.id = %s AND ca.tenant_id = %s', (client_app_id, g.tenant_id))
    row = cur.fetchone()
    conn.close()
    if row is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify(dict(row))


@client_apps_bp.route('', methods=['POST'])
def register_client_app():
    """Manually register an already-installed integration as a client
    application (independent of what its free-text `type` says) — e.g. for
    an integration installed via "+ Install Integration" whose type wasn't
    set to include the phrase. Idempotent: registering twice just returns
    the existing row."""
    data = request.get_json(force=True) or {}
    installed_integration_id = data.get('installed_integration_id')
    if not installed_integration_id:
        return jsonify({'ok': False, 'error': 'installed_integration_id is required'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT id FROM installed_integrations WHERE id = %s AND tenant_id = %s',
        (installed_integration_id, g.tenant_id),
    )
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown installed integration'}), 404

    # source='manual' both on insert and on conflict — registering an
    # already-auto-derived row here promotes it to manual too, so it stops
    # being at the mercy of _reconcile() pruning it the moment its type
    # next changes.
    cur.execute(
        """
        INSERT INTO client_applications (tenant_id, installed_integration_id, source)
        VALUES (%s, %s, 'manual')
        ON CONFLICT (installed_integration_id) DO UPDATE SET source = 'manual'
        RETURNING id
        """,
        (g.tenant_id, installed_integration_id),
    )
    new_id = cur.fetchone()['id']
    # Tenant predicate is defence-in-depth: the parent was already verified to
    # belong to this tenant above, but UNIQUE(installed_integration_id) is a
    # global constraint, so the ON CONFLICT above can in principle resolve to a
    # row id this tenant does not own. Read it back scoped either way.
    cur.execute(_ROW_SELECT + ' WHERE ca.id = %s AND ca.tenant_id = %s', (new_id, g.tenant_id))
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify(dict(row)), 201


@client_apps_bp.route('/<int:client_app_id>', methods=['DELETE'])
def unregister_client_app(client_app_id):
    """Un-register only — removes the client-application flag row, never
    the underlying installed_integrations row (that stays owned by the
    Installed tab's Uninstall action)."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT id FROM client_applications WHERE id = %s AND tenant_id = %s',
        (client_app_id, g.tenant_id),
    )
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404
    cur.execute('DELETE FROM client_applications WHERE id = %s AND tenant_id = %s', (client_app_id, g.tenant_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})
