"""
Tests for Integrations Phase 1's Salesforce OAuth flow (salesforce_oauth.py)
and its low-level HTTP client (salesforce_client.py).

Same approach as the other CRUD test files: runs against the REAL
development PostgreSQL database via Flask's test client against the real
`app`, inside a dedicated disposable test tenant torn down at the end of
the session.

One deliberate departure from every other test file in this repo: no test
file here mocks an outbound HTTP call, because until this feature none of
them made one for real (dataact.py/botconnectors.py's "Test"/"Connect"
have always been pure deterministic simulations — see their own module
docstrings). salesforce_client.exchange_code_for_token/refresh_access_token/
revoke_token/soql_query are the first genuinely real outbound calls in the
Integrations surface, and there is no live Salesforce sandbox reachable
from CI/this environment, so those four functions are monkeypatched at
the salesforce_oauth module level for the tests that exercise success/
failure branches. Everything else here — state validation, encryption at
rest, tenant isolation, the DB writes themselves — hits the real database,
matching the rest of this codebase's "prefer a real deterministic path
over a mock" preference wherever a mock genuinely isn't required.
"""

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet
from werkzeug.security import generate_password_hash

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app as flask_app  # noqa: E402
from db import get_db  # noqa: E402
import config  # noqa: E402
import salesforce_client as sf  # noqa: E402
import salesforce_oauth as sfo  # noqa: E402


@pytest.fixture(scope='session', autouse=True)
def salesforce_config():
    """Fake-but-structurally-valid config for the whole session — every
    test that needs a real Salesforce account is either skipped or mocks
    salesforce_client directly instead of actually reaching Salesforce."""
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
def client():
    flask_app.config['TESTING'] = True
    return flask_app.test_client()


def _make_tenant(db_conn, label):
    cur = db_conn.cursor()
    name = f'__pytest_sfoauth_{label}_{uuid.uuid4().hex[:8]}__'
    cur.execute('INSERT INTO tenants (name) VALUES (%s) RETURNING id', (name,))
    tid = cur.fetchone()['id']
    email = f'sfoauth-{label}-{uuid.uuid4().hex[:8]}@example.test'
    cur.execute(
        'INSERT INTO users (tenant_id, name, email, password_hash, state) '
        'VALUES (%s,%s,%s,%s,%s) RETURNING id',
        (tid, f'Pytest {label}', email, generate_password_hash('pytest-password-123'), 'Active'),
    )
    db_conn.commit()
    return tid, email


def _login(client, email):
    resp = client.post('/api/auth/login', json={'email': email, 'password': 'pytest-password-123'})
    assert resp.status_code == 200, resp.get_json()
    return {'Authorization': f'Bearer {resp.get_json()["token"]}'}


@pytest.fixture(scope='session')
def tenant_id(db_conn):
    tid, _ = _make_tenant(db_conn, 'main')
    yield tid
    db_conn.cursor().execute('DELETE FROM tenants WHERE id = %s', (tid,))
    db_conn.commit()


@pytest.fixture(scope='session')
def auth_headers(client, db_conn, tenant_id):
    cur = db_conn.cursor()
    cur.execute('SELECT email FROM users WHERE tenant_id = %s', (tenant_id,))
    return _login(client, cur.fetchone()['email'])


@pytest.fixture(scope='session')
def other_tenant_id(db_conn):
    tid, _ = _make_tenant(db_conn, 'other')
    yield tid
    db_conn.cursor().execute('DELETE FROM tenants WHERE id = %s', (tid,))
    db_conn.commit()


@pytest.fixture(scope='session')
def other_headers(client, db_conn, other_tenant_id):
    cur = db_conn.cursor()
    cur.execute('SELECT email FROM users WHERE tenant_id = %s', (other_tenant_id,))
    return _login(client, cur.fetchone()['email'])


