from __future__ import annotations

import base64
import json
import logging
import re
import time
import uuid
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils

from app.database import get_db_connection

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r'^[0-9a-fA-F]{64,512}$')
_APNS_INACTIVE_REASONS = {
    'BadDeviceToken',
    'DeviceTokenNotForTopic',
    'Unregistered',
}


def normalize_apns_token(raw_token: str) -> str | None:
    token = re.sub(r'[^0-9a-fA-F]', '', str(raw_token or '')).lower()
    if not _TOKEN_RE.fullmatch(token):
        return None
    if len(token) % 2 != 0:
        return None
    return token


def normalize_apns_environment(raw_value: str | None) -> str:
    value = str(raw_value or '').strip().lower()
    return 'production' if value in {'prod', 'production'} else 'sandbox'


def apns_config(config: Any) -> dict[str, Any]:
    private_key = str(config.get('APNS_PRIVATE_KEY') or '').strip()
    private_key_path = str(config.get('APNS_PRIVATE_KEY_PATH') or '').strip()
    if not private_key and private_key_path:
        try:
            private_key = Path(private_key_path).read_text(encoding='utf-8').strip()
        except OSError:
            private_key = ''
    private_key = private_key.replace('\\n', '\n')

    bundle_id = str(config.get('APNS_BUNDLE_ID') or '').strip()
    topic = str(config.get('APNS_VOIP_TOPIC') or '').strip() or (
        f'{bundle_id}.voip' if bundle_id else ''
    )
    environment = normalize_apns_environment(config.get('APNS_ENVIRONMENT'))
    return {
        'enabled': bool(
            config.get('APNS_ENABLED')
            and str(config.get('APNS_TEAM_ID') or '').strip()
            and str(config.get('APNS_KEY_ID') or '').strip()
            and bundle_id
            and private_key
        ),
        'team_id': str(config.get('APNS_TEAM_ID') or '').strip(),
        'key_id': str(config.get('APNS_KEY_ID') or '').strip(),
        'bundle_id': bundle_id,
        'topic': topic,
        'private_key': private_key,
        'environment': environment,
        'host': 'api.push.apple.com' if environment == 'production' else 'api.sandbox.push.apple.com',
        'timeout': float(config.get('APNS_TIMEOUT_SECONDS') or 5),
    }


def save_apns_device_token(
    conn,
    *,
    user_id: int,
    token: str,
    push_type: str = 'voip',
    environment: str = 'sandbox',
    bundle_id: str = '',
    device_id: str = '',
) -> bool:
    normalized = normalize_apns_token(token)
    if normalized is None:
        return False
    normalized_push_type = 'voip' if str(push_type or '').strip().lower() == 'voip' else 'alert'
    normalized_environment = normalize_apns_environment(environment)
    conn.execute(
        '''
        INSERT INTO apns_device_tokens (
            user_id, token, push_type, environment, bundle_id, device_id,
            is_active, updated_at, failure_count, last_failure_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, 1, CURRENT_TIMESTAMP, 0, NULL)
        ON CONFLICT(token, push_type) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            environment = EXCLUDED.environment,
            bundle_id = EXCLUDED.bundle_id,
            device_id = EXCLUDED.device_id,
            is_active = 1,
            updated_at = CURRENT_TIMESTAMP,
            failure_count = 0,
            last_failure_at = NULL
        ''',
        (
            int(user_id),
            normalized,
            normalized_push_type,
            normalized_environment,
            str(bundle_id or '')[:255],
            str(device_id or '')[:255],
        ),
    )
    return True


def deactivate_apns_device_token(
    conn,
    *,
    user_id: int,
    token: str,
    push_type: str = 'voip',
) -> int:
    normalized = normalize_apns_token(token)
    if normalized is None:
        return 0
    cursor = conn.execute(
        '''
        UPDATE apns_device_tokens
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = %s AND token = %s AND push_type = %s AND is_active = 1
        ''',
        (int(user_id), normalized, str(push_type or 'voip')),
    )
    return int(cursor.rowcount or 0)


def _active_apns_tokens_for_user(conn, *, user_id: int, push_type: str = 'voip') -> list[dict[str, Any]]:
    rows = conn.execute(
        '''
        SELECT id, token
        FROM apns_device_tokens
        WHERE user_id = %s AND push_type = %s AND is_active = 1
        ORDER BY updated_at DESC, id DESC
        ''',
        (int(user_id), str(push_type or 'voip')),
    ).fetchall()
    return [{'id': int(row['id']), 'token': str(row['token'] or '')} for row in rows]


def _mark_apns_send_success(conn, *, token_id: int) -> None:
    conn.execute(
        '''
        UPDATE apns_device_tokens
        SET
            failure_count = 0,
            last_failure_at = NULL,
            last_success_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
        ''',
        (int(token_id),),
    )


