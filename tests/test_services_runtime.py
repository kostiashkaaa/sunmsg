from pathlib import Path
import importlib
import logging
import threading
import time
import subprocess
import pytest

from app import create_app
from app.services import presence, refresh_tokens, scheduler_runtime, web_runtime
from app.services.pip_audit_runtime import run_pip_audit
from app.services.production_config_runtime import run_production_config_check
from app.services.security_runtime import run_security_check
from tests._pg_test_db import connect_test_db


def _secure_production_overrides() -> dict:
    return {
        'RUN_MIGRATIONS_ON_STARTUP': False,
        'START_SCHEDULER_IN_WEB': False,
        'SOCKETIO_CORS_ORIGINS': 'https://sunmessenger.ru',
        'SESSION_COOKIE_SECURE': True,
        'PROXY_FIX_X_FOR': 1,
        'PROXY_FIX_X_PROTO': 1,
        'DEBUG': False,
        'DATABASE_BACKUP_DIR': '',
        'ALLOW_UNSAFE_WERKZEUG': False,
        'ALLOW_EMBEDDED_WEB_SERVER': False,
        'CSP_STYLE_UNSAFE_INLINE': False,
        'CHAT_MEDIA_AV_SCAN_ENABLED': True,
        'CHAT_MEDIA_AV_FAIL_CLOSED': True,
        'CHAT_MEDIA_AV_COMMAND': 'scanner --scan {path}',
        'WEB_PUSH_ENABLED': True,
        'WEB_PUSH_VAPID_PUBLIC_KEY': 'test-public-key',
        'WEB_PUSH_VAPID_PRIVATE_KEY': 'test-private-key',
        'WEB_PUSH_VAPID_SUBJECT': 'mailto:test@sunmessenger.local',
    }


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


def test_refresh_token_lifecycle_and_cleanup(monkeypatch, tmp_path):
    db_path = tmp_path / 'refresh-service.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    with app.test_request_context(
        '/api/refresh',
        headers={'User-Agent': 'pytest-device', 'X-Forwarded-For': '198.51.100.9'},
    ):
        raw_token, first_exp = refresh_tokens.issue_refresh_token(1, family_id='family-1')

    with _connect(db_path) as conn:
        issued_row = conn.execute(
            '''
            SELECT user_id, family_id, expires_at, revoked_at, user_agent, ip
            FROM refresh_tokens
            WHERE family_id = 'family-1'
            '''
        ).fetchone()

    assert issued_row['user_id'] == 1
    assert issued_row['family_id'] == 'family-1'
    assert issued_row['expires_at'] == first_exp
    assert issued_row['revoked_at'] is None
    assert issued_row['user_agent'] == 'pytest-device'
    assert issued_row['ip'] == '198.51.100.9'

    with app.test_request_context(
        '/api/refresh',
        headers={'User-Agent': 'pytest-rotated', 'X-Forwarded-For': '198.51.100.10'},
    ):
        rotated = refresh_tokens.rotate_refresh_token(raw_token)

    assert rotated is not None
    rotated_user_id, rotated_raw, rotated_exp = rotated
    assert rotated_user_id == 1
    assert rotated_raw != raw_token
    assert rotated_exp >= first_exp

    with _connect(db_path) as conn:
        family_rows = conn.execute(
            '''
            SELECT token_hash, family_id, revoked_at, user_agent, ip
            FROM refresh_tokens
            WHERE family_id = 'family-1'
            ORDER BY id ASC
            '''
        ).fetchall()

    assert len(family_rows) == 2
    assert family_rows[0]['revoked_at'] is not None
    assert family_rows[1]['revoked_at'] is None
    assert family_rows[1]['user_agent'] == 'pytest-rotated'
    assert family_rows[1]['ip'] == '198.51.100.10'

    assert refresh_tokens.revoke_refresh_token(rotated_raw) is True
    assert refresh_tokens.revoke_refresh_token(rotated_raw) is False

    with app.test_request_context('/api/refresh'):
        assert refresh_tokens.rotate_refresh_token(raw_token) is None

    with _connect(db_path) as conn:
        revoked_count = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM refresh_tokens
            WHERE family_id = 'family-1' AND revoked_at IS NOT NULL
            '''
        ).fetchone()['cnt']

    assert revoked_count == 2

    with app.test_request_context('/api/refresh'):
        extra_a, _ = refresh_tokens.issue_refresh_token(1, family_id='family-a')
        extra_b, _ = refresh_tokens.issue_refresh_token(1, family_id='family-b')
        assert extra_a != extra_b

    revoked = refresh_tokens.revoke_all_for_user(1)
    assert revoked == 2

    cutoff = int(time.time()) - (2 * 24 * 60 * 60)
    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO refresh_tokens (
                user_id, token_hash, family_id, expires_at, created_at, last_used_at, user_agent, ip
            )
            VALUES (2, 'expired-hash', 'family-expired', ?, ?, ?, 'old-device', '127.0.0.1')
            ''',
            (cutoff - 10, cutoff - 20, cutoff - 20),
        )
        conn.commit()

    assert refresh_tokens.cleanup_expired() == 1
    with _connect(db_path) as conn:
        expired_row = conn.execute(
            "SELECT 1 FROM refresh_tokens WHERE family_id = 'family-expired'"
        ).fetchone()

    assert expired_row is None


