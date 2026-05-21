from __future__ import annotations

import json
import re
from typing import Any

from app.db_backend import IntegrityError
from app.services.user_file_storage import (
    AVATAR_FOLDER,
    CHAT_MEDIA_FOLDER,
    avatar_storage_name_from_profile_url,
    safe_remove_stored_file_from_dir,
)
from app.services import moderation as moderation_service

USERNAME_MAX_LENGTH = 50
USERNAME_PATTERN = re.compile(r'[a-z0-9_]+')


def _load_user_row(conn, *, target_user_id: int):
    return conn.execute(
        '''
        SELECT id, username, public_key, avatar_url
        FROM users
        WHERE id = ?
        LIMIT 1
        ''',
        (int(target_user_id),),
    ).fetchone()


def _collect_related_chat_ids(conn, *, target_user_id: int) -> list[str]:
    chat_id_rows = conn.execute(
        '''
        SELECT DISTINCT chat_id
        FROM (
            SELECT chat_id FROM messages WHERE sender_id = ? OR receiver_id = ?
            UNION
            SELECT chat_id FROM contacts WHERE user_id = ? OR contact_id = ?
        )
        WHERE chat_id IS NOT NULL AND chat_id != ''
        ''',
        (int(target_user_id), int(target_user_id), int(target_user_id), int(target_user_id)),
    ).fetchall()
    return [row['chat_id'] for row in chat_id_rows if row and row['chat_id']]


def rename_user_username(
    conn,
    *,
    target_user_id: int,
    new_username: str,
    moderator_user_id: int,
) -> dict[str, Any]:
    safe_target_user_id = moderation_service.parse_int(target_user_id, min_value=1)
    if safe_target_user_id is None:
        raise ValueError('invalid_target_user_id')

    normalized_username = str(new_username or '').strip()
    if len(normalized_username) < 2:
        raise ValueError('username_too_short')
    if len(normalized_username) > USERNAME_MAX_LENGTH:
        raise ValueError('username_too_long')
    if not USERNAME_PATTERN.fullmatch(normalized_username):
        raise ValueError('invalid_username')

    target_user = _load_user_row(conn, target_user_id=int(safe_target_user_id))
    if not target_user:
        raise ValueError('target_user_not_found')

    current_username = str(target_user['username'] or '')
    if current_username == normalized_username:
        return {
            'target_user_id': int(safe_target_user_id),
            'old_username': current_username,
            'new_username': normalized_username,
            'updated': False,
        }

    try:
        conn.execute(
            '''
            UPDATE users
            SET username = ?
            WHERE id = ?
            ''',
            (normalized_username, int(safe_target_user_id)),
        )
    except IntegrityError:
        raise ValueError('username_taken') from None

    moderation_service.add_audit_log(
        conn,
        actor_type='moderator',
        actor_id=str(int(moderator_user_id)),
        action='admin_user_username_changed',
        entity_type='user',
        entity_id=str(int(safe_target_user_id)),
        details_json=json.dumps(
            {
                'old_username': current_username,
                'new_username': normalized_username,
            },
            ensure_ascii=False,
        ),
    )
    conn.commit()
    return {
        'target_user_id': int(safe_target_user_id),
        'old_username': current_username,
        'new_username': normalized_username,
        'updated': True,
    }


def clear_user_active_sanctions(
    conn,
    *,
    target_user_id: int,
    moderator_user_id: int,
    note: str = '',
) -> dict[str, Any]:
    safe_target_user_id = moderation_service.parse_int(target_user_id, min_value=1)
    if safe_target_user_id is None:
        raise ValueError('invalid_target_user_id')

    target_user = _load_user_row(conn, target_user_id=int(safe_target_user_id))
    if not target_user:
        raise ValueError('target_user_not_found')

    result = conn.execute(
        '''
        UPDATE moderation_sanctions
        SET
            status = 'reversed',
            expires_at = COALESCE(expires_at, CURRENT_TIMESTAMP)
        WHERE subject_type = 'user'
          AND subject_id = ?
          AND status = 'active'
          AND action_type IN ('warn', 'mute_temp', 'ban_temp', 'ban_perma')
        ''',
        (str(int(safe_target_user_id)),),
    )
    reversed_count = int(result.rowcount or 0)

    moderation_service.add_audit_log(
        conn,
        actor_type='moderator',
        actor_id=str(int(moderator_user_id)),
        action='admin_user_active_sanctions_cleared',
        entity_type='user',
        entity_id=str(int(safe_target_user_id)),
        details_json=json.dumps(
            {
                'reversed_count': reversed_count,
                'note': moderation_service.normalize_comment(note, max_length=512),
            },
            ensure_ascii=False,
        ),
    )
    conn.commit()
    return {
        'target_user_id': int(safe_target_user_id),
        'target_username': str(target_user['username'] or ''),
        'reversed_count': reversed_count,
    }


