from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

from app import create_app
from app.routes import chat as chat_routes
from app.services.av_scan import AVScanError
from app.services.crypto import generate_chat_id
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


def _seed_chat_participants(db_path: Path, chat_id: str) -> None:
    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'alice', 'Alice'),
                (2, 'pk-2', 'bob', 'Bob')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, ?), (2, 1, ?)
            ''',
            (chat_id, chat_id),
        )
        conn.commit()


def test_upload_chat_media_blocks_infected_file(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-media-av-infected.db'
    media_dir = tmp_path / 'chat_media_av_infected'
    media_dir.mkdir()
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'CHAT_MEDIA_AV_SCAN_ENABLED': True,
            'CHAT_MEDIA_AV_FAIL_CLOSED': True,
            'CHAT_MEDIA_AV_COMMAND': 'scanner --scan {path}',
        },
    )
    monkeypatch.setattr(chat_routes, 'CHAT_MEDIA_FOLDER', str(media_dir))
    monkeypatch.setattr(
        chat_routes,
        'scan_file',
        lambda *args, **kwargs: SimpleNamespace(
            infected=True,
            signature='Eicar-Test-Signature',
            output='Eicar-Test-Signature FOUND',
        ),
    )

    chat_id = generate_chat_id('pk-1', 'pk-2')
    _seed_chat_participants(db_path, chat_id)
    client = _authed_client(app, 1, 'pk-1')

    response = client.post(
        '/upload_chat_media',
        data={
            'chat_id': chat_id,
            'file': (BytesIO(b'hello media'), 'note.txt', 'text/plain'),
        },
        content_type='multipart/form-data',
    )
    payload = response.get_json()

    assert response.status_code == 400
    assert payload['success'] is False
    assert list(media_dir.iterdir()) == []
    with _connect(db_path) as conn:
        count = conn.execute('SELECT COUNT(*) AS cnt FROM chat_media').fetchone()['cnt']
    assert int(count) == 0


def test_upload_chat_media_fail_closed_on_scanner_error(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-media-av-fail-closed.db'
    media_dir = tmp_path / 'chat_media_av_fail_closed'
    media_dir.mkdir()
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'CHAT_MEDIA_AV_SCAN_ENABLED': True,
            'CHAT_MEDIA_AV_FAIL_CLOSED': True,
            'CHAT_MEDIA_AV_COMMAND': 'scanner --scan {path}',
        },
    )
    monkeypatch.setattr(chat_routes, 'CHAT_MEDIA_FOLDER', str(media_dir))

    def _raise_scan_error(*args, **kwargs):
        raise AVScanError('scanner unavailable')

    monkeypatch.setattr(chat_routes, 'scan_file', _raise_scan_error)

    chat_id = generate_chat_id('pk-1', 'pk-2')
    _seed_chat_participants(db_path, chat_id)
    client = _authed_client(app, 1, 'pk-1')

    response = client.post(
        '/upload_chat_media',
        data={
            'chat_id': chat_id,
            'file': (BytesIO(b'hello media'), 'note.txt', 'text/plain'),
        },
        content_type='multipart/form-data',
    )
    payload = response.get_json()

    assert response.status_code == 503
    assert payload['success'] is False
    assert list(media_dir.iterdir()) == []
    with _connect(db_path) as conn:
        count = conn.execute('SELECT COUNT(*) AS cnt FROM chat_media').fetchone()['cnt']
    assert int(count) == 0


def test_upload_chat_media_fail_open_on_scanner_error(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-media-av-fail-open.db'
    media_dir = tmp_path / 'chat_media_av_fail_open'
    media_dir.mkdir()
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'CHAT_MEDIA_AV_SCAN_ENABLED': True,
            'CHAT_MEDIA_AV_FAIL_CLOSED': False,
            'CHAT_MEDIA_AV_COMMAND': 'scanner --scan {path}',
        },
    )
    monkeypatch.setattr(chat_routes, 'CHAT_MEDIA_FOLDER', str(media_dir))

    def _raise_scan_error(*args, **kwargs):
        raise AVScanError('scanner unavailable')

    monkeypatch.setattr(chat_routes, 'scan_file', _raise_scan_error)

    chat_id = generate_chat_id('pk-1', 'pk-2')
    _seed_chat_participants(db_path, chat_id)
    client = _authed_client(app, 1, 'pk-1')

    response = client.post(
        '/upload_chat_media',
        data={
            'chat_id': chat_id,
            'file': (BytesIO(b'hello media'), 'note.txt', 'text/plain'),
        },
        content_type='multipart/form-data',
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    with _connect(db_path) as conn:
        media_row = conn.execute(
            'SELECT storage_name, original_name FROM chat_media WHERE id = ?',
            (int(payload['url'].rsplit('/', 1)[-1]),),
        ).fetchone()

    assert media_row['original_name'] == 'note.txt'
    assert (media_dir / media_row['storage_name']).exists()