@pytest.fixture
def installed_integration(db_conn, tenant_id):
    """A fresh 'Salesforce CTI' installed_integrations row per test, so
    each test's salesforce_connections rows start from a clean slate."""
    cur = db_conn.cursor()
    cur.execute(
        "INSERT INTO installed_integrations (tenant_id, name, category, type, status) "
        "VALUES (%s, 'Salesforce CTI', 'CRM', 'Client application', 'Active') RETURNING id",
        (tenant_id,),
    )
    iid = cur.fetchone()['id']
    db_conn.commit()
    yield iid
    cur.execute('DELETE FROM installed_integrations WHERE id = %s', (iid,))
    db_conn.commit()


TOKEN_RESPONSE = {
    'access_token': 'fake-access-token-abc',
    'refresh_token': 'fake-refresh-token-xyz',
    'instance_url': 'https://example.my.salesforce.com',
    'token_type': 'Bearer',
    'scope': 'api refresh_token',
    'id': 'https://login.salesforce.com/id/00D.../005...',
    'issued_at': '1700000000000',
    'signature': 'abc123==',
}


class TestAuthorizeUrl:
    def test_generates_real_looking_url(self, client, auth_headers, installed_integration):
        resp = client.post('/api/integrations/salesforce/oauth/authorize-url', headers=auth_headers,
                            json={'installed_integration_id': installed_integration, 'redirect_uri': 'http://x/y'})
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        assert body['ok'] is True
        url = body['authorize_url']
        assert url.startswith('https://login.salesforce.com/services/oauth2/authorize?')
        assert 'response_type=code' in url
        assert 'client_id=test_client_id' in url
        assert 'state=' in url
        assert 'scope=api' in url

    def test_marks_connecting(self, client, auth_headers, db_conn, tenant_id, installed_integration):
        client.post('/api/integrations/salesforce/oauth/authorize-url', headers=auth_headers,
                    json={'installed_integration_id': installed_integration})
        status = client.get(f'/api/integrations/salesforce/oauth/status/{installed_integration}', headers=auth_headers)
        assert status.get_json()['connection_status'] == 'Connecting'

    def test_requires_installed_integration_id(self, client, auth_headers):
        resp = client.post('/api/integrations/salesforce/oauth/authorize-url', headers=auth_headers, json={})
        assert resp.status_code == 400

    def test_unknown_integration_404(self, client, auth_headers):
        resp = client.post('/api/integrations/salesforce/oauth/authorize-url', headers=auth_headers,
                            json={'installed_integration_id': 999999999})
        assert resp.status_code == 404

    def test_requires_auth(self, client, installed_integration):
        resp = client.post('/api/integrations/salesforce/oauth/authorize-url', json={'installed_integration_id': installed_integration})
        assert resp.status_code == 401

    def test_missing_config_returns_clean_500(self, client, auth_headers, installed_integration):
        original = config.SALESFORCE_CLIENT_ID
        config.SALESFORCE_CLIENT_ID = None
        try:
            resp = client.post('/api/integrations/salesforce/oauth/authorize-url', headers=auth_headers,
                                json={'installed_integration_id': installed_integration})
            assert resp.status_code == 500
            assert 'OG_SALESFORCE_CLIENT_ID' in resp.get_json()['error']
        finally:
            config.SALESFORCE_CLIENT_ID = original

    def test_cross_tenant_cannot_generate_for_others_integration(self, client, other_headers, installed_integration):
        resp = client.post('/api/integrations/salesforce/oauth/authorize-url', headers=other_headers,
                            json={'installed_integration_id': installed_integration})
        assert resp.status_code == 404


