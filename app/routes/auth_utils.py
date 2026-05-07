import base64
import json
import os
import secrets


def is_valid_b64_blob(value: str, *, pattern, min_bytes: int = 1, max_bytes: int = 16 * 1024) -> bool:
    if not isinstance(value, str):
        return False
    raw = value.strip()
    if not raw or len(raw) > (max_bytes * 4):
        return False
    if not pattern.fullmatch(raw):
        return False
    try:
        decoded = base64.b64decode(raw, validate=True)
    except Exception:
        return False
    return min_bytes <= len(decoded) <= max_bytes


def normalize_login_vault(
    raw_value,
    *,
    login_vault_max_bytes: int,
    is_valid_b64_blob_func,
):
    if raw_value is None:
        return None
    if not isinstance(raw_value, str):
        return None
    payload_raw = raw_value.strip()
    if not payload_raw:
        return None
    if len(payload_raw.encode('utf-8')) > login_vault_max_bytes:
        return None
    try:
        payload = json.loads(payload_raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get('v') != 1:
        return None
    iv = payload.get('iv')
    data = payload.get('data')
    if not is_valid_b64_blob_func(iv, min_bytes=12, max_bytes=64):
        return None
    if not is_valid_b64_blob_func(data, min_bytes=16, max_bytes=16 * 1024):
        return None
    return json.dumps({'v': 1, 'iv': iv, 'data': data}, separators=(',', ':'))


def build_decoy_login_vault() -> str:
    return json.dumps({
        'v': 1,
        'iv': base64.b64encode(secrets.token_bytes(12)).decode('ascii'),
        'data': base64.b64encode(secrets.token_bytes(128)).decode('ascii'),
    })


def wants_remember(data) -> bool:
    if not isinstance(data, dict):
        return False
    return bool(data.get('remember_device'))


def safe_remove_stored_file(base_dir: str, storage_name: str, *, logger) -> None:
    if not storage_name:
        return
    if storage_name != os.path.basename(storage_name):
        logger.warning('skip delete invalid storage name=%s', storage_name)
        return
    base_abs = os.path.abspath(base_dir)
    target_abs = os.path.abspath(os.path.join(base_abs, storage_name))
    if os.path.commonpath([base_abs, target_abs]) != base_abs:
        logger.warning('skip delete path escape target=%s', target_abs)
        return
    try:
        if os.path.exists(target_abs):
            os.remove(target_abs)
    except OSError:
        logger.exception('failed to remove file path=%s', target_abs)


def avatar_storage_name_from_url(avatar_url: str, *, prefix: str = '/static/avatars/'):
    if not avatar_url or not avatar_url.startswith(prefix):
        return None
    storage_name = avatar_url[len(prefix):]
    if not storage_name:
        return None
    return storage_name
