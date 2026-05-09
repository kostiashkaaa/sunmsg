from pathlib import Path
import subprocess

from app import create_app
from app.services.presence import add_active, add_connected, remove_active, remove_connected
import manage
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


def test_chat_page_renders_initial_contacts_and_local_vendor_assets(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-boot.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (2, 'pk-2', 'bob', 'Bob')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-1')
            '''
        )
        conn.execute(
            '''
            INSERT INTO messages (chat_id, sender_id, receiver_id, message)
            VALUES ('chat-1', 2, 1, 'hello from bob')
            '''
        )
        conn.commit()

    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    response = client.get('/chat')
    html = response.get_data(as_text=True)

    assert response.status_code == 200
    assert 'id="appBootOverlay"' not in html
    assert 'id="contactsList"' in html
    assert 'data-chat-id="chat-1"' in html
    assert '/static/modules/bi-icon-adapter.js' in html
    assert '/static/vendor/js/qrcode.min.js' in html
    assert '/static/vendor/js/socket.io.min.js' in html
    assert 'fonts.googleapis.com' not in html
    assert 'cdn.jsdelivr.net' not in html
    assert 'cdnjs.cloudflare.com' not in html
    assert 'twemoji' not in html


def test_chat_page_renders_saved_messages_for_user_without_contacts(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-boot-empty.db'
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

    assert response.status_code == 200
    assert 'id="appBootOverlay"' not in html
    assert 'id="contactsList"' in html
    assert 'data-contact-id="1"' in html


def test_chat_key_restore_banner_reacts_to_private_key_status_event():
    script_path = Path(__file__).resolve().parents[1] / 'static' / 'pages' / 'chat-key-restore.js'

    node_harness = f"""
const fs = require('fs');
const vm = require('vm');

class FakeEventTarget {{
  constructor() {{
    this.listeners = new Map();
    this.style = {{}};
    this.innerHTML = '';
    this.textContent = '';
    this.disabled = false;
  }}

  addEventListener(type, handler) {{
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }}

  dispatchEvent(event) {{
    const handlers = this.listeners.get(event.type) || [];
    for (const handler of handlers) {{
      handler.call(this, event);
    }}
  }}

  querySelector() {{
    return null;
  }}

  querySelectorAll() {{
    return [];
  }}

  appendChild() {{
    return null;
  }}

  focus() {{
    return null;
  }}
}}

function createStorage() {{
  const data = new Map();
  return {{
    getItem(key) {{
      return data.has(key) ? data.get(key) : null;
    }},
    setItem(key, value) {{
      data.set(key, String(value));
    }},
    removeItem(key) {{
      data.delete(key);
    }},
  }};
}}

const elements = new Map();
for (const id of [
  'e2eLockAlert',
  'keyRestoreModal',
  'keyRestoreGrid',
  'keyRestoreError',
  'keyRestoreSubmitBtn',
  'keyRestoreCloseBtn',
  'keyRestoreCancelBtn',
]) {{
  elements.set(id, new FakeEventTarget());
}}

const windowTarget = new FakeEventTarget();
windowTarget._activateFocusTrap = () => {{}};
windowTarget._deactivateFocusTrap = () => {{}};
let inMemoryPrivateKeyPem = '';
windowTarget.sunPrivateKeySession = {{
  getPrivateKeyPem() {{
    return inMemoryPrivateKeyPem;
  }},
  async stagePrivateKeyForRedirect(pem) {{
    inMemoryPrivateKeyPem = String(pem || '');
    return !!inMemoryPrivateKeyPem;
  }},
  _setPrivateKey(pem) {{
    inMemoryPrivateKeyPem = String(pem || '');
  }},
}};

const context = {{
  window: windowTarget,
  document: {{
    getElementById(id) {{
      return elements.get(id) || null;
    }},
  }},
  sessionStorage: createStorage(),
  localStorage: createStorage(),
  Event: function Event(type) {{
    this.type = type;
  }},
  fetch: async () => {{
    throw new Error('fetch should not be called in this harness');
  }},
  console,
  setTimeout,
  clearTimeout,
}};

context.window.window = context.window;
context.window.document = context.document;
context.window.sessionStorage = context.sessionStorage;
context.window.localStorage = context.localStorage;
context.window.Event = context.Event;
context.window.fetch = context.fetch;
context.window.console = console;
context.window.setTimeout = setTimeout;
context.window.clearTimeout = clearTimeout;

const source = fs.readFileSync({str(script_path)!r}, 'utf8');
vm.runInNewContext(source, context, {{ filename: 'chat-key-restore.js' }});

const alertEl = elements.get('e2eLockAlert');
if (alertEl.style.display !== 'none') {{
  throw new Error(`Expected lock alert to stay hidden on boot, got ${{alertEl.style.display}}`);
}}

context.window.sunPrivateKeySession._setPrivateKey('pem');
context.window.dispatchEvent(new context.Event('sun-private-key-status-changed'));

if (alertEl.style.display !== 'none') {{
  throw new Error(`Expected lock alert to stay hidden after key restore event, got ${{alertEl.style.display}}`);
}}

context.window.sunPrivateKeySession._setPrivateKey('');
context.window.dispatchEvent(new context.Event('sun-private-key-status-changed'));

if (alertEl.style.display !== 'none') {{
  throw new Error(`Expected lock alert to stay hidden after key removal, got ${{alertEl.style.display}}`);
}}
"""

    result = subprocess.run(
        ['node', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout


def test_manage_cli_dispatches_runtime_modes(monkeypatch):
    calls = []

    monkeypatch.setattr(
        manage,
        'run_web_server',
        lambda config_name=None: calls.append(('web', config_name)),
    )
    monkeypatch.setattr(
        manage,
        'run_scheduler_forever',
        lambda config_name=None: calls.append(('scheduler', config_name)),
    )
    monkeypatch.setattr(
        manage,
        'run_database_maintenance',
        lambda config_name=None: calls.append(('maintenance', config_name)),
    )

    assert manage.main(['--env', 'testing', 'web']) == 0
    assert manage.main(['scheduler']) == 0
    assert manage.main(['maintenance']) == 0

    assert calls == [
        ('web', 'testing'),
        ('scheduler', None),
        ('maintenance', None),
    ]


def test_hidden_online_status_is_not_exposed_via_profile_or_contacts(monkeypatch, tmp_path):
    db_path = tmp_path / 'hidden-online.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, hide_online_status)
            VALUES (2, 'pk-2', 'bob', 'Bob', 1)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-1'), (2, 1, 'chat-1')
            '''
        )
        conn.commit()

    sid = 'sid-hidden-profile'
    add_connected('pk-2', sid)
    try:
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user_id'] = 1
            sess['public_key_pem'] = 'pk-1'

        profile_response = client.get('/get_user_profile?user_id=2')
        contacts_response = client.get('/get_contacts')

        assert profile_response.status_code == 200
        profile_payload = profile_response.get_json()
        assert profile_payload['success'] is True
        assert profile_payload['online'] is False
        assert profile_payload['last_seen'] is None

        assert contacts_response.status_code == 200
        contacts_payload = contacts_response.get_json()
        assert contacts_payload['success'] is True
        bob_contact = next(item for item in contacts_payload['contacts'] if int(item['userId']) == 2)
        assert bob_contact['is_online'] is False
    finally:
        remove_active('pk-2', sid)