class TestCallback:
    def _begin(self, client, auth_headers, installed_integration, redirect_uri='http://frontend.example/integrations'):
        resp = client.post('/api/integrations/salesforce/oauth/authorize-url', headers=auth_headers,
                            json={'installed_integration_id': installed_integration, 'redirect_uri': redirect_uri})
        url = resp.get_json()['authorize_url']
        state = url.split('state=')[1].split('&')[0]
        return state

    def test_invalid_state_rejected(self, client):
        resp = client.get('/api/integrations/salesforce/oauth/callback?code=abc&state=not-a-real-state')
        assert resp.status_code == 400
        assert 'state' in resp.get_json()['error']

    def test_no_bearer_token_required(self, client):
        """The callback route must be public — Salesforce redirects the
        bare browser here with no way to attach our Authorization header."""
        resp = client.get('/api/integrations/salesforce/oauth/callback?code=abc&state=nope')
        assert resp.status_code != 401

    def test_idp_error_param_fails_cleanly(self, client, auth_headers, installed_integration):
        state = self._begin(client, auth_headers, installed_integration)
        resp = client.get(f'/api/integrations/salesforce/oauth/callback?error=access_denied&state={state}')
        assert resp.status_code == 302
        assert 'salesforce=failed' in resp.headers['Location']

    def test_missing_code_fails_cleanly(self, client, auth_headers, installed_integration):
        state = self._begin(client, auth_headers, installed_integration)
        resp = client.get(f'/api/integrations/salesforce/oauth/callback?state={state}')
        assert resp.status_code == 302
        assert 'salesforce=failed' in resp.headers['Location']

    def test_state_is_single_use(self, client, auth_headers, installed_integration):
        state = self._begin(client, auth_headers, installed_integration)
        with patch.object(sf, 'exchange_code_for_token', return_value=dict(TOKEN_RESPONSE)):
            first = client.get(f'/api/integrations/salesforce/oauth/callback?code=abc&state={state}')
            assert first.status_code == 302
        second = client.get(f'/api/integrations/salesforce/oauth/callback?code=abc&state={state}')
        assert second.status_code == 400

    def test_successful_exchange_connects_and_redirects(self, client, auth_headers, db_conn, tenant_id, installed_integration):
        state = self._begin(client, auth_headers, installed_integration, redirect_uri='http://frontend.example/int?tab=installed')
        with patch.object(sf, 'exchange_code_for_token', return_value=dict(TOKEN_RESPONSE)) as mocked:
            resp = client.get(f'/api/integrations/salesforce/oauth/callback?code=real-code-123&state={state}')
        assert resp.status_code == 302
        assert resp.headers['Location'].startswith('http://frontend.example/int?tab=installed&')
        assert 'salesforce=connected' in resp.headers['Location']
        mocked.assert_called_once()

        status = client.get(f'/api/integrations/salesforce/oauth/status/{installed_integration}', headers=auth_headers)
        body = status.get_json()
        assert body['connection_status'] == 'Connected'
        assert body['connected_at'] is not None

    def test_successful_exchange_encrypts_tokens_at_rest(self, client, auth_headers, db_conn, tenant_id, installed_integration):
        state = self._begin(client, auth_headers, installed_integration)
        with patch.object(sf, 'exchange_code_for_token', return_value=dict(TOKEN_RESPONSE)):
            client.get(f'/api/integrations/salesforce/oauth/callback?code=abc&state={state}')

        cur = db_conn.cursor()
        cur.execute(
            'SELECT access_token_encrypted, refresh_token_encrypted FROM salesforce_connections '
            'WHERE installed_integration_id = %s', (installed_integration,),
        )
        row = cur.fetchone()
        assert row['access_token_encrypted'] is not None
        assert 'fake-access-token-abc' not in row['access_token_encrypted']
        assert row['refresh_token_encrypted'] is not None
        assert 'fake-refresh-token-xyz' not in row['refresh_token_encrypted']
        assert sfo._decrypt(row['access_token_encrypted']) == 'fake-access-token-abc'

    def test_exchange_failure_marks_authentication_failed(self, client, auth_headers, installed_integration):
        state = self._begin(client, auth_headers, installed_integration)
        with patch.object(sf, 'exchange_code_for_token', side_effect=sf.SalesforceAuthError('invalid_grant')):
            resp = client.get(f'/api/integrations/salesforce/oauth/callback?code=bad-code&state={state}')
        assert resp.status_code == 302
        assert 'salesforce=failed' in resp.headers['Location']

        status = client.get(f'/api/integrations/salesforce/oauth/status/{installed_integration}', headers=auth_headers)
        body = status.get_json()
        assert body['connection_status'] == 'Authentication Failed'
        assert 'invalid_grant' in body['last_error']

    def test_response_missing_access_token_fails_cleanly(self, client, auth_headers, installed_integration):
        state = self._begin(client, auth_headers, installed_integration)
        with patch.object(sf, 'exchange_code_for_token', return_value={'instance_url': 'https://x.my.salesforce.com'}):
            resp = client.get(f'/api/integrations/salesforce/oauth/callback?code=abc&state={state}')
        assert resp.status_code == 302
        assert 'salesforce=failed' in resp.headers['Location']


