"""
Integration Catalogue module — backs the Admin > Integrations >
Integrations page's "Catalogue" tab (frontend/src/mcm/scripts.ts's
renderCatalogueTab). Plain list/get/create/update/delete for
integration_catalogue itself already comes for free from the generic
resource registry (see backend/resources.py, resource "integration-
catalogue") — this module only adds the one action that registry can't
express: installing a catalogue entry, which has to create a *linked* row
in installed_integrations (and, when that install is a client application,
register it there too) rather than just returning the catalogue row.
Same shape as apps.py's /api/apps/available/<id>/install.

Tenant-scoped via g.tenant_id throughout, same convention as every other
module in this backend.
"""

from flask import Blueprint, jsonify, g

from db import get_db

catalogue_bp = Blueprint('catalogue', __name__, url_prefix='/api/integration-catalogue')


@catalogue_bp.route('/<int:catalogue_id>/install', methods=['POST'])
def install_from_catalogue(catalogue_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'SELECT * FROM integration_catalogue WHERE id = %s AND tenant_id = %s',
        (catalogue_id, g.tenant_id),
    )
    entry = cur.fetchone()
    if entry is None:
        conn.close()
        return jsonify({'ok': False, 'error': 'unknown catalogue entry'}), 404

    # Idempotent by name, matching the frontend's own pre-flight "already
    # installed" check (renderCatalogueTab) — installing the same catalogue
    # entry twice just hands back the existing installed row.
    cur.execute(
        'SELECT * FROM installed_integrations WHERE tenant_id = %s AND name = %s',
        (g.tenant_id, entry['name']),
    )
    existing = cur.fetchone()
    if existing is not None:
        conn.close()
        return jsonify({'ok': True, 'already_installed': True, 'integration': dict(existing)})

    cur.execute(
        """
        INSERT INTO installed_integrations
            (tenant_id, catalogue_id, name, category, type, credentials, used_by, division, status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, '', 'Active')
        RETURNING *
        """,
        (g.tenant_id, entry['id'], entry['name'], entry['category'], entry['type'],
         entry['credentials'], entry['used_by']),
    )
    row = cur.fetchone()

    # Eagerly register as a Client Application when it qualifies, so the
    # Client Applications tab reflects this install immediately rather than
    # waiting for its own next fetch's reconcile pass (see client_apps.py) —
    # that reconcile still runs on every read regardless, as a safety net
    # for installs/edits that don't come through this endpoint.
    if row['type'] and 'client application' in row['type'].lower():
        cur.execute(
            """
            INSERT INTO client_applications (tenant_id, installed_integration_id)
            VALUES (%s, %s)
            ON CONFLICT (installed_integration_id) DO NOTHING
            """,
            (g.tenant_id, row['id']),
        )

    cur.execute(
        'INSERT INTO audit_log (tenant_id, who, action, detail, created_at) VALUES (%s,%s,%s,%s, now())',
        (g.tenant_id, g.user_name, 'Install integration', row['name']),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'already_installed': False, 'integration': dict(row)}), 201
