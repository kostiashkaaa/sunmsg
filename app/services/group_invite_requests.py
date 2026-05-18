from __future__ import annotations

from app.services.chat_members import CHAT_TYPE_GROUP, ensure_chat_members

GROUP_INVITE_PRIVACY_ALL = 'all'
GROUP_INVITE_PRIVACY_CONTACTS = 'contacts'
GROUP_INVITE_PRIVACY_NOBODY = 'nobody'
GROUP_INVITE_PRIVACY_VALUES = {
    GROUP_INVITE_PRIVACY_ALL,
    GROUP_INVITE_PRIVACY_CONTACTS,
    GROUP_INVITE_PRIVACY_NOBODY,
}
GROUP_INVITE_ACTION_ADD = 'add'
GROUP_INVITE_ACTION_REQUEST = 'request'
GROUP_INVITE_ACTION_DENY = 'deny'


def normalize_group_invite_privacy(value: str | None) -> str:
    normalized = str(value or '').strip().lower()
    if normalized in GROUP_INVITE_PRIVACY_VALUES:
        return normalized
    return GROUP_INVITE_PRIVACY_ALL


def _is_contact(conn, *, owner_user_id: int, contact_user_id: int) -> bool:
    row = conn.execute(
        '''
        SELECT 1
        FROM contacts
        WHERE user_id = ? AND contact_id = ?
        LIMIT 1
        ''',
        (int(owner_user_id), int(contact_user_id)),
    ).fetchone()
    return row is not None


def resolve_group_invite_privacy_action(
    conn,
    *,
    inviter_user_id: int,
    invitee_user_id: int,
) -> str:
    row = conn.execute(
        '''
        SELECT group_invite_privacy
        FROM users
        WHERE id = ?
        LIMIT 1
        ''',
        (int(invitee_user_id),),
    ).fetchone()
    privacy = normalize_group_invite_privacy(
        row['group_invite_privacy'] if row and 'group_invite_privacy' in row.keys() else GROUP_INVITE_PRIVACY_ALL
    )
    if privacy == GROUP_INVITE_PRIVACY_ALL:
        return GROUP_INVITE_ACTION_ADD
    if privacy == GROUP_INVITE_PRIVACY_CONTACTS:
        if _is_contact(
            conn,
            owner_user_id=int(invitee_user_id),
            contact_user_id=int(inviter_user_id),
        ):
            return GROUP_INVITE_ACTION_ADD
        return GROUP_INVITE_ACTION_REQUEST
    return GROUP_INVITE_ACTION_DENY


def should_route_group_invite_to_request(
    conn,
    *,
    inviter_user_id: int,
    invitee_user_id: int,
) -> bool:
    return resolve_group_invite_privacy_action(
        conn,
        inviter_user_id=inviter_user_id,
        invitee_user_id=invitee_user_id,
    ) == GROUP_INVITE_ACTION_REQUEST


def ensure_group_invite_request(
    conn,
    *,
    chat_id: str,
    inviter_user_id: int,
    invitee_user_id: int,
) -> int:
    normalized_chat_id = str(chat_id or '').strip()
    if not normalized_chat_id:
        return 0

    existing = conn.execute(
        '''
        SELECT id
        FROM group_invite_requests
        WHERE chat_id = ?
          AND invitee_user_id = ?
          AND status = 'pending'
        ORDER BY id DESC
        LIMIT 1
        ''',
        (normalized_chat_id, int(invitee_user_id)),
    ).fetchone()
    if existing:
        request_id = int(existing['id'])
        conn.execute(
            '''
            UPDATE group_invite_requests
            SET inviter_user_id = ?, created_at = CURRENT_TIMESTAMP, responded_at = NULL
            WHERE id = ?
            ''',
            (int(inviter_user_id), request_id),
        )
        return request_id

    conn.execute(
        '''
        INSERT INTO group_invite_requests (
            chat_id,
            inviter_user_id,
            invitee_user_id,
            status
        )
        VALUES (?, ?, ?, 'pending')
        ''',
        (normalized_chat_id, int(inviter_user_id), int(invitee_user_id)),
    )
    created = conn.execute(
        '''
        SELECT id
        FROM group_invite_requests
        WHERE chat_id = ?
          AND invitee_user_id = ?
          AND status = 'pending'
        ORDER BY id DESC
        LIMIT 1
        ''',
        (normalized_chat_id, int(invitee_user_id)),
    ).fetchone()
    return int(created['id']) if created else 0


