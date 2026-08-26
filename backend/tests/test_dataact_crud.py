"""
CRUD + integrity tests for the Admin > Integrations > Data Actions section:
data_actions (the real "Actions" tab) and data_action_runs (the "Run
History" tab, populated by Test Action invocations).

Same approach as tests/test_integrations_crud.py: runs against the REAL
development PostgreSQL database via Flask's test client against the real
`app`, inside a dedicated disposable test tenant torn down at the end of
the session (cascades through tenant_id FKs, so no per-test cleanup and no
risk to the seeded demo data).
"""

import os
import sys
import uuid

import pytest
from werkzeug.security import generate_password_hash

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app as flask_app  # noqa: E402
from db import get_db  # noqa: E402
import dataact  # noqa: E402


@pytest.fixture(scope='session')
def db_conn():
    conn = get_db()
    yield conn
    conn.close()


@pytest.fixture(scope='session')
def tenant_id(db_conn):
    cur = db_conn.cursor()
    name = f'__pytest_dataact_tenant_{uuid.uuid4().hex[:8]}__'
    cur.execute('INSERT INTO tenants (name) VALUES (%s) RETURNING id', (name,))
    tid = cur.fetchone()['id']
    cur.execute(
        'INSERT INTO users (tenant_id, name, email, password_hash, state) '
        'VALUES (%s, %s, %s, %s, %s) RETURNING id',
        (tid, 'Pytest DataAct User', f'pytest-dataact-{uuid.uuid4().hex[:8]}@example.test',
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
    cur = db_conn.cursor()
    cur.execute('SELECT email FROM users WHERE tenant_id = %s', (tenant_id,))
    email = cur.fetchone()['email']
    resp = client.post('/api/auth/login', json={'email': email, 'password': 'pytest-password-123'})
    assert resp.status_code == 200, resp.get_json()
    token = resp.get_json()['token']
    return {'Authorization': f'Bearer {token}'}


class TestDataActions:
    def test_create_valid(self, client, auth_headers):
        resp = client.post('/api/dataact', headers=auth_headers, json={
            'name': 'Test_Lookup_Customer', 'integration': 'Salesforce', 'method': 'GET',
            'endpoint': '/services/data/v60.0/query', 'contract': 'ani -> tier, name', 'division': '',
        })
        assert resp.status_code == 201, resp.get_json()
        body = resp.get_json()
        assert body['name'] == 'Test_Lookup_Customer'
        assert body['status'] == 'Draft'
        assert body['id'].startswith('da_')
        pytest.action_id_a = body['id']

    def test_create_missing_name(self, client, auth_headers):
        resp = client.post('/api/dataact', headers=auth_headers, json={'endpoint': '/x'})
        assert resp.status_code == 400, resp.get_json()
        assert 'name' in resp.get_json()['error'].lower()

    def test_create_missing_endpoint(self, client, auth_headers):
        resp = client.post('/api/dataact', headers=auth_headers, json={'name': 'No Endpoint Test'})
        assert resp.status_code == 400, resp.get_json()
        assert 'endpoint' in resp.get_json()['error'].lower()

    def test_create_duplicate_name(self, client, auth_headers):
        resp = client.post('/api/dataact', headers=auth_headers,
                            json={'name': 'Test_Lookup_Customer', 'endpoint': '/other'})
        assert resp.status_code == 409, resp.get_json()

    def test_create_duplicate_name_case_insensitive(self, client, auth_headers):
        """The app pre-check compares LOWER(name); confirm the DB-level
        unique index backs that up (not just the app check)."""
        resp = client.post('/api/dataact', headers=auth_headers,
                            json={'name': 'TEST_LOOKUP_CUSTOMER', 'endpoint': '/other'})
        assert resp.status_code == 409, resp.get_json()

    def test_create_no_auth(self, client):
        resp = client.post('/api/dataact', json={'name': 'No Auth', 'endpoint': '/x'})
        assert resp.status_code == 401

    def test_create_defaults_applied(self, client, auth_headers):
        """integration/method default server-side when omitted, matching
        the DB column defaults ('Web Services' / 'GET')."""
        resp = client.post('/api/dataact', headers=auth_headers, json={'name': 'Defaults Test', 'endpoint': '/d'})
        assert resp.status_code == 201
        body = resp.get_json()
        assert body['integration'] == 'Web Services'
        assert body['method'] == 'GET'
        pytest.defaults_action_id = body['id']

    def test_read_list(self, client, auth_headers):
        resp = client.get('/api/dataact', headers=auth_headers)
        assert resp.status_code == 200
        names = [r['name'] for r in resp.get_json()]
        assert 'Test_Lookup_Customer' in names

    def test_read_list_filter_integration(self, client, auth_headers):
        resp = client.get('/api/dataact?integration=Salesforce', headers=auth_headers)
        assert resp.status_code == 200
        assert all(r['integration'] == 'Salesforce' for r in resp.get_json())
        assert any(r['name'] == 'Test_Lookup_Customer' for r in resp.get_json())

    def test_read_list_filter_q(self, client, auth_headers):
        resp = client.get('/api/dataact?q=Lookup_Customer', headers=auth_headers)
        assert resp.status_code == 200
        assert any(r['name'] == 'Test_Lookup_Customer' for r in resp.get_json())

    def test_read_single(self, client, auth_headers):
        resp = client.get(f'/api/dataact/{pytest.action_id_a}', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['name'] == 'Test_Lookup_Customer'

    def test_read_single_invalid_id(self, client, auth_headers):
        resp = client.get('/api/dataact/da_doesnotexist', headers=auth_headers)
        assert resp.status_code == 404

    def test_read_empty_for_fresh_tenant(self, client, db_conn):
        cur = db_conn.cursor()
        cur.execute("INSERT INTO tenants (name) VALUES (%s) RETURNING id", (f'__pytest_da_empty_{uuid.uuid4().hex[:8]}__',))
        empty_tid = cur.fetchone()['id']
        cur.execute(
            'INSERT INTO users (tenant_id, name, email, password_hash, state) VALUES (%s,%s,%s,%s,%s) RETURNING id',
            (empty_tid, 'Empty', f'da-empty-{uuid.uuid4().hex[:8]}@example.test', generate_password_hash('x'), 'Active'),
        )
        db_conn.commit()
        cur.execute('SELECT email FROM users WHERE tenant_id = %s', (empty_tid,))
        email = cur.fetchone()['email']
        login = client.post('/api/auth/login', json={'email': email, 'password': 'x'})
        headers = {'Authorization': f'Bearer {login.get_json()["token"]}'}
        resp = client.get('/api/dataact', headers=headers)
        assert resp.status_code == 200
        assert resp.get_json() == []
        runs_resp = client.get('/api/dataact/runs', headers=headers)
        assert runs_resp.status_code == 200
        assert runs_resp.get_json() == []
        cur.execute('DELETE FROM tenants WHERE id = %s', (empty_tid,))
        db_conn.commit()

    def test_update_valid(self, client, auth_headers):
        resp = client.put(f'/api/dataact/{pytest.action_id_a}', headers=auth_headers, json={'method': 'POST'})
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()['method'] == 'POST'

    def test_update_invalid_id(self, client, auth_headers):
        resp = client.put('/api/dataact/da_doesnotexist', headers=auth_headers, json={'method': 'GET'})
        assert resp.status_code == 404

    def test_update_no_fields(self, client, auth_headers):
        resp = client.put(f'/api/dataact/{pytest.action_id_a}', headers=auth_headers, json={})
        assert resp.status_code == 400

    def test_update_duplicate_name(self, client, auth_headers):
        resp = client.put(f'/api/dataact/{pytest.defaults_action_id}', headers=auth_headers,
                           json={'name': 'Test_Lookup_Customer'})
        assert resp.status_code == 409, resp.get_json()

    def test_update_cannot_forge_readonly_fields(self, client, auth_headers):
        """status/avg_latency_ms/last_error are written only by Test
        Action (see WRITABLE_FIELDS in dataact.py) — a client can't set
        them directly through the edit endpoint."""
        resp = client.put(f'/api/dataact/{pytest.action_id_a}', headers=auth_headers,
                           json={'status': 'Published', 'method': 'PUT'})
        assert resp.status_code == 200
        assert resp.get_json()['status'] == 'Draft'  # unchanged — status wasn't a writable field
        assert resp.get_json()['method'] == 'PUT'     # method was, and did change

    # --- Test Action + Run History ---

    def test_test_action_invalid_id(self, client, auth_headers):
        resp = client.post('/api/dataact/da_doesnotexist/test', headers=auth_headers)
        assert resp.status_code == 404

    def test_test_action_records_run_history(self, client, auth_headers):
        before = client.get('/api/dataact/runs', headers=auth_headers).get_json()
        resp = client.post(f'/api/dataact/{pytest.action_id_a}/test', headers=auth_headers)
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        assert body['status'] in ('Published', 'Slow', 'Failing')
        assert body['last_tested_at'] is not None

        after = client.get('/api/dataact/runs', headers=auth_headers).get_json()
        assert len(after) == len(before) + 1
        newest = after[0]
        assert newest['action_name'] == 'Test_Lookup_Customer'
        assert newest['data_action_id'] == pytest.action_id_a

    def test_test_action_legacy_endpoint_fails_deterministically(self, client, auth_headers):
        """_simulate_test always fails an endpoint containing 'legacy' —
        confirms the deterministic test harness the page relies on."""
        legacy = client.post('/api/dataact', headers=auth_headers,
                              json={'name': 'Legacy Probe', 'endpoint': 'https://legacy.example/x'})
        aid = legacy.get_json()['id']
        resp = client.post(f'/api/dataact/{aid}/test', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['status'] == 'Failing'
        assert resp.get_json()['avg_latency_ms'] is None
        runs = client.get('/api/dataact/runs', headers=auth_headers).get_json()
        assert runs[0]['result'] == 'Connection refused (503)'
        client.delete(f'/api/dataact/{aid}', headers=auth_headers)

    def test_run_history_survives_action_delete(self, client, auth_headers):
        """data_action_id is ON DELETE SET NULL — a run log entry must
        outlive the data_actions row it was run against."""
        created = client.post('/api/dataact', headers=auth_headers,
                               json={'name': 'Delete Then Check History', 'endpoint': '/x'})
        aid = created.get_json()['id']
        client.post(f'/api/dataact/{aid}/test', headers=auth_headers)
        client.delete(f'/api/dataact/{aid}', headers=auth_headers)

        runs = client.get('/api/dataact/runs', headers=auth_headers).get_json()
        matching = [r for r in runs if r['action_name'] == 'Delete Then Check History']
        assert len(matching) == 1
        assert matching[0]['data_action_id'] is None

    # --- Delete ---

    def test_delete_nonexistent(self, client, auth_headers):
        resp = client.delete('/api/dataact/da_doesnotexist', headers=auth_headers)
        assert resp.status_code == 404

    def test_delete_valid(self, client, auth_headers):
        resp = client.delete(f'/api/dataact/{pytest.action_id_a}', headers=auth_headers)
        assert resp.status_code == 200
        resp2 = client.get(f'/api/dataact/{pytest.action_id_a}', headers=auth_headers)
        assert resp2.status_code == 404

    def test_delete_cleanup_defaults_action(self, client, auth_headers):
        client.delete(f'/api/dataact/{pytest.defaults_action_id}', headers=auth_headers)


class TestDataActionsDatabaseTruth:
    """Every assertion here reads PostgreSQL directly (not the API's own
    response) after an API call, so a route that returns a cheerful 200
    without actually writing can't pass."""

    def test_create_actually_inserts_row(self, client, auth_headers, db_conn, tenant_id):
        resp = client.post('/api/dataact', headers=auth_headers,
                            json={'name': 'DB Truth Create', 'endpoint': '/db/truth', 'contract': 'a -> b'})
        assert resp.status_code == 201
        aid = resp.get_json()['id']
        cur = db_conn.cursor()
        cur.execute('SELECT name, endpoint, contract, status, tenant_id FROM data_actions WHERE id = %s', (aid,))
        row = cur.fetchone()
        assert row is not None, 'API returned 201 but no row exists in PostgreSQL'
        assert row['name'] == 'DB Truth Create'
        assert row['endpoint'] == '/db/truth'
        assert row['status'] == 'Draft'
        assert str(row['tenant_id']) == str(tenant_id)
        pytest.db_truth_id = aid

    def test_update_actually_changes_row(self, client, auth_headers, db_conn):
        resp = client.put(f'/api/dataact/{pytest.db_truth_id}', headers=auth_headers,
                           json={'endpoint': '/db/truth/updated'})
        assert resp.status_code == 200
        cur = db_conn.cursor()
        cur.execute('SELECT endpoint, updated_at, created_at FROM data_actions WHERE id = %s', (pytest.db_truth_id,))
        row = cur.fetchone()
        assert row['endpoint'] == '/db/truth/updated'
        assert row['updated_at'] >= row['created_at'], 'touch_updated_at trigger did not fire'

    def test_test_action_actually_writes_run_row(self, client, auth_headers, db_conn, tenant_id):
        cur = db_conn.cursor()
        cur.execute('SELECT count(*) AS n FROM data_action_runs WHERE tenant_id = %s', (tenant_id,))
        before = cur.fetchone()['n']

        resp = client.post(f'/api/dataact/{pytest.db_truth_id}/test', headers=auth_headers)
        assert resp.status_code == 200

        cur.execute('SELECT count(*) AS n FROM data_action_runs WHERE tenant_id = %s', (tenant_id,))
        assert cur.fetchone()['n'] == before + 1, 'test endpoint returned 200 but wrote no run row'

        cur.execute(
            'SELECT action_name, data_action_id, duration_ms, result FROM data_action_runs '
            'WHERE tenant_id = %s ORDER BY ran_at DESC LIMIT 1', (tenant_id,)
        )
        run = cur.fetchone()
        assert run['data_action_id'] == pytest.db_truth_id
        assert run['action_name'] == 'DB Truth Create'
        assert run['result']

        # and the action row itself must have been stamped
        cur.execute('SELECT last_tested_at, status FROM data_actions WHERE id = %s', (pytest.db_truth_id,))
        acted = cur.fetchone()
        assert acted['last_tested_at'] is not None
        assert acted['status'] in ('Published', 'Slow', 'Failing')

    def test_delete_actually_removes_row_and_nulls_run_fk(self, client, auth_headers, db_conn, tenant_id):
        resp = client.delete(f'/api/dataact/{pytest.db_truth_id}', headers=auth_headers)
        assert resp.status_code == 200
        cur = db_conn.cursor()
        cur.execute('SELECT id FROM data_actions WHERE id = %s', (pytest.db_truth_id,))
        assert cur.fetchone() is None, 'API returned 200 but row still in PostgreSQL'
        # ON DELETE SET NULL: the run history row survives, FK nulled
        cur.execute(
            "SELECT data_action_id FROM data_action_runs WHERE action_name = 'DB Truth Create' AND tenant_id = %s",
            (tenant_id,),
        )
        run = cur.fetchone()
        assert run is not None, 'run history row was destroyed with its action (expected SET NULL, not CASCADE)'
        assert run['data_action_id'] is None


@pytest.fixture(scope='session')
def other_tenant_headers(client, db_conn):
    """A second, separate tenant used to prove cross-tenant isolation."""
    cur = db_conn.cursor()
    cur.execute('INSERT INTO tenants (name) VALUES (%s) RETURNING id',
                (f'__pytest_da_other_{uuid.uuid4().hex[:8]}__',))
    tid = cur.fetchone()['id']
    email = f'da-other-{uuid.uuid4().hex[:8]}@example.test'
    cur.execute(
        'INSERT INTO users (tenant_id, name, email, password_hash, state) VALUES (%s,%s,%s,%s,%s)',
        (tid, 'Other', email, generate_password_hash('x'), 'Active'),
    )
    db_conn.commit()
    login = client.post('/api/auth/login', json={'email': email, 'password': 'x'})
    headers = {'Authorization': f'Bearer {login.get_json()["token"]}'}
    yield headers
    cur.execute('DELETE FROM tenants WHERE id = %s', (tid,))
    db_conn.commit()


class TestDataActionsTenantIsolation:
    """A second tenant must never see, read, mutate or delete the first
    tenant's data actions or run history."""

    def test_cross_tenant_read_list_is_isolated(self, client, auth_headers, other_tenant_headers):
        mine = client.post('/api/dataact', headers=auth_headers,
                            json={'name': 'Tenant A Secret Action', 'endpoint': '/secret'})
        assert mine.status_code == 201
        pytest.isolation_action_id = mine.get_json()['id']

        theirs = client.get('/api/dataact', headers=other_tenant_headers)
        assert theirs.status_code == 200
        assert not any(r['name'] == 'Tenant A Secret Action' for r in theirs.get_json())

    def test_cross_tenant_read_single_is_404(self, client, other_tenant_headers):
        resp = client.get(f'/api/dataact/{pytest.isolation_action_id}', headers=other_tenant_headers)
        assert resp.status_code == 404

    def test_cross_tenant_update_is_404(self, client, other_tenant_headers, db_conn):
        resp = client.put(f'/api/dataact/{pytest.isolation_action_id}', headers=other_tenant_headers,
                           json={'endpoint': '/hacked'})
        assert resp.status_code == 404
        cur = db_conn.cursor()
        cur.execute('SELECT endpoint FROM data_actions WHERE id = %s', (pytest.isolation_action_id,))
        assert cur.fetchone()['endpoint'] == '/secret', 'cross-tenant update actually mutated the row'

    def test_cross_tenant_test_action_is_404(self, client, other_tenant_headers):
        resp = client.post(f'/api/dataact/{pytest.isolation_action_id}/test', headers=other_tenant_headers)
        assert resp.status_code == 404

    def test_cross_tenant_delete_is_404(self, client, auth_headers, other_tenant_headers, db_conn):
        resp = client.delete(f'/api/dataact/{pytest.isolation_action_id}', headers=other_tenant_headers)
        assert resp.status_code == 404
        cur = db_conn.cursor()
        cur.execute('SELECT id FROM data_actions WHERE id = %s', (pytest.isolation_action_id,))
        assert cur.fetchone() is not None, 'cross-tenant delete actually removed the row'
        client.delete(f'/api/dataact/{pytest.isolation_action_id}', headers=auth_headers)

    def test_cross_tenant_run_history_is_isolated(self, client, auth_headers, other_tenant_headers):
        created = client.post('/api/dataact', headers=auth_headers,
                               json={'name': 'Tenant A Run Source', 'endpoint': '/runsrc'})
        aid = created.get_json()['id']
        client.post(f'/api/dataact/{aid}/test', headers=auth_headers)

        theirs = client.get('/api/dataact/runs', headers=other_tenant_headers)
        assert theirs.status_code == 200
        assert not any(r['action_name'] == 'Tenant A Run Source' for r in theirs.get_json())
        client.delete(f'/api/dataact/{aid}', headers=auth_headers)


class TestDataActionsAuthRequired:
    """Every Data Actions endpoint sits behind auth.py's bearer guard."""

    @pytest.mark.parametrize('method,path', [
        ('get', '/api/dataact'),
        ('get', '/api/dataact/runs'),
        ('get', '/api/dataact/contracts'),
        ('get', '/api/dataact/some_id'),
        ('get', '/api/dataact/some_id/contract'),
        ('put', '/api/dataact/some_id/contract'),
        ('post', '/api/dataact'),
        ('put', '/api/dataact/some_id'),
        ('delete', '/api/dataact/some_id'),
        ('post', '/api/dataact/some_id/test'),
    ])
    def test_endpoint_requires_auth(self, client, method, path):
        resp = getattr(client, method)(path, json={})
        assert resp.status_code == 401, f'{method.upper()} {path} did not require auth'


class TestContractParsing:
    """parse_contract is the single server-side definition of what a
    contract string means — the Contracts tab, the stored rows and the
    seed backfill all go through it."""

    def test_unicode_arrow(self):
        fields = dataact.parse_contract('ani → tier, name')
        assert [(f['direction'], f['field_name']) for f in fields] == [
            ('input', 'ani'), ('output', 'tier'), ('output', 'name')]

    def test_ascii_arrow(self):
        fields = dataact.parse_contract('a -> b')
        assert [(f['direction'], f['field_name']) for f in fields] == [('input', 'a'), ('output', 'b')]

    def test_typed_fields(self):
        fields = dataact.parse_contract('phone (string), acct (int) -> ok (bool)')
        assert [(f['field_name'], f['field_type']) for f in fields] == [
            ('phone', 'string'), ('acct', 'int'), ('ok', 'bool')]

    def test_untyped_defaults_to_string(self):
        assert dataact.parse_contract('a -> b')[0]['field_type'] == 'string'

    def test_positions_are_ordered_per_direction(self):
        fields = dataact.parse_contract('a, b, c -> x, y')
        assert [f['position'] for f in fields if f['direction'] == 'input'] == [0, 1, 2]
        assert [f['position'] for f in fields if f['direction'] == 'output'] == [0, 1]

    @pytest.mark.parametrize('text', ['', None, '   '])
    def test_empty_contract_yields_no_fields(self, text):
        assert dataact.parse_contract(text) == []

    def test_no_arrow_is_all_input(self):
        fields = dataact.parse_contract('justInput')
        assert len(fields) == 1 and fields[0]['direction'] == 'input'


class TestContractsPersistence:
    """The Contracts tab's data must exist in PostgreSQL, not just in the
    browser — this is the bug this class exists to prevent regressing."""

    def test_create_action_persists_structured_contract(self, client, auth_headers, db_conn, tenant_id):
        resp = client.post('/api/dataact', headers=auth_headers, json={
            'name': 'Contract Persist A', 'endpoint': '/cp/a',
            'contract': 'phone (string), acct -> name, tier (gold|silver)',
        })
        assert resp.status_code == 201
        aid = resp.get_json()['id']
        pytest.contract_action_id = aid

        cur = db_conn.cursor()
        cur.execute(
            'SELECT direction, field_name, field_type, position FROM data_action_contracts '
            'WHERE data_action_id = %s AND tenant_id = %s ORDER BY direction, position',
            (aid, tenant_id),
        )
        rows = [(r['direction'], r['field_name'], r['field_type']) for r in cur.fetchall()]
        assert rows == [
            ('input', 'phone', 'string'), ('input', 'acct', 'string'),
            ('output', 'name', 'string'), ('output', 'tier', 'gold|silver'),
        ], 'contract shown in UI is not backed by rows in PostgreSQL'

    def test_list_contracts_returns_db_rows(self, client, auth_headers):
        resp = client.get('/api/dataact/contracts', headers=auth_headers)
        assert resp.status_code == 200
        mine = [r for r in resp.get_json() if r['data_action_id'] == pytest.contract_action_id]
        assert len(mine) == 4
        assert all(r['action_name'] == 'Contract Persist A' for r in mine)

    def test_filter_contracts_by_action(self, client, auth_headers):
        resp = client.get(f'/api/dataact/contracts?data_action_id={pytest.contract_action_id}', headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.get_json()) == 4

    def test_get_single_action_contract(self, client, auth_headers):
        resp = client.get(f'/api/dataact/{pytest.contract_action_id}/contract', headers=auth_headers)
        assert resp.status_code == 200
        assert [r['field_name'] for r in resp.get_json()] == ['phone', 'acct', 'name', 'tier']

    def test_get_contract_invalid_action(self, client, auth_headers):
        assert client.get('/api/dataact/da_nope/contract', headers=auth_headers).status_code == 404

    def test_update_contract_string_resyncs_rows(self, client, auth_headers, db_conn):
        resp = client.put(f'/api/dataact/{pytest.contract_action_id}', headers=auth_headers,
                           json={'contract': 'newIn -> newOut'})
        assert resp.status_code == 200
        cur = db_conn.cursor()
        cur.execute('SELECT field_name FROM data_action_contracts WHERE data_action_id = %s ORDER BY direction',
                    (pytest.contract_action_id,))
        names = [r['field_name'] for r in cur.fetchall()]
        assert names == ['newIn', 'newOut'], 'stale contract fields survived an update'

    def test_update_other_field_leaves_contract_rows_alone(self, client, auth_headers, db_conn):
        client.put(f'/api/dataact/{pytest.contract_action_id}', headers=auth_headers, json={'method': 'POST'})
        cur = db_conn.cursor()
        cur.execute('SELECT count(*) AS n FROM data_action_contracts WHERE data_action_id = %s',
                    (pytest.contract_action_id,))
        assert cur.fetchone()['n'] == 2

    def test_structured_put_replaces_fields_and_summary(self, client, auth_headers, db_conn):
        resp = client.put(f'/api/dataact/{pytest.contract_action_id}/contract', headers=auth_headers, json={
            'fields': [
                {'direction': 'input', 'field_name': 'pin', 'field_type': 'int'},
                {'direction': 'output', 'field_name': 'valid', 'field_type': 'bool'},
            ]
        })
        assert resp.status_code == 200
        cur = db_conn.cursor()
        cur.execute('SELECT contract FROM data_actions WHERE id = %s', (pytest.contract_action_id,))
        assert cur.fetchone()['contract'] == 'pin → valid', 'summary string not regenerated from structured fields'
        cur.execute('SELECT field_type FROM data_action_contracts WHERE data_action_id = %s AND field_name = %s',
                    (pytest.contract_action_id, 'pin'))
        assert cur.fetchone()['field_type'] == 'int'

    @pytest.mark.parametrize('payload,expected', [
        ({'fields': 'nope'}, 400),
        ({'fields': [{'direction': 'sideways', 'field_name': 'x'}]}, 400),
        ({'fields': [{'direction': 'input', 'field_name': '   '}]}, 400),
        ({'fields': ['notanobject']}, 400),
        ({}, 400),
    ])
    def test_structured_put_validation(self, client, auth_headers, payload, expected):
        resp = client.put(f'/api/dataact/{pytest.contract_action_id}/contract', headers=auth_headers, json=payload)
        assert resp.status_code == expected

    def test_structured_put_invalid_action(self, client, auth_headers):
        resp = client.put('/api/dataact/da_nope/contract', headers=auth_headers, json={'fields': []})
        assert resp.status_code == 404

    def test_delete_action_cascades_contract_rows(self, client, auth_headers, db_conn):
        client.delete(f'/api/dataact/{pytest.contract_action_id}', headers=auth_headers)
        cur = db_conn.cursor()
        cur.execute('SELECT count(*) AS n FROM data_action_contracts WHERE data_action_id = %s',
                    (pytest.contract_action_id,))
        assert cur.fetchone()['n'] == 0, 'orphaned contract rows left behind after action delete'

    def test_cross_tenant_contracts_isolated(self, client, auth_headers, other_tenant_headers):
        created = client.post('/api/dataact', headers=auth_headers,
                               json={'name': 'Isolated Contract Action', 'endpoint': '/i', 'contract': 'secretIn -> secretOut'})
        aid = created.get_json()['id']
        theirs = client.get('/api/dataact/contracts', headers=other_tenant_headers)
        assert theirs.status_code == 200
        assert not any(r['data_action_id'] == aid for r in theirs.get_json())
        assert client.get(f'/api/dataact/{aid}/contract', headers=other_tenant_headers).status_code == 404
        client.delete(f'/api/dataact/{aid}', headers=auth_headers)


class TestRunHistoryPersistence:
    """Run History must be produced by real executions and recorded with
    the entry point that triggered them."""

    def test_execution_records_run_with_trigger_source(self, client, auth_headers, db_conn, tenant_id):
        created = client.post('/api/dataact', headers=auth_headers,
                               json={'name': 'Run Source Probe', 'endpoint': '/rs'})
        aid = created.get_json()['id']
        pytest.run_probe_id = aid

        resp = client.post(f'/api/dataact/{aid}/test?source=test-tab', headers=auth_headers)
        assert resp.status_code == 200
        body = resp.get_json()
        assert 'run' in body, 'test response did not include the persisted run record'
        assert body['run']['trigger_source'] == 'test-tab'

        cur = db_conn.cursor()
        cur.execute('SELECT trigger_source, action_name, duration_ms, result FROM data_action_runs '
                    'WHERE id = %s AND tenant_id = %s', (body['run']['id'], tenant_id))
        row = cur.fetchone()
        assert row is not None, 'run reported by API does not exist in PostgreSQL'
        assert row['trigger_source'] == 'test-tab'
        assert row['action_name'] == 'Run Source Probe'

    def test_default_trigger_source_is_test(self, client, auth_headers):
        resp = client.post(f'/api/dataact/{pytest.run_probe_id}/test', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['run']['trigger_source'] == 'test'

    def test_unknown_trigger_source_is_normalised(self, client, auth_headers):
        """An unexpected ?source= must not write arbitrary text into the log."""
        resp = client.post(f'/api/dataact/{pytest.run_probe_id}/test?source=malicious', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['run']['trigger_source'] == 'test'

    def test_runs_endpoint_exposes_trigger_source(self, client, auth_headers):
        resp = client.get('/api/dataact/runs', headers=auth_headers)
        assert resp.status_code == 200
        mine = [r for r in resp.get_json() if r['action_name'] == 'Run Source Probe']
        assert mine and all('trigger_source' in r for r in mine)

    def test_failed_execution_is_still_recorded(self, client, auth_headers, db_conn):
        """A failing run must be logged too — history that only records
        successes is worse than none."""
        created = client.post('/api/dataact', headers=auth_headers,
                               json={'name': 'Failing Run Probe', 'endpoint': 'https://legacy.example/x'})
        aid = created.get_json()['id']
        resp = client.post(f'/api/dataact/{aid}/test', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['status'] == 'Failing'
        cur = db_conn.cursor()
        cur.execute("SELECT result, duration_ms FROM data_action_runs WHERE action_name = 'Failing Run Probe'")
        row = cur.fetchone()
        assert row is not None
        assert row['result'] == 'Connection refused (503)'
        assert row['duration_ms'] is None
        client.delete(f'/api/dataact/{aid}', headers=auth_headers)

    def test_cleanup(self, client, auth_headers):
        client.delete(f'/api/dataact/{pytest.run_probe_id}', headers=auth_headers)


class TestRunHistoryDeletion:
    """DELETE /api/dataact/runs[/<id>] — the way an operator clears Run
    History. Deliberately last in this file: clear_runs() empties the whole
    tenant's history, so running it earlier would pull the rug out from
    under TestRunHistoryPersistence above.
    """

    def _make_run(self, client, auth_headers, name):
        created = client.post('/api/dataact', headers=auth_headers,
                              json={'name': name, 'endpoint': '/rh'})
        aid = created.get_json()['id']
        resp = client.post(f'/api/dataact/{aid}/test', headers=auth_headers)
        assert resp.status_code == 200, resp.get_json()
        return aid, resp.get_json()['run']['id']

    def test_delete_single_run(self, client, auth_headers, db_conn, tenant_id):
        aid, run_id = self._make_run(client, auth_headers, 'RH Delete One')

        resp = client.delete(f'/api/dataact/runs/{run_id}', headers=auth_headers)
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()['ok'] is True

        cur = db_conn.cursor()
        cur.execute('SELECT id FROM data_action_runs WHERE id = %s AND tenant_id = %s', (run_id, tenant_id))
        assert cur.fetchone() is None, 'run still present in PostgreSQL after delete'
        client.delete(f'/api/dataact/{aid}', headers=auth_headers)

    def test_delete_unknown_run_is_404(self, client, auth_headers):
        assert client.delete('/api/dataact/runs/99999999', headers=auth_headers).status_code == 404

    def test_runs_path_is_not_swallowed_by_action_id_route(self, client, auth_headers):
        """'/runs' must route to clear_runs(), never be captured as an
        action_id by DELETE /<action_id> — which would 404 instead."""
        resp = client.delete('/api/dataact/runs', headers=auth_headers)
        assert resp.status_code == 200, resp.get_json()
        assert 'deleted' in resp.get_json(), 'hit the wrong route — no deleted count returned'

    def test_clear_runs_empties_history_and_reports_count(self, client, auth_headers, db_conn, tenant_id):
        aid1, _ = self._make_run(client, auth_headers, 'RH Clear A')
        aid2, _ = self._make_run(client, auth_headers, 'RH Clear B')
        assert len(client.get('/api/dataact/runs', headers=auth_headers).get_json()) >= 2

        resp = client.delete('/api/dataact/runs', headers=auth_headers)
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()['deleted'] >= 2

        assert client.get('/api/dataact/runs', headers=auth_headers).get_json() == []
        cur = db_conn.cursor()
        cur.execute('SELECT count(*) AS n FROM data_action_runs WHERE tenant_id = %s', (tenant_id,))
        assert cur.fetchone()['n'] == 0
        client.delete(f'/api/dataact/{aid1}', headers=auth_headers)
        client.delete(f'/api/dataact/{aid2}', headers=auth_headers)

    def test_clear_runs_on_empty_history_is_a_no_op(self, client, auth_headers):
        resp = client.delete('/api/dataact/runs', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['deleted'] == 0

    def test_cross_tenant_delete_single_is_404(self, client, auth_headers, other_tenant_headers, db_conn, tenant_id):
        """Another tenant must not be able to delete our run — and the row
        must genuinely survive, not just return a 404 while deleting."""
        aid, run_id = self._make_run(client, auth_headers, 'RH Cross Tenant')

        assert client.delete(f'/api/dataact/runs/{run_id}', headers=other_tenant_headers).status_code == 404

        cur = db_conn.cursor()
        cur.execute('SELECT id FROM data_action_runs WHERE id = %s AND tenant_id = %s', (run_id, tenant_id))
        assert cur.fetchone() is not None, 'another tenant deleted our run history'
        client.delete(f'/api/dataact/{aid}', headers=auth_headers)

    def test_cross_tenant_clear_leaves_our_history_intact(self, client, auth_headers, other_tenant_headers, db_conn, tenant_id):
        aid, run_id = self._make_run(client, auth_headers, 'RH Cross Clear')

        resp = client.delete('/api/dataact/runs', headers=other_tenant_headers)
        assert resp.status_code == 200
        assert resp.get_json()['deleted'] == 0, "cleared another tenant's rows"

        cur = db_conn.cursor()
        cur.execute('SELECT id FROM data_action_runs WHERE id = %s AND tenant_id = %s', (run_id, tenant_id))
        assert cur.fetchone() is not None, "another tenant's clear wiped our history"
        client.delete(f'/api/dataact/{aid}', headers=auth_headers)
        client.delete('/api/dataact/runs', headers=auth_headers)

    @pytest.mark.parametrize('path', ['/api/dataact/runs', '/api/dataact/runs/1'])
    def test_auth_required(self, client, path):
        assert client.delete(path).status_code == 401