def test_refresh_rotation_is_atomic_under_concurrency(monkeypatch, tmp_path):
    db_path = tmp_path / 'refresh-race.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    with app.test_request_context('/api/refresh', headers={'User-Agent': 'seed', 'X-Forwarded-For': '198.51.100.1'}):
        raw_token, _ = refresh_tokens.issue_refresh_token(1, family_id='family-race')

    workers = 8
    barrier = threading.Barrier(workers)
    results = []
    errors = []

    def _rotate_worker(index: int) -> None:
        try:
            with app.test_request_context(
                '/api/refresh',
                headers={
                    'User-Agent': f'worker-{index}',
                    'X-Forwarded-For': f'198.51.100.{index + 2}',
                },
            ):
                barrier.wait()
                results.append(refresh_tokens.rotate_refresh_token(raw_token))
        except Exception as exc:  # pragma: no cover - only for diagnostics
            errors.append(exc)

    threads = [threading.Thread(target=_rotate_worker, args=(idx,)) for idx in range(workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not errors
    assert any(result is not None for result in results)

    with _connect(db_path) as conn:
        rows = conn.execute(
            '''
            SELECT id, revoked_at
            FROM refresh_tokens
            WHERE family_id = 'family-race'
            ORDER BY id
            '''
        ).fetchall()

    active_rows = [row for row in rows if row['revoked_at'] is None]
    assert len(active_rows) <= 1
    assert len(rows) <= 2


def test_refresh_cookie_helpers_set_expected_flags():
    app = create_app('testing', overrides={'RUN_MIGRATIONS_ON_STARTUP': False})

    with app.test_request_context('/'):
        response = app.make_response('')
        refresh_tokens.set_refresh_cookie(response, 'raw-token', secure=True)
        cookie_headers = response.headers.getlist('Set-Cookie')
        assert any('refresh_token=raw-token' in header for header in cookie_headers)
        assert any('HttpOnly' in header for header in cookie_headers)
        assert any('Secure' in header for header in cookie_headers)
        assert any('SameSite=Lax' in header for header in cookie_headers)

        response = app.make_response('')
        refresh_tokens.clear_refresh_cookie(response, secure=False)
        cookie_headers = response.headers.getlist('Set-Cookie')
        assert any('refresh_token=' in header for header in cookie_headers)
        assert any('Max-Age=0' in header for header in cookie_headers)


def test_presence_in_process_store_and_effective_online(monkeypatch):
    monkeypatch.delenv('REDIS_URL', raising=False)
    monkeypatch.setenv('APP_ENV', 'testing')
    presence.configure_presence('', 'testing')
    presence._connected.clear()
    presence._active.clear()

    assert presence.add_connected('pk-1', 'sid-1') == 1
    assert presence.add_connected('pk-1', 'sid-2') == 2
    assert presence.count_connected('pk-1') == 2

    assert presence.add_active('pk-1', 'sid-1') == 1
    assert presence.is_effectively_online('pk-1', persisted=False) is True
    assert presence.count_active('pk-1') == 1

    assert presence.remove_active('pk-1', 'sid-1') == 0
    assert presence.is_effectively_online('pk-1', persisted=True) is False
    assert presence.is_effectively_online('pk-1', persisted=False) is False

    assert presence.remove_connected('pk-1', 'sid-1') == 1
    assert presence.remove_connected('pk-1', 'sid-2') == 0
    assert presence.count_connected('pk-1') == 0
    assert presence.is_effectively_online('pk-1', persisted=False) is False


def test_presence_module_warns_without_redis_in_production(monkeypatch, caplog):
    monkeypatch.delenv('REDIS_URL', raising=False)
    monkeypatch.setenv('APP_ENV', 'production')

    with caplog.at_level(logging.WARNING):
        importlib.reload(presence)
        presence.configure_presence()

    assert any('REDIS_URL not set in production' in record.getMessage() for record in caplog.records)
    assert presence._redis is None
    importlib.reload(presence)


def test_presence_reconfigures_when_redis_url_appears_after_import(monkeypatch):
    importlib.reload(presence)
    sentinel = object()
    captured = []

    monkeypatch.setattr(
        presence,
        '_make_redis_store',
        lambda redis_url: captured.append(redis_url) or sentinel,
    )
    monkeypatch.setenv('REDIS_URL', 'redis://127.0.0.1:6379/0')
    monkeypatch.setenv('APP_ENV', 'production')

    configured = presence.configure_presence()

    assert configured is sentinel
    assert presence._redis is sentinel
    assert captured == ['redis://127.0.0.1:6379/0']


def test_create_app_rejects_combined_web_runtime_roles_in_production(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 'x' * 64)

    with pytest.raises(RuntimeError, match='RUN_MIGRATIONS_ON_STARTUP'):
        create_app('production', overrides={'RUN_MIGRATIONS_ON_STARTUP': True})

    with pytest.raises(RuntimeError, match='START_SCHEDULER_IN_WEB'):
        create_app('production', overrides={'START_SCHEDULER_IN_WEB': True})


def test_create_app_requires_redis_backing_services_in_production(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 'z' * 64)

    with pytest.raises(RuntimeError, match='REDIS_URL must be set'):
        create_app(
            'production',
            overrides={
                'RUN_MIGRATIONS_ON_STARTUP': False,
                'START_SCHEDULER_IN_WEB': False,
                'REDIS_URL': '',
            },
        )

    with pytest.raises(RuntimeError, match='RATELIMIT_STORAGE_URI must point to Redis'):
        create_app(
            'production',
            overrides={
                'RUN_MIGRATIONS_ON_STARTUP': False,
                'START_SCHEDULER_IN_WEB': False,
                'REDIS_URL': 'redis://127.0.0.1:6379/0',
                'RATELIMIT_STORAGE_URI': 'memory://',
                'SOCKETIO_MESSAGE_QUEUE': 'redis://127.0.0.1:6379/0',
            },
        )

    with pytest.raises(RuntimeError, match='SOCKETIO_MESSAGE_QUEUE must be set'):
        create_app(
            'production',
            overrides={
                'RUN_MIGRATIONS_ON_STARTUP': False,
                'START_SCHEDULER_IN_WEB': False,
                'REDIS_URL': 'redis://127.0.0.1:6379/0',
                'RATELIMIT_STORAGE_URI': 'redis://127.0.0.1:6379/0',
                'SOCKETIO_MESSAGE_QUEUE': '',
            },
        )


def test_security_check_validates_av_command_in_production(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 's' * 64)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://sunmessenger:test@127.0.0.1:5432/sunmessenger')
    overrides = {
        **_secure_production_overrides(),
        'REDIS_URL': 'redis://127.0.0.1:6379/0',
        'RATELIMIT_STORAGE_URI': 'redis://127.0.0.1:6379/1',
        'SOCKETIO_MESSAGE_QUEUE': 'redis://127.0.0.1:6379/2',
        'CHAT_MEDIA_AV_COMMAND': 'definitely-missing-scanner --scan {path}',
    }

    with pytest.raises(RuntimeError, match='not found in PATH'):
        run_security_check('production', overrides=overrides)


def test_security_check_reports_ok_with_valid_av_command(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 'k' * 64)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://sunmessenger:test@127.0.0.1:5432/sunmessenger')
    overrides = {
        **_secure_production_overrides(),
        'REDIS_URL': 'redis://127.0.0.1:6379/0',
        'RATELIMIT_STORAGE_URI': 'redis://127.0.0.1:6379/1',
        'SOCKETIO_MESSAGE_QUEUE': 'redis://127.0.0.1:6379/2',
        'CHAT_MEDIA_AV_COMMAND': 'python -V',
    }

    report = run_security_check('production', overrides=overrides)
    assert report['env'] == 'production'
    assert report['status'] == 'ok'
    assert report['av_command'][0] == 'python'


def test_create_app_rejects_weak_secret_and_wildcard_cors_in_production(monkeypatch):
    base_overrides = _secure_production_overrides()

    monkeypatch.setenv('SECRET_KEY', 'change-me')
    with pytest.raises(RuntimeError, match='SECRET_KEY must be a strong non-default value'):
        create_app('production', overrides=base_overrides)

    monkeypatch.setenv('SECRET_KEY', 'w' * 64)
    with pytest.raises(RuntimeError, match='SOCKETIO_CORS_ORIGINS cannot include wildcard'):
        create_app(
            'production',
            overrides={**base_overrides, 'SOCKETIO_CORS_ORIGINS': '*'},
        )


def test_create_app_rejects_insecure_production_flags(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 'q' * 64)
    base_overrides = _secure_production_overrides()

    with pytest.raises(RuntimeError, match='SESSION_COOKIE_SECURE must be enabled'):
        create_app(
            'production',
            overrides={**base_overrides, 'SESSION_COOKIE_SECURE': False},
        )

    with pytest.raises(RuntimeError, match='DEBUG must remain disabled'):
        create_app(
            'production',
            overrides={**base_overrides, 'DEBUG': True},
        )

    with pytest.raises(RuntimeError, match='PROXY_FIX_X_FOR must be >= 1'):
        create_app(
            'production',
            overrides={**base_overrides, 'PROXY_FIX_X_FOR': 0},
        )

    with pytest.raises(RuntimeError, match='PROXY_FIX_X_PROTO must be >= 1'):
        create_app(
            'production',
            overrides={**base_overrides, 'PROXY_FIX_X_PROTO': 0},
        )

    with pytest.raises(RuntimeError, match='ALLOW_UNSAFE_WERKZEUG must remain disabled'):
        create_app(
            'production',
            overrides={**base_overrides, 'ALLOW_UNSAFE_WERKZEUG': True},
        )

    with pytest.raises(RuntimeError, match='ALLOW_EMBEDDED_WEB_SERVER must remain disabled'):
        create_app(
            'production',
            overrides={**base_overrides, 'ALLOW_EMBEDDED_WEB_SERVER': True},
        )

    with pytest.raises(RuntimeError, match='CSP_STYLE_UNSAFE_INLINE must remain disabled'):
        create_app(
            'production',
            overrides={**base_overrides, 'CSP_STYLE_UNSAFE_INLINE': True},
        )

    with pytest.raises(RuntimeError, match='CHAT_MEDIA_AV_SCAN_ENABLED must be enabled'):
        create_app(
            'production',
            overrides={**base_overrides, 'CHAT_MEDIA_AV_SCAN_ENABLED': False},
        )

    with pytest.raises(RuntimeError, match='CHAT_MEDIA_AV_FAIL_CLOSED must be enabled'):
        create_app(
            'production',
            overrides={**base_overrides, 'CHAT_MEDIA_AV_FAIL_CLOSED': False},
        )

    with pytest.raises(RuntimeError, match='CHAT_MEDIA_AV_COMMAND must be configured'):
        create_app(
            'production',
            overrides={**base_overrides, 'CHAT_MEDIA_AV_COMMAND': ''},
        )

    with pytest.raises(RuntimeError, match='WEB_PUSH_VAPID_PUBLIC_KEY must be configured'):
        create_app(
            'production',
            overrides={**base_overrides, 'WEB_PUSH_VAPID_PUBLIC_KEY': ''},
        )


def test_proxy_fix_resolves_client_ip_from_forwarded_headers():
    app_with_proxy_fix = create_app(
        'testing',
        overrides={
            'RUN_MIGRATIONS_ON_STARTUP': False,
            'PROXY_FIX_X_FOR': 1,
            'PROXY_FIX_X_PROTO': 1,
            'PROXY_FIX_X_HOST': 1,
            'PROXY_FIX_X_PORT': 1,
        },
    )

    @app_with_proxy_fix.route('/_test_proxyfix_identity')
    def _test_proxyfix_identity():
        from flask import request

        return f'{request.remote_addr}|{request.scheme}|{request.host}'

    client = app_with_proxy_fix.test_client()
    response = client.get(
        '/_test_proxyfix_identity',
        headers={
            'Host': 'internal.local',
            'X-Forwarded-For': '203.0.113.42',
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-Host': 'chat.example.test',
            'X-Forwarded-Port': '443',
        },
    )
    remote_addr, scheme, host = response.get_data(as_text=True).split('|', 2)
    assert remote_addr == '203.0.113.42'
    assert scheme == 'https'
    assert host.startswith('chat.example.test')

    app_without_proxy_fix = create_app(
        'testing',
        overrides={
            'RUN_MIGRATIONS_ON_STARTUP': False,
            'PROXY_FIX_X_FOR': 0,
            'PROXY_FIX_X_PROTO': 0,
            'PROXY_FIX_X_HOST': 0,
            'PROXY_FIX_X_PORT': 0,
        },
    )

    @app_without_proxy_fix.route('/_test_no_proxyfix_identity')
    def _test_no_proxyfix_identity():
        from flask import request

        return request.remote_addr or ''

    raw_client = app_without_proxy_fix.test_client()
    raw_response = raw_client.get(
        '/_test_no_proxyfix_identity',
        headers={'X-Forwarded-For': '203.0.113.42'},
    )
    assert raw_response.get_data(as_text=True) == '127.0.0.1'


def test_csp_uses_script_nonce_and_restricts_websocket_sources():
    app = create_app(
        'testing',
        overrides={
            'RUN_MIGRATIONS_ON_STARTUP': False,
            'CONNECT_SRC_HOSTS': 'https://api.example.test wss://push.example.test',
        },
    )

    response = app.test_client().get('/', headers={'Host': 'chat.example.test'})
    csp = str(response.headers.get('Content-Security-Policy') or '')
    assert csp

    directives = {}
    for raw_part in csp.split(';'):
        part = raw_part.strip()
        if not part:
            continue
        name, _, _rest = part.partition(' ')
        directives[name] = part

    script_src = directives.get('script-src', '')
    style_src = directives.get('style-src', '')
    style_src_elem = directives.get('style-src-elem', '')
    style_src_attr = directives.get('style-src-attr', '')
    connect_src = directives.get('connect-src', '')
    media_src = directives.get('media-src', '')
    manifest_src = directives.get('manifest-src', '')
    worker_src = directives.get('worker-src', '')
    frame_src = directives.get('frame-src', '')
    object_src = directives.get('object-src', '')
    base_uri = directives.get('base-uri', '')
    form_action = directives.get('form-action', '')

    assert "'unsafe-inline'" not in script_src
    assert "'nonce-" in script_src
    assert "'unsafe-inline'" not in style_src
    assert "'unsafe-inline'" not in style_src_elem
    assert "'self'" in style_src_elem
    assert style_src_attr == "style-src-attr 'unsafe-inline'"
    assert object_src == "object-src 'none'"
    assert base_uri == "base-uri 'self'"
    assert form_action == "form-action 'self'"
    assert manifest_src == "manifest-src 'self'"
    assert worker_src == "worker-src 'self' blob:"
    assert frame_src == "frame-src 'self'"
    assert 'blob:' in media_src
    assert 'data:' in media_src

    padded_connect = f' {connect_src} '
    assert ' ws: ' not in padded_connect
    assert ' wss: ' not in padded_connect
    assert 'ws://chat.example.test' in connect_src
    assert 'wss://chat.example.test' in connect_src
    assert 'https://api.example.test' in connect_src
    assert 'wss://push.example.test' in connect_src


def test_csp_in_production_disables_plain_ws_and_enforces_upgrade(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 'p' * 64)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://sunmessenger:test@127.0.0.1:5432/sunmessenger')
    app = create_app(
        'production',
        overrides={
            **_secure_production_overrides(),
            'REDIS_URL': 'redis://127.0.0.1:6379/0',
            'RATELIMIT_STORAGE_URI': 'redis://127.0.0.1:6379/1',
            'SOCKETIO_MESSAGE_QUEUE': 'redis://127.0.0.1:6379/2',
        },
    )

    response = app.test_client().get('/', headers={'Host': 'sunmessenger.ru'})
    csp = str(response.headers.get('Content-Security-Policy') or '')
    assert csp
    assert 'ws://sunmessenger.ru' not in csp
    assert 'wss://sunmessenger.ru' in csp
    assert 'upgrade-insecure-requests' in csp


def test_production_config_check_reports_failed_and_ok():
    failed = run_production_config_check(
        'production',
        overrides={
            'ENV_NAME': 'production',
            'SECRET_KEY': 'change-me',
            'USING_DEV_SECRET_KEY': True,
            'FORCE_HTTPS': False,
            'SESSION_COOKIE_SECURE': False,
            'SESSION_COOKIE_HTTPONLY': False,
            'SESSION_COOKIE_SAMESITE': 'None',
            'PROXY_FIX_X_PROTO': 0,
            'REDIS_URL': '',
            'RATELIMIT_STORAGE_URI': 'memory://',
            'SOCKETIO_MESSAGE_QUEUE': '',
        },
    )
    assert failed['status'] == 'failed'
    assert any(check['ok'] is False for check in failed['checks'])

    ok = run_production_config_check(
        'production',
        overrides={
            'ENV_NAME': 'production',
            'SECRET_KEY': 'u' * 64,
            'USING_DEV_SECRET_KEY': False,
            'FORCE_HTTPS': True,
            'SESSION_COOKIE_SECURE': True,
            'SESSION_COOKIE_HTTPONLY': True,
            'SESSION_COOKIE_SAMESITE': 'Lax',
            'PROXY_FIX_X_PROTO': 1,
            'REDIS_URL': 'redis://127.0.0.1:6379/0',
            'RATELIMIT_STORAGE_URI': 'redis://127.0.0.1:6379/1',
            'SOCKETIO_MESSAGE_QUEUE': 'redis://127.0.0.1:6379/2',
        },
    )
    assert ok['status'] == 'ok'
    assert all(check['ok'] for check in ok['checks'])


def test_pip_audit_runtime_happy_path_and_missing_file(monkeypatch):
    class _FakeCompleted:
        def __init__(self):
            self.returncode = 0
            self.stdout = '{"dependencies":[],"vulns":[]}\n'
            self.stderr = ''

    captured = {}

    def _fake_run(args, capture_output, text, check, cwd):
        captured['args'] = args
        captured['cwd'] = cwd
        captured['capture_output'] = capture_output
        captured['text'] = text
        captured['check'] = check
        return _FakeCompleted()

    monkeypatch.setattr(subprocess, 'run', _fake_run)

    report = run_pip_audit(['requirements.txt'], strict=True)
    assert report['status'] == 'ok'
    assert report['exit_code'] == 0
    assert '--strict' in report['command']
    assert '-r' in report['command']
    assert captured['capture_output'] is True
    assert captured['text'] is True

    missing = run_pip_audit(['definitely-missing-file.txt'])
    assert missing['status'] == 'failed'
    assert missing['exit_code'] == 2
    assert 'Missing requirements files' in missing['error']


def test_scheduler_cleanup_and_runtime(monkeypatch, tmp_path):
    db_path = tmp_path / 'scheduler-runtime.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO dialog_keys (key_value, creator_id, used, created_at)
            VALUES
                ('used-key', 1, 1, datetime('now')),
                ('old-key', 1, 0, datetime('now', '-2 minutes')),
                ('fresh-key', 1, 0, datetime('now'))
            '''
        )
        conn.commit()

    scheduler_runtime.cleanup_dialog_keys()

    with _connect(db_path) as conn:
        remaining_keys = {
            row['key_value']
            for row in conn.execute('SELECT key_value FROM dialog_keys').fetchall()
        }

    assert remaining_keys == {'fresh-key'}

    scheduler = scheduler_runtime.create_scheduler()
    assert {job.id for job in scheduler.get_jobs()} == {
        'cleanup_dialog_keys',
        'cleanup_disappearing_messages',
        'cleanup_refresh_tokens',
        'cleanup_soft_deleted_messages',
    }

    spotify_scheduler = scheduler_runtime.create_scheduler({
        'SPOTIFY_CLIENT_ID': 'spotify-client',
        'SPOTIFY_CLIENT_SECRET': 'spotify-secret',
        'SPOTIFY_POLLING_INTERVAL_SECONDS': 10,
    })
    spotify_job = spotify_scheduler.get_job('poll_spotify_now_playing')
    assert spotify_job is not None
    assert spotify_job.trigger.interval.total_seconds() == 15

    class FakeScheduler:
        def __init__(self):
            self.started = 0
            self.shutdown_calls = []

        def start(self):
            self.started += 1

        def shutdown(self, wait=False):
            self.shutdown_calls.append(wait)

    scheduler_runtime._scheduler_started = False
    scheduler_runtime._scheduler_instance = None
    fake_scheduler = FakeScheduler()
    monkeypatch.setattr(scheduler_runtime, 'create_scheduler', lambda config=None: fake_scheduler)

    disabled = scheduler_runtime.start_scheduler_if_enabled({'SCHEDULER_ENABLED': False})
    assert disabled is None

    started = scheduler_runtime.start_scheduler_if_enabled({'SCHEDULER_ENABLED': True})
    started_again = scheduler_runtime.start_scheduler_if_enabled({'SCHEDULER_ENABLED': True})
    assert started is fake_scheduler
    assert started_again is fake_scheduler
    assert fake_scheduler.started == 1

    scheduler_runtime._scheduler_started = False
    scheduler_runtime._scheduler_instance = None
    fake_runtime_scheduler = FakeScheduler()
    monkeypatch.setattr(
        scheduler_runtime,
        'start_scheduler_if_enabled',
        lambda config: fake_runtime_scheduler,
    )

    class _FakeConfig:
        @classmethod
        def from_env(cls):
            return {'DATABASE_PATH': str(db_path), 'SCHEDULER_ENABLED': True}

    config_module = importlib.import_module('app.config')
    monkeypatch.setattr(config_module, 'get_config_class', lambda config_name=None: _FakeConfig)
    monkeypatch.setattr(scheduler_runtime.time, 'sleep', lambda _seconds: (_ for _ in ()).throw(KeyboardInterrupt()))

    scheduler_runtime.run_scheduler_forever('testing')
    assert fake_runtime_scheduler.shutdown_calls == [False]


def test_spotify_scheduler_poll_uses_stored_config(monkeypatch):
    from app.services import spotify

    class FakeConn:
        def close(self):
            pass

    conns = iter([FakeConn(), FakeConn()])
    calls = []
    monkeypatch.setattr(scheduler_runtime, '_spotify_poll_client_id', 'spotify-client')
    monkeypatch.setattr(scheduler_runtime, '_spotify_poll_client_secret', 'spotify-secret')

    monkeypatch.setattr(scheduler_runtime, 'get_db_connection', lambda: next(conns))
    monkeypatch.setattr(spotify, 'get_connected_user_ids', lambda conn: [42])
    monkeypatch.setattr(
        spotify,
        'poll_and_update',
        lambda conn, user_id, client_id, client_secret: calls.append(
            (user_id, client_id, client_secret)
        ),
    )

    scheduler_runtime.poll_spotify_now_playing()

    assert calls == [(42, 'spotify-client', 'spotify-secret')]


def test_web_runtime_logging_and_server_modes(monkeypatch, tmp_path):
    eventlet_logger = logging.getLogger('eventlet.wsgi.server')
    werkzeug_logger = logging.getLogger('werkzeug')
    eventlet_before = len(eventlet_logger.filters)
    werkzeug_before = len(werkzeug_logger.filters)

    web_runtime.configure_web_runtime_logging()
    eventlet_added = eventlet_logger.filters[eventlet_before:]
    werkzeug_added = werkzeug_logger.filters[werkzeug_before:]
    assert len(eventlet_added) == 1
    assert len(werkzeug_added) == 1
    assert isinstance(eventlet_added[0], web_runtime._AbortedConnectionFilter)
    assert isinstance(werkzeug_added[0], web_runtime._AbortedConnectionFilter)
    assert web_runtime._AbortedConnectionFilter().filter(
        logging.makeLogRecord({'msg': 'ConnectionAbortedError while serving request'})
    ) is False
    assert web_runtime._AbortedConnectionFilter().filter(
        logging.makeLogRecord({'msg': 'regular log line'})
    ) is True

    app = create_app(
        'testing',
        overrides={
            'RUN_MIGRATIONS_ON_STARTUP': False,
            'PORT': 5001,
            'TLS_PORT': 5443,
            'HOST': '127.0.0.1',
            'DEBUG': True,
            'ALLOW_UNSAFE_WERKZEUG': True,
            'TLS_CERT_PATH': str(tmp_path / 'cert.pem'),
            'TLS_KEY_PATH': str(tmp_path / 'key.pem'),
        },
    )

    monkeypatch.setattr(web_runtime, 'create_web_app', lambda config_name=None, overrides=None: app)
    run_calls = []
    monkeypatch.setattr(
        web_runtime.socketio,
        'run',
        lambda app_obj, **kwargs: run_calls.append({'app': app_obj, 'kwargs': kwargs}),
    )
    monkeypatch.setattr(web_runtime.os.path, 'exists', lambda path: False)

    returned_app = web_runtime.run_web_server('testing')
    assert returned_app is app
    assert run_calls[0]['kwargs'] == {
        'host': '127.0.0.1',
        'port': 5001,
        'debug': True,
        'use_reloader': True,
        'allow_unsafe_werkzeug': True,
    }

    run_calls.clear()
    monkeypatch.setattr(
        web_runtime.os.path,
        'exists',
        lambda path: path in {app.config['TLS_CERT_PATH'], app.config['TLS_KEY_PATH']},
    )
    returned_app = web_runtime.run_web_server('testing')
    assert returned_app is app
    assert run_calls[0]['kwargs'] == {
        'host': '127.0.0.1',
        'port': 5443,
        'certfile': app.config['TLS_CERT_PATH'],
        'keyfile': app.config['TLS_KEY_PATH'],
        'allow_unsafe_werkzeug': True,
    }


def test_web_runtime_tls_fallback_to_ssl_context_on_werkzeug(monkeypatch, tmp_path):
    app = create_app(
        'testing',
        overrides={
            'RUN_MIGRATIONS_ON_STARTUP': False,
            'TLS_PORT': 5443,
            'HOST': '127.0.0.1',
            'ALLOW_UNSAFE_WERKZEUG': True,
            'TLS_CERT_PATH': str(tmp_path / 'cert.pem'),
            'TLS_KEY_PATH': str(tmp_path / 'key.pem'),
        },
    )

    monkeypatch.setattr(web_runtime, 'create_web_app', lambda config_name=None, overrides=None: app)
    monkeypatch.setattr(
        web_runtime.os.path,
        'exists',
        lambda path: path in {app.config['TLS_CERT_PATH'], app.config['TLS_KEY_PATH']},
    )

    run_calls = []

    def _fake_run(app_obj, **kwargs):
        run_calls.append({'app': app_obj, 'kwargs': kwargs})
        if 'certfile' in kwargs:
            raise TypeError("run_simple() got an unexpected keyword argument 'certfile'")

    monkeypatch.setattr(web_runtime.socketio, 'run', _fake_run)

    returned_app = web_runtime.run_web_server('testing')
    assert returned_app is app
    assert len(run_calls) == 2
    assert run_calls[0]['kwargs'] == {
        'host': '127.0.0.1',
        'port': 5443,
        'certfile': app.config['TLS_CERT_PATH'],
        'keyfile': app.config['TLS_KEY_PATH'],
        'allow_unsafe_werkzeug': True,
    }
    assert run_calls[1]['kwargs'] == {
        'host': '127.0.0.1',
        'port': 5443,
        'ssl_context': (app.config['TLS_CERT_PATH'], app.config['TLS_KEY_PATH']),
        'allow_unsafe_werkzeug': True,
    }


def test_web_runtime_rejects_embedded_server_in_production(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 'y' * 64)
    app = create_app(
        'testing',
        overrides={
            'RUN_MIGRATIONS_ON_STARTUP': False,
            'ALLOW_EMBEDDED_WEB_SERVER': False,
        },
    )
    app.config['ENV_NAME'] = 'production'

    monkeypatch.setattr(web_runtime, 'create_web_app', lambda config_name=None, overrides=None: app)

    with pytest.raises(RuntimeError, match='Embedded socketio.run server is disabled in production'):
        web_runtime.run_web_server('production')
