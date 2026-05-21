from urllib.parse import parse_qs, urlparse

from app import create_app
from app.db.schema import ensure_base_schema
from app.services import spotify
from tests._pg_test_db import connect_test_db


def _create_user(conn, user_id=1):
    conn.execute(
        '''
        INSERT INTO users (id, public_key, username, display_name)
        VALUES (?, ?, ?, ?)
        ''',
        (user_id, f'pk-{user_id}', f'user{user_id}', f'User {user_id}'),
    )
    conn.commit()


def test_spotify_token_lifecycle_preserves_refresh_token(monkeypatch, tmp_path):
    db_path = tmp_path / 'spotify-service.db'
    monkeypatch.setattr(spotify.time, 'time', lambda: 1000)

    with connect_test_db(db_path) as conn:
        ensure_base_schema(conn)
        _create_user(conn)

        spotify.save_tokens(
            conn,
            1,
            {
                'access_token': 'access-1',
                'refresh_token': 'refresh-1',
                'scope': 'user-read-currently-playing',
                'expires_in': 3600,
            },
        )
        assert spotify.is_connected(conn, 1) is True
        assert spotify.get_connected_user_ids(conn) == [1]

        spotify.save_tokens(
            conn,
            1,
            {
                'access_token': 'access-2',
                'scope': 'user-read-playback-state',
                'expires_in': 1800,
            },
        )
        row = conn.execute(
            '''
            SELECT access_token, refresh_token, scope, expires_at
            FROM spotify_tokens
            WHERE user_id = ?
            ''',
            (1,),
        ).fetchone()
        assert row['access_token'] == 'access-2'
        assert row['refresh_token'] == 'refresh-1'
        assert row['scope'] == 'user-read-playback-state'
        assert int(row['expires_at']) == 2740

        spotify.revoke_tokens(conn, 1)
        assert spotify.is_connected(conn, 1) is False


def test_spotify_poll_updates_public_cached_status(monkeypatch, tmp_path):
    db_path = tmp_path / 'spotify-poll.db'
    monkeypatch.setattr(spotify.time, 'time', lambda: 2000)
    playback = {
        'is_playing': True,
        'progress_ms': 65000,
        'item': {
            'name': 'Test Track',
            'duration_ms': 240000,
            'artists': [{'name': 'Artist One'}, {'name': 'Artist Two'}],
            'album': {
                'name': 'Test Album',
                'images': [{'url': 'https://example.test/cover.jpg'}],
            },
            'external_urls': {'spotify': 'https://open.spotify.com/track/test'},
        },
    }

    with connect_test_db(db_path) as conn:
        ensure_base_schema(conn)
        _create_user(conn)
        spotify.save_tokens(
            conn,
            1,
            {
                'access_token': 'access-token',
                'refresh_token': 'refresh-token',
                'expires_in': 3600,
            },
        )

        monkeypatch.setattr(spotify, '_fetch_current_playback', lambda token: playback)
        spotify.poll_and_update(conn, 1, 'client-id', 'client-secret')

        status = spotify.get_public_listening_status(conn, 2, 1)

    assert status == {
        'is_playing': True,
        'track': 'Test Track',
        'artist': 'Artist One, Artist Two',
        'album': 'Test Album',
        'album_art_url': 'https://example.test/cover.jpg',
        'spotify_url': 'https://open.spotify.com/track/test',
        'progress_ms': 65000,
        'duration_ms': 240000,
        'updated_at': 2000,
    }


def test_spotify_oauth_state_rejects_tampering(monkeypatch):
    monkeypatch.setattr(spotify.time, 'time', lambda: 3000)
    state = spotify.generate_oauth_state('secret-key', 17)

    assert spotify.verify_oauth_state('secret-key', state) == 17
    assert spotify.verify_oauth_state('other-secret', state) is None
    assert spotify.verify_oauth_state('secret-key', f'{state}bad') is None


