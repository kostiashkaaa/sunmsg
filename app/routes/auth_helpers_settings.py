import logging

from app.services.user_file_storage import (
    AVATAR_FOLDER,
    CHAT_MEDIA_FOLDER,
    avatar_storage_name_from_profile_url as avatar_storage_name_from_profile_url,
    safe_remove_stored_file_from_dir as safe_remove_stored_file_from_dir,
)

logger = logging.getLogger(__name__)

USERNAME_MAX_LENGTH = 50
DISPLAY_NAME_MAX_LENGTH = 50

__all__ = [
    'AVATAR_FOLDER',
    'CHAT_MEDIA_FOLDER',
    'DISPLAY_NAME_MAX_LENGTH',
    'USERNAME_MAX_LENGTH',
    'avatar_storage_name_from_profile_url',
    'logger',
    'safe_remove_stored_file_from_dir',
]
