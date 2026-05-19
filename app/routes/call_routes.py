"""
Flask blueprint: /call — voice/video call REST endpoints.

Only endpoint: GET /call/ice-config
Returns short-lived TURN credentials using coturn's HMAC static-auth-secret mechanism.
Credentials expire in TURN_CREDENTIAL_TTL_SECONDS (default 600 s).
"""
from __future__ import annotations

import hashlib
import hmac
import time
from base64 import b64encode

from flask import Blueprint, current_app, jsonify, make_response, request, session

from app.database import get_db_connection
from app.extensions import limiter
from app.services.call_feature_access import can_user_use_calls
from app.services.turn_pool import parse_turn_urls
from app.services.turn_pool import select_turn_relays

call_bp = Blueprint('call', __name__, url_prefix='/call')

_DEFAULT_TTL = 600
_DEFAULT_STUN = 'stun:stun.l.google.com:19302'
_ICE_TRANSPORT_POLICIES = {'all', 'relay'}


def _parse_turn_urls(raw_value: str) -> list[str]:
    return parse_turn_urls(raw_value)


def _normalize_ice_transport_policy(raw_value: str) -> str:
    policy = str(raw_value or '').strip().lower()
    return policy if policy in _ICE_TRANSPORT_POLICIES else 'all'


def _user_belongs_to_call_chat(conn, *, call_id: str, user_id: int) -> bool:
    if not call_id:
        return False
    row = conn.execute(
        '''
        SELECT 1
        FROM call_sessions cs
        JOIN call_participants cp ON cp.call_id = cs.call_id
        WHERE cs.call_id = ?
          AND cp.user_id = ?
          AND cp.left_at IS NULL
          AND cs.status IN ('ringing', 'active')
        LIMIT 1
        ''',
        (call_id, user_id),
    ).fetchone()
    return row is not None


@call_bp.route('/ice-config', methods=['GET'])
@limiter.limit('30 per minute')
def ice_config():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthenticated'}), 401

    user_id    = session['user_id']
    call_id = str(request.args.get('call_id') or '').strip()
    if not call_id:
        return jsonify({'error': 'missing_call_id'}), 400

    conn = get_db_connection()
    try:
        if not can_user_use_calls(conn, user_id=int(user_id)):
            return jsonify({'error': 'calls_feature_disabled'}), 403
        if not _user_belongs_to_call_chat(conn, call_id=call_id, user_id=int(user_id)):
            return jsonify({'error': 'call_not_found_or_expired'}), 404
    finally:
        conn.close()

    turn_secret = str(current_app.config.get('TURN_SECRET') or '').strip()
    turn_urls_raw = str(
        current_app.config.get('TURN_SERVER_URLS')
        or current_app.config.get('TURN_SERVER_URL')
        or ''
    ).strip()
    turn_pool_raw = str(current_app.config.get('TURN_SERVER_POOL') or '').strip()
    turn_pool_limit = current_app.config.get('TURN_SERVER_POOL_LIMIT') or 2
    ttl         = int(current_app.config.get('TURN_CREDENTIAL_TTL_SECONDS') or _DEFAULT_TTL)
    requested_ice_transport_policy = _normalize_ice_transport_policy(
        current_app.config.get('CALL_ICE_TRANSPORT_POLICY') or 'all'
    )

    ice_servers = [{'urls': _DEFAULT_STUN}]
    turn_selection = select_turn_relays(
        pool_raw=turn_pool_raw,
        legacy_urls_raw=turn_urls_raw,
        limit=turn_pool_limit,
    )
    turn_configured = bool(turn_secret and turn_selection.relays)
    ice_transport_policy = requested_ice_transport_policy if turn_configured else 'all'

    if turn_configured:
        expiry   = int(time.time()) + ttl
        username = f'{expiry}:{user_id}'
        credential = b64encode(
            hmac.new(turn_secret.encode(), username.encode(), hashlib.sha1).digest()
        ).decode()
        for relay in turn_selection.relays:
            ice_servers.append({
                'urls':       list(relay.urls) if len(relay.urls) > 1 else relay.urls[0],
                'username':   username,
                'credential': credential,
            })

    response = make_response(jsonify({
        'ice_servers': ice_servers,
        'turn_configured': turn_configured,
        'turn_urls_count': turn_selection.urls_count,
        'turn_relays_count': len(turn_selection.relays),
        'turn_pool_configured': turn_selection.pool_configured,
        'turn_pool_source': turn_selection.source,
        'turn_pool_selected_ids': turn_selection.selected_ids,
        'turn_credential_ttl_seconds': ttl,
        'ice_transport_policy': ice_transport_policy,
    }))
    response.headers['Cache-Control'] = 'no-store, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    return response


@call_bp.route('/feature-access', methods=['GET'])
@limiter.limit('60 per minute')
def feature_access():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthenticated'}), 401

    user_id = int(session['user_id'])
    conn = get_db_connection()
    try:
        calls_enabled = can_user_use_calls(conn, user_id=user_id)
    finally:
        conn.close()

    return jsonify({'calls_enabled': calls_enabled})
