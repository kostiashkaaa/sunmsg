from pathlib import Path

from app import create_app
from tests._pg_test_db import connect_test_db


class _ConnectionHandle:
    def __init__(self, db_path: Path):
        self._conn = connect_test_db(db_path)

    def __enter__(self):
        return self._conn

    def __exit__(self, exc_type, exc, tb):
        self._conn.close()
        return False

    def close(self):
        return self._conn.close()

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _connect(db_path: Path) -> _ConnectionHandle:
    return _ConnectionHandle(db_path)


def _authed_client(app, user_id: int, public_key: str):
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = user_id
        sess['public_key_pem'] = public_key
    return client


def _push_subscription_payload(endpoint: str = 'https://push.example.test/sub-1'):
    return {
        'subscription': {
            'endpoint': endpoint,
            'keys': {
                'p256dh': 'BKqQyN7l9M6WB2i2B8z5p5uOeU4yR8M1gQ2hI3jK4l5mN6oP7qR8sT9uV0wX1yZ2',
                'auth': 'A1b2C3d4E5f6G7h8I9j0',
            },
        }
    }


def test_service_worker_route_served(monkeypatch, tmp_path):
    db_path = tmp_path / 'web-push-worker.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    response = app.test_client().get('/service-worker.js')

    assert response.status_code == 200
    assert response.headers.get('Service-Worker-Allowed') == '/'
    assert 'javascript' in str(response.headers.get('Content-Type') or '')


def test_web_push_public_key_endpoint(monkeypatch, tmp_path):
    db_path = tmp_path / 'web-push-public-key.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    disabled_app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'WEB_PUSH_ENABLED': False,
        },
    )
    enabled_app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'WEB_PUSH_ENABLED': True,
            'WEB_PUSH_VAPID_PUBLIC_KEY': 'public-test-key',
            'WEB_PUSH_VAPID_PRIVATE_KEY': 'private-test-key',
            'WEB_PUSH_VAPID_SUBJECT': 'mailto:test@sunmessenger.local',
        },
    )

    disabled_payload = disabled_app.test_client().get('/api/web_push/public_key').get_json()
    enabled_payload = enabled_app.test_client().get('/api/web_push/public_key').get_json()

    assert disabled_payload == {'success': True, 'enabled': False, 'publicKey': ''}
    assert enabled_payload == {'success': True, 'enabled': True, 'publicKey': 'public-test-key'}


def test_web_push_subscribe_and_unsubscribe_roundtrip(monkeypatch, tmp_path):
    db_path = tmp_path / 'web-push-subscribe.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'WEB_PUSH_ENABLED': True,
            'WEB_PUSH_VAPID_PUBLIC_KEY': 'public-test-key',
            'WEB_PUSH_VAPID_PRIVATE_KEY': 'private-test-key',
            'WEB_PUSH_VAPID_SUBJECT': 'mailto:test@sunmessenger.local',
        },
    )

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    subscribe_response = client.post('/api/web_push/subscribe', json=_push_subscription_payload())
    assert subscribe_response.status_code == 200
    assert subscribe_response.get_json() == {'success': True}

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT user_id, endpoint, is_active
            FROM push_subscriptions
            WHERE endpoint = ?
            ''',
            ('https://push.example.test/sub-1',),
        ).fetchone()
    assert row
    assert row['user_id'] == 1
    assert int(row['is_active']) == 1

    unsubscribe_response = client.post(
        '/api/web_push/unsubscribe',
        json={'endpoint': 'https://push.example.test/sub-1'},
    )
    assert unsubscribe_response.status_code == 200
    assert unsubscribe_response.get_json() == {'success': True, 'updated': 1}

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT is_active
            FROM push_subscriptions
            WHERE endpoint = ?
            ''',
            ('https://push.example.test/sub-1',),
        ).fetchone()
    assert row
    assert int(row['is_active']) == 0


def test_web_push_subscribe_validates_payload_and_auth(monkeypatch, tmp_path):
    db_path = tmp_path / 'web-push-subscribe-validation.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'WEB_PUSH_ENABLED': True,
            'WEB_PUSH_VAPID_PUBLIC_KEY': 'public-test-key',
            'WEB_PUSH_VAPID_PRIVATE_KEY': 'private-test-key',
            'WEB_PUSH_VAPID_SUBJECT': 'mailto:test@sunmessenger.local',
        },
    )

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    unauth_response = app.test_client().post('/api/web_push/subscribe', json=_push_subscription_payload())
    assert unauth_response.status_code == 401

    authed_client = _authed_client(app, 1, 'pk-1')
    invalid_payload_response = authed_client.post(
        '/api/web_push/subscribe',
        json={'subscription': {'endpoint': 'http://invalid', 'keys': {'p256dh': 'x', 'auth': 'y'}}},
    )
    assert invalid_payload_response.status_code == 400
    assert invalid_payload_response.get_json() == {'success': False, 'error': 'Некорректная push-подписка.'}