def build_group_invite_request_payload(conn, *, request_id: int):
    row = conn.execute(
        '''
        SELECT
            gir.id AS request_id,
            gir.chat_id,
            ch.chat_name,
            ch.chat_avatar_url,
            inviter.public_key AS sender_public_key,
            inviter.username AS sender_username,
            inviter.display_name AS sender_display_name,
            inviter.avatar_url AS sender_avatar_url,
            inviter.avatar_visibility AS sender_avatar_visibility
        FROM group_invite_requests gir
        JOIN chats ch ON ch.chat_id = gir.chat_id
        JOIN users inviter ON inviter.id = gir.inviter_user_id
        WHERE gir.id = ?
        LIMIT 1
        ''',
        (int(request_id),),
    ).fetchone()
    if not row:
        return None

    sender_avatar = (
        str(row['sender_avatar_url'] or '').strip()
        if str(row['sender_avatar_visibility'] or '').strip().lower() == GROUP_INVITE_PRIVACY_ALL
        else ''
    )
    return {
        'request_kind': 'group_invite',
        'request_id': int(row['request_id']),
        'chat_id': str(row['chat_id'] or ''),
        'chat_name': str(row['chat_name'] or ''),
        'chat_avatar_url': str(row['chat_avatar_url'] or ''),
        'sender_public_key': str(row['sender_public_key'] or ''),
        'sender_username': str(row['sender_username'] or ''),
        'sender_display_name': str(row['sender_display_name'] or ''),
        'sender_avatar': sender_avatar,
    }


def fetch_pending_group_invite_requests_for_user(conn, *, user_id: int) -> list[dict]:
    rows = conn.execute(
        '''
        SELECT
            gir.id AS request_id,
            gir.chat_id,
            ch.chat_name,
            ch.chat_avatar_url,
            inviter.public_key AS sender_public_key,
            inviter.username AS sender_username,
            inviter.display_name AS sender_display_name,
            inviter.avatar_url AS sender_avatar_url,
            inviter.avatar_visibility AS sender_avatar_visibility
        FROM group_invite_requests gir
        JOIN chats ch ON ch.chat_id = gir.chat_id
        JOIN users inviter ON inviter.id = gir.inviter_user_id
        WHERE gir.invitee_user_id = ?
          AND gir.status = 'pending'
          AND LOWER(COALESCE(ch.chat_type, '')) = ?
          AND NOT EXISTS (
              SELECT 1
              FROM chat_members cm
              WHERE cm.chat_id = gir.chat_id AND cm.user_id = gir.invitee_user_id
          )
          AND NOT EXISTS (
              SELECT 1
              FROM block_list b
              WHERE (b.blocker_id = gir.invitee_user_id AND b.blocked_id = gir.inviter_user_id)
                 OR (b.blocker_id = gir.inviter_user_id AND b.blocked_id = gir.invitee_user_id)
          )
        ORDER BY gir.created_at DESC, gir.id DESC
        ''',
        (int(user_id), CHAT_TYPE_GROUP),
    ).fetchall()

    requests: list[dict] = []
    for row in rows:
        sender_avatar = (
            str(row['sender_avatar_url'] or '').strip()
            if str(row['sender_avatar_visibility'] or '').strip().lower() == GROUP_INVITE_PRIVACY_ALL
            else ''
        )
        requests.append(
            {
                'request_kind': 'group_invite',
                'request_id': int(row['request_id']),
                'chat_id': str(row['chat_id'] or ''),
                'chat_name': str(row['chat_name'] or ''),
                'chat_avatar_url': str(row['chat_avatar_url'] or ''),
                'sender_public_key': str(row['sender_public_key'] or ''),
                'sender_username': str(row['sender_username'] or ''),
                'sender_display_name': str(row['sender_display_name'] or ''),
                'sender_avatar': sender_avatar,
            }
        )
    return requests


def accept_group_invite_request(
    conn,
    *,
    request_id: int,
    invitee_user_id: int,
):
    row = conn.execute(
        '''
        SELECT
            gir.id AS request_id,
            gir.chat_id,
            gir.inviter_user_id,
            ch.chat_type
        FROM group_invite_requests gir
        JOIN chats ch ON ch.chat_id = gir.chat_id
        WHERE gir.id = ?
          AND gir.invitee_user_id = ?
          AND gir.status = 'pending'
        LIMIT 1
        ''',
        (int(request_id), int(invitee_user_id)),
    ).fetchone()
    if not row:
        return {'status': 'request_missing'}

    if str(row['chat_type'] or '').strip().lower() != CHAT_TYPE_GROUP:
        return {'status': 'chat_missing'}

    ensure_chat_members(
        conn,
        str(row['chat_id']),
        [int(invitee_user_id)],
        role='member',
        added_by_user_id=int(row['inviter_user_id']),
    )
    conn.execute(
        '''
        UPDATE group_invite_requests
        SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
        WHERE id = ?
        ''',
        (int(request_id),),
    )
    return {
        'status': 'accepted',
        'chat_id': str(row['chat_id']),
        'inviter_user_id': int(row['inviter_user_id']),
    }


def decline_group_invite_request(
    conn,
    *,
    request_id: int,
    invitee_user_id: int,
):
    row = conn.execute(
        '''
        SELECT id, chat_id, inviter_user_id
        FROM group_invite_requests
        WHERE id = ?
          AND invitee_user_id = ?
          AND status = 'pending'
        LIMIT 1
        ''',
        (int(request_id), int(invitee_user_id)),
    ).fetchone()
    if not row:
        return {'status': 'request_missing'}

    conn.execute(
        '''
        UPDATE group_invite_requests
        SET status = 'declined', responded_at = CURRENT_TIMESTAMP
        WHERE id = ?
        ''',
        (int(request_id),),
    )
    return {
        'status': 'declined',
        'chat_id': str(row['chat_id']),
        'inviter_user_id': int(row['inviter_user_id']),
    }
