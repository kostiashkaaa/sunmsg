from __future__ import annotations

from collections.abc import Iterable

from app.services.user_privacy import is_privacy_allowed, normalize_privacy_choice


def _normalize_message_ids(message_ids: Iterable[int] | None) -> list[int]:
    if not message_ids:
        return []
    normalized: list[int] = []
    seen: set[int] = set()
    for value in message_ids:
        try:
            numeric = int(value)
        except (TypeError, ValueError):
            continue
        if numeric <= 0 or numeric in seen:
            continue
        seen.add(numeric)
        normalized.append(numeric)
    return normalized


def list_unread_group_receipt_message_ids(conn, *, chat_id: str, user_id: int) -> list[int]:
    rows = conn.execute(
        '''
        SELECT mr.message_id
        FROM message_receipts mr
        JOIN messages m ON m.id = mr.message_id
        WHERE m.chat_id = ?
          AND mr.user_id = ?
          AND mr.deleted_for_user = 0
          AND mr.is_read = 0
        ORDER BY mr.message_id ASC
        ''',
        (str(chat_id), int(user_id)),
    ).fetchall()
    return _normalize_message_ids(row['message_id'] for row in rows)


def collect_group_read_details_map(
    conn,
    *,
    chat_id: str,
    message_ids: Iterable[int] | None,
    viewer_user_id: int | None = None,
) -> dict[int, dict]:
    normalized_message_ids = _normalize_message_ids(message_ids)
    if not normalized_message_ids:
        return {}

    placeholders = ', '.join('?' * len(normalized_message_ids))
    rows = conn.execute(
        f'''
        SELECT
            m.id AS message_id,
            mr.user_id AS reader_user_id,
            COALESCE(NULLIF(u.display_name, ''), NULLIF(u.username, ''), 'Участник') AS reader_display_name,
            COALESCE(u.username, '') AS reader_username,
            u.read_receipts_privacy AS reader_privacy,
            mr.read_at,
            m.created_at
        FROM messages m
        JOIN message_receipts mr ON mr.message_id = m.id
        JOIN users u ON u.id = mr.user_id
        WHERE m.chat_id = ?
          AND m.id IN ({placeholders})
          AND mr.user_id <> m.sender_id
          AND mr.deleted_for_user = 0
          AND mr.is_read = 1
        ORDER BY m.id ASC, COALESCE(mr.read_at, m.created_at) ASC, mr.user_id ASC
        ''',
        (str(chat_id), *normalized_message_ids),
    ).fetchall()

    payload_by_message: dict[int, dict] = {
        message_id: {
            'message_id': int(message_id),
            'read_count': 0,
            'readers': [],
            'latest_read_at': None,
        }
        for message_id in normalized_message_ids
    }
    for row in rows:
        message_id = int(row['message_id'])
        entry = payload_by_message.get(message_id)
        if entry is None:
            continue
        if viewer_user_id is not None and not is_privacy_allowed(
            conn,
            owner_id=int(row['reader_user_id']),
            viewer_id=int(viewer_user_id),
            policy=normalize_privacy_choice(row['reader_privacy']),
        ):
            continue
        read_at = str(row['read_at'] or '').strip() or None
        entry['readers'].append(
            {
                'user_id': int(row['reader_user_id']),
                'display_name': str(row['reader_display_name'] or '').strip(),
                'username': str(row['reader_username'] or '').strip(),
                'read_at': read_at,
            }
        )
        if read_at:
            entry['latest_read_at'] = read_at

    for payload in payload_by_message.values():
        payload['read_count'] = len(payload['readers'])

    return payload_by_message


def build_group_read_updates(
    conn,
    *,
    chat_id: str,
    message_ids: Iterable[int] | None,
    viewer_user_id: int | None = None,
) -> list[dict]:
    payload_by_message = collect_group_read_details_map(
        conn,
        chat_id=chat_id,
        message_ids=message_ids,
        viewer_user_id=viewer_user_id,
    )
    if not payload_by_message:
        return []
    return [payload_by_message[key] for key in sorted(payload_by_message)]

