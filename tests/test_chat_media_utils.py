from io import BytesIO
from zipfile import ZipFile

from app.routes.chat_media_utils import (
    allowed_file,
    canonical_username,
    detect_chat_media_type,
    matches_magic_rules,
    normalize_chat_media_mime,
    read_stream_head,
    serialize_block_state,
    validate_chat_media_content,
    validate_magic,
    validate_openxml_package,
    validate_text_like_payload,
)


_MAGIC_BYTES = {
    'png': [(0, b'\x89PNG\r\n\x1a\n')],
    'jpg': [(0, b'\xff\xd8\xff')],
}

_CHAT_MEDIA_MAGIC_RULES = {
    'png': [[(0, b'\x89PNG\r\n\x1a\n')]],
    'txt': [],
    'docx': [[(0, b'PK\x03\x04')], [(0, b'PK\x05\x06')], [(0, b'PK\x07\x08')]],
    'xlsx': [[(0, b'PK\x03\x04')], [(0, b'PK\x05\x06')], [(0, b'PK\x07\x08')]],
}


class _Upload:
    def __init__(self, raw: bytes):
        self.stream = BytesIO(raw)


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
    png = b'\x89PNG\r\n\x1a\n' + b'\x00' * 16
    jpg = b'\xff\xd8\xff' + b'\x00' * 16
    stream = BytesIO(png)

    assert validate_magic(stream, 'png', magic_bytes_map=_MAGIC_BYTES) is True
    assert validate_magic(BytesIO(jpg), 'png', magic_bytes_map=_MAGIC_BYTES) is False
    assert validate_magic(BytesIO(png), 'unknown', magic_bytes_map=_MAGIC_BYTES) is False

    stream.seek(5)
    head = read_stream_head(stream, size=8)
    assert head == png[:8]
    assert stream.tell() == 5


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
    png = b'\x89PNG\r\n\x1a\n' + b'\x00' * 16

    assert validate_openxml_package(BytesIO(docx_bytes), 'word/') is True
    assert validate_openxml_package(BytesIO(xlsx_bytes), 'xl/') is True
    assert validate_openxml_package(BytesIO(bad_zip), 'word/') is False

    assert validate_chat_media_content(_Upload(png), 'png', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(b'not-png'), 'png', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is False
    assert validate_chat_media_content(_Upload(b'hello'), 'txt', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(b'bad\x00text'), 'txt', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is False
    assert validate_chat_media_content(_Upload(docx_bytes), 'docx', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(xlsx_bytes), 'xlsx', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is True
    assert validate_chat_media_content(_Upload(b'zip?'), 'docx', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is False
    assert validate_chat_media_content(_Upload(b'anything'), 'unknown', chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES) is False


def test_detect_media_type_normalize_mime_and_block_state():
    assert detect_chat_media_type('image/png') == 'image'
    assert detect_chat_media_type('video/mp4') == 'video'
    assert detect_chat_media_type('audio/ogg') == 'audio'
    assert detect_chat_media_type('application/pdf') == 'file'

    assert normalize_chat_media_mime('audio/webm', 'voice.webm', 'webm') == 'audio/webm'
    assert normalize_chat_media_mime('application/octet-stream', 'photo.jpg', 'jpg') == 'image/jpeg'
    assert normalize_chat_media_mime(None, 'track.mp3', 'mp3') == 'audio/mpeg'
    assert normalize_chat_media_mime(None, 'sheet.xlsx', 'xlsx') in {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'}

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
