from __future__ import annotations

import re

from app.services.client_preferences import client_preferences_from_db

USERNAME_PATTERN = re.compile(r'^[a-z0-9_]{1,50}$')


def build_socketio_client_config(config) -> dict:
    raw_transports = str(config.get('SOCKETIO_CLIENT_TRANSPORTS', '') or '')
    transports = [item.strip() for item in raw_transports.split(',') if item.strip()]
    if not transports:
        transports = ['polling', 'websocket']

    return {
        'transports': transports,
        'upgrade': bool(config.get('SOCKETIO_CLIENT_UPGRADE', True)),
    }


def normalize_initial_chat_contact_username(value: str | None, *, canonical_username) -> str:
    normalized = canonical_username(value)
    if not normalized:
        return ''
    if not USERNAME_PATTERN.fullmatch(normalized):
        return ''
    return normalized


def fetch_chat_page_context(
    *,
    conn,
    user_id: int,
    fetch_contacts_for_user,
    language_from_user_row,
    initial_contacts_limit: int,
) -> dict | None:
    user_info = conn.execute(
        '''
        SELECT username, display_name, public_key, avatar_url, language, mute_dialog_requests, client_preferences
        FROM users
        WHERE id = ?
        ''',
        (user_id,),
    ).fetchone()
    if not user_info:
        return None

    ui_language = language_from_user_row(user_info)
    initial_contacts = fetch_contacts_for_user(
        user_id,
        conn,
        limit=initial_contacts_limit,
        language=ui_language,
        include_self_contact=False,
    ) or []

    return {
        'current_display_name': user_info['display_name'],
        'current_username': user_info['username'],
        'current_public_key': user_info['public_key'],
        'current_avatar_url': user_info['avatar_url'],
        'ui_language': ui_language,
        'mute_dialog_requests': bool(user_info['mute_dialog_requests']) if 'mute_dialog_requests' in user_info.keys() else False,
        'client_preferences': client_preferences_from_db(
            user_info['client_preferences'] if 'client_preferences' in user_info.keys() else None
        ),
        'initial_contacts': initial_contacts,
    }
