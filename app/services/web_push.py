from __future__ import annotations

import json
import logging
import re
from typing import Any

from flask import current_app

from app.database import get_db_connection

logger = logging.getLogger(__name__)

_ENDPOINT_MAX_LENGTH = 2048
_KEY_MAX_LENGTH = 512
_B64URL_RE = re.compile(r'^[A-Za-z0-9\-_]+={0,2}$')


def web_push_config(config=None) -> dict[str, Any]:
    cfg = config or current_app.config
    enabled = bool(cfg.get('WEB_PUSH_ENABLED'))
    public_key = str(cfg.get('WEB_PUSH_VAPID_PUBLIC_KEY') or '').strip()
    private_key = str(cfg.get('WEB_PUSH_VAPID_PRIVATE_KEY') or '').strip()
    subject = str(cfg.get('WEB_PUSH_VAPID_SUBJECT') or '').strip()
    return {
        'enabled': bool(enabled and public_key and private_key and subject),
        'public_key': public_key,
        'private_key': private_key,
        'subject': subject,
    }


def web_push_bootstrap_payload(config=None) -> dict[str, Any]:
    cfg = web_push_config(config)
    return {
        'enabled': bool(cfg['enabled']),
        'publicKey': cfg['public_key'] if cfg['enabled'] else '',
    }


def normalize_subscription(payload) -> dict[str, str] | None:
    if not isinstance(payload, dict):
        return None
    endpoint = str(payload.get('endpoint') or '').strip()
    keys = payload.get('keys')
    if not isinstance(keys, dict):
        return None
    p256dh = str(keys.get('p256dh') or '').strip()
    auth = str(keys.get('auth') or '').strip()

    if not endpoint or len(endpoint) > _ENDPOINT_MAX_LENGTH:
        return None
    if not endpoint.startswith('https://'):
        return None
    if (
        not p256dh
        or len(p256dh) > _KEY_MAX_LENGTH
        or not _B64URL_RE.fullmatch(p256dh)
    ):
        return None
    if not auth or len(auth) > _KEY_MAX_LENGTH or not _B64URL_RE.fullmatch(auth):
        return None

    return {
        'endpoint': endpoint,
        'p256dh': p256dh,
        'auth': auth,
    }


def save_push_subscription(
    conn,
    *,
    user_id: int,
    subscription: dict[str, str],
    user_agent: str = '',
) -> None:
    conn.execute(
        '''
        INSERT INTO push_subscriptions (
            user_id, endpoint, p256dh, auth, user_agent, is_active, updated_at, failure_count, last_failure_at
        )
        VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, 0, NULL)
        ON CONFLICT(endpoint) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent,
            is_active = 1,
            updated_at = CURRENT_TIMESTAMP,
            failure_count = 0,
            last_failure_at = NULL
        ''',
        (
            int(user_id),
            subscription['endpoint'],
            subscription['p256dh'],
            subscription['auth'],
            str(user_agent or '')[:512],
        ),
    )


def deactivate_push_subscription(conn, *, user_id: int, endpoint: str) -> int:
    cursor = conn.execute(
        '''
        UPDATE push_subscriptions
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND endpoint = ? AND is_active = 1
        ''',
        (int(user_id), str(endpoint or '').strip()),
    )
    return int(cursor.rowcount or 0)


def deactivate_user_push_subscriptions(conn, *, user_id: int) -> int:
    cursor = conn.execute(
        '''
        UPDATE push_subscriptions
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND is_active = 1
        ''',
        (int(user_id),),
    )
    return int(cursor.rowcount or 0)


def _active_subscriptions_for_user(conn, *, user_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        '''
        SELECT id, endpoint, p256dh, auth
        FROM push_subscriptions
        WHERE user_id = ? AND is_active = 1
        ORDER BY updated_at DESC, id DESC
        ''',
        (int(user_id),),
    ).fetchall()
    return [
        {
            'id': int(row['id']),
            'endpoint': str(row['endpoint'] or ''),
            'p256dh': str(row['p256dh'] or ''),
            'auth': str(row['auth'] or ''),
        }
        for row in rows
    ]


def _mark_push_send_success(conn, *, subscription_id: int) -> None:
    conn.execute(
        '''
        UPDATE push_subscriptions
        SET
            failure_count = 0,
            last_failure_at = NULL,
            last_success_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        ''',
        (int(subscription_id),),
    )


