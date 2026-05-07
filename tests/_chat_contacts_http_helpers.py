from pathlib import Path

from app.routes import chat as chat_routes
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


def _capture_socket_emits(monkeypatch):
    emitted = []

    def _fake_emit(name, payload=None, *args, **kwargs):
        emitted.append(
            {
                'name': name,
                'payload': payload,
                'args': args,
                'kwargs': kwargs,
            }
        )

    monkeypatch.setattr(chat_routes.socketio, 'emit', _fake_emit)
    return emitted


def _png_bytes():
    return b'\x89PNG\r\n\x1a\n' + b'\x00' * 32