def _mark_apns_send_failure(conn, *, token_id: int, deactivate: bool) -> None:
    conn.execute(
        '''
        UPDATE apns_device_tokens
        SET
            failure_count = COALESCE(failure_count, 0) + 1,
            last_failure_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP,
            is_active = CASE WHEN %s = 1 THEN 0 ELSE is_active END
        WHERE id = %s
        ''',
        (int(bool(deactivate)), int(token_id)),
    )


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def _provider_token(cfg: dict[str, Any], issued_at: int | None = None) -> str:
    now = int(issued_at or time.time())
    header = {'alg': 'ES256', 'kid': cfg['key_id']}
    claims = {'iss': cfg['team_id'], 'iat': now}
    signing_input = '.'.join((
        _b64url(json.dumps(header, separators=(',', ':')).encode('utf-8')),
        _b64url(json.dumps(claims, separators=(',', ':')).encode('utf-8')),
    )).encode('ascii')
    private_key = serialization.load_pem_private_key(
        str(cfg['private_key']).encode('utf-8'),
        password=None,
    )
    signature_der = private_key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = utils.decode_dss_signature(signature_der)
    signature_raw = r.to_bytes(32, 'big') + s.to_bytes(32, 'big')
    return signing_input.decode('ascii') + '.' + _b64url(signature_raw)


def build_call_voip_payload(
    *,
    call_id: str,
    chat_id: str,
    call_type: str,
    initiator_user_id: int,
    initiator_display_name: str,
    initiator_username: str,
    initiator_avatar_url: str = '',
) -> dict[str, Any]:
    return {
        'aps': {'content-available': 1},
        'kind': 'call',
        'call_id': str(call_id or ''),
        'chat_id': str(chat_id or ''),
        'call_type': 'video' if call_type == 'video' else 'audio',
        'caller': {
            'user_id': int(initiator_user_id or 0),
            'display_name': str(initiator_display_name or ''),
            'username': str(initiator_username or ''),
            'avatar_url': str(initiator_avatar_url or ''),
        },
    }


def _send_apns_payload(*, client, cfg: dict[str, Any], token: str, payload: dict[str, Any], auth_token: str) -> tuple[bool, str]:
    url = f'https://{cfg["host"]}/3/device/{token}'
    headers = {
        'authorization': f'bearer {auth_token}',
        'apns-id': str(uuid.uuid4()),
        'apns-push-type': 'voip',
        'apns-topic': cfg['topic'],
        'apns-priority': '10',
        'apns-expiration': '0',
    }
    response = client.post(url, headers=headers, json=payload)
    if response.status_code == 200:
        return True, ''
    reason = ''
    try:
        reason = str(response.json().get('reason') or '')
    except Exception:  # noqa: BLE001
        reason = response.text[:120]
    return False, reason


def send_call_incoming_voip_push(  # noqa: PLR0913 - explicit push-delivery contract
    *,
    receiver_user_id: int,
    initiator_user_id: int,
    initiator_display_name: str,
    initiator_username: str,
    chat_id: str,
    call_id: str,
    call_type: str = 'audio',
    initiator_avatar_url: str = '',
) -> dict[str, int]:
    from flask import current_app

    cfg = apns_config(current_app.config)
    if not cfg['enabled']:
        return {'sent': 0, 'failed': 0}

    try:
        import httpx  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        logger.warning('APNs disabled at runtime: httpx unavailable: %s', exc)
        return {'sent': 0, 'failed': 0}

    payload = build_call_voip_payload(
        call_id=call_id,
        chat_id=chat_id,
        call_type=call_type,
        initiator_user_id=initiator_user_id,
        initiator_display_name=initiator_display_name,
        initiator_username=initiator_username,
        initiator_avatar_url=initiator_avatar_url,
    )
    auth_token = _provider_token(cfg)

    conn = get_db_connection()
    sent = 0
    failed = 0
    try:
        tokens = _active_apns_tokens_for_user(conn, user_id=receiver_user_id, push_type='voip')
        if not tokens:
            return {'sent': 0, 'failed': 0}
        with httpx.Client(http2=True, timeout=cfg['timeout']) as client:
            for item in tokens:
                ok, reason = _send_apns_payload(
                    client=client,
                    cfg=cfg,
                    token=item['token'],
                    payload=payload,
                    auth_token=auth_token,
                )
                if ok:
                    sent += 1
                    _mark_apns_send_success(conn, token_id=item['id'])
                else:
                    failed += 1
                    _mark_apns_send_failure(
                        conn,
                        token_id=item['id'],
                        deactivate=reason in _APNS_INACTIVE_REASONS,
                    )
                    logger.info('APNs VoIP push failed for user_id=%s reason=%s', receiver_user_id, reason)
        conn.commit()
    finally:
        conn.close()
    return {'sent': sent, 'failed': failed}
