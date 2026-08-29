"""
CRUD and queue-assignment tests for Admin > Contact Center > Scripts.

Scripts itself is a plain generic-resource-registry entity (see
resources.py) — no dedicated blueprint — so most of its CRUD behavior is
already covered indirectly by whichever entity's tests exercise that
shared code path first. This suite instead focuses on what's actually
specific to Scripts: the `content` jsonb canvas column, and the
script <-> queue "default on queues" assignment (PUT /api/queues/<id>/script
and GET /api/scripts/<id>/queues), including the delete-time cleanup that
clears a queue's reference to a script that no longer exists.

Same approach as the other suites: real dev PostgreSQL via Flask's test
client against the real `app`, inside a disposable test tenant that is
dropped at the end (cascading through tenant_id FKs), so the seeded demo
data is never touched. Assertions that matter read PostgreSQL directly
rather than trusting the API's own response.
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


def _make_tenant(db_conn, label):
    cur = db_conn.cursor()
    cur.execute('INSERT INTO tenants (name) VALUES (%s) RETURNING id',
                (f'__pytest_{label}_{uuid.uuid4().hex[:8]}__',))
    tid = cur.fetchone()['id']
    email = f'{label}-{uuid.uuid4().hex[:8]}@example.test'
    cur.execute(
        'INSERT INTO users (tenant_id, name, email, password_hash, state) VALUES (%s,%s,%s,%s,%s)',
        (tid, 'Pytest Scripts User', email, generate_password_hash('pytest-password-123'), 'Active'),
    )
    db_conn.commit()
    return tid, email


@pytest.fixture(scope='session')
def client():
    flask_app.config['TESTING'] = True
    return flask_app.test_client()


def _login(client, email):
    resp = client.post('/api/auth/login', json={'email': email, 'password': 'pytest-password-123'})
    assert resp.status_code == 200, resp.get_json()
    return {'Authorization': f'Bearer {resp.get_json()["token"]}'}


@pytest.fixture(scope='session')
def tenant_id(db_conn):
    tid, email = _make_tenant(db_conn, 'scripts')
    pytest.scripts_tenant_email = email
    yield tid
    cur = db_conn.cursor()
    cur.execute('DELETE FROM tenants WHERE id = %s', (tid,))
    db_conn.commit()


@pytest.fixture(scope='session')
def auth_headers(client, tenant_id):
    return _login(client, pytest.scripts_tenant_email)


@pytest.fixture(scope='session')
def other_headers(client, db_conn):
    tid, email = _make_tenant(db_conn, 'scriptsother')
    yield _login(client, email)
    cur = db_conn.cursor()
    cur.execute('DELETE FROM tenants WHERE id = %s', (tid,))
    db_conn.commit()


def _create_script(client, headers, **kw):
    payload = {'name': 'Script', 'type': 'Inbound', 'published': False}
    payload.update(kw)
    return client.post('/api/scripts', headers=headers, json=payload)


def _create_queue(client, headers, **kw):
    payload = {'name': 'Queue', 'max_wait_s': 60}
    payload.update(kw)
    return client.post('/api/queues', headers=headers, json=payload)


class TestScriptContent:
    def test_create_with_content(self, client, auth_headers, db_conn, tenant_id):
        content = {'pages': ['1. Greeting'], 'comps': {'1': [['text', 'c1', 'Greeting', 'Hi there']]}, 'vars': []}
        resp = _create_script(client, auth_headers, name='Content Script', content=content)
        assert resp.status_code == 201, resp.get_json()
        body = resp.get_json()
        assert body['content'] == content
        pytest.content_script_id = body['id']

        cur = db_conn.cursor()
        cur.execute('SELECT content, tenant_id FROM scripts WHERE id = %s', (body['id'],))
        row = cur.fetchone()
        assert row['content'] == content
        assert str(row['tenant_id']) == str(tenant_id)

    def test_create_without_content_defaults_empty(self, client, auth_headers, db_conn):
        resp = _create_script(client, auth_headers, name='No Content Script')
        assert resp.status_code == 201
        cur = db_conn.cursor()
        cur.execute('SELECT content FROM scripts WHERE id = %s', (resp.get_json()['id'],))
        assert cur.fetchone()['content'] == {}

    def test_update_content_round_trips(self, client, auth_headers, db_conn):
        new_content = {'pages': ['1. Greeting', '2. Follow-up'], 'comps': {}, 'vars': [['X', 'Input', 'string']]}
        resp = client.put(f'/api/scripts/{pytest.content_script_id}', headers=auth_headers,
                           json={'content': new_content})
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()['content'] == new_content

        cur = db_conn.cursor()
        cur.execute('SELECT content, name FROM scripts WHERE id = %s', (pytest.content_script_id,))
        row = cur.fetchone()
        assert row['content'] == new_content
        assert row['name'] == 'Content Script', 'updating content must not disturb other fields'

    def test_update_name_does_not_disturb_content(self, client, auth_headers, db_conn):
        resp = client.put(f'/api/scripts/{pytest.content_script_id}', headers=auth_headers,
                           json={'name': 'Renamed Content Script'})
        assert resp.status_code == 200
        cur = db_conn.cursor()
        cur.execute('SELECT content FROM scripts WHERE id = %s', (pytest.content_script_id,))
        assert cur.fetchone()['content']['pages'] == ['1. Greeting', '2. Follow-up']


class TestScriptTenantIsolation:
    def test_list_is_isolated(self, client, other_headers):
        resp = client.get('/api/scripts', headers=other_headers)
        assert resp.status_code == 200
        assert resp.get_json() == []

    def test_get_is_404(self, client, other_headers):
        resp = client.get(f'/api/scripts/{pytest.content_script_id}', headers=other_headers)
        assert resp.status_code == 404

    def test_update_is_404_and_does_not_mutate(self, client, other_headers, db_conn):
        resp = client.put(f'/api/scripts/{pytest.content_script_id}', headers=other_headers,
                           json={'name': 'Hijacked'})
        assert resp.status_code == 404
        cur = db_conn.cursor()
        cur.execute('SELECT name FROM scripts WHERE id = %s', (pytest.content_script_id,))
        assert cur.fetchone()['name'] == 'Renamed Content Script'

    def test_delete_is_404_and_does_not_remove(self, client, other_headers, db_conn):
        resp = client.delete(f'/api/scripts/{pytest.content_script_id}', headers=other_headers)
        assert resp.status_code == 404
        cur = db_conn.cursor()
        cur.execute('SELECT id FROM scripts WHERE id = %s', (pytest.content_script_id,))
        assert cur.fetchone() is not None


class TestQueueScriptAssignment:
    def test_assign_script_to_queue(self, client, auth_headers, db_conn):
        queue_resp = _create_queue(client, auth_headers, name='Assign Test Queue')
        assert queue_resp.status_code == 201, queue_resp.get_json()
        queue_id = queue_resp.get_json()['id']
        pytest.assign_queue_id = queue_id

        resp = client.put(f'/api/queues/{queue_id}/script', headers=auth_headers,
                           json={'script_id': pytest.content_script_id})
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()['config']['script'] == pytest.content_script_id

        cur = db_conn.cursor()
        cur.execute('SELECT config FROM queues WHERE id = %s', (queue_id,))
        assert cur.fetchone()['config']['script'] == pytest.content_script_id

    def test_assignment_does_not_clobber_other_config_keys(self, client, auth_headers, db_conn):
        cur = db_conn.cursor()
        cur.execute("UPDATE queues SET config = config || '{\"lang\": \"English\"}'::jsonb WHERE id = %s",
                    (pytest.assign_queue_id,))
        db_conn.commit()

        resp = client.put(f'/api/queues/{pytest.assign_queue_id}/script', headers=auth_headers,
                           json={'script_id': pytest.content_script_id})
        assert resp.status_code == 200

        cur.execute('SELECT config FROM queues WHERE id = %s', (pytest.assign_queue_id,))
        config = cur.fetchone()['config']
        assert config['lang'] == 'English', 'assigning a script must not clobber unrelated config keys'
        assert config['script'] == pytest.content_script_id

    def test_list_assigned_queues(self, client, auth_headers):
        resp = client.get(f'/api/scripts/{pytest.content_script_id}/queues', headers=auth_headers)
        assert resp.status_code == 200
        names = [q['name'] for q in resp.get_json()]
        assert 'Assign Test Queue' in names

    def test_reassign_to_another_script_moves_it(self, client, auth_headers, db_conn):
        other_script = _create_script(client, auth_headers, name='Other Script').get_json()
        resp = client.put(f'/api/queues/{pytest.assign_queue_id}/script', headers=auth_headers,
                           json={'script_id': other_script['id']})
        assert resp.status_code == 200

        first_list = client.get(f'/api/scripts/{pytest.content_script_id}/queues', headers=auth_headers).get_json()
        assert pytest.assign_queue_id not in [q['id'] for q in first_list]

        second_list = client.get(f"/api/scripts/{other_script['id']}/queues", headers=auth_headers).get_json()
        assert pytest.assign_queue_id in [q['id'] for q in second_list]

        client.delete(f"/api/scripts/{other_script['id']}", headers=auth_headers)

    def test_clear_assignment_with_null(self, client, auth_headers, db_conn):
        client.put(f'/api/queues/{pytest.assign_queue_id}/script', headers=auth_headers,
                   json={'script_id': pytest.content_script_id})
        resp = client.put(f'/api/queues/{pytest.assign_queue_id}/script', headers=auth_headers,
                           json={'script_id': None})
        assert resp.status_code == 200
        assert resp.get_json()['config']['script'] is None
        cur = db_conn.cursor()
        cur.execute('SELECT config FROM queues WHERE id = %s', (pytest.assign_queue_id,))
        assert cur.fetchone()['config']['script'] is None

    def test_assign_nonexistent_script_rejected(self, client, auth_headers):
        resp = client.put(f'/api/queues/{pytest.assign_queue_id}/script', headers=auth_headers,
                           json={'script_id': 999999})
        assert resp.status_code == 404

    def test_assign_on_invalid_queue(self, client, auth_headers):
        resp = client.put('/api/queues/999999/script', headers=auth_headers,
                           json={'script_id': pytest.content_script_id})
        assert resp.status_code == 404

    def test_assignment_is_tenant_scoped(self, client, other_headers):
        """A different tenant must not be able to point their own queue at
        this tenant's script id, and must not be able to touch this
        tenant's queue at all."""
        other_queue = _create_queue(client, other_headers, name='Other Tenant Queue').get_json()
        resp = client.put(f"/api/queues/{other_queue['id']}/script", headers=other_headers,
                           json={'script_id': pytest.content_script_id})
        assert resp.status_code == 404, 'must not be able to reference another tenant\'s script id'

        resp = client.put(f'/api/queues/{pytest.assign_queue_id}/script', headers=other_headers,
                           json={'script_id': None})
        assert resp.status_code == 404, 'must not be able to touch another tenant\'s queue'

    def test_assigned_queues_list_is_tenant_scoped(self, client, other_headers):
        resp = client.get(f'/api/scripts/{pytest.content_script_id}/queues', headers=other_headers)
        # scripts has no dedicated blueprint guarding this read the way
        # resource_get does — assert it at minimum never leaks another
        # tenant's queue rows even if the script id itself is foreign.
        assert resp.status_code == 200
        assert resp.get_json() == []


