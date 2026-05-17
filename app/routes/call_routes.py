"""
Flask blueprint: /call — voice/video call REST endpoints.

Only endpoint: GET /call/ice-config
Returns short-lived TURN credentials using coturn's HMAC static-auth-secret mechanism.
Credentials expire in TURN_CREDENTIAL_TTL_SECONDS (default 3600 s).
"""
from __future__ import annotations

import hashlib
import hmac
import time
from base64 import b64encode

from flask import Blueprint, current_app, jsonify, session

from app.database import get_db_connection
from app.extensions import limiter
from app.services.call_feature_access import can_user_use_calls

call_bp = Blueprint('call', __name__, url_prefix='/call')

_DEFAULT_TTL = 3600
_DEFAULT_STUN = 'stun:stun.l.google.com:19302'


def _parse_turn_urls(raw_value: str) -> list[str]:
    urls = []
    for item in str(raw_value or '').split(','):
        url = item.strip()
        if not url:
            continue
        if not (url.startswith('turn:') or url.startswith('turns:')):
            continue
        urls.append(url)
    return urls


@call_bp.route('/ice-config', methods=['GET'])
@limiter.limit('30 per minute')
def ice_config():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthenticated'}), 401

    user_id    = session['user_id']
    conn = get_db_connection()
    try:
        if not can_user_use_calls(conn, user_id=int(user_id)):
            return jsonify({'error': 'calls_feature_disabled'}), 403
    finally:
        conn.close()

    turn_secret = str(current_app.config.get('TURN_SECRET') or '').strip()
    turn_urls_raw = str(
        current_app.config.get('TURN_SERVER_URLS')
        or current_app.config.get('TURN_SERVER_URL')
        or ''
    ).strip()
    ttl         = int(current_app.config.get('TURN_CREDENTIAL_TTL_SECONDS') or _DEFAULT_TTL)

    ice_servers = [{'urls': _DEFAULT_STUN}]
    turn_urls = _parse_turn_urls(turn_urls_raw)

    if turn_secret and turn_urls:
        expiry   = int(time.time()) + ttl
        username = f'{expiry}:{user_id}'
        credential = b64encode(
            hmac.new(turn_secret.encode(), username.encode(), hashlib.sha1).digest()
        ).decode()
        ice_servers.append({
            'urls':       turn_urls if len(turn_urls) > 1 else turn_urls[0],
            'username':   username,
            'credential': credential,
        })

    return jsonify({
        'ice_servers': ice_servers,
        'turn_configured': bool(turn_secret and turn_urls),
        'turn_urls_count': len(turn_urls),
    })


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
