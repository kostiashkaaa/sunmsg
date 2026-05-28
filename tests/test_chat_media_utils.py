import sqlite3
from io import BytesIO
from types import SimpleNamespace
from zipfile import ZipFile

import pytest

from app.routes import chat as chat_routes
from app.routes.chat_media_utils import (
    allowed_file,
    canonical_username,
    detect_chat_media_type,
    matches_magic_rules,
    normalize_chat_media_mime,
    read_stream_head,
    serialize_block_state,
    validate_chat_media_content,
    validate_image_payload,
    validate_magic,
    validate_openxml_package,
    validate_text_like_payload,
)
from app.services.chat_media_service import upload_chat_media_for_user
from app.services.image_sanitizer import sanitize_image_to_path


# Minimal valid 1x1 PNG. Used wherever a test needs a payload that passes
# both magic-bytes and Pillow.verify(). Generated once via Pillow and frozen
# so the suite does not need to rebuild the bytes on every run.
_VALID_PNG_1X1 = bytes.fromhex(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753'
    'de0000000c49444154789c63f8ffff3f0005fe02fe0def46b80000000049454e'
    '44ae426082'
)


_MAGIC_BYTES = {
    'png': [(0, b'\x89PNG\r\n\x1a\n')],
    'jpg': [(0, b'\xff\xd8\xff')],
}

_CHAT_MEDIA_MAGIC_RULES = {
    'png': [[(0, b'\x89PNG\r\n\x1a\n')]],
    'mp3': [[(0, b'ID3')], [(0, b'\xff\xfb')], [(0, b'\xff\xfa')], [(0, b'\xff\xf3')], [(0, b'\xff\xf2')], [(0, b'\xff\xe3')], [(0, b'\xff\xe2')]],
    'txt': [],
    'docx': [[(0, b'PK\x03\x04')], [(0, b'PK\x05\x06')], [(0, b'PK\x07\x08')]],
    'xlsx': [[(0, b'PK\x03\x04')], [(0, b'PK\x05\x06')], [(0, b'PK\x07\x08')]],
}


class _Upload:
    def __init__(self, raw: bytes):
        self.stream = BytesIO(raw)


class _UploadFile:
    filename = 'note.txt'
    mimetype = 'text/plain'

    def __init__(self, raw: bytes):
        self.stream = BytesIO(raw)

    def save(self, path: str) -> None:
        with open(path, 'wb') as output:
            output.write(self.stream.getvalue())


class _InsertCursor:
    def fetchone(self):
        return {'id': 42}


class _FakeMediaConnection:
    def __init__(self, name: str):
        self.name = name
        self.closed = False
        self.commits = 0

    def execute(self, query, params=()):
        assert self.name == 'insert'
        assert 'INSERT INTO chat_media' in query
        return _InsertCursor()

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