class TestScriptDeleteCascade:
    def test_deleting_script_clears_queue_assignment(self, client, auth_headers, db_conn):
        script = _create_script(client, auth_headers, name='Doomed Script').get_json()
        queue = _create_queue(client, auth_headers, name='Doomed Assignment Queue').get_json()
        client.put(f"/api/queues/{queue['id']}/script", headers=auth_headers, json={'script_id': script['id']})

        cur = db_conn.cursor()
        cur.execute('SELECT config FROM queues WHERE id = %s', (queue['id'],))
        assert cur.fetchone()['config']['script'] == script['id']

        resp = client.delete(f"/api/scripts/{script['id']}", headers=auth_headers)
        assert resp.status_code == 200, resp.get_json()

        cur.execute('SELECT config FROM queues WHERE id = %s', (queue['id'],))
        assert cur.fetchone()['config']['script'] is None, \
            'deleting a script must clear it from any queue that referenced it'

    def test_deleting_unassigned_script_does_not_touch_other_queues(self, client, auth_headers, db_conn):
        untouched = _create_queue(client, auth_headers, name='Untouched Queue').get_json()
        client.put(f"/api/queues/{untouched['id']}/script", headers=auth_headers,
                   json={'script_id': pytest.content_script_id})

        other_script = _create_script(client, auth_headers, name='Unrelated Script').get_json()
        client.delete(f"/api/scripts/{other_script['id']}", headers=auth_headers)

        cur = db_conn.cursor()
        cur.execute('SELECT config FROM queues WHERE id = %s', (untouched['id'],))
        assert cur.fetchone()['config']['script'] == pytest.content_script_id


class TestScriptsAuthRequired:
    @pytest.mark.parametrize('method,path', [
        ('get', '/api/scripts'),
        ('post', '/api/scripts'),
        ('get', '/api/scripts/1'),
        ('put', '/api/scripts/1'),
        ('delete', '/api/scripts/1'),
        ('get', '/api/scripts/1/queues'),
        ('put', '/api/queues/1/script'),
    ])
    def test_requires_auth(self, client, method, path):
        resp = getattr(client, method)(path, json={})
        assert resp.status_code == 401
