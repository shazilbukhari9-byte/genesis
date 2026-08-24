"""
CRUD, action, integrity and isolation tests for Admin > Integrations >
Bot Connectors: bot_connectors, bot_intents and bot_intent_utterances
(the only three tables the page's three sections require).

Same approach as the Integrations and Data Actions suites: real dev
PostgreSQL via Flask's test client against the real `app`, inside a
disposable test tenant that is dropped at the end (cascading through
tenant_id FKs), so the seeded demo data is never touched. Assertions that
matter read PostgreSQL directly rather than trusting the API's own
response.
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
        (tid, 'Pytest Bot User', email, generate_password_hash('pytest-password-123'), 'Active'),
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
    tid, email = _make_tenant(db_conn, 'bot')
    pytest.bot_tenant_email = email
    yield tid
    cur = db_conn.cursor()
    cur.execute('DELETE FROM tenants WHERE id = %s', (tid,))
    db_conn.commit()


@pytest.fixture(scope='session')
def auth_headers(client, tenant_id):
    return _login(client, pytest.bot_tenant_email)


@pytest.fixture(scope='session')
def other_headers(client, db_conn):
    tid, email = _make_tenant(db_conn, 'botother')
    yield _login(client, email)
    cur = db_conn.cursor()
    cur.execute('DELETE FROM tenants WHERE id = %s', (tid,))
    db_conn.commit()


def _create(client, headers, **kw):
    payload = {'name': 'Connector', 'platform': 'Custom'}
    payload.update(kw)
    return client.post('/api/bot-connectors', headers=headers, json=payload)


class TestBotConnectorCreate:
    def test_create_valid(self, client, auth_headers, db_conn, tenant_id):
        resp = _create(client, auth_headers, name='Bot A', platform='Dialogflow',
                       webhook_url='https://bots.example/hook', notes='primary')
        assert resp.status_code == 201, resp.get_json()
        body = resp.get_json()
        assert body['status'] == 'Disconnected'
        pytest.bot_a = body['id']

        cur = db_conn.cursor()
        cur.execute('SELECT name, platform, webhook_url, notes, status, tenant_id '
                    'FROM bot_connectors WHERE id = %s', (body['id'],))
        row = cur.fetchone()
        assert row is not None, '201 returned but no row in PostgreSQL'
        assert row['name'] == 'Bot A' and row['platform'] == 'Dialogflow'
        assert str(row['tenant_id']) == str(tenant_id)

    def test_create_without_webhook_is_allowed(self, client, auth_headers):
        resp = _create(client, auth_headers, name='Bot No Webhook')
        assert resp.status_code == 201
        pytest.bot_no_webhook = resp.get_json()['id']

    @pytest.mark.parametrize('payload,expected', [
        ({'platform': 'Custom'}, 400),                                   # missing name
        ({'name': 'x'}, 400),                                            # name too short
        ({'name': '   '}, 400),                                          # blank name
        ({'name': 'Bad Platform', 'platform': 'SkyNet'}, 400),           # not in whitelist
        ({'name': 'Bad Hook', 'webhook_url': 'ftp://nope'}, 400),        # wrong scheme
        ({'name': 'Bad Hook 2', 'webhook_url': 'javascript:alert(1)'}, 400),
    ])
    def test_create_validation(self, client, auth_headers, payload, expected):
        resp = client.post('/api/bot-connectors', headers=auth_headers, json=payload)
        assert resp.status_code == expected, resp.get_json()

    def test_create_duplicate_name(self, client, auth_headers):
        assert _create(client, auth_headers, name='Bot A').status_code == 409

    def test_create_duplicate_name_case_insensitive(self, client, auth_headers):
        assert _create(client, auth_headers, name='bot a').status_code == 409

    def test_client_cannot_forge_status(self, client, auth_headers, db_conn):
        """status is owned by connect/disconnect/test — a client must not be
        able to declare itself Connected."""
        resp = _create(client, auth_headers, name='Bot Forge', status='Connected')
        assert resp.status_code == 201
        assert resp.get_json()['status'] == 'Disconnected'
        cur = db_conn.cursor()
        cur.execute('SELECT status FROM bot_connectors WHERE id = %s', (resp.get_json()['id'],))
        assert cur.fetchone()['status'] == 'Disconnected'
        client.delete(f"/api/bot-connectors/{resp.get_json()['id']}", headers=auth_headers)


class TestBotConnectorRead:
    def test_list(self, client, auth_headers):
        resp = client.get('/api/bot-connectors', headers=auth_headers)
        assert resp.status_code == 200
        assert any(r['name'] == 'Bot A' for r in resp.get_json())

    def test_get_single(self, client, auth_headers):
        resp = client.get(f'/api/bot-connectors/{pytest.bot_a}', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['name'] == 'Bot A'

    def test_get_invalid_id(self, client, auth_headers):
        assert client.get('/api/bot-connectors/999999', headers=auth_headers).status_code == 404

    def test_filter_by_platform(self, client, auth_headers):
        resp = client.get('/api/bot-connectors?platform=Dialogflow', headers=auth_headers)
        assert resp.status_code == 200
        assert all(r['platform'] == 'Dialogflow' for r in resp.get_json())

    def test_filter_by_status(self, client, auth_headers):
        resp = client.get('/api/bot-connectors?status=Disconnected', headers=auth_headers)
        assert resp.status_code == 200
        assert all(r['status'] == 'Disconnected' for r in resp.get_json())

    def test_search_q(self, client, auth_headers):
        resp = client.get('/api/bot-connectors?q=No Webhook', headers=auth_headers)
        assert resp.status_code == 200
        assert any(r['name'] == 'Bot No Webhook' for r in resp.get_json())

    def test_empty_result_for_fresh_tenant(self, client, other_headers):
        resp = client.get('/api/bot-connectors', headers=other_headers)
        assert resp.status_code == 200
        assert resp.get_json() == []


class TestBotConnectorUpdate:
    def test_update_valid(self, client, auth_headers, db_conn):
        resp = client.put(f'/api/bot-connectors/{pytest.bot_a}', headers=auth_headers,
                           json={'platform': 'Amazon Lex', 'notes': 'switched'})
        assert resp.status_code == 200
        cur = db_conn.cursor()
        cur.execute('SELECT platform, notes, updated_at, created_at FROM bot_connectors WHERE id = %s',
                    (pytest.bot_a,))
        row = cur.fetchone()
        assert row['platform'] == 'Amazon Lex' and row['notes'] == 'switched'
        assert row['updated_at'] >= row['created_at'], 'touch trigger did not fire'

    def test_update_cannot_change_status(self, client, auth_headers, db_conn):
        resp = client.put(f'/api/bot-connectors/{pytest.bot_a}', headers=auth_headers,
                           json={'status': 'Connected'})
        assert resp.status_code == 400
        cur = db_conn.cursor()
        cur.execute('SELECT status FROM bot_connectors WHERE id = %s', (pytest.bot_a,))
        assert cur.fetchone()['status'] == 'Disconnected'

    def test_update_invalid_id(self, client, auth_headers):
        resp = client.put('/api/bot-connectors/999999', headers=auth_headers, json={'name': 'Nope'})
        assert resp.status_code == 404

    def test_update_duplicate_name(self, client, auth_headers):
        resp = client.put(f'/api/bot-connectors/{pytest.bot_a}', headers=auth_headers,
                           json={'name': 'Bot No Webhook'})
        assert resp.status_code == 409

    def test_update_same_name_allowed(self, client, auth_headers):
        """Renaming a connector to its own current name must not trip the
        duplicate check against itself."""
        resp = client.put(f'/api/bot-connectors/{pytest.bot_a}', headers=auth_headers, json={'name': 'Bot A'})
        assert resp.status_code == 200

    def test_update_invalid_webhook(self, client, auth_headers):
        resp = client.put(f'/api/bot-connectors/{pytest.bot_a}', headers=auth_headers,
                           json={'webhook_url': 'gopher://x'})
        assert resp.status_code == 400


class TestBotConnectorActions:
    def test_connect_success_persists_status(self, client, auth_headers, db_conn):
        client.put(f'/api/bot-connectors/{pytest.bot_a}', headers=auth_headers,
                   json={'webhook_url': 'https://bots.example/hook'})
        resp = client.post(f'/api/bot-connectors/{pytest.bot_a}/connect', headers=auth_headers)
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        assert body['ok'] is True and body['connector']['status'] == 'Connected'
        assert body['detail']

        cur = db_conn.cursor()
        cur.execute('SELECT status, last_error, last_connected_at FROM bot_connectors WHERE id = %s',
                    (pytest.bot_a,))
        row = cur.fetchone()
        assert row['status'] == 'Connected'
        assert row['last_error'] == ''
        assert row['last_connected_at'] is not None

    def test_connect_is_repeatable(self, client, auth_headers, db_conn):
        cur = db_conn.cursor()
        cur.execute('SELECT last_connected_at FROM bot_connectors WHERE id = %s', (pytest.bot_a,))
        before = cur.fetchone()['last_connected_at']
        assert client.post(f'/api/bot-connectors/{pytest.bot_a}/connect', headers=auth_headers).status_code == 200
        cur.execute('SELECT status, last_connected_at FROM bot_connectors WHERE id = %s', (pytest.bot_a,))
        row = cur.fetchone()
        assert row['status'] == 'Connected'
        assert row['last_connected_at'] >= before, 'repeat connect did not restamp last_connected_at'

    def test_test_does_not_change_connected_state(self, client, auth_headers, db_conn):
        resp = client.post(f'/api/bot-connectors/{pytest.bot_a}/test', headers=auth_headers)
        assert resp.status_code == 200
        cur = db_conn.cursor()
        cur.execute('SELECT status FROM bot_connectors WHERE id = %s', (pytest.bot_a,))
        assert cur.fetchone()['status'] == 'Connected', 'test wrongly altered connection state'

    def test_disconnect(self, client, auth_headers, db_conn):
        resp = client.post(f'/api/bot-connectors/{pytest.bot_a}/disconnect', headers=auth_headers)
        assert resp.status_code == 200
        cur = db_conn.cursor()
        cur.execute('SELECT status FROM bot_connectors WHERE id = %s', (pytest.bot_a,))
        assert cur.fetchone()['status'] == 'Disconnected'

    def test_connect_without_webhook_fails_and_logs(self, client, auth_headers, db_conn):
        resp = client.post(f'/api/bot-connectors/{pytest.bot_no_webhook}/connect', headers=auth_headers)
        assert resp.status_code == 400
        assert 'webhook' in resp.get_json()['error'].lower()
        cur = db_conn.cursor()
        cur.execute('SELECT status, last_error FROM bot_connectors WHERE id = %s', (pytest.bot_no_webhook,))
        row = cur.fetchone()
        assert row['status'] == 'Error'
        assert 'webhook' in row['last_error'].lower()

    def test_test_without_webhook_fails(self, client, auth_headers):
        resp = client.post(f'/api/bot-connectors/{pytest.bot_no_webhook}/test', headers=auth_headers)
        assert resp.status_code == 400

    def test_connection_failure_sets_error_status(self, client, auth_headers, db_conn):
        created = _create(client, auth_headers, name='Bot Unreachable',
                          webhook_url='https://unreachable.example/hook')
        cid = created.get_json()['id']
        resp = client.post(f'/api/bot-connectors/{cid}/connect', headers=auth_headers)
        assert resp.status_code == 502, resp.get_json()
        assert resp.get_json()['ok'] is False
        cur = db_conn.cursor()
        cur.execute('SELECT status, last_error FROM bot_connectors WHERE id = %s', (cid,))
        row = cur.fetchone()
        assert row['status'] == 'Error'
        assert row['last_error'] == 'Connection refused (503)'
        pytest.bot_unreachable = cid

    def test_invalid_credentials_failure(self, client, auth_headers):
        created = _create(client, auth_headers, name='Bot BadCreds',
                          webhook_url='https://invalid.example/hook')
        cid = created.get_json()['id']
        resp = client.post(f'/api/bot-connectors/{cid}/test', headers=auth_headers)
        assert resp.status_code == 502
        assert 'invalid credentials' in resp.get_json()['detail'].lower()
        client.delete(f'/api/bot-connectors/{cid}', headers=auth_headers)

    @pytest.mark.parametrize('action', ['connect', 'disconnect', 'test'])
    def test_action_invalid_id(self, client, auth_headers, action):
        assert client.post(f'/api/bot-connectors/999999/{action}', headers=auth_headers).status_code == 404


class TestBotConnectorDelete:
    def test_delete_nonexistent(self, client, auth_headers):
        assert client.delete('/api/bot-connectors/999999', headers=auth_headers).status_code == 404

    def test_delete_cascades_intents_and_utterances(self, client, auth_headers, db_conn):
        """Deleting a bot must take its intents and their training
        utterances with it, leaving no orphans behind."""
        created = client.post(f'/api/bot-connectors/{pytest.bot_unreachable}/intents', headers=auth_headers,
                              json={'name': 'Doomed Intent', 'utterances': ['bye now', 'see you']})
        assert created.status_code == 201
        intent_id = created.get_json()['id']

        cur = db_conn.cursor()
        cur.execute('SELECT count(*) AS n FROM bot_intent_utterances WHERE bot_intent_id = %s', (intent_id,))
        assert cur.fetchone()['n'] == 2

        resp = client.delete(f'/api/bot-connectors/{pytest.bot_unreachable}', headers=auth_headers)
        assert resp.status_code == 200

        cur.execute('SELECT id FROM bot_connectors WHERE id = %s', (pytest.bot_unreachable,))
        assert cur.fetchone() is None, 'bot row survived delete'
        cur.execute('SELECT count(*) AS n FROM bot_intents WHERE bot_connector_id = %s', (pytest.bot_unreachable,))
        assert cur.fetchone()['n'] == 0, 'orphaned bot_intents left behind'
        cur.execute('SELECT count(*) AS n FROM bot_intent_utterances WHERE bot_intent_id = %s', (intent_id,))
        assert cur.fetchone()['n'] == 0, 'orphaned bot_intent_utterances left behind'

    def test_delete_valid(self, client, auth_headers, db_conn):
        assert client.delete(f'/api/bot-connectors/{pytest.bot_a}', headers=auth_headers).status_code == 200
        cur = db_conn.cursor()
        cur.execute('SELECT id FROM bot_connectors WHERE id = %s', (pytest.bot_a,))
        assert cur.fetchone() is None


class TestBotConnectorTenantIsolation:
    def test_setup_connector(self, client, auth_headers):
        resp = _create(client, auth_headers, name='Tenant A Bot', webhook_url='https://a.example/h')
        assert resp.status_code == 201
        pytest.iso_bot = resp.get_json()['id']

    def test_list_is_isolated(self, client, other_headers):
        resp = client.get('/api/bot-connectors', headers=other_headers)
        assert not any(r['name'] == 'Tenant A Bot' for r in resp.get_json())

    def test_get_is_404(self, client, other_headers):
        assert client.get(f'/api/bot-connectors/{pytest.iso_bot}', headers=other_headers).status_code == 404

    def test_update_is_404_and_does_not_mutate(self, client, other_headers, db_conn):
        assert client.put(f'/api/bot-connectors/{pytest.iso_bot}', headers=other_headers,
                          json={'name': 'Hijacked'}).status_code == 404
        cur = db_conn.cursor()
        cur.execute('SELECT name FROM bot_connectors WHERE id = %s', (pytest.iso_bot,))
        assert cur.fetchone()['name'] == 'Tenant A Bot'

    @pytest.mark.parametrize('action', ['connect', 'disconnect', 'test'])
    def test_actions_are_404(self, client, other_headers, action):
        assert client.post(f'/api/bot-connectors/{pytest.iso_bot}/{action}',
                           headers=other_headers).status_code == 404

    def test_delete_is_404_and_does_not_remove(self, client, auth_headers, other_headers, db_conn):
        assert client.delete(f'/api/bot-connectors/{pytest.iso_bot}', headers=other_headers).status_code == 404
        cur = db_conn.cursor()
        cur.execute('SELECT id FROM bot_connectors WHERE id = %s', (pytest.iso_bot,))
        assert cur.fetchone() is not None
        client.delete(f'/api/bot-connectors/{pytest.iso_bot}', headers=auth_headers)

    def test_connector_intents_are_isolated(self, client, other_headers):
        resp = client.get('/api/bot-connectors/intents', headers=other_headers)
        assert resp.status_code == 200
        assert not any(i['connector_name'] == 'Tenant A Bot' for i in resp.get_json())


class TestBotConnectorAuthRequired:
    @pytest.mark.parametrize('method,path', [
        ('get', '/api/bot-connectors'),
        ('get', '/api/bot-connectors/intents'),
        ('get', '/api/bot-connectors/1'),
        ('post', '/api/bot-connectors'),
        ('put', '/api/bot-connectors/1'),
        ('delete', '/api/bot-connectors/1'),
        ('post', '/api/bot-connectors/1/connect'),
        ('post', '/api/bot-connectors/1/disconnect'),
        ('post', '/api/bot-connectors/1/test'),
        ('post', '/api/bot-connectors/1/intents'),
        ('delete', '/api/bot-connectors/intents/1'),
        ('post', '/api/bot-connectors/match-intent'),
    ])
    def test_requires_auth(self, client, method, path):
        resp = getattr(client, method)(path, json={})
        assert resp.status_code == 401, f'{method.upper()} {path} did not require auth'


class TestBotConnectorListColumns:
    """The Bots tab renders Bot / Provider / Language / Intents / Channels /
    Confidence threshold / Status — every one of those must come from the
    API, not from frontend placeholders."""

    def test_create_persists_all_display_columns(self, client, auth_headers, db_conn):
        resp = _create(client, auth_headers, name='Columns Bot', platform='Amazon Lex V2',
                       language='en-GB', channels='Voice, Web Messenger',
                       confidence_threshold=0.72, division='d_ret', lifecycle='Live')
        assert resp.status_code == 201, resp.get_json()
        cid = resp.get_json()['id']
        pytest.columns_bot = cid
        cur = db_conn.cursor()
        cur.execute('SELECT language, channels, confidence_threshold, division, lifecycle '
                    'FROM bot_connectors WHERE id = %s', (cid,))
        row = cur.fetchone()
        assert row['language'] == 'en-GB'
        assert row['channels'] == 'Voice, Web Messenger'
        assert float(row['confidence_threshold']) == 0.72
        assert row['division'] == 'd_ret'
        assert row['lifecycle'] == 'Live'

    def test_list_exposes_display_columns_and_intent_count(self, client, auth_headers):
        rows = client.get('/api/bot-connectors', headers=auth_headers).get_json()
        row = next(r for r in rows if r['id'] == pytest.columns_bot)
        for field in ('language', 'channels', 'confidence_threshold', 'lifecycle', 'intent_count'):
            assert field in row, f'{field} missing from list response'
        assert row['intent_count'] == 0

    @pytest.mark.parametrize('payload,expected', [
        ({'name': 'Bad Lifecycle', 'lifecycle': 'Zombie'}, 400),
        ({'name': 'Bad Conf', 'confidence_threshold': 5}, 400),
        ({'name': 'Bad Conf 2', 'confidence_threshold': -1}, 400),
        ({'name': 'Bad Conf 3', 'confidence_threshold': 'abc'}, 400),
    ])
    def test_display_column_validation(self, client, auth_headers, payload, expected):
        assert client.post('/api/bot-connectors', headers=auth_headers, json=payload).status_code == expected

    def test_lifecycle_and_division_filters(self, client, auth_headers):
        live = client.get('/api/bot-connectors?lifecycle=Live', headers=auth_headers).get_json()
        assert all(r['lifecycle'] == 'Live' for r in live)
        assert any(r['id'] == pytest.columns_bot for r in live)
        ret = client.get('/api/bot-connectors?division=d_ret', headers=auth_headers).get_json()
        assert all(r['division'] == 'd_ret' for r in ret)


class TestBotIntents:
    """Intents tab + the data the Test Utterances tab matches against."""

    def test_create_intent_with_utterances(self, client, auth_headers, db_conn):
        resp = client.post(f'/api/bot-connectors/{pytest.columns_bot}/intents', headers=auth_headers,
                           json={'name': 'CheckBalance', 'confidence': 0.94,
                                 'utterances': ['how much do I owe', 'what is my balance']})
        assert resp.status_code == 201, resp.get_json()
        assert resp.get_json()['utterance_count'] == 2
        pytest.intent_id = resp.get_json()['id']

        cur = db_conn.cursor()
        cur.execute('SELECT count(*) AS n FROM bot_intent_utterances WHERE bot_intent_id = %s',
                    (pytest.intent_id,))
        assert cur.fetchone()['n'] == 2, 'utterances not persisted'

    def test_intent_count_is_live_not_stored(self, client, auth_headers):
        rows = client.get('/api/bot-connectors', headers=auth_headers).get_json()
        row = next(r for r in rows if r['id'] == pytest.columns_bot)
        assert row['intent_count'] == 1

    def test_list_intents(self, client, auth_headers):
        rows = client.get('/api/bot-connectors/intents', headers=auth_headers).get_json()
        mine = [r for r in rows if r['id'] == pytest.intent_id]
        assert len(mine) == 1
        assert mine[0]['name'] == 'CheckBalance' and mine[0]['utterance_count'] == 2

    def test_duplicate_intent_name(self, client, auth_headers):
        resp = client.post(f'/api/bot-connectors/{pytest.columns_bot}/intents', headers=auth_headers,
                           json={'name': 'CheckBalance'})
        assert resp.status_code == 409

    @pytest.mark.parametrize('payload,expected', [
        ({}, 400),
        ({'name': '   '}, 400),
        ({'name': 'X', 'confidence': 9}, 400),
        ({'name': 'X', 'utterances': 'notalist'}, 400),
    ])
    def test_intent_validation(self, client, auth_headers, payload, expected):
        resp = client.post(f'/api/bot-connectors/{pytest.columns_bot}/intents',
                           headers=auth_headers, json=payload)
        assert resp.status_code == expected

    def test_intent_on_invalid_connector(self, client, auth_headers):
        resp = client.post('/api/bot-connectors/999999/intents', headers=auth_headers, json={'name': 'X'})
        assert resp.status_code == 404

    def test_intents_are_tenant_isolated(self, client, other_headers):
        rows = client.get('/api/bot-connectors/intents', headers=other_headers).get_json()
        assert not any(r['name'] == 'CheckBalance' for r in rows)


class TestMatchIntent:
    """Test Utterances tab — matching happens in the backend against real
    bot_intent_utterances rows, so it cannot be a frontend simulation."""

    def test_match_known_utterance(self, client, auth_headers):
        resp = client.post('/api/bot-connectors/match-intent', headers=auth_headers,
                           json={'utterance': 'how much do I owe?'})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['matched'] is True
        assert body['intent'] == 'CheckBalance'
        assert body['score'] >= body['confidence_threshold']

    def test_unrelated_utterance_does_not_match(self, client, auth_headers):
        resp = client.post('/api/bot-connectors/match-intent', headers=auth_headers,
                           json={'utterance': 'xylophone spaceship'})
        assert resp.status_code == 200
        assert resp.get_json()['matched'] is False

    def test_empty_utterance(self, client, auth_headers):
        assert client.post('/api/bot-connectors/match-intent', headers=auth_headers,
                           json={'utterance': '   '}).status_code == 400

    def test_no_trained_data_reports_honestly(self, client, other_headers):
        """A tenant with no intents must be told so, not given a fake match."""
        resp = client.post('/api/bot-connectors/match-intent', headers=other_headers,
                           json={'utterance': 'how much do I owe'})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['matched'] is False
        assert 'no trained utterances' in body['reason']

    def test_match_is_tenant_scoped(self, client, other_headers):
        resp = client.post('/api/bot-connectors/match-intent', headers=other_headers,
                           json={'utterance': 'how much do I owe'})
        assert resp.get_json().get('intent') is None

    def test_delete_intent_cascades_utterances(self, client, auth_headers, db_conn):
        assert client.delete(f'/api/bot-connectors/intents/{pytest.intent_id}',
                             headers=auth_headers).status_code == 200
        cur = db_conn.cursor()
        cur.execute('SELECT count(*) AS n FROM bot_intent_utterances WHERE bot_intent_id = %s',
                    (pytest.intent_id,))
        assert cur.fetchone()['n'] == 0, 'utterances orphaned after intent delete'

    def test_delete_intent_invalid_id(self, client, auth_headers):
        assert client.delete('/api/bot-connectors/intents/999999', headers=auth_headers).status_code == 404

    def test_deleting_connector_cascades_intents(self, client, auth_headers, db_conn):
        created = client.post(f'/api/bot-connectors/{pytest.columns_bot}/intents', headers=auth_headers,
                              json={'name': 'Temp Intent', 'utterances': ['hello there']})
        assert created.status_code == 201
        client.delete(f'/api/bot-connectors/{pytest.columns_bot}', headers=auth_headers)
        cur = db_conn.cursor()
        cur.execute('SELECT count(*) AS n FROM bot_intents WHERE bot_connector_id = %s', (pytest.columns_bot,))
        assert cur.fetchone()['n'] == 0, 'intents survived their connector being deleted'