def test_spotify_connect_redirects_to_authorization(tmp_path, monkeypatch):
    db_path = tmp_path / 'spotify-routes-connect.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'RUN_MIGRATIONS_ON_STARTUP': False,
            'SPOTIFY_CLIENT_ID': 'client-id',
            'SPOTIFY_CLIENT_SECRET': 'client-secret',
            'SPOTIFY_REDIRECT_URI': 'https://example.test/spotify/callback',
        },
    )
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 5
        sess['public_key_pem'] = 'pk-5'

    response = client.get('/spotify/connect')

    assert response.status_code == 302
    location = response.headers['Location']
    parsed = urlparse(location)
    query = parse_qs(parsed.query)
    assert parsed.netloc == 'accounts.spotify.com'
    assert parsed.path == '/authorize'
    assert query['client_id'] == ['client-id']
    assert query['redirect_uri'] == ['https://example.test/spotify/callback']
    assert query['response_type'] == ['code']
    assert query['scope'] == ['user-read-currently-playing user-read-playback-state']


def test_spotify_callback_saves_tokens_and_returns_to_settings(tmp_path, monkeypatch):
    from app.routes import spotify as spotify_routes

    db_path = tmp_path / 'spotify-routes-callback.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'RUN_MIGRATIONS_ON_STARTUP': False,
            'SPOTIFY_CLIENT_ID': 'client-id',
            'SPOTIFY_CLIENT_SECRET': 'client-secret',
            'SPOTIFY_REDIRECT_URI': 'https://example.test/spotify/callback',
        },
    )
    saved = []

    class FakeConn:
        def close(self):
            pass

    monkeypatch.setattr(
        spotify_routes,
        'exchange_code',
        lambda client_id, client_secret, redirect_uri, code: {'access_token': 'access-token'},
    )
    monkeypatch.setattr(spotify_routes, 'get_db_connection', lambda: FakeConn())
    monkeypatch.setattr(
        spotify_routes,
        'save_tokens',
        lambda conn, user_id, token_data: saved.append((user_id, token_data)),
    )

    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 5
        sess['public_key_pem'] = 'pk-5'

    state = spotify.generate_oauth_state(app.config['SECRET_KEY'], 5)
    response = client.get(f'/spotify/callback?code=oauth-code&state={state}')

    assert response.status_code == 302
    assert response.headers['Location'].endswith('/chat?settings=integrations')
    assert saved == [(5, {'access_token': 'access-token'})]


def test_spotify_refresh_polls_current_user_and_broadcasts(monkeypatch):
    from flask import Flask
    from app.routes import spotify as spotify_routes
    from app.extensions import limiter
    from app.services import scheduler_runtime

    app = Flask(__name__)
    app.secret_key = 'test-secret'
    app.config.update(
        TESTING=True,
        RATELIMIT_ENABLED=False,
        SPOTIFY_CLIENT_ID='client-id',
        SPOTIFY_CLIENT_SECRET='client-secret',
        SPOTIFY_REDIRECT_URI='https://example.test/spotify/callback',
    )
    limiter.init_app(app)
    app.register_blueprint(spotify_routes.spotify_bp)
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 5
        sess['public_key_pem'] = 'pk-5'

    class FakeConn:
        def close(self):
            pass

    status_payload = {'is_playing': True, 'track': 'Fresh Track'}
    broadcasts = []
    monkeypatch.setattr(spotify_routes, 'get_db_connection', lambda: FakeConn())
    monkeypatch.setattr(spotify_routes, 'is_connected', lambda conn, user_id: True)
    monkeypatch.setattr(
        spotify_routes,
        'poll_and_update',
        lambda conn, user_id, client_id, client_secret: status_payload,
    )
    monkeypatch.setattr(
        scheduler_runtime,
        '_broadcast_spotify_status',
        lambda conn, user_id, spotify_status: broadcasts.append((user_id, spotify_status)),
    )

    response = client.post('/spotify/refresh')

    assert response.status_code == 200
    payload = response.get_json()
    assert payload == {
        'success': True,
        'configured': True,
        'connected': True,
        'spotify_status': status_payload,
    }
    assert broadcasts == [(5, status_payload)]
