from flask import current_app

from app.services import moderation as moderation_service


def configured_moderator_ids() -> set[int]:
    raw_ids = str(current_app.config.get('MODERATOR_USER_IDS') or '').strip()
    return moderation_service.moderator_id_set(raw_ids)
