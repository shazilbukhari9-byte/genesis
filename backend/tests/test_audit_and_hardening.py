"""
Regression tests for the production-hardening fixes applied to the
Integrations feature area.

Covers three things that previously had no coverage:

  1. audit_log tenant scoping. Every Integrations write (catalogue install,
     data-action create/update/delete/test, bot-connector changes) records an
     audit row. audit_log had no tenant_id and GET /api/subscription/audit
     returned the newest 200 rows unfiltered, so any signed-in user of any
     tenant could read every other tenant's integration names, data-action
     names and bot-connector names.

  2. Pagination parsing. A non-numeric ?limit=/?offset= raised straight out of
     int() and surfaced as a generic 500; negatives were passed to Postgres.

  3. Connection teardown. Routes close their connection inline with no
     try/finally, so an exception between get_db() and close() leaked it.

Same conventions as the other suites in this directory: real development
PostgreSQL, real Flask app and auth guard, two disposable tenants that are
dropped at the end (their ON DELETE CASCADE FKs clean up everything).
"""

import os
import sys
import uuid

import pytest
from werkzeug.security import generate_password_hash

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app as flask_app  # noqa: E402
from db import get_db  # noqa: E402

PASSWORD = 'pytest-password-123'


@pytest.fixture(scope='module')
def db_conn():
    conn = get_db()
    yield conn
    conn.close()


@pytest.fixture(scope='module')
def client():
    flask_app.config['TESTING'] = True
    return flask_app.test_client()


def _make_tenant(db_conn, client, label):
    """A disposable tenant with a real user and a real login token."""
    cur = db_conn.cursor()
    cur.execute('INSERT INTO tenants (name) VALUES (%s) RETURNING id',
                (f'__pytest_audit_{label}_{uuid.uuid4().hex[:8]}__',))
    tid = cur.fetchone()['id']
    email = f'pytest-audit-{uuid.uuid4().hex[:8]}@example.test'
    cur.execute(
        'INSERT INTO users (tenant_id, name, email, password_hash, state) '
        'VALUES (%s, %s, %s, %s, %s)',
        (tid, 'Pytest Audit User', email, generate_password_hash(PASSWORD), 'Active'),
    )
    db_conn.commit()
    resp = client.post('/api/auth/login', json={'email': email, 'password': PASSWORD})
    assert resp.status_code == 200, resp.get_json()
    return tid, {'Authorization': f"Bearer {resp.get_json()['token']}"}


@pytest.fixture(scope='module')
def tenants(db_conn, client):
    a = _make_tenant(db_conn, client, 'A')
    b = _make_tenant(db_conn, client, 'B')
    yield {'a_id': a[0], 'a_headers': a[1], 'b_id': b[0], 'b_headers': b[1]}
    cur = db_conn.cursor()
    cur.execute('DELETE FROM tenants WHERE id IN (%s, %s)', (a[0], b[0]))
    db_conn.commit()


# ---------------------------------------------------------------------
# 1. audit_log tenant isolation
# ---------------------------------------------------------------------