def test_presence_store_drives_online_status_for_contacts_and_profiles(monkeypatch, tmp_path):
    db_path = tmp_path / 'presence-online.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_online)
            VALUES (1, 'pk-1', 'alice', 'Alice', 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_online)
            VALUES (2, 'pk-2', 'bob', 'Bob', 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-1'), (2, 1, 'chat-1')
            '''
        )
        conn.commit()

    sid = 'sid-presence-online'
    add_active('pk-2', sid)
    try:
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user_id'] = 1
            sess['public_key_pem'] = 'pk-1'

        profile_response = client.get('/get_user_profile?user_id=2')
        contacts_response = client.get('/get_contacts')

        assert profile_response.status_code == 200
        assert profile_response.get_json()['online'] is True

        assert contacts_response.status_code == 200
        contacts_payload = contacts_response.get_json()
        bob_contact = next(item for item in contacts_payload['contacts'] if int(item['userId']) == 2)
        assert bob_contact['is_online'] is True
    finally:
        remove_connected('pk-2', sid)


def test_private_profile_is_not_exposed_to_non_contacts(monkeypatch, tmp_path):
    db_path = tmp_path / 'private-profile-hidden.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_public)
            VALUES (1, 'pk-1', 'alice', 'Alice', 1)
            '''
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_public, bio)
            VALUES (2, 'pk-2', 'bob', 'Bob', 0, 'private bio')
            '''
        )
        conn.commit()

    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    response = client.get('/get_user_profile?user_id=2')

    assert response.status_code == 404
    payload = response.get_json()
    assert payload['success'] is False


def test_public_profile_remains_available_to_non_contacts(monkeypatch, tmp_path):
    db_path = tmp_path / 'public-profile-visible.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_public)
            VALUES (1, 'pk-1', 'alice', 'Alice', 1)
            '''
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_public, bio)
            VALUES (2, 'pk-2', 'bob', 'Bob', 1, 'public bio')
            '''
        )
        conn.commit()

    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    response = client.get('/get_user_profile?user_id=2')

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['restricted'] is False
    assert payload['display_name'] == 'Bob'
    assert payload['username'] == 'bob'
    assert payload['public_key'] == 'pk-2'
    assert payload['bio'] == 'public bio'
    assert payload['online'] is None
    assert payload['last_seen'] is None