def delete_user_account_hard(
    conn,
    *,
    target_user_id: int,
    moderator_user_id: int,
    remote_addr: str = '',
) -> dict[str, Any]:
    safe_target_user_id = moderation_service.parse_int(target_user_id, min_value=1)
    if safe_target_user_id is None:
        raise ValueError('invalid_target_user_id')

    user_row = _load_user_row(conn, target_user_id=int(safe_target_user_id))
    if not user_row:
        raise ValueError('target_user_not_found')

    media_storage_names: list[str] = []
    avatar_storage_name = avatar_storage_name_from_profile_url(user_row['avatar_url'])
    chat_ids = _collect_related_chat_ids(conn, target_user_id=int(safe_target_user_id))

    if chat_ids:
        placeholders = ','.join(['?'] * len(chat_ids))
        media_rows = conn.execute(
            f'''
            SELECT storage_name
            FROM chat_media
            WHERE uploader_id = ? OR chat_id IN ({placeholders})
            ''',
            (int(safe_target_user_id), *chat_ids),
        ).fetchall()
        media_storage_names = [row['storage_name'] for row in media_rows if row and row['storage_name']]
        conn.execute(
            f'DELETE FROM chat_media WHERE uploader_id = ? OR chat_id IN ({placeholders})',
            (int(safe_target_user_id), *chat_ids),
        )
    else:
        media_rows = conn.execute(
            'SELECT storage_name FROM chat_media WHERE uploader_id = ?',
            (int(safe_target_user_id),),
        ).fetchall()
        media_storage_names = [row['storage_name'] for row in media_rows if row and row['storage_name']]
        conn.execute('DELETE FROM chat_media WHERE uploader_id = ?', (int(safe_target_user_id),))

    conn.execute(
        'DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?',
        (int(safe_target_user_id), int(safe_target_user_id)),
    )
    conn.execute(
        'DELETE FROM contacts WHERE user_id = ? OR contact_id = ?',
        (int(safe_target_user_id), int(safe_target_user_id)),
    )
    conn.execute(
        'DELETE FROM dialog_requests WHERE sender_id = ? OR receiver_id = ?',
        (int(safe_target_user_id), int(safe_target_user_id)),
    )
    conn.execute(
        'DELETE FROM block_list WHERE blocker_id = ? OR blocked_id = ?',
        (int(safe_target_user_id), int(safe_target_user_id)),
    )
    conn.execute('DELETE FROM pinned_chats WHERE user_id = ?', (int(safe_target_user_id),))
    conn.execute('DELETE FROM socket_rate_limits WHERE user_id = ?', (int(safe_target_user_id),))
    conn.execute('DELETE FROM dialog_keys WHERE creator_id = ?', (int(safe_target_user_id),))
    conn.execute('DELETE FROM refresh_tokens WHERE user_id = ?', (int(safe_target_user_id),))

    if chat_ids:
        placeholders = ','.join(['?'] * len(chat_ids))
        conn.execute(
            f'DELETE FROM pinned_chats WHERE chat_id IN ({placeholders})',
            tuple(chat_ids),
        )
        conn.execute(
            f'DELETE FROM chat_pins WHERE chat_id IN ({placeholders})',
            tuple(chat_ids),
        )
        conn.execute(
            f'DELETE FROM chats WHERE chat_id IN ({placeholders})',
            tuple(chat_ids),
        )

    conn.execute('DELETE FROM users WHERE id = ?', (int(safe_target_user_id),))
    moderation_service.add_audit_log(
        conn,
        actor_type='moderator',
        actor_id=str(int(moderator_user_id)),
        action='admin_user_deleted',
        entity_type='user',
        entity_id=str(int(safe_target_user_id)),
        details_json=json.dumps(
            {
                'username': str(user_row['username'] or ''),
                'public_key': str(user_row['public_key'] or ''),
                'remote_addr': str(remote_addr or ''),
                'related_chats_deleted': len(chat_ids),
                'media_rows_deleted': len(media_storage_names),
            },
            ensure_ascii=False,
        ),
    )
    conn.commit()

    if avatar_storage_name:
        safe_remove_stored_file_from_dir(AVATAR_FOLDER, avatar_storage_name)
    for storage_name in set(media_storage_names):
        safe_remove_stored_file_from_dir(CHAT_MEDIA_FOLDER, storage_name)

    return {
        'target_user_id': int(safe_target_user_id),
        'target_username': str(user_row['username'] or ''),
        'related_chats_deleted': len(chat_ids),
        'media_rows_deleted': len(media_storage_names),
    }