class TestDisconnect:
    def _connect(self, client, auth_headers, installed_integration):
        auth_resp = client.post('/api/integrations/salesforce/oauth/authorize-url', headers=auth_headers,
                                 json={'installed_integration_id': installed_integration})
        state = auth_resp.get_json()['authorize_url'].split('state=')[1].split('&')[0]
        with patch.object(sf, 'exchange_code_for_token', return_value=dict(TOKEN_RESPONSE)):
            client.get(f'/api/integrations/salesforce/oauth/callback?code=abc&state={state}')

    def test_disconnect_clears_tokens_and_revokes(self, client, auth_headers, db_conn, installed_integration):
        self._connect(client, auth_headers, installed_integration)
        with patch.object(sf, 'revoke_token') as mocked_revoke:
            resp = client.post('/api/integrations/salesforce/oauth/disconnect', headers=auth_headers,
                                json={'installed_integration_id': installed_integration})
        assert resp.status_code == 200
        assert resp.get_json()['connection_status'] == 'Disconnected'
        mocked_revoke.assert_called_once()

        cur = db_conn.cursor()
        cur.execute('SELECT access_token_encrypted, connection_status FROM salesforce_connections '
                    'WHERE installed_integration_id = %s', (installed_integration,))
        row = cur.fetchone()
        assert row['access_token_encrypted'] is None
        assert row['connection_status'] == 'Disconnected'

    def test_disconnect_survives_revoke_failure(self, client, auth_headers, installed_integration):
        """Revocation is best-effort — Salesforce being unreachable must
        not block a local disconnect."""
        self._connect(client, auth_headers, installed_integration)
        with patch.object(sf, 'revoke_token', side_effect=sf.SalesforceNetworkError('unreachable')):
            resp = client.post('/api/integrations/salesforce/oauth/disconnect', headers=auth_headers,
                                json={'installed_integration_id': installed_integration})
        assert resp.status_code == 200
        assert resp.get_json()['connection_status'] == 'Disconnected'

    def test_disconnect_not_connected_404(self, client, auth_headers, installed_integration):
        resp = client.post('/api/integrations/salesforce/oauth/disconnect', headers=auth_headers,
                            json={'installed_integration_id': installed_integration})
        assert resp.status_code == 404

    def test_cross_tenant_cannot_disconnect(self, client, other_headers, auth_headers, installed_integration):
        self._connect(client, auth_headers, installed_integration)
        resp = client.post('/api/integrations/salesforce/oauth/disconnect', headers=other_headers,
                            json={'installed_integration_id': installed_integration})
        assert resp.status_code == 404


class TestTestConnection:
    def _connect(self, client, auth_headers, installed_integration):
        auth_resp = client.post('/api/integrations/salesforce/oauth/authorize-url', headers=auth_headers,
                                 json={'installed_integration_id': installed_integration})
        state = auth_resp.get_json()['authorize_url'].split('state=')[1].split('&')[0]
        with patch.object(sf, 'exchange_code_for_token', return_value=dict(TOKEN_RESPONSE)):
            client.get(f'/api/integrations/salesforce/oauth/callback?code=abc&state={state}')

    def test_not_connected_returns_409(self, client, auth_headers, installed_integration):
        resp = client.post('/api/integrations/salesforce/oauth/test', headers=auth_headers,
                            json={'installed_integration_id': installed_integration})
        assert resp.status_code == 409

    def test_successful_call_stays_connected(self, client, auth_headers, installed_integration):
        self._connect(client, auth_headers, installed_integration)
        with patch.object(sf, 'soql_query', return_value={'records': [{'Id': '001xx'}]}):
            resp = client.post('/api/integrations/salesforce/oauth/test', headers=auth_headers,
                                json={'installed_integration_id': installed_integration})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['connection_status'] == 'Connected'
        assert body['verified'] is True

    def test_auth_error_marks_token_expired(self, client, auth_headers, installed_integration):
        self._connect(client, auth_headers, installed_integration)
        with patch.object(sf, 'soql_query', side_effect=sf.SalesforceAuthError('Session expired or invalid')):
            resp = client.post('/api/integrations/salesforce/oauth/test', headers=auth_headers,
                                json={'installed_integration_id': installed_integration})
        assert resp.status_code == 401
        assert resp.get_json()['connection_status'] == 'Token Expired'
        # Never leaks a token or a raw exception into the response.
        assert 'fake-access-token' not in str(resp.get_json())

    def test_server_error_marks_authentication_failed(self, client, auth_headers, installed_integration):
        self._connect(client, auth_headers, installed_integration)
        with patch.object(sf, 'soql_query', side_effect=sf.SalesforceServerError('internal error')):
            resp = client.post('/api/integrations/salesforce/oauth/test', headers=auth_headers,
                                json={'installed_integration_id': installed_integration})
        assert resp.status_code == 502


