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


def send_chat_message_push(
    *,
    receiver_user_id: int,
    sender_user_id: int,
    sender_display_name: str,
    sender_username: str,
    chat_id: str,
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

        resolved_sender_display_name = str(sender_display_name or '').strip()
        resolved_sender_username = str(sender_username or '').strip()
        if not resolved_sender_display_name or not resolved_sender_username:
            sender_row = conn.execute(
                'SELECT display_name, username FROM users WHERE id = ?',
                (int(sender_user_id),),
            ).fetchone()
            if sender_row:
                if not resolved_sender_display_name:
                    resolved_sender_display_name = str(sender_row['display_name'] or '').strip()
                if not resolved_sender_username:
                    resolved_sender_username = str(sender_row['username'] or '').strip()

        title = resolved_sender_display_name or resolved_sender_username or 'SUN Messenger'
        payload = json.dumps(
            {
                'title': title,
                'body': 'Новое сообщение',
                'url': '/chat',
                'chat_id': str(chat_id or '').strip(),
                'tag': f'chat:{str(chat_id or "").strip()}',
            },
            ensure_ascii=False,
        )

        for item in subscriptions:
            subscription_info = {
                'endpoint': item['endpoint'],
                'keys': {
                    'p256dh': item['p256dh'],
                    'auth': item['auth'],
                },
            }
            try:
                webpush(
                    subscription_info=subscription_info,
                    data=payload,
                    vapid_private_key=cfg['private_key'],
                    vapid_claims={'sub': cfg['subject']},
                    ttl=60,
                )
                _mark_push_send_success(conn, subscription_id=item['id'])
                sent += 1
            except WebPushException as exc:
                response = getattr(exc, 'response', None)
                status_code = int(getattr(response, 'status_code', 0) or 0)
                _mark_push_send_failure(
                    conn,
                    subscription_id=item['id'],
                    deactivate=status_code in {404, 410},
                )
                failed += 1
            except Exception:  # noqa: BLE001
                _mark_push_send_failure(conn, subscription_id=item['id'], deactivate=False)
                failed += 1

        conn.commit()
    finally:
        conn.close()

    return {'sent': sent, 'failed': failed}
