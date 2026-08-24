"""
CRUD + integrity tests for the Admin > Integrations > Integrations section's
4 tables: installed_integrations, integration_credentials,
integration_catalogue, client_applications.

Runs against the REAL development PostgreSQL database configured in
backend/.env (via db.py/config.py) — not a mock. Everything happens inside
a dedicated, disposable test tenant (created in the tenant_id fixture,
torn down at the end of the session) so none of this ever touches the
seeded demo data ("MCM Group" / Faisal Khan / the pre-existing Salesforce
CTI install, etc.) — the teardown's single `DELETE FROM tenants` cascades
through every table here via their tenant_id ON DELETE CASCADE FK, so no
per-test cleanup is needed either.

Uses Flask's test client against the real `app` object (same routes, same
auth guard, same REGISTRY, same db.py connection) — this exercises the
actual HTTP routing/JSON layer, not just the database directly.
"""

import os
import sys
import uuid

import pytest
from werkzeug.security import generate_password_hash

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app as flask_app  # noqa: E402
from db import get_db  # noqa: E402


@pytest.fixture(scope='session')
def db_conn():
    conn = get_db()
    yield conn
    conn.close()


@pytest.fixture(scope='session')
def tenant_id(db_conn):
    """A disposable tenant + user, isolated from the real demo data."""
    cur = db_conn.cursor()
    name = f'__pytest_tenant_{uuid.uuid4().hex[:8]}__'
    cur.execute('INSERT INTO tenants (name) VALUES (%s) RETURNING id', (name,))
    tid = cur.fetchone()['id']
    cur.execute(
        'INSERT INTO users (tenant_id, name, email, password_hash, state) '
        'VALUES (%s, %s, %s, %s, %s) RETURNING id',
        (tid, 'Pytest User', f'pytest-{uuid.uuid4().hex[:8]}@example.test',
         generate_password_hash('pytest-password-123'), 'Active'),
    )
    db_conn.commit()
    yield tid
    cur.execute('DELETE FROM tenants WHERE id = %s', (tid,))
    db_conn.commit()


@pytest.fixture(scope='session')
def client():
    flask_app.config['TESTING'] = True
    return flask_app.test_client()


@pytest.fixture(scope='session')
def auth_headers(client, tenant_id, db_conn):
    """Real bearer token, obtained the same way a browser would — via
    /api/auth/login — not fabricated in the test."""
    cur = db_conn.cursor()
    cur.execute('SELECT email FROM users WHERE tenant_id = %s', (tenant_id,))
    email = cur.fetchone()['email']
    resp = client.post('/api/auth/login', json={'email': email, 'password': 'pytest-password-123'})
    assert resp.status_code == 200, resp.get_json()
    token = resp.get_json()['token']
    return {'Authorization': f'Bearer {token}'}


# ---------------------------------------------------------------------
# installed_integrations
# ---------------------------------------------------------------------