class TestGetValidAccessToken:
    """Direct unit-style coverage of the refresh logic, since it's the one
    function dataact.py imports and depends on behaving correctly."""

    def _connect(self, client, auth_headers, installed_integration):
        auth_resp = client.post('/api/integrations/salesforce/oauth/authorize-url', headers=auth_headers,
                                 json={'installed_integration_id': installed_integration})
        state = auth_resp.get_json()['authorize_url'].split('state=')[1].split('&')[0]
        with patch.object(sf, 'exchange_code_for_token', return_value=dict(TOKEN_RESPONSE)):
            client.get(f'/api/integrations/salesforce/oauth/callback?code=abc&state={state}')

    def test_not_connected_raises(self, db_conn, tenant_id, installed_integration):
        cur = db_conn.cursor()
        with pytest.raises(sfo.SalesforceNotConnectedError):
            sfo.get_valid_access_token(cur, tenant_id, installed_integration)

    def test_valid_token_returned_without_refresh(self, client, auth_headers, db_conn, tenant_id, installed_integration):
        self._connect(client, auth_headers, installed_integration)
        cur = db_conn.cursor()
        with patch.object(sf, 'refresh_access_token') as mocked_refresh:
            instance_url, access_token = sfo.get_valid_access_token(cur, tenant_id, installed_integration)
        mocked_refresh.assert_not_called()
        assert instance_url == 'https://example.my.salesforce.com'
        assert access_token == 'fake-access-token-abc'

    def test_expired_token_is_refreshed(self, client, auth_headers, db_conn, tenant_id, installed_integration):
        self._connect(client, auth_headers, installed_integration)
        cur = db_conn.cursor()
        cur.execute(
            "UPDATE salesforce_connections SET expires_at = %s WHERE installed_integration_id = %s",
            (datetime.now(timezone.utc) - timedelta(minutes=5), installed_integration),
        )
        db_conn.commit()
        with patch.object(sf, 'refresh_access_token', return_value={
            'access_token': 'refreshed-token-999', 'instance_url': 'https://example.my.salesforce.com',
        }) as mocked_refresh:
            instance_url, access_token = sfo.get_valid_access_token(cur, tenant_id, installed_integration)
        mocked_refresh.assert_called_once()
        assert access_token == 'refreshed-token-999'

    def test_refresh_failure_marks_token_expired(self, client, auth_headers, db_conn, tenant_id, installed_integration):
        self._connect(client, auth_headers, installed_integration)
        cur = db_conn.cursor()
        cur.execute(
            "UPDATE salesforce_connections SET expires_at = %s WHERE installed_integration_id = %s",
            (datetime.now(timezone.utc) - timedelta(minutes=5), installed_integration),
        )
        db_conn.commit()
        with patch.object(sf, 'refresh_access_token', side_effect=sf.SalesforceAuthError('invalid_grant')):
            with pytest.raises(sf.SalesforceAuthError):
                sfo.get_valid_access_token(cur, tenant_id, installed_integration)

        cur.execute('SELECT connection_status FROM salesforce_connections WHERE installed_integration_id = %s',
                    (installed_integration,))
        assert cur.fetchone()['connection_status'] == 'Token Expired'

    def test_no_refresh_token_raises_not_connected(self, client, auth_headers, db_conn, tenant_id, installed_integration):
        self._connect(client, auth_headers, installed_integration)
        cur = db_conn.cursor()
        cur.execute(
            "UPDATE salesforce_connections SET expires_at = %s, refresh_token_encrypted = NULL "
            "WHERE installed_integration_id = %s",
            (datetime.now(timezone.utc) - timedelta(minutes=5), installed_integration),
        )
        db_conn.commit()
        with pytest.raises(sfo.SalesforceNotConnectedError):
            sfo.get_valid_access_token(cur, tenant_id, installed_integration)


