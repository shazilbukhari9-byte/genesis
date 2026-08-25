"""
Tests for Integrations Phase 1's real (non-simulated) execution branch in
dataact.py's test_action() — CRM_Lookup_Customer, when Salesforce is
actually connected, calls salesforce_client.soql_query instead of
_simulate_test.

Same "real database, mock only the outbound network call" approach as
test_salesforce_oauth.py. data_actions.id is a client-chosen TEXT primary
key that dataact.py's own POST route always auto-generates
(`'da_' + secrets.token_hex(5)`) — since the real-execution branch is
deliberately keyed to the exact seeded id 'da-crm-lookup-customer'
(dataact.SALESFORCE_REAL_ACTION_ID), the fixture below inserts that row
directly via SQL rather than through the API, matching this codebase's
existing "database truth" pattern (test_dataact_crud.py's
TestDataActionsDatabaseTruth class does the same kind of direct SQL for
setup/verification elsewhere).
"""

import os
import sys
import uuid
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet
from werkzeug.security import generate_password_hash

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app as flask_app  # noqa: E402
from db import get_db  # noqa: E402
import config  # noqa: E402
import dataact  # noqa: E402
import salesforce_client as sf  # noqa: E402


@pytest.fixture(scope='session', autouse=True)
def salesforce_config():
    original = (config.SALESFORCE_CLIENT_ID, config.SALESFORCE_CLIENT_SECRET, config.INTEGRATION_ENCRYPTION_KEY)
    config.SALESFORCE_CLIENT_ID = 'test_client_id'
    config.SALESFORCE_CLIENT_SECRET = 'test_client_secret'
    config.INTEGRATION_ENCRYPTION_KEY = Fernet.generate_key().decode()
    yield
    config.SALESFORCE_CLIENT_ID, config.SALESFORCE_CLIENT_SECRET, config.INTEGRATION_ENCRYPTION_KEY = original


@pytest.fixture(scope='session')
def db_conn():
    conn = get_db()
    yield conn
    conn.close()


