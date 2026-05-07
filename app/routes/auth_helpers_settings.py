import logging
import os

from app.routes.auth_utils import avatar_storage_name_from_url, safe_remove_stored_file

logger = logging.getLogger(__name__)

USERNAME_MAX_LENGTH = 50
DISPLAY_NAME_MAX_LENGTH = 50
_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CHAT_MEDIA_FOLDER = os.path.join(_BASE_DIR, 'storage', 'chat_media')
AVATAR_FOLDER = os.path.join(_BASE_DIR, 'static', 'avatars')


def avatar_storage_name_from_profile_url(avatar_url: str):
    return avatar_storage_name_from_url(avatar_url)


def safe_remove_stored_file_from_dir(base_dir: str, storage_name: str) -> None:
    safe_remove_stored_file(base_dir, storage_name, logger=logger)
