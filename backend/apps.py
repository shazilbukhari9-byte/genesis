"""
Apps Module — backs frontend/src/mcm/apps-redesign.ts's Apps > Installed /
Available tabs. One `apps` table serves both lists (see database/schema.sql):
a row is "available" while installed = false, and "installed" once it's
true — Install/uninstall just flip that flag plus the status fields below,
they never create or delete catalogue rows, so the total set of
integrations never changes size, only which list a given one is in.

Every route is tenant-scoped via g.tenant_id (set by auth.py's bearer-token
guard) — never a client-supplied value, same convention as every other
module in this backend (see app.py's divisions routes, directory.py, etc).
"""

from flask import Blueprint, jsonify, request, g

from db import get_db

apps_bp = Blueprint('apps', __name__)


@apps_bp.route('/api/apps/installed', methods=['GET'])
def list_installed():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT * FROM apps WHERE tenant_id = %s AND installed = true ORDER BY name',
        (g.tenant_id,),
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@apps_bp.route('/api/apps/available', methods=['GET'])
def list_available():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT * FROM apps WHERE tenant_id = %s AND installed = false ORDER BY name',
        (g.tenant_id,),
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@apps_bp.route('/api/apps/available/<app_id>/install', methods=['POST'])
def install_app(app_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id, installed FROM apps WHERE id = %s AND tenant_id = %s', (app_id, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown app'}), 404
    if existing['installed']:
        conn.close()
        return jsonify({'ok': False, 'error': 'already installed'}), 409

    cur.execute(
        """
        UPDATE apps
        SET installed = true, status = 'active', status_label = 'Active',
            integration_status = 'Connected', last_sync_label = 'Just now',
            installed_at = now()
        WHERE id = %s AND tenant_id = %s
        RETURNING *
        """,
        (app_id, g.tenant_id),
    )
    row = cur.fetchone()
    cur.execute(
        'INSERT INTO audit_log (tenant_id, who, action, detail, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.tenant_id, g.user_name, 'App installed', row['name']),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'app': dict(row)})


@apps_bp.route('/api/apps/installed/<app_id>', methods=['PUT', 'PATCH'])
def update_installed(app_id):
    """Update an installed app's status/config. Only status, status_label,
    integration_status and last_sync_label are writable here — name,
    category, icon, description and permissions describe the catalogue
    entry itself, not per-install configuration, so they aren't accepted
    from the client (same "declare writable fields explicitly" convention
    as resources.py's generic registry)."""
    data = request.get_json(force=True) or {}
    writable = ('status', 'status_label', 'integration_status', 'last_sync_label')
    cols = [f for f in writable if f in data]
    if not cols:
        return jsonify({'ok': False, 'error': 'no writable fields supplied'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM apps WHERE id = %s AND tenant_id = %s AND installed = true', (app_id, g.tenant_id))
    if cur.fetchone() is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    set_clause = ', '.join(f'{c} = %s' for c in cols)
    cur.execute(
        f'UPDATE apps SET {set_clause} WHERE id = %s AND tenant_id = %s RETURNING *',
        [data[c] for c in cols] + [app_id, g.tenant_id],
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'app': dict(row)})


@apps_bp.route('/api/apps/installed/<app_id>', methods=['DELETE'])
def uninstall_app(app_id):
    """Uninstall — flips the row back to the Available list rather than
    deleting it, so it can be reinstalled later without re-seeding. A real
    "remove from catalogue entirely" isn't a feature this module exposes."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id, name FROM apps WHERE id = %s AND tenant_id = %s AND installed = true', (app_id, g.tenant_id))
    existing = cur.fetchone()
    if existing is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'not found'}), 404

    cur.execute(
        """
        UPDATE apps
        SET installed = false, status = 'inactive', status_label = 'Inactive',
            integration_status = 'Not connected', last_sync_label = NULL,
            installed_at = NULL
        WHERE id = %s AND tenant_id = %s
        """,
        (app_id, g.tenant_id),
    )
    cur.execute(
        'INSERT INTO audit_log (tenant_id, who, action, detail, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.tenant_id, g.user_name, 'App uninstalled', existing['name']),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})
