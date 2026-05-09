from __future__ import annotations

from app.db.connection import ensure_chat_exists
from app.services.crypto import generate_chat_id

_SAVED_MESSAGES_CHAT_NAME = 'Saved Messages'
_SAVED_MESSAGES_TITLE_RU = '\u0418\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435'
_SAVED_MESSAGES_TITLE_EN = 'Saved Messages'


def saved_messages_chat_id(public_key: str) -> str:
    normalized_public_key = str(public_key or '').strip()
    if not normalized_public_key:
        return ''
    return generate_chat_id(normalized_public_key, normalized_public_key)


def ensure_saved_messages_chat(conn, *, user_id: int, public_key: str) -> str:
    chat_id = saved_messages_chat_id(public_key)
    if not chat_id:
        return ''

    ensure_chat_exists(conn, chat_id, chat_name=_SAVED_MESSAGES_CHAT_NAME)
    conn.execute(
        '''
        INSERT INTO contacts (user_id, contact_id, chat_id)
        SELECT ?, ?, ?
        WHERE NOT EXISTS (
            SELECT 1
            FROM contacts
            WHERE user_id = ? AND contact_id = ?
        )
        ''',
        (user_id, user_id, chat_id, user_id, user_id),
    )
    conn.execute(
        '''
        UPDATE contacts
        SET chat_id = ?
        WHERE user_id = ? AND contact_id = ?
          AND COALESCE(chat_id, '') <> ?
        ''',
        (chat_id, user_id, user_id, chat_id),
    )
    return chat_id


def resolve_contact_display_name(*, viewer_user_id: int, contact_user_id: int, language: str, display_name: str, username: str) -> str:
    if int(viewer_user_id) == int(contact_user_id):
        if str(language or '').lower() == 'en':
            return _SAVED_MESSAGES_TITLE_EN
        return _SAVED_MESSAGES_TITLE_RU
    return str(display_name or username or '')