def _build_openxml_bytes(prefix: str) -> bytes:
    blob = BytesIO()
    with ZipFile(blob, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr(f'{prefix}/doc.xml', '<doc/>')
    return blob.getvalue()


def test_allowed_file_and_canonical_username():
    assert allowed_file('avatar.png', allowed_extensions={'png'}) is True
    assert allowed_file('avatar.exe', allowed_extensions={'png'}) is False
    assert allowed_file('avatar', allowed_extensions={'png'}) is False
    assert canonical_username('  Alice_01 ') == 'alice_01'


def test_validate_magic_and_read_stream_helpers():
    # Use a real 1×1 PNG so the Pillow-backed deep validation pass also accepts it.
    png = _VALID_PNG_1X1
    jpg = b'\xff\xd8\xff' + b'\x00' * 16
    stream = BytesIO(png)

    assert validate_magic(stream, 'png', magic_bytes_map=_MAGIC_BYTES) is True
    assert validate_magic(BytesIO(jpg), 'png', magic_bytes_map=_MAGIC_BYTES) is False
    assert validate_magic(BytesIO(png), 'unknown', magic_bytes_map=_MAGIC_BYTES) is False
    # SVG and other XML-ish image-like extensions must be rejected outright.
    assert validate_magic(BytesIO(b'<svg/>'), 'svg', magic_bytes_map=_MAGIC_BYTES) is False
    # Synthetic PNG with valid header but broken payload is rejected by Pillow.verify().
    broken_png = b'\x89PNG\r\n\x1a\n' + b'\x00' * 16
    assert validate_magic(BytesIO(broken_png), 'png', magic_bytes_map=_MAGIC_BYTES) is False

    stream.seek(5)
    head = read_stream_head(stream, size=8)
    assert head == png[:8]
    assert stream.tell() == 5


def test_validate_image_payload_directly():
    assert validate_image_payload(BytesIO(_VALID_PNG_1X1)) is True
    assert validate_image_payload(BytesIO(b'\x89PNG\r\n\x1a\n' + b'\x00' * 16)) is False
    assert validate_image_payload(BytesIO(b'not-an-image-at-all')) is False


def test_image_sanitizer_strips_metadata_and_trailing_payload(tmp_path):
    try:
        from PIL import Image, PngImagePlugin
    except ImportError:
        pytest.skip('Pillow is not installed')

    source = BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text('gps', 'secret-location')
    Image.new('RGB', (1, 1), (255, 0, 0)).save(source, format='PNG', pnginfo=metadata)
    raw_with_payload = source.getvalue() + b'PKTRAILING-PAYLOAD'

    dest = tmp_path / 'clean.png'
    size = sanitize_image_to_path(BytesIO(raw_with_payload), str(dest), ext='png')
    clean = dest.read_bytes()

    assert size == len(clean)
    assert b'secret-location' not in clean
    assert b'PKTRAILING-PAYLOAD' not in clean
    assert validate_image_payload(BytesIO(clean)) is True


def test_matches_rules_and_text_payload_validation():
    header = b'\x89PNG\r\n\x1a\nxxxx'
    rules = [[(0, b'\x89PNG\r\n\x1a\n')]]
    assert matches_magic_rules(header, rules) is True
    assert matches_magic_rules(header, [[(0, b'GIF89a')]]) is False
    assert matches_magic_rules(header, []) is False

    assert validate_text_like_payload(BytesIO(b'hello-text')) is True
    assert validate_text_like_payload(BytesIO(b'bad\x00binary')) is False


def test_validate_openxml_package_and_chat_media_content():
    docx_bytes = _build_openxml_bytes('word')
    xlsx_bytes = _build_openxml_bytes('xl')
    bad_zip = b'PK\x03\x04not-a-valid-zip'
    # Real 1×1 PNG passes Pillow.verify(); a header-only payload would not.
    png = _VALID_PNG_1X1
    mp3_id3 = b'ID3\x04\x00\x00' + b'\x00' * 16
    mp3_fffb = b'\xff\xfb\x90\x64' + b'\x00' * 16
    mp3_fffa = b'\xff\xfa\x90\x64' + b'\x00' * 16
    mp3_ffe3 = b'\xff\xe3\x90\x64' + b'\x00' * 16
    mp3_ffe2 = b'\xff\xe2\x90\x64' + b'\x00' * 16

    assert validate_openxml_package(BytesIO(docx_bytes), 'word/') is True
    assert validate_openxml_package(BytesIO(xlsx_bytes), 'xl/') is True
    assert validate_openxml_package(BytesIO(bad_zip), 'word/') is False

    assert validate_chat_media_content(_Upload(png), 'png', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(mp3_id3), 'mp3', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(mp3_fffb), 'mp3', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(mp3_fffa), 'mp3', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(mp3_ffe3), 'mp3', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(mp3_ffe2), 'mp3', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(b'not-png'), 'png', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is False
    assert validate_chat_media_content(_Upload(b'hello'), 'txt', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(b'bad\x00text'), 'txt', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is False
    assert validate_chat_media_content(_Upload(docx_bytes), 'docx', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(xlsx_bytes), 'xlsx', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(b'SUNENC1\nciphertext'), 'sunenc', chat_media_magic_rules=chat_routes._CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(b'ciphertext'), 'sunenc', chat_media_magic_rules=chat_routes._CHAT_MEDIA_MAGIC_RULES) is False
    assert validate_chat_media_content(_Upload(b'zip?'), 'docx', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is False
    assert validate_chat_media_content(_Upload(b'anything'), 'unknown', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is False


def test_validate_chat_media_content_accepts_heic_mif1_brand_for_heic_extension():
    heic_mif1_payload = b'\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00heic' + (b'\x00' * 32)
    assert validate_chat_media_content(
        _Upload(heic_mif1_payload),
        'heic',
        chat_media_magic_rules=chat_routes._CHAT_MEDIA_MAGIC_RULES,
    ) is True


def test_detect_media_type_normalize_mime_and_block_state():
    assert detect_chat_media_type('image/png') == 'image'
    assert detect_chat_media_type('video/mp4') == 'video'
    assert detect_chat_media_type('audio/ogg') == 'audio'
    assert detect_chat_media_type('application/pdf') == 'file'

    assert normalize_chat_media_mime('audio/webm', 'voice.webm', 'webm') == 'audio/webm'
    assert normalize_chat_media_mime('application/octet-stream', 'photo.jpg', 'jpg') == 'image/jpeg'
    assert normalize_chat_media_mime(None, 'track.mp3', 'mp3') == 'audio/mpeg'
    assert normalize_chat_media_mime('image/png', 'note.txt', 'txt') == 'text/plain'
    assert normalize_chat_media_mime('text/html', 'report.pdf', 'pdf') == 'application/pdf'
    assert normalize_chat_media_mime(None, 'sheet.xlsx', 'xlsx') in {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'}
    assert normalize_chat_media_mime('text/plain', 'payload.sunenc', 'sunenc') == 'application/octet-stream'

    assert serialize_block_state({'blocked_by_me': True, 'blocked_me': False}) == {
        'is_blocked': True,
        'blocked_by_me': True,
        'blocked_me': False,
    }
    assert serialize_block_state(None) == {
        'is_blocked': False,
        'blocked_by_me': False,
        'blocked_me': False,
    }


def test_upload_chat_media_releases_auth_db_connection_before_av_scan(tmp_path):
    media_dir = tmp_path / 'media'
    media_dir.mkdir()
    auth_conn = _FakeMediaConnection('auth')
    insert_conn = _FakeMediaConnection('insert')
    opened_connections = []
    scan_seen = {}

    def _open_connection():
        conn = auth_conn if not opened_connections else insert_conn
        opened_connections.append(conn)
        return conn

    def _scan_file(path, **kwargs):
        scan_seen['auth_closed'] = auth_conn.closed
        scan_seen['opened_count'] = len(opened_connections)
        return SimpleNamespace(infected=False, signature='', output='')

    result = upload_chat_media_for_user(
        None,
        user_id=1,
        chat_id='chat-1',
        uploaded_file=_UploadFile(b'hello media'),
        chat_media_folder=str(media_dir),
        allowed_extensions={'txt'},
        max_chat_media_size=1024,
        validate_chat_media_content_func=lambda uploaded, ext: True,
        get_chat_partner_func=lambda conn, user_id, chat_id: {'contact_id': 2},
        build_block_state_func=lambda conn, user_id, contact_id: {'blocked_by_me': False, 'blocked_me': False},
        serialize_block_state_func=serialize_block_state,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        normalize_chat_media_mime_func=lambda mimetype, filename, ext: 'text/plain',
        detect_chat_media_type_func=lambda mime: 'file',
        scan_file_func=_scan_file,
        av_scan_enabled=True,
        av_fail_closed=True,
        av_command_template='scanner --scan {path}',
        av_timeout_seconds=20,
        av_scan_extensions={'txt'},
        get_db_connection_func=_open_connection,
    )

    assert result['status'] == 'ok'
    assert scan_seen == {'auth_closed': True, 'opened_count': 1}
    assert opened_connections == [auth_conn, insert_conn]
    assert insert_conn.closed is True
    assert insert_conn.commits == 1


def test_upload_chat_media_rejects_group_member_when_media_disabled(tmp_path):
    media_dir = tmp_path / 'group-media'
    media_dir.mkdir()
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.executescript(
        '''
        CREATE TABLE chats (
            chat_id TEXT PRIMARY KEY,
            group_perm_send_messages INTEGER DEFAULT 1,
            group_perm_send_media INTEGER DEFAULT 1
        );
        CREATE TABLE chat_members (
            user_id INTEGER,
            chat_id TEXT,
            role TEXT
        );
        '''
    )
    conn.execute(
        '''
        INSERT INTO chats (chat_id, group_perm_send_messages, group_perm_send_media)
        VALUES ('group-1', 1, 0)
        '''
    )
    conn.execute("INSERT INTO chat_members (user_id, chat_id, role) VALUES (2, 'group-1', 'member')")

    result = upload_chat_media_for_user(
        conn,
        user_id=2,
        chat_id='group-1',
        uploaded_file=_UploadFile(b'hello media'),
        chat_media_folder=str(media_dir),
        allowed_extensions={'txt'},
        max_chat_media_size=1024,
        validate_chat_media_content_func=lambda uploaded, ext: True,
        get_chat_partner_func=lambda conn, user_id, chat_id: {'contact_id': None, 'chat_type': 'group', 'is_group': True},
        build_block_state_func=lambda conn, user_id, contact_id: {'blocked_by_me': False, 'blocked_me': False},
        serialize_block_state_func=serialize_block_state,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        normalize_chat_media_mime_func=lambda mimetype, filename, ext: 'text/plain',
        detect_chat_media_type_func=lambda mime: 'file',
        scan_file_func=lambda path, **kwargs: SimpleNamespace(infected=False, signature='', output=''),
        av_scan_enabled=False,
        av_fail_closed=True,
        av_command_template='scanner --scan {path}',
        av_timeout_seconds=20,
        av_scan_extensions={'txt'},
    )

    assert result['status'] == 'forbidden'
    assert result['error'] == 'Participants cannot send media in this group.'
    assert list(media_dir.iterdir()) == []
