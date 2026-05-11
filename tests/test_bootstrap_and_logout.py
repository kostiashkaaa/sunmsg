import json
from pathlib import Path
import re
import subprocess

from app import create_app
from app.extensions import socketio
from app.routes import auth as auth_routes
from app.services.refresh_tokens import REFRESH_COOKIE_NAME, issue_refresh_token
from werkzeug.exceptions import BadRequest
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


def _extract_csrf_token(html: str) -> str:
    match = re.search(r'<meta name="csrf-token" content="([^"]+)"', html)
    assert match is not None
    return match.group(1)


def _extract_bootstrap_payload(html: str) -> dict:
    match = re.search(
        r'<script id="sun-bootstrap-data" type="application/json"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    )
    assert match is not None
    return json.loads(match.group(1))


def test_create_app_bootstraps_empty_database(monkeypatch, tmp_path):
    db_path = tmp_path / 'bootstrap.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    assert app is not None
    assert db_path.exists()

    with _connect(db_path) as conn:
        table_names = {
            row['name']
            for row in conn.execute(
                "SELECT table_name AS name FROM information_schema.tables "
                "WHERE table_schema = current_schema()"
            ).fetchall()
        }

    assert {'users', 'messages', 'contacts', 'chats', 'dialog_requests'} <= table_names


def test_socketio_uses_threading_mode(monkeypatch, tmp_path):
    db_path = tmp_path / 'socketio.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    assert socketio.server.async_mode == 'threading'
    assert app.config['SOCKETIO_CLIENT_TRANSPORTS'] == 'polling,websocket'
    assert app.config['SOCKETIO_CLIENT_UPGRADE'] is False


def test_chat_page_uses_safe_socketio_client_config(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-page.db'
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

    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    response = client.get('/chat')
    html = response.get_data(as_text=True)
    bootstrap_payload = _extract_bootstrap_payload(html)

    assert response.status_code == 200
    assert bootstrap_payload['page'] == 'chat'
    assert bootstrap_payload['socketio']['transports'] == ['polling', 'websocket']
    assert bootstrap_payload['socketio']['upgrade'] is False
    assert bootstrap_payload['user']['currentUsername'] == 'alice'
    assert isinstance(bootstrap_payload['user']['clientPreferences'], dict)
    assert bootstrap_payload['assets']['qrcodeSrc'].startswith('/static/vendor/js/qrcode.min.js')
    assert 'window.SUN_SOCKETIO_CONFIG' not in html


def test_auth_and_settings_pages_embed_bootstrap_payload(monkeypatch, tmp_path):
    db_path = tmp_path / 'bootstrap-pages.db'
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

    client = app.test_client()

    auth_response = client.get('/')
    auth_html = auth_response.get_data(as_text=True)
    auth_bootstrap = _extract_bootstrap_payload(auth_html)
    assert auth_response.status_code == 200
    assert auth_bootstrap['page'] == 'auth'
    assert auth_bootstrap['assets']['qrcodeSrc'].startswith('/static/vendor/js/qrcode.min.js')
    assert 'window.SUN_QRCODE_SRC' not in auth_html

    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    settings_response = client.get('/settings')
    settings_html = settings_response.get_data(as_text=True)
    settings_bootstrap = _extract_bootstrap_payload(settings_html)
    assert settings_response.status_code == 200
    assert settings_bootstrap['page'] == 'settings'
    assert settings_bootstrap['user']['currentUsername'] == 'alice'
    assert settings_bootstrap['user']['embedMode'] is False
    assert settings_bootstrap['socketio']['transports'] == ['polling', 'websocket']
    assert settings_bootstrap['socketio']['upgrade'] is False
    assert isinstance(settings_bootstrap['user']['clientPreferences'], dict)
    assert settings_bootstrap['assets']['qrcodeSrc'].startswith('/static/vendor/js/qrcode.min.js')
    assert 'window.SUN_QRCODE_SRC' not in settings_html
    assert 'pages/settings-qr.js' not in settings_html
    assert '/static/vendor/js/socket.io.min.js' in settings_html
    assert 'pages/settings.js' in settings_html


def test_bootstrap_runtime_populates_legacy_globals_from_single_payload():
    script_path = Path(__file__).resolve().parents[1] / 'static' / 'bootstrap.js'

    node_harness = f"""
const fs = require('fs');
const vm = require('vm');

const payload = {{
  page: 'chat',
  user: {{
    currentUserPublicKey: 'pk-1',
    currentDisplayName: 'Alice',
    currentUsername: 'alice',
    currentUserId: '42',
    currentAvatarUrl: '/static/avatars/a.png',
    initialChatContactUsername: 'bob',
    uiLanguage: 'en',
    clientPreferences: {{
      darkMode: true,
      messageScale: 1.2,
      performanceMode: 'lite',
      motionLevel: 'balanced',
      sendShortcut: 'ctrl_enter',
      timeFormat: '12h',
      interfaceThemeStore: {{ version: 2, themes: {{ light: {{ accent: '#c58a22' }}, dark: {{ accent: '#d6a449' }} }} }},
      chatAppearanceStore: {{ themes: {{ light: {{ mode: 'default' }}, dark: {{ mode: 'default' }} }} }},
    }},
  }},
  socketio: {{
    transports: ['polling', 'websocket'],
    upgrade: false,
  }},
  assets: {{
    qrcodeSrc: '/static/vendor/js/qrcode.min.js?v=123',
  }},
}};

const bootstrapScript = {{
  textContent: JSON.stringify(payload),
}};

const localStorageState = {{}};
const localStorage = {{
  getItem(key) {{
    return Object.prototype.hasOwnProperty.call(localStorageState, key) ? localStorageState[key] : null;
  }},
  setItem(key, value) {{
    localStorageState[key] = String(value);
  }},
  removeItem(key) {{
    delete localStorageState[key];
  }},
}};

const windowObj = {{}};
const context = {{
  window: windowObj,
  localStorage,
  document: {{
    documentElement: {{ lang: 'ru' }},
    body: {{
      dataset: {{
        currentUsername: 'fallback-user',
      }},
    }},
    getElementById(id) {{
      return id === 'sun-bootstrap-data' ? bootstrapScript : null;
    }},
  }},
  console,
}};

windowObj.window = windowObj;
windowObj.document = context.document;

const source = fs.readFileSync({str(script_path)!r}, 'utf8');
vm.runInNewContext(source, context, {{ filename: 'bootstrap.js' }});

if (!windowObj.SUN_BOOTSTRAP) throw new Error('SUN_BOOTSTRAP was not created');
if (windowObj.SUN_BOOTSTRAP.page !== 'chat') throw new Error('Unexpected bootstrap page');
if (windowObj.SUN_BOOTSTRAP.user.currentUsername !== 'alice') throw new Error('Bootstrap user.username mismatch');
if (windowObj.SUN_BOOTSTRAP.user.clientPreferences.darkMode !== true) throw new Error('Bootstrap user.clientPreferences mismatch');
if (!Array.isArray(windowObj.SUN_BOOTSTRAP.socketio.transports)) throw new Error('Socket transports missing');
if (windowObj.SUN_BOOTSTRAP.socketio.upgrade !== false) throw new Error('Socket upgrade mismatch');
if (windowObj.SUN_QRCODE_SRC !== '/static/vendor/js/qrcode.min.js?v=123') throw new Error('QR source mismatch');
if (windowObj.currentUserId !== '42') throw new Error('Legacy currentUserId mismatch');
if (windowObj.currentDisplayName !== 'Alice') throw new Error('Legacy currentDisplayName mismatch');
if (typeof windowObj.getSunBootstrap !== 'function') throw new Error('Bootstrap accessor missing');
if (localStorageState.darkMode !== 'true') throw new Error('darkMode was not persisted from bootstrap clientPreferences');
if (localStorageState.sun_chat_message_scale_v1 !== '1.20') throw new Error('message scale was not persisted from bootstrap clientPreferences');
if (localStorageState.sun_performance_mode !== 'lite') throw new Error('performance mode was not persisted from bootstrap clientPreferences');
if (localStorageState.sun_motion_level !== 'balanced') throw new Error('motion level was not persisted from bootstrap clientPreferences');
if (localStorageState.sun_send_shortcut_mode_v1 !== 'ctrl_enter') throw new Error('send shortcut was not persisted from bootstrap clientPreferences');
if (localStorageState.sun_time_format_v1 !== '12h') throw new Error('time format was not persisted from bootstrap clientPreferences');
if (!localStorageState['sun.interfaceTheme.v1']) throw new Error('interface theme store was not persisted');
if (!localStorageState['sun.chatAppearance.v2']) throw new Error('chat appearance store was not persisted');
"""

    result = subprocess.run(
        ['node', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout


def test_logout_revokes_refresh_token_from_cookie(monkeypatch, tmp_path):
    db_path = tmp_path / 'logout.db'
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

    with app.test_request_context('/api/refresh', headers={'User-Agent': 'pytest'}):
        raw_token, _exp = issue_refresh_token(1)

    client = app.test_client()
    client.set_cookie(REFRESH_COOKIE_NAME, raw_token)
    csrf_response = client.get('/', follow_redirects=True)
    csrf_html = csrf_response.get_data(as_text=True)
    if '<meta name="csrf-token"' not in csrf_html:
        fallback_response = client.get('/chat')
        csrf_html = fallback_response.get_data(as_text=True)
    csrf_token = _extract_csrf_token(csrf_html)

    response = client.post('/logout', data={'csrf_token': csrf_token})

    assert response.status_code == 302

    with _connect(db_path) as conn:
        row = conn.execute(
            'SELECT revoked_at FROM refresh_tokens WHERE user_id = 1'
        ).fetchone()

    assert row is not None
    assert row['revoked_at'] is not None


def test_logout_rejects_get_method(monkeypatch, tmp_path):
    db_path = tmp_path / 'logout-get.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = app.test_client()

    response = client.get('/logout')

    assert response.status_code == 405


def test_index_clears_stale_session_and_renders_login(monkeypatch, tmp_path):
    db_path = tmp_path / 'stale.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = app.test_client()

    with client.session_transaction() as sess:
        sess['user_id'] = 57
        sess['public_key_pem'] = 'missing-public-key'

    response = client.get('/')

    assert response.status_code == 200

    with client.session_transaction() as sess:
        assert 'user_id' not in sess
        assert 'public_key_pem' not in sess


def test_index_restores_session_from_refresh_cookie_and_redirects_to_chat(monkeypatch, tmp_path):
    db_path = tmp_path / 'index-refresh-restore.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, language)
            VALUES (1, 'pk-1', 'alice', 'Alice', 'ru')
            '''
        )
        conn.commit()

    with app.test_request_context('/api/refresh', headers={'User-Agent': 'pytest'}):
        raw_token, _exp = issue_refresh_token(1)

    client = app.test_client()
    client.set_cookie(REFRESH_COOKIE_NAME, raw_token)

    response = client.get('/')
    assert response.status_code == 302
    assert response.headers['Location'].endswith('/chat')
    assert any(REFRESH_COOKIE_NAME in cookie for cookie in response.headers.getlist('Set-Cookie'))

    with client.session_transaction() as sess:
        assert sess['user_id'] == 1
        assert sess['public_key_pem'] == 'pk-1'
        assert sess.permanent is True


def test_settings_closes_connection_on_missing_user(monkeypatch, tmp_path):
    db_path = tmp_path / 'settings-missing.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    class TrackingConnection:
        def __init__(self, inner):
            self._inner = inner
            self.closed = False

        def close(self):
            self.closed = True
            return self._inner.close()

        def __getattr__(self, name):
            return getattr(self._inner, name)

    tracked_connections = []
    original_get_db_connection = auth_routes.get_db_connection

    def _tracked_connection():
        tracked = TrackingConnection(original_get_db_connection())
        tracked_connections.append(tracked)
        return tracked

    monkeypatch.setattr(auth_routes, 'get_db_connection', _tracked_connection)

    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 999
        sess['public_key_pem'] = 'missing-public-key'

    response = client.get('/settings')

    assert response.status_code == 302
    assert tracked_connections
    assert tracked_connections[0].closed is True


def test_error_pages_render_html_and_keep_json_for_api(monkeypatch, tmp_path):
    db_path = tmp_path / 'error-pages.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    @app.route('/__test__/bad-request')
    def _bad_request():
        raise BadRequest('Некорректные параметры запроса.')

    @app.route('/__test__/server-error')
    def _server_error():
        raise RuntimeError('boom')

    @app.route('/api/__test__/server-error')
    def _api_server_error():
        raise RuntimeError('boom')

    client = app.test_client()

    bad_request_response = client.get('/__test__/bad-request', headers={'Accept': 'text/html'})
    bad_request_html = bad_request_response.get_data(as_text=True)

    assert bad_request_response.status_code == 400
    assert 'Запрос не удалось обработать' in bad_request_html
    assert 'Некорректные параметры запроса.' in bad_request_html
    assert 'error-page-panel' in bad_request_html

    server_error_response = client.get('/__test__/server-error', headers={'Accept': 'text/html'})
    server_error_html = server_error_response.get_data(as_text=True)

    assert server_error_response.status_code == 500
    assert 'Сервер временно недоступен' in server_error_html
    assert 'Обновить страницу' in server_error_html

    api_error_response = client.get('/api/__test__/server-error', headers={'Accept': 'application/json'})

    assert api_error_response.status_code == 500
    assert api_error_response.is_json is True
    assert api_error_response.get_json() == {
        'success': False,
        'error': 'Внутренняя ошибка сервера.',
    }