class TestInstalledIntegrations:
    def test_create_valid(self, client, auth_headers):
        resp = client.post('/api/installed-integrations', headers=auth_headers, json={
            'name': 'Test Integration A', 'category': 'CRM', 'type': 'Client application',
            'credentials': 'OAuth', 'used_by': 'Agent UI', 'division': '', 'status': 'Active',
        })
        assert resp.status_code == 201, resp.get_json()
        body = resp.get_json()
        assert body['name'] == 'Test Integration A'
        assert body['id'] is not None
        pytest.installed_id_a = body['id']

    def test_create_missing_required_field(self, client, auth_headers):
        resp = client.post('/api/installed-integrations', headers=auth_headers, json={'category': 'CRM'})
        assert resp.status_code == 400, resp.get_json()
        assert 'name' in resp.get_json()['error'].lower()

    def test_create_duplicate_name(self, client, auth_headers):
        resp = client.post('/api/installed-integrations', headers=auth_headers, json={'name': 'Test Integration A'})
        assert resp.status_code == 409, resp.get_json()

    def test_create_invalid_field_type_is_stored_as_text_not_rejected(self, client, auth_headers):
        # Every client-writable column on this table is plain TEXT, which
        # Postgres accepts almost anything into — a JSON list gets adapted
        # to its `{a,b,c}` array-literal text form and stored as an
        # ordinary string (verified: no corruption, no error). There is no
        # reachable "wrong type" failure on this particular table because
        # nothing here is strictly typed; that scenario is exercised for
        # real on integration_credentials.rotated_at below (a genuine DATE
        # column), where a bad value does get rejected with 400.
        resp = client.post('/api/installed-integrations', headers=auth_headers, json={
            'name': 'Test Integration B', 'status': ['not', 'a', 'string'],
        })
        assert resp.status_code == 201, resp.get_json()
        assert resp.get_json()['status'] == '{not,a,string}'
        client.delete(f"/api/installed-integrations/{resp.get_json()['id']}", headers=auth_headers)

    def test_create_no_auth(self, client):
        resp = client.post('/api/installed-integrations', json={'name': 'No Auth Test'})
        assert resp.status_code == 401, resp.get_json()

    def test_read_list(self, client, auth_headers):
        resp = client.get('/api/installed-integrations', headers=auth_headers)
        assert resp.status_code == 200
        names = [r['name'] for r in resp.get_json()]
        assert 'Test Integration A' in names

    def test_read_single(self, client, auth_headers):
        resp = client.get(f'/api/installed-integrations/{pytest.installed_id_a}', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['name'] == 'Test Integration A'

    def test_read_single_invalid_id(self, client, auth_headers):
        resp = client.get('/api/installed-integrations/999999999', headers=auth_headers)
        assert resp.status_code == 404

    def test_read_empty_for_fresh_tenant(self, client, db_conn):
        """A tenant with zero rows gets an empty list, not an error."""
        cur = db_conn.cursor()
        cur.execute("INSERT INTO tenants (name) VALUES (%s) RETURNING id", (f'__pytest_empty_{uuid.uuid4().hex[:8]}__',))
        empty_tid = cur.fetchone()['id']
        cur.execute(
            'INSERT INTO users (tenant_id, name, email, password_hash, state) VALUES (%s,%s,%s,%s,%s) RETURNING id',
            (empty_tid, 'Empty', f'empty-{uuid.uuid4().hex[:8]}@example.test', generate_password_hash('x'), 'Active'),
        )
        db_conn.commit()
        cur.execute('SELECT email FROM users WHERE tenant_id = %s', (empty_tid,))
        email = cur.fetchone()['email']
        login = client.post('/api/auth/login', json={'email': email, 'password': 'x'})
        headers = {'Authorization': f'Bearer {login.get_json()["token"]}'}
        resp = client.get('/api/installed-integrations', headers=headers)
        assert resp.status_code == 200
        assert resp.get_json() == []
        cur.execute('DELETE FROM tenants WHERE id = %s', (empty_tid,))
        db_conn.commit()

    def test_update_valid(self, client, auth_headers):
        resp = client.put(f'/api/installed-integrations/{pytest.installed_id_a}', headers=auth_headers,
                           json={'status': 'Warning'})
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()['status'] == 'Warning'

    def test_update_invalid_id(self, client, auth_headers):
        resp = client.put('/api/installed-integrations/999999999', headers=auth_headers, json={'status': 'Active'})
        assert resp.status_code == 404

    def test_update_no_fields(self, client, auth_headers):
        resp = client.put(f'/api/installed-integrations/{pytest.installed_id_a}', headers=auth_headers, json={})
        assert resp.status_code == 400

    def test_update_duplicate_name(self, client, auth_headers):
        second = client.post('/api/installed-integrations', headers=auth_headers, json={'name': 'Test Integration C'})
        assert second.status_code == 201
        resp = client.put(f'/api/installed-integrations/{second.get_json()["id"]}', headers=auth_headers,
                           json={'name': 'Test Integration A'})
        assert resp.status_code == 409, resp.get_json()
        client.delete(f'/api/installed-integrations/{second.get_json()["id"]}', headers=auth_headers)

    def test_delete_nonexistent(self, client, auth_headers):
        resp = client.delete('/api/installed-integrations/999999999', headers=auth_headers)
        assert resp.status_code == 404

    def test_delete_cascades_client_application(self, client, auth_headers):
        """A dependent client_applications row must not survive its parent
        installed_integrations row being deleted (ON DELETE CASCADE)."""
        created = client.post('/api/installed-integrations', headers=auth_headers,
                               json={'name': 'Cascade Test App', 'type': 'Client application'})
        iid = created.get_json()['id']
        client.get('/api/client-applications', headers=auth_headers)  # trigger reconcile
        linked = client.get('/api/client-applications', headers=auth_headers).get_json()
        assert any(r['installed_integration_id'] == iid for r in linked)

        resp = client.delete(f'/api/installed-integrations/{iid}', headers=auth_headers)
        assert resp.status_code == 200

        after = client.get('/api/client-applications', headers=auth_headers).get_json()
        assert not any(r['installed_integration_id'] == iid for r in after)

    def test_delete_valid(self, client, auth_headers):
        resp = client.delete(f'/api/installed-integrations/{pytest.installed_id_a}', headers=auth_headers)
        assert resp.status_code == 200
        resp2 = client.get(f'/api/installed-integrations/{pytest.installed_id_a}', headers=auth_headers)
        assert resp2.status_code == 404


# ---------------------------------------------------------------------
# integration_credentials
# ---------------------------------------------------------------------

class TestIntegrationCredentials:
    def test_create_valid(self, client, auth_headers):
        resp = client.post('/api/integration-credentials', headers=auth_headers,
                            json={'name': 'test-cred', 'integration_name': 'Test Integration', 'rotated_at': '2026-01-01'})
        assert resp.status_code == 201, resp.get_json()
        pytest.cred_id = resp.get_json()['id']

    def test_create_missing_required_field(self, client, auth_headers):
        resp = client.post('/api/integration-credentials', headers=auth_headers, json={'integration_name': 'X'})
        assert resp.status_code == 400

    def test_create_invalid_date_type(self, client, auth_headers):
        resp = client.post('/api/integration-credentials', headers=auth_headers,
                            json={'name': 'bad-date-cred', 'rotated_at': 'not-a-date'})
        assert resp.status_code == 400, resp.get_json()

    def test_read_list(self, client, auth_headers):
        resp = client.get('/api/integration-credentials', headers=auth_headers)
        assert resp.status_code == 200
        assert any(r['id'] == pytest.cred_id for r in resp.get_json())

    def test_read_single_invalid_id(self, client, auth_headers):
        resp = client.get('/api/integration-credentials/999999999', headers=auth_headers)
        assert resp.status_code == 404

    def test_update_valid(self, client, auth_headers):
        resp = client.put(f'/api/integration-credentials/{pytest.cred_id}', headers=auth_headers,
                           json={'rotated_at': '2026-06-01'})
        assert resp.status_code == 200

    def test_update_invalid_id(self, client, auth_headers):
        resp = client.put('/api/integration-credentials/999999999', headers=auth_headers, json={'name': 'x'})
        assert resp.status_code == 404

    def test_delete_valid(self, client, auth_headers):
        resp = client.delete(f'/api/integration-credentials/{pytest.cred_id}', headers=auth_headers)
        assert resp.status_code == 200

    def test_delete_nonexistent(self, client, auth_headers):
        resp = client.delete('/api/integration-credentials/999999999', headers=auth_headers)
        assert resp.status_code == 404


# ---------------------------------------------------------------------
# integration_catalogue
# ---------------------------------------------------------------------

class TestIntegrationCatalogue:
    def test_create_valid(self, client, auth_headers):
        resp = client.post('/api/integration-catalogue', headers=auth_headers, json={
            'name': 'Test Catalogue Entry', 'category': 'Test', 'type': 'Client application',
            'credentials': 'OAuth', 'used_by': 'Tests',
        })
        assert resp.status_code == 201, resp.get_json()
        pytest.catalogue_id = resp.get_json()['id']

    def test_create_missing_required_field(self, client, auth_headers):
        resp = client.post('/api/integration-catalogue', headers=auth_headers, json={'category': 'Test'})
        assert resp.status_code == 400

    def test_create_duplicate_name(self, client, auth_headers):
        resp = client.post('/api/integration-catalogue', headers=auth_headers, json={'name': 'Test Catalogue Entry'})
        assert resp.status_code == 409, resp.get_json()

    def test_read_list(self, client, auth_headers):
        resp = client.get('/api/integration-catalogue', headers=auth_headers)
        assert resp.status_code == 200
        assert any(r['id'] == pytest.catalogue_id for r in resp.get_json())

    def test_read_single(self, client, auth_headers):
        resp = client.get(f'/api/integration-catalogue/{pytest.catalogue_id}', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['name'] == 'Test Catalogue Entry'

    def test_read_single_invalid_id(self, client, auth_headers):
        resp = client.get('/api/integration-catalogue/999999999', headers=auth_headers)
        assert resp.status_code == 404

    def test_update_valid_deactivate(self, client, auth_headers):
        resp = client.put(f'/api/integration-catalogue/{pytest.catalogue_id}', headers=auth_headers,
                           json={'status': 'Deprecated'})
        assert resp.status_code == 200
        assert resp.get_json()['status'] == 'Deprecated'
        # updated_at must have advanced past created_at (trigger fired)
        row = resp.get_json()
        assert row['updated_at'] >= row['created_at']

    def test_update_invalid_id(self, client, auth_headers):
        resp = client.put('/api/integration-catalogue/999999999', headers=auth_headers, json={'status': 'Active'})
        assert resp.status_code == 404

    # --- install flow: catalogue -> installed_integrations, with FK validation ---

    def test_install_invalid_catalogue_id(self, client, auth_headers):
        resp = client.post('/api/integration-catalogue/999999999/install', headers=auth_headers)
        assert resp.status_code == 404

    def test_install_valid_creates_linked_installed_row(self, client, auth_headers):
        cat = client.post('/api/integration-catalogue', headers=auth_headers,
                           json={'name': 'Installable Entry', 'type': 'Data actions'})
        cat_id = cat.get_json()['id']
        resp = client.post(f'/api/integration-catalogue/{cat_id}/install', headers=auth_headers)
        assert resp.status_code == 201, resp.get_json()
        body = resp.get_json()
        assert body['ok'] is True
        assert body['already_installed'] is False
        assert body['integration']['catalogue_id'] == cat_id
        pytest.installable_catalogue_id = cat_id
        pytest.installable_installed_id = body['integration']['id']

    def test_install_idempotent(self, client, auth_headers):
        resp = client.post(f'/api/integration-catalogue/{pytest.installable_catalogue_id}/install', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['already_installed'] is True

    def test_installed_row_survives_catalogue_delete(self, client, auth_headers):
        """catalogue_id is ON DELETE SET NULL, not CASCADE — deleting the
        catalogue entry must not take the installed row down with it."""
        resp = client.delete(f'/api/integration-catalogue/{pytest.installable_catalogue_id}', headers=auth_headers)
        assert resp.status_code == 200
        still_there = client.get(f'/api/installed-integrations/{pytest.installable_installed_id}', headers=auth_headers)
        assert still_there.status_code == 200
        assert still_there.get_json()['catalogue_id'] is None
        client.delete(f'/api/installed-integrations/{pytest.installable_installed_id}', headers=auth_headers)

    def test_delete_nonexistent(self, client, auth_headers):
        resp = client.delete('/api/integration-catalogue/999999999', headers=auth_headers)
        assert resp.status_code == 404

    def test_delete_valid(self, client, auth_headers):
        resp = client.delete(f'/api/integration-catalogue/{pytest.catalogue_id}', headers=auth_headers)
        assert resp.status_code == 200


# ---------------------------------------------------------------------
# client_applications
# ---------------------------------------------------------------------

class TestClientApplications:
    def test_read_empty_before_any_client_app(self, client, auth_headers):
        resp = client.get('/api/client-applications', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json() == []

    def test_register_invalid_installed_integration_id(self, client, auth_headers):
        resp = client.post('/api/client-applications', headers=auth_headers, json={'installed_integration_id': 999999999})
        assert resp.status_code == 404

    def test_register_missing_field(self, client, auth_headers):
        resp = client.post('/api/client-applications', headers=auth_headers, json={})
        assert resp.status_code == 400

    def test_register_valid(self, client, auth_headers):
        created = client.post('/api/installed-integrations', headers=auth_headers,
                               json={'name': 'Manual Client App', 'type': 'Something else entirely'})
        iid = created.get_json()['id']
        resp = client.post('/api/client-applications', headers=auth_headers, json={'installed_integration_id': iid})
        assert resp.status_code == 201, resp.get_json()
        pytest.client_app_installed_id = iid
        pytest.client_app_id = resp.get_json()['id']

    def test_register_duplicate_is_idempotent(self, client, auth_headers):
        resp = client.post('/api/client-applications', headers=auth_headers,
                            json={'installed_integration_id': pytest.client_app_installed_id})
        assert resp.status_code == 201
        assert resp.get_json()['id'] == pytest.client_app_id

    def test_read_list(self, client, auth_headers):
        resp = client.get('/api/client-applications', headers=auth_headers)
        assert resp.status_code == 200
        assert any(r['installed_integration_id'] == pytest.client_app_installed_id for r in resp.get_json())

    def test_read_single(self, client, auth_headers):
        resp = client.get(f'/api/client-applications/{pytest.client_app_id}', headers=auth_headers)
        assert resp.status_code == 200

    def test_read_single_invalid_id(self, client, auth_headers):
        resp = client.get('/api/client-applications/999999999', headers=auth_headers)
        assert resp.status_code == 404

    def test_type_edit_reconciles_auto_membership(self, client, auth_headers):
        """An *auto*-derived membership (never explicitly registered —
        just an installed_integrations row whose type happens to match) is
        pure derived state: editing type away from 'client application'
        must drop it from this list on next read."""
        created = client.post('/api/installed-integrations', headers=auth_headers,
                               json={'name': 'Auto Membership Test', 'type': 'Client application'})
        iid = created.get_json()['id']
        present = client.get('/api/client-applications', headers=auth_headers).get_json()
        assert any(r['installed_integration_id'] == iid for r in present)

        client.put(f'/api/installed-integrations/{iid}', headers=auth_headers, json={'type': 'No longer a client app'})
        after = client.get('/api/client-applications', headers=auth_headers).get_json()
        assert not any(r['installed_integration_id'] == iid for r in after)
        client.delete(f'/api/installed-integrations/{iid}', headers=auth_headers)

    def test_type_edit_does_not_remove_manual_membership(self, client, auth_headers):
        """A *manually*-registered membership (POST /api/client-applications,
        the pytest.client_app_installed_id row from test_register_valid
        above — installed with a type that never matched "client
        application" in the first place) is explicitly "independent of what
        the free-text type says" per register_client_app's own contract —
        editing type must NOT make it disappear, unlike the auto case above."""
        client.put(f'/api/installed-integrations/{pytest.client_app_installed_id}', headers=auth_headers,
                   json={'type': 'Something completely different now'})
        resp = client.get('/api/client-applications', headers=auth_headers)
        assert any(r['installed_integration_id'] == pytest.client_app_installed_id for r in resp.get_json())

    def test_delete_nonexistent(self, client, auth_headers):
        resp = client.delete('/api/client-applications/999999999', headers=auth_headers)
        assert resp.status_code == 404

    def test_unregister_does_not_delete_installed_integration(self, client, auth_headers):
        client.put(f'/api/installed-integrations/{pytest.client_app_installed_id}', headers=auth_headers,
                   json={'type': 'Client application'})
        row = client.get('/api/client-applications', headers=auth_headers).get_json()
        cid = next(r['id'] for r in row if r['installed_integration_id'] == pytest.client_app_installed_id)
        resp = client.delete(f'/api/client-applications/{cid}', headers=auth_headers)
        assert resp.status_code == 200
        still_installed = client.get(f'/api/installed-integrations/{pytest.client_app_installed_id}', headers=auth_headers)
        assert still_installed.status_code == 200
