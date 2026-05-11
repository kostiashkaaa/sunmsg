from __future__ import annotations

from flask import Blueprint, Flask

from app.routes.chat_page_routes import register_chat_page_routes


class _Logger:
    def __init__(self):
        self.messages = []

    def info(self, message, *args):
        self.messages.append((message, args))


class _FakeCursor:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeConn:
    def __init__(self, *, row=None, close_probe=None):
        self._row = row
        self._close_probe = close_probe

    def execute(self, *_args, **_kwargs):
        return _FakeCursor(self._row)

    def close(self):
        if callable(self._close_probe):
            self._close_probe()


def _build_test_app(
    *,
    get_db_connection_func,
    normalize_initial_chat_contact_username_func,
    clear_invalid_session_user_func,
    fetch_chat_page_context_func,
):
    app = Flask(__name__)
    app.secret_key = 'test-secret'

    auth_bp = Blueprint('auth', __name__)

    @auth_bp.route('/auth')
    def index():
        return 'auth'

    app.register_blueprint(auth_bp)

    chat_bp = Blueprint('chat', __name__)
    register_chat_page_routes(
        chat_bp,
        logger=_Logger(),
        get_db_connection_func=get_db_connection_func,
        clear_invalid_session_user_func=clear_invalid_session_user_func,
        fetch_chat_page_context_func=fetch_chat_page_context_func,
        fetch_contacts_for_user_func=lambda *_args, **_kwargs: [],
        language_from_user_row_func=lambda *_args, **_kwargs: 'en',
        build_socketio_client_config_func=lambda *_args, **_kwargs: {},
        web_push_bootstrap_payload_func=lambda *_args, **_kwargs: {},
        normalize_initial_chat_contact_username_func=normalize_initial_chat_contact_username_func,
        canonical_username_func=lambda raw: str(raw or '').strip().lower(),
        initial_contacts_ssr_limit=50,
    )
    app.register_blueprint(chat_bp)
    return app


def test_chat_index_requires_authenticated_session():
    app = _build_test_app(
        get_db_connection_func=lambda: (_ for _ in ()).throw(RuntimeError('db should not be used')),
        normalize_initial_chat_contact_username_func=lambda raw, canonical_username: canonical_username(raw),
        clear_invalid_session_user_func=lambda sess: sess.clear(),
        fetch_chat_page_context_func=lambda **_kwargs: (_ for _ in ()).throw(
            RuntimeError('context should not be loaded')
        ),
    )

    client = app.test_client()
    response = client.get('/chat')

    assert response.status_code == 302
    assert response.headers['Location'].endswith('/auth')


def test_chat_by_contact_redirects_to_chat_when_username_normalization_fails():
    app = _build_test_app(
        get_db_connection_func=lambda: (_ for _ in ()).throw(RuntimeError('db should not be used')),
        normalize_initial_chat_contact_username_func=lambda _raw, canonical_username: '',
        clear_invalid_session_user_func=lambda sess: sess.clear(),
        fetch_chat_page_context_func=lambda **_kwargs: (_ for _ in ()).throw(
            RuntimeError('context should not be loaded')
        ),
    )

    client = app.test_client()
    response = client.get('/chat/invalid')

    assert response.status_code == 302
    assert response.headers['Location'].endswith('/chat')


def test_username_chat_redirects_to_current_session_alias():
    close_calls = {'count': 0}
    cleared = {'called': False}

    def _mark_closed():
        close_calls['count'] += 1

    app = _build_test_app(
        get_db_connection_func=lambda: _FakeConn(row={'username': 'alice'}, close_probe=_mark_closed),
        normalize_initial_chat_contact_username_func=lambda raw, canonical_username: canonical_username(raw),
        clear_invalid_session_user_func=lambda sess: (sess.clear(), cleared.__setitem__('called', True)),
        fetch_chat_page_context_func=lambda **_kwargs: (_ for _ in ()).throw(
            RuntimeError('chat page render should not be reached')
        ),
    )

    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    response = client.get('/bob/chat')

    assert response.status_code == 302
    assert response.headers['Location'].endswith('/alice/chat')
    assert close_calls['count'] == 1
    assert cleared['called'] is False
