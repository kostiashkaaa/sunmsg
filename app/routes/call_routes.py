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

from app.extensions import limiter

call_bp = Blueprint('call', __name__, url_prefix='/call')

_DEFAULT_TTL = 3600
_DEFAULT_STUN = 'stun:stun.l.google.com:19302'


@call_bp.route('/ice-config', methods=['GET'])
@limiter.limit('30 per minute')
def ice_config():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthenticated'}), 401

    user_id    = session['user_id']
    turn_secret = str(current_app.config.get('TURN_SECRET') or '').strip()
    turn_url    = str(current_app.config.get('TURN_SERVER_URL') or '').strip()
    ttl         = int(current_app.config.get('TURN_CREDENTIAL_TTL_SECONDS') or _DEFAULT_TTL)

    ice_servers = [{'urls': _DEFAULT_STUN}]

    if turn_secret and turn_url:
        expiry   = int(time.time()) + ttl
        username = f'{expiry}:{user_id}'
        credential = b64encode(
            hmac.new(turn_secret.encode(), username.encode(), hashlib.sha1).digest()
        ).decode()
        ice_servers.append({
            'urls':       turn_url,
            'username':   username,
            'credential': credential,
        })

    return jsonify({'ice_servers': ice_servers})