def _mark_push_send_failure(conn, *, subscription_id: int, deactivate: bool) -> None:
    conn.execute(
        '''
        UPDATE push_subscriptions
        SET
            failure_count = COALESCE(failure_count, 0) + 1,
            last_failure_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP,
            is_active = CASE WHEN ? THEN 0 ELSE is_active END
        WHERE id = ?
        ''',
        (int(bool(deactivate)), int(subscription_id)),
    )


_PUSH_BODY_BY_TYPE: dict[str, str] = {
    'voice': '🎤 Голосовое сообщение',
    'image': '🖼 Фото',
    'video': '🎬 Видео',
    'file': '📎 Файл',
    'sticker': '🖼 Стикер',
}
_MENTION_PUSH_BODY = 'Вас упомянули в чате'
_DEFAULT_PUSH_BODY = 'Новое сообщение'


def _resolve_sender_identity_for_push(
    conn,
    *,
    sender_user_id: int,
    sender_display_name: str,
    sender_username: str,
) -> tuple[str, str]:
    resolved_sender_display_name = str(sender_display_name or '').strip()
    resolved_sender_username = str(sender_username or '').strip()
    if resolved_sender_display_name and resolved_sender_username:
        return resolved_sender_display_name, resolved_sender_username

    sender_row = conn.execute(
        'SELECT display_name, username FROM users WHERE id = ?',
        (int(sender_user_id),),
    ).fetchone()
    if sender_row:
        if not resolved_sender_display_name:
            resolved_sender_display_name = str(sender_row['display_name'] or '').strip()
        if not resolved_sender_username:
            resolved_sender_username = str(sender_row['username'] or '').strip()
    return resolved_sender_display_name, resolved_sender_username


def _build_push_message_context(
    *,
    context: dict | None = None,
) -> dict[str, str]:
    push_context = context or {}
    notification_type = str(push_context.get('notification_type') or '').strip().lower()
    chat_display_name = str(push_context.get('chat_display_name') or '').strip()
    message_type = str(push_context.get('message_type') or '').strip()
    chat_id = str(push_context.get('chat_id') or '').strip()
    sender_display_name = str(push_context.get('sender_display_name') or '').strip()
    sender_username = str(push_context.get('sender_username') or '').strip()

    title = sender_display_name or sender_username or 'SUN Messenger'
    is_mention_notification = notification_type == 'mention'
    if is_mention_notification and chat_display_name:
        title = chat_display_name

    if is_mention_notification:
        body = f'{_MENTION_PUSH_BODY}: {chat_display_name}' if chat_display_name else _MENTION_PUSH_BODY
        tag = f'mention:{chat_id}'
        kind = 'mention'
    else:
        body = _PUSH_BODY_BY_TYPE.get(message_type, _DEFAULT_PUSH_BODY)
        tag = f'chat:{chat_id}'
        kind = 'message'
    return {
        'title': title,
        'body': body,
        'chat_id': chat_id,
        'tag': tag,
        'kind': kind,
    }


def _build_push_payload(message_context: dict[str, str]) -> str:
    chat_id = str(message_context.get('chat_id') or '').strip()
    destination_url = f'/chat?chat_id={chat_id}' if chat_id else '/chat'
    return json.dumps(
        {
            'title': message_context['title'],
            'body': message_context['body'],
            'url': destination_url,
            'chat_id': chat_id,
            'tag': message_context['tag'],
            'kind': message_context['kind'],
        },
        ensure_ascii=False,
    )


def _build_call_push_payload(*, call_id: str, chat_id: str, call_type: str, title: str) -> str:
    destination_url = f'/chat?chat_id={chat_id}' if chat_id else '/chat'
    body = 'Входящий видеозвонок' if call_type == 'video' else 'Входящий звонок'
    return json.dumps(
        {
            'title': title or 'SUN Messenger',
            'body': body,
            'url': destination_url,
            'chat_id': chat_id,
            'call_id': call_id,
            'tag': f'call:{call_id}',
            'kind': 'call',
            'requireInteraction': True,
        },
        ensure_ascii=False,
    )


