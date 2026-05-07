from collections.abc import Callable, Mapping
from typing import Any


def _build_chat_created_payload(*, chat_id: str, user: Mapping[str, Any], avatar_url: str | None) -> dict[str, Any]:
    return {
        'chat_id': chat_id,
        'contact': {
            'userId': user['id'],
            'display_name': user['display_name'],
            'username': user['username'],
            'public_key': user['public_key'],
            'chatId': chat_id,
            'last_message': None,
            'unreadCount': 0,
            'avatar_url': avatar_url,
            'blocked_by_me': False,
            'blocked_me': False,
            'is_blocked': False,
        },
    }


def build_accept_request_socket_events(
    *,
    chat_id: str,
    sender: Mapping[str, Any],
    receiver: Mapping[str, Any],
    receiver_user_id: int,
    sender_public_key: str,
    get_safe_avatar_url_func: Callable[[Mapping[str, Any], int], str | None],
) -> list[dict[str, Any]]:
    sender_id = int(sender['id'])
    sender_payload = _build_chat_created_payload(
        chat_id=chat_id,
        user=sender,
        avatar_url=get_safe_avatar_url_func(sender, receiver_user_id),
    )
    receiver_payload = _build_chat_created_payload(
        chat_id=chat_id,
        user=receiver,
        avatar_url=get_safe_avatar_url_func(receiver, sender_id),
    )
    return [
        {
            'name': 'chat_created',
            'payload': sender_payload,
            'room': receiver['public_key'],
        },
        {
            'name': 'chat_created',
            'payload': receiver_payload,
            'room': sender_public_key,
        },
        {
            'name': 'dialog_request_updated',
            'payload': {'sender_public_key': sender_public_key, 'action': 'accepted'},
            'room': receiver['public_key'],
        },
    ]


def build_decline_request_socket_event(
    *,
    sender_public_key: str,
    sender_display_name: str,
    action: str,
) -> dict[str, Any]:
    return {
        'name': 'dialog_request_updated',
        'payload': {
            'action': action,
            'sender_display_name': sender_display_name,
        },
        'room': sender_public_key,
    }


def fetch_pending_dialog_requests_for_user(conn, *, user_id: int) -> list[dict]:
    dialog_requests = conn.execute(
        '''
        SELECT u.public_key as sender_public_key, u.username, u.display_name
        FROM dialog_requests dr
        JOIN users u ON dr.sender_id = u.id
        WHERE dr.receiver_id = ? AND dr.status = 'pending'
          AND NOT EXISTS (
              SELECT 1
              FROM block_list b
              WHERE (b.blocker_id = ? AND b.blocked_id = dr.sender_id)
                 OR (b.blocker_id = dr.sender_id AND b.blocked_id = ?)
          )
        ''',
        (user_id, user_id, user_id),
    ).fetchall()

    return [
        {
            'sender_public_key': req['sender_public_key'],
            'sender_username': req['username'],
            'sender_display_name': req['display_name'],
        }
        for req in dialog_requests
    ]