@pytest.fixture(scope='session')
def tenant_id(db_conn):
    cur = db_conn.cursor()
    name = f'__pytest_dasf_tenant_{uuid.uuid4().hex[:8]}__'
    cur.execute('INSERT INTO tenants (name) VALUES (%s) RETURNING id', (name,))
    tid = cur.fetchone()['id']
    cur.execute(
        'INSERT INTO users (tenant_id, name, email, password_hash, state) '
        'VALUES (%s,%s,%s,%s,%s) RETURNING id',
        (tid, 'Pytest DASF User', f'pytest-dasf-{uuid.uuid4().hex[:8]}@example.test',
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
def auth_headers(client, db_conn, tenant_id):
    cur = db_conn.cursor()
    cur.execute('SELECT email FROM users WHERE tenant_id = %s', (tenant_id,))
    resp = client.post('/api/auth/login', json={'email': cur.fetchone()['email'], 'password': 'pytest-password-123'})
    assert resp.status_code == 200, resp.get_json()
    return {'Authorization': f'Bearer {resp.get_json()["token"]}'}


@pytest.fixture
def crm_lookup_action(client, auth_headers, db_conn, tenant_id):
    """The one action the real-execution branch is scoped to — matched by
    (name, integration), not by id: data_actions.id is a TEXT PRIMARY KEY
    with no tenant_id in it (schema.sql), i.e. globally unique across every
    tenant, not per-tenant, so a hardcoded id would collide with the real
    seed data's own 'da-crm-lookup-customer' row the moment a second
    tenant tried to use it (this fixture used to do exactly that and hit
    a UniqueViolation). Created through the real API so
    data_action_contracts comes from the same _sync_contract_fields() path
    production traffic uses, not a hand-written INSERT."""
    resp = client.post('/api/dataact', headers=auth_headers, json={
        'name': dataact.SALESFORCE_REAL_ACTION_NAME,
        'integration': dataact.SALESFORCE_REAL_ACTION_INTEGRATION,
        'method': 'GET',
        'endpoint': '/services/data/v60.0/query',
        'contract': 'ani → tier, name, accountId',
        'division': 'd_home',
    })
    assert resp.status_code == 201, resp.get_json()
    action_id = resp.get_json()['id']
    yield action_id
    client.delete(f'/api/dataact/{action_id}', headers=auth_headers)


@pytest.fixture
def other_action(client, auth_headers):
    """A second Salesforce-tagged action (mirrors the seeded CRM_Create_Case)
    that must stay simulated even when Salesforce is connected — the real
    branch is scoped to (SALESFORCE_REAL_ACTION_NAME, ..._INTEGRATION)
    specifically, not to every action whose integration is 'Salesforce'."""
    resp = client.post('/api/dataact', headers=auth_headers, json={
        'name': 'CRM_Create_Case', 'integration': 'Salesforce', 'method': 'POST',
        'endpoint': '/services/data/v60.0/sobjects/Case', 'contract': 'subject, desc → caseId', 'division': 'd_home',
    })
    assert resp.status_code == 201, resp.get_json()
    action_id = resp.get_json()['id']
    yield action_id
    client.delete(f'/api/dataact/{action_id}', headers=auth_headers)


@pytest.fixture
def installed_salesforce(db_conn, tenant_id):
    cur = db_conn.cursor()
    cur.execute(
        "INSERT INTO installed_integrations (tenant_id, name, category, type, status) "
        "VALUES (%s,'Salesforce CTI','CRM','Client application','Active') RETURNING id",
        (tenant_id,),
    )
    iid = cur.fetchone()['id']
    db_conn.commit()
    yield iid
    cur.execute('DELETE FROM installed_integrations WHERE id = %s', (iid,))
    db_conn.commit()


@pytest.fixture
def connected_salesforce(client, auth_headers, db_conn, tenant_id, installed_salesforce):
    """Runs the real OAuth callback (with the token exchange mocked) so
    this fixture exercises the exact same code path a real connection
    would, rather than hand-inserting a 'Connected' row."""
    auth_resp = client.post('/api/integrations/salesforce/oauth/authorize-url', headers=auth_headers,
                             json={'installed_integration_id': installed_salesforce})
    state = auth_resp.get_json()['authorize_url'].split('state=')[1].split('&')[0]
    with patch.object(sf, 'exchange_code_for_token', return_value={
        'access_token': 'fake-access-token', 'refresh_token': 'fake-refresh-token',
        'instance_url': 'https://example.my.salesforce.com', 'token_type': 'Bearer', 'scope': 'api refresh_token',
    }):
        resp = client.get(f'/api/integrations/salesforce/oauth/callback?code=abc&state={state}')
    assert resp.status_code == 302
    return installed_salesforce


CONTACT_FOUND = {
    'records': [{
        'Id': '003xx000004TmiQAAS', 'Name': 'Amy Carter', 'AccountId': '001xx000003DGgUAAW',
        'Account': {'Type': 'Enterprise', 'attributes': {}},
    }],
}


class TestRealExecutionSuccess:
    def test_successful_lookup_returns_real_output(self, client, auth_headers, connected_salesforce, crm_lookup_action):
        with patch.object(sf, 'soql_query', return_value=CONTACT_FOUND) as mocked:
            resp = client.post(f'/api/dataact/{crm_lookup_action}/test', headers=auth_headers, json={'ani': '555-0100'})
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        assert body['status'] == 'Published'
        assert body['output'] == {'name': 'Amy Carter', 'accountId': '001xx000003DGgUAAW', 'tier': 'Enterprise'}
        mocked.assert_called_once()
        soql = mocked.call_args[0][2]
        assert "Phone = '555-0100'" in soql
        assert 'FROM Contact' in soql

    def test_run_history_records_the_real_execution(self, client, auth_headers, db_conn, tenant_id, connected_salesforce, crm_lookup_action):
        with patch.object(sf, 'soql_query', return_value=CONTACT_FOUND):
            client.post(f'/api/dataact/{crm_lookup_action}/test', headers=auth_headers, json={'ani': '555-0100'})
        cur = db_conn.cursor()
        cur.execute('SELECT * FROM data_action_runs WHERE data_action_id = %s AND tenant_id = %s ORDER BY id DESC LIMIT 1',
                    (crm_lookup_action, tenant_id))
        run = cur.fetchone()
        assert run['result'] == '200 OK'
        assert run['duration_ms'] is not None and run['duration_ms'] >= 0

    def test_never_leaks_the_token_in_the_response(self, client, auth_headers, connected_salesforce, crm_lookup_action):
        with patch.object(sf, 'soql_query', return_value=CONTACT_FOUND):
            resp = client.post(f'/api/dataact/{crm_lookup_action}/test', headers=auth_headers, json={'ani': '555-0100'})
        assert 'fake-access-token' not in str(resp.get_json())


class TestRealExecutionInputValidation:
    def test_missing_required_input_field_fails_without_calling_salesforce(self, client, auth_headers, connected_salesforce, crm_lookup_action):
        with patch.object(sf, 'soql_query') as mocked:
            resp = client.post(f'/api/dataact/{crm_lookup_action}/test', headers=auth_headers, json={})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['status'] == 'Failing'
        assert 'Contract validation failed' in body['last_error']
        assert 'ani' in body['last_error']
        mocked.assert_not_called()


class TestRealExecutionOutputContractValidation:
    def test_missing_output_field_is_a_controlled_failure_not_silent_success(self, client, auth_headers, connected_salesforce, crm_lookup_action):
        incomplete = {'records': [{'Id': 'x', 'Name': 'Amy Carter', 'AccountId': None, 'Account': None}]}
        with patch.object(sf, 'soql_query', return_value=incomplete):
            resp = client.post(f'/api/dataact/{crm_lookup_action}/test', headers=auth_headers, json={'ani': '555-0100'})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['status'] == 'Failing'
        assert 'Contract validation failed' in body['last_error']
        assert 'output' not in body  # no half-valid output is ever returned as if it were usable

    def test_no_matching_contact_is_a_controlled_failure(self, client, auth_headers, connected_salesforce, crm_lookup_action):
        with patch.object(sf, 'soql_query', return_value={'records': []}):
            resp = client.post(f'/api/dataact/{crm_lookup_action}/test', headers=auth_headers, json={'ani': '555-9999'})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['status'] == 'Failing'
        assert 'No Salesforce contact found' in body['last_error']


class TestRealExecutionErrorMapping:
    @pytest.mark.parametrize('exc,expected_substring', [
        (sf.SalesforceAuthError('Session expired or invalid'), 'authentication failed'),
        (sf.SalesforceForbiddenError('insufficient access'), 'denied access'),
        (sf.SalesforceNotFoundError('not found'), 'not found'),
        (sf.SalesforceRateLimitError('REQUEST_LIMIT_EXCEEDED'), 'API limit'),
        (sf.SalesforceServerError('internal error'), 'server error'),
        (sf.SalesforceTimeoutError('timed out'), 'timed out'),
        (sf.SalesforceNetworkError('unreachable'), 'reach Salesforce'),
        (sf.SalesforceResponseError('bad json'), 'unexpected response'),
    ])
    def test_each_error_type_is_a_controlled_failure(self, client, auth_headers, connected_salesforce, crm_lookup_action, exc, expected_substring):
        with patch.object(sf, 'soql_query', side_effect=exc):
            resp = client.post(f'/api/dataact/{crm_lookup_action}/test', headers=auth_headers, json={'ani': '555-0100'})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['status'] == 'Failing'
        assert expected_substring.lower() in body['last_error'].lower()

    def test_unexpected_exception_never_leaks_a_stack_trace(self, client, auth_headers, connected_salesforce, crm_lookup_action):
        with patch.object(sf, 'soql_query', side_effect=RuntimeError('boom: internal detail nobody should see')):
            resp = client.post(f'/api/dataact/{crm_lookup_action}/test', headers=auth_headers, json={'ani': '555-0100'})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['status'] == 'Failing'
        assert 'boom' not in body['last_error']
        assert 'internal detail' not in body['last_error']


class TestNeverFakeSuccessAndScoping:
    def test_not_connected_reports_not_connected_not_a_fake_success(self, client, auth_headers, installed_salesforce, crm_lookup_action):
        """Salesforce CTI installed but never OAuth-connected — must be a
        real, honest failure, never a silent fall-through to simulation."""
        resp = client.post(f'/api/dataact/{crm_lookup_action}/test', headers=auth_headers, json={'ani': '555-0100'})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['status'] == 'Failing'
        assert 'not connected' in body['last_error'].lower()

    def test_salesforce_not_installed_is_a_controlled_failure_not_fake_success(self, client, auth_headers, crm_lookup_action):
        """No 'Salesforce CTI' installed_integrations row at all for this
        tenant (no installed_salesforce fixture used here). This must be a
        real, honest 'not installed' failure — CRM_Lookup_Customer/Salesforce
        never falls back to _simulate_test's fake 'Published' result, which
        would otherwise look like a working integration when none exists."""
        with patch.object(sf, 'soql_query') as mocked:
            resp = client.post(f'/api/dataact/{crm_lookup_action}/test', headers=auth_headers, json={'ani': '555-0100'})
        assert resp.status_code == 200
        mocked.assert_not_called()
        body = resp.get_json()
        assert body['status'] == 'Failing'
        assert 'not installed' in body['last_error'].lower()

    def test_other_salesforce_action_still_simulated_even_when_connected(self, client, auth_headers, connected_salesforce, other_action):
        """CRM_Create_Case is also integration='Salesforce' but is not
        SALESFORCE_REAL_ACTION_ID — Phase 1 is scoped to one action."""
        with patch.object(sf, 'soql_query') as mocked:
            resp = client.post(f'/api/dataact/{other_action}/test', headers=auth_headers, json={})
        assert resp.status_code == 200
        mocked.assert_not_called()

    def test_existing_non_salesforce_action_untouched(self, client, auth_headers, db_conn, tenant_id):
        """A plain 'Web Services' action must behave exactly as before —
        no Phase 1 code path involved at all."""
        resp = client.post('/api/dataact', headers=auth_headers, json={
            'name': 'Untouched_Web_Service', 'integration': 'Web Services', 'method': 'GET',
            'endpoint': 'https://api.example.com/x', 'contract': 'id → name',
        })
        assert resp.status_code == 201, resp.get_json()
        action_id = resp.get_json()['id']
        try:
            with patch.object(sf, 'soql_query') as mocked:
                test_resp = client.post(f'/api/dataact/{action_id}/test', headers=auth_headers)
            assert test_resp.status_code == 200
            mocked.assert_not_called()
        finally:
            client.delete(f'/api/dataact/{action_id}', headers=auth_headers)
