import base64
import json
import re

from app.routes.auth_utils import (
    avatar_storage_name_from_url,
    build_decoy_login_vault,
    is_valid_b64_blob,
    normalize_login_vault,
    safe_remove_stored_file,
    wants_remember,
)


class _LoggerStub:
    def __init__(self):
        self.warning_calls = []
        self.exception_calls = []

    def warning(self, message, *args):
        self.warning_calls.append((message, args))

    def exception(self, message, *args):
        self.exception_calls.append((message, args))


def _valid_vault_payload():
    return json.dumps(
        {
            'v': 1,
            'iv': base64.b64encode(b'123456789012').decode('ascii'),
            'data': base64.b64encode(b'x' * 32).decode('ascii'),
        }
    )


def test_is_valid_b64_blob_accepts_valid_and_rejects_invalid():
    pattern = re.compile(r'^[A-Za-z0-9+/]+={0,2}$')
    valid = base64.b64encode(b'hello world').decode('ascii')

    assert is_valid_b64_blob(valid, pattern=pattern, min_bytes=1, max_bytes=32) is True
    assert is_valid_b64_blob('not_base64!?', pattern=pattern, min_bytes=1, max_bytes=32) is False
    assert is_valid_b64_blob(base64.b64encode(b'').decode('ascii'), pattern=pattern, min_bytes=1, max_bytes=32) is False
    assert is_valid_b64_blob(base64.b64encode(b'x' * 40).decode('ascii'), pattern=pattern, min_bytes=1, max_bytes=16) is False


def test_normalize_login_vault_validates_and_canonicalizes():
    pattern = re.compile(r'^[A-Za-z0-9+/]+={0,2}$')

    def checker(value, min_bytes=1, max_bytes=16 * 1024):
        return is_valid_b64_blob(
            value,
            pattern=pattern,
            min_bytes=min_bytes,
            max_bytes=max_bytes,
        )

    normalized = normalize_login_vault(
        _valid_vault_payload(),
        login_vault_max_bytes=24 * 1024,
        is_valid_b64_blob_func=checker,
    )
    assert normalized == json.dumps(json.loads(_valid_vault_payload()), separators=(',', ':'))

    bad_version = json.dumps({'v': 2, 'iv': 'a', 'data': 'b'})
    assert normalize_login_vault(
        bad_version,
        login_vault_max_bytes=24 * 1024,
        is_valid_b64_blob_func=checker,
    ) is None

    assert normalize_login_vault(
        '{"bad":true}',
        login_vault_max_bytes=24 * 1024,
        is_valid_b64_blob_func=checker,
    ) is None

    assert normalize_login_vault(
        None,
        login_vault_max_bytes=24 * 1024,
        is_valid_b64_blob_func=checker,
    ) is None


def test_build_decoy_login_vault_shape():
    payload = json.loads(build_decoy_login_vault())
    assert payload['v'] == 1
    assert isinstance(payload['iv'], str) and payload['iv']
    assert isinstance(payload['data'], str) and payload['data']
    assert len(base64.b64decode(payload['iv'])) == 12
    assert len(base64.b64decode(payload['data'])) == 128


def test_wants_remember_and_avatar_storage_name():
    assert wants_remember({'remember_device': True}) is True
    assert wants_remember({'remember_device': 1}) is True
    assert wants_remember({'remember_device': 0}) is False
    assert wants_remember(None) is False

    assert avatar_storage_name_from_url('/static/avatars/a.png') == 'a.png'
    assert avatar_storage_name_from_url('/static/avatars/') is None
    assert avatar_storage_name_from_url('/other/path/a.png') is None


def test_safe_remove_stored_file_deletes_inside_base_and_rejects_invalid(tmp_path):
    logger = _LoggerStub()
    base = tmp_path / 'base'
    base.mkdir()
    inside = base / 'inside.txt'
    inside.write_text('ok', encoding='utf-8')

    safe_remove_stored_file(str(base), 'inside.txt', logger=logger)
    assert inside.exists() is False

    safe_remove_stored_file(str(base), '../escape.txt', logger=logger)
    assert len(logger.warning_calls) >= 1
