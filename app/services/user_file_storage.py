from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CHAT_MEDIA_FOLDER = os.path.join(_BASE_DIR, 'storage', 'chat_media')
AVATAR_FOLDER = os.path.join(_BASE_DIR, 'static', 'avatars')


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


def safe_remove_stored_file_from_dir(base_dir: str, storage_name: str) -> None:
    safe_remove_stored_file(base_dir, storage_name, logger=logger)


def avatar_storage_name_from_url(avatar_url: str, *, prefix: str = '/static/avatars/'):
    if not avatar_url or not avatar_url.startswith(prefix):
        return None
    storage_name = avatar_url[len(prefix):]
    if not storage_name:
        return None
    return storage_name


def avatar_storage_name_from_profile_url(avatar_url: str):
    return avatar_storage_name_from_url(avatar_url)