class TestAuditLogTenantIsolation:
    MARKER_A = '__pytest_audit_marker_A__'
    MARKER_B = '__pytest_audit_marker_B__'

    def test_schema_has_tenant_column(self, db_conn):
        cur = db_conn.cursor()
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'audit_log' AND column_name = 'tenant_id'"
        )
        assert cur.fetchone() is not None, 'audit_log.tenant_id is missing'

    def test_writes_record_the_acting_tenant(self, client, db_conn, tenants):
        for headers, marker in ((tenants['a_headers'], self.MARKER_A),
                                (tenants['b_headers'], self.MARKER_B)):
            resp = client.post('/api/dataact', headers=headers, json={
                'name': marker, 'endpoint': '/audit-test',
                'integration': 'Web Services', 'method': 'GET',
            })
            assert resp.status_code == 201, resp.get_json()

        cur = db_conn.cursor()
        cur.execute('SELECT tenant_id FROM audit_log WHERE detail = %s', (self.MARKER_A,))
        rows = cur.fetchall()
        assert rows, 'no audit row written for the create'
        assert all(str(r['tenant_id']) == str(tenants['a_id']) for r in rows)

    def test_each_tenant_sees_only_its_own_audit_rows(self, client, tenants):
        a = client.get('/api/subscription/audit', headers=tenants['a_headers'])
        b = client.get('/api/subscription/audit', headers=tenants['b_headers'])
        assert a.status_code == 200 and b.status_code == 200

        details_a = ' '.join(str(r.get('detail', '')) for r in a.get_json())
        details_b = ' '.join(str(r.get('detail', '')) for r in b.get_json())

        assert self.MARKER_A in details_a
        assert self.MARKER_B in details_b
        # The actual leak: B's activity must not be visible to A.
        assert self.MARKER_B not in details_a
        assert self.MARKER_A not in details_b

    def test_audit_rows_returned_all_belong_to_the_caller(self, client, tenants):
        resp = client.get('/api/subscription/audit', headers=tenants['a_headers'])
        rows = resp.get_json()
        assert rows, 'expected at least one audit row'
        assert all(str(r['tenant_id']) == str(tenants['a_id']) for r in rows)

    def test_audit_post_is_tenant_scoped(self, client, tenants):
        marker = f'__pytest_post_{uuid.uuid4().hex[:8]}__'
        resp = client.post('/api/subscription/audit', headers=tenants['a_headers'],
                           json={'action': 'Pytest action', 'detail': marker})
        assert resp.status_code == 201, resp.get_json()
        assert str(resp.get_json()['tenant_id']) == str(tenants['a_id'])

        other = client.get('/api/subscription/audit', headers=tenants['b_headers'])
        assert marker not in ' '.join(str(r.get('detail', '')) for r in other.get_json())

    def test_audit_requires_auth(self, client):
        assert client.get('/api/subscription/audit').status_code == 401


# ---------------------------------------------------------------------
# 2. Pagination parsing
# ---------------------------------------------------------------------

class TestPaginationParsing:
    @pytest.mark.parametrize('query', ['?limit=abc', '?offset=xyz', '?limit=', '?limit=1.5'])
    def test_malformed_pagination_is_400_not_500(self, client, tenants, query):
        resp = client.get('/api/installed-integrations' + query, headers=tenants['a_headers'])
        assert resp.status_code == 400, (query, resp.status_code, resp.get_json())
        assert 'integer' in resp.get_json()['error'].lower()

    def test_malformed_limit_on_runs_is_400(self, client, tenants):
        resp = client.get('/api/dataact/runs?limit=abc', headers=tenants['a_headers'])
        assert resp.status_code == 400, resp.get_json()

    @pytest.mark.parametrize('query', ['?limit=5', '?limit=-1', '?offset=-3', '?limit=0'])
    def test_valid_and_negative_pagination_still_returns_a_list(self, client, tenants, query):
        resp = client.get('/api/installed-integrations' + query, headers=tenants['a_headers'])
        assert resp.status_code == 200, (query, resp.get_json())
        assert isinstance(resp.get_json(), list)

    def test_limit_is_respected(self, client, tenants):
        for i in range(3):
            client.post('/api/installed-integrations', headers=tenants['a_headers'],
                        json={'name': f'__pytest_page_{i}__'})
        resp = client.get('/api/installed-integrations?limit=2', headers=tenants['a_headers'])
        assert resp.status_code == 200
        assert len(resp.get_json()) <= 2


# ---------------------------------------------------------------------
# 3. Connection teardown
# ---------------------------------------------------------------------

class TestConnectionTeardown:
    def _open_connections(self, db_conn):
        cur = db_conn.cursor()
        cur.execute(
            'SELECT count(*) AS c FROM pg_stat_activity '
            'WHERE datname = current_database() AND state IS NOT NULL'
        )
        return cur.fetchone()['c']

    def test_failing_requests_do_not_leak_connections(self, client, db_conn, tenants):
        """Routes that return early or raise skip their own conn.close();
        the teardown handler registered in app.py has to catch those."""
        baseline = self._open_connections(db_conn)
        for _ in range(30):
            client.get('/api/installed-integrations/99999999', headers=tenants['a_headers'])
        for _ in range(15):
            client.post('/api/dataact', headers=tenants['a_headers'], json={'name': ''})
        for _ in range(15):
            client.get('/api/installed-integrations?limit=abc', headers=tenants['a_headers'])
        after = self._open_connections(db_conn)
        assert after <= baseline + 5, f'connections grew {baseline} -> {after}'

    def test_backend_still_healthy_after_the_burst(self, client, tenants):
        resp = client.get('/api/installed-integrations', headers=tenants['a_headers'])
        assert resp.status_code == 200
        assert isinstance(resp.get_json(), list)