class TestSalesforceClientErrorMapping:
    """Unit tests for salesforce_client.py's HTTP-error-to-exception
    mapping — no Flask/DB involved, just urllib.error.HTTPError shapes."""

    def _http_error(self, code, body=b'{"error_description": "boom"}'):
        import io
        import urllib.error
        return urllib.error.HTTPError('http://x', code, 'msg', {}, io.BytesIO(body))

    def test_401_maps_to_auth_error(self):
        with patch('urllib.request.urlopen', side_effect=self._http_error(401)):
            with pytest.raises(sf.SalesforceAuthError):
                sf.soql_query('https://x.my.salesforce.com', 'tok', 'SELECT Id FROM Account')

    def test_403_maps_to_forbidden(self):
        with patch('urllib.request.urlopen', side_effect=self._http_error(403)):
            with pytest.raises(sf.SalesforceForbiddenError):
                sf.soql_query('https://x.my.salesforce.com', 'tok', 'SELECT Id FROM Account')

    def test_404_maps_to_not_found(self):
        with patch('urllib.request.urlopen', side_effect=self._http_error(404)):
            with pytest.raises(sf.SalesforceNotFoundError):
                sf.soql_query('https://x.my.salesforce.com', 'tok', 'SELECT Id FROM Account')

    def test_429_maps_to_rate_limit(self):
        with patch('urllib.request.urlopen', side_effect=self._http_error(429)):
            with pytest.raises(sf.SalesforceRateLimitError):
                sf.soql_query('https://x.my.salesforce.com', 'tok', 'SELECT Id FROM Account')

    def test_500_maps_to_server_error(self):
        with patch('urllib.request.urlopen', side_effect=self._http_error(500)):
            with pytest.raises(sf.SalesforceServerError):
                sf.soql_query('https://x.my.salesforce.com', 'tok', 'SELECT Id FROM Account')

    def test_timeout_maps_to_timeout_error(self):
        import socket
        with patch('urllib.request.urlopen', side_effect=socket.timeout()):
            with pytest.raises(sf.SalesforceTimeoutError):
                sf.soql_query('https://x.my.salesforce.com', 'tok', 'SELECT Id FROM Account')

    def test_network_error_maps_to_network_error(self):
        import urllib.error
        with patch('urllib.request.urlopen', side_effect=urllib.error.URLError('no route to host')):
            with pytest.raises(sf.SalesforceNetworkError):
                sf.soql_query('https://x.my.salesforce.com', 'tok', 'SELECT Id FROM Account')

    def test_invalid_json_maps_to_response_error(self):
        import io
        class FakeResp:
            def read(self):
                return b'not json at all'
        with patch('urllib.request.urlopen', return_value=FakeResp()):
            with pytest.raises(sf.SalesforceResponseError):
                sf.soql_query('https://x.my.salesforce.com', 'tok', 'SELECT Id FROM Account')

    def test_error_message_never_includes_the_token(self):
        with patch('urllib.request.urlopen', side_effect=self._http_error(401, b'{"error_description": "bad token: super-secret-value-xyz"}')):
            try:
                sf.soql_query('https://x.my.salesforce.com', 'a-real-secret-access-token', 'SELECT Id FROM Account')
                assert False, 'expected SalesforceAuthError'
            except sf.SalesforceAuthError as e:
                # The exception carries Salesforce's own error_description,
                # never the access_token we sent — that value is only ever
                # used in the Authorization header, never echoed back here.
                assert 'a-real-secret-access-token' not in str(e)