def _send_push_to_subscription(
    *,
    context: dict | None = None,
) -> bool:
    push_context = context or {}
    webpush_func = push_context.get('webpush_func')
    webpush_exception_cls = push_context.get('webpush_exception_cls')
    subscription = push_context.get('subscription') or {}
    payload = str(push_context.get('payload') or '')
    cfg = push_context.get('cfg') or {}
    conn = push_context.get('conn')
    ttl = int(push_context.get('ttl') or 3_600)

    subscription_info = {
        'endpoint': subscription['endpoint'],
        'keys': {
            'p256dh': subscription['p256dh'],
            'auth': subscription['auth'],
        },
    }
    try:
        webpush_func(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=cfg['private_key'],
            vapid_claims={'sub': cfg['subject']},
            ttl=ttl,
        )
        _mark_push_send_success(conn, subscription_id=subscription['id'])
        return True
    except webpush_exception_cls as exc:
        response = getattr(exc, 'response', None)
        status_code = int(getattr(response, 'status_code', 0) or 0)
        _mark_push_send_failure(
            conn,
            subscription_id=subscription['id'],
            deactivate=status_code in {404, 410},
        )
        return False
    except Exception:  # noqa: BLE001
        _mark_push_send_failure(conn, subscription_id=subscription['id'], deactivate=False)
        return False


def send_chat_message_push(  # noqa: PLR0913 - explicit push-delivery contract
    *,
    receiver_user_id: int,
    sender_user_id: int,
    sender_display_name: str,
    sender_username: str,
    chat_id: str,
    message_type: str = 'text',
    notification_type: str = 'message',
    chat_display_name: str = '',
) -> dict[str, int]:
    cfg = web_push_config()
    if not cfg['enabled']:
        return {'sent': 0, 'failed': 0}

    try:
        from pywebpush import WebPushException, webpush
    except Exception as exc:  # noqa: BLE001
        logger.warning('Web push disabled at runtime: pywebpush unavailable: %s', exc)
        return {'sent': 0, 'failed': 0}

    conn = get_db_connection()
    sent = 0
    failed = 0
    try:
        subscriptions = _active_subscriptions_for_user(conn, user_id=receiver_user_id)
        if not subscriptions:
            return {'sent': 0, 'failed': 0}

        resolved_sender_display_name, resolved_sender_username = _resolve_sender_identity_for_push(
            conn,
            sender_user_id=int(sender_user_id),
            sender_display_name=sender_display_name,
            sender_username=sender_username,
        )
        message_context = _build_push_message_context(
            context={
                'notification_type': notification_type,
                'chat_display_name': chat_display_name,
                'message_type': message_type,
                'chat_id': chat_id,
                'sender_display_name': resolved_sender_display_name,
                'sender_username': resolved_sender_username,
            },
        )
        payload = _build_push_payload(message_context)

        for item in subscriptions:
            if _send_push_to_subscription(
                context={
                    'webpush_func': webpush,
                    'webpush_exception_cls': WebPushException,
                    'subscription': item,
                    'payload': payload,
                    'cfg': cfg,
                    'conn': conn,
                },
            ):
                sent += 1
            else:
                failed += 1

        conn.commit()
    finally:
        conn.close()

    return {'sent': sent, 'failed': failed}


def send_call_incoming_push(  # noqa: PLR0913 - explicit push-delivery contract
    *,
    receiver_user_id: int,
    initiator_user_id: int,
    initiator_display_name: str,
    initiator_username: str,
    chat_id: str,
    call_id: str,
    call_type: str = 'audio',
) -> dict[str, int]:
    cfg = web_push_config()
    if not cfg['enabled']:
        return {'sent': 0, 'failed': 0}

    try:
        from pywebpush import WebPushException, webpush
    except Exception as exc:  # noqa: BLE001
        logger.warning('Web push disabled at runtime: pywebpush unavailable: %s', exc)
        return {'sent': 0, 'failed': 0}

    conn = get_db_connection()
    sent = 0
    failed = 0
    try:
        subscriptions = _active_subscriptions_for_user(conn, user_id=receiver_user_id)
        if not subscriptions:
            return {'sent': 0, 'failed': 0}

        display_name, username = _resolve_sender_identity_for_push(
            conn,
            sender_user_id=int(initiator_user_id),
            sender_display_name=initiator_display_name,
            sender_username=initiator_username,
        )
        payload = _build_call_push_payload(
            call_id=str(call_id or ''),
            chat_id=str(chat_id or ''),
            call_type='video' if call_type == 'video' else 'audio',
            title=display_name or username or 'SUN Messenger',
        )

        for item in subscriptions:
            if _send_push_to_subscription(
                context={
                    'webpush_func': webpush,
                    'webpush_exception_cls': WebPushException,
                    'subscription': item,
                    'payload': payload,
                    'cfg': cfg,
                    'conn': conn,
                    'ttl': 60,
                },
            ):
                sent += 1
            else:
                failed += 1

        conn.commit()
    finally:
        conn.close()

    return {'sent': sent, 'failed': failed}
