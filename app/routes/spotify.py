"""Spotify OAuth routes.

GET  /spotify/connect    - redirect user to Spotify authorization page
GET  /spotify/callback   - OAuth callback; save tokens and redirect to settings
POST /spotify/disconnect - revoke stored tokens for current user
GET  /spotify/status     - JSON: whether current user has Spotify connected
"""

import logging

from flask import Blueprint, current_app, jsonify, redirect, request, session, url_for

from app.database import get_db_connection
from app.extensions import limiter
from app.services.spotify import (
    build_auth_url,
    exchange_code,
    generate_oauth_state,
    is_connected,
    revoke_tokens,
    save_tokens,
    verify_oauth_state,
)

logger = logging.getLogger(__name__)
spotify_bp = Blueprint('spotify', __name__)


def _unauthorized():
    return jsonify({'success': False, 'error': 'unauthorized'}), 401


def _settings_redirect():
    return redirect(url_for('chat.chat_index', settings='integrations'))


def _spotify_configured() -> tuple[str, str, str] | None:
    cfg = current_app.config
    client_id = str(cfg.get('SPOTIFY_CLIENT_ID') or '').strip()
    client_secret = str(cfg.get('SPOTIFY_CLIENT_SECRET') or '').strip()
    redirect_uri = str(cfg.get('SPOTIFY_REDIRECT_URI') or '').strip()
    if client_id and client_secret and redirect_uri:
        return client_id, client_secret, redirect_uri
    return None


@spotify_bp.route('/spotify/connect')
@limiter.limit('10 per minute')
def spotify_connect():
    if 'user_id' not in session:
        return redirect(url_for('chat.chat_index'))

    creds = _spotify_configured()
    if not creds:
        return _settings_redirect()

    client_id, _secret, redirect_uri = creds
    user_id = session['user_id']
    secret_key = current_app.config['SECRET_KEY']
    state = generate_oauth_state(secret_key, user_id)
    auth_url = build_auth_url(client_id, redirect_uri, state)
    return redirect(auth_url)


@spotify_bp.route('/spotify/callback')
@limiter.limit('10 per minute')
def spotify_callback():
    error = request.args.get('error')
    if error:
        logger.info('Spotify OAuth error: %s', error)
        return _settings_redirect()

    code = request.args.get('code', '').strip()
    state = request.args.get('state', '').strip()

    if not code or not state:
        return _settings_redirect()

    if 'user_id' not in session:
        return _settings_redirect()

    secret_key = current_app.config['SECRET_KEY']
    state_user_id = verify_oauth_state(secret_key, state)
    session_user_id = int(session['user_id'])
    if state_user_id is None or state_user_id != session_user_id:
        logger.warning('Spotify OAuth state mismatch for session user %s', session.get('user_id'))
        return _settings_redirect()

    creds = _spotify_configured()
    if not creds:
        return _settings_redirect()

    client_id, client_secret, redirect_uri = creds
    try:
        token_data = exchange_code(client_id, client_secret, redirect_uri, code)
    except Exception:
        logger.exception('Spotify token exchange failed')
        return _settings_redirect()

    conn = get_db_connection()
    try:
        save_tokens(conn, session_user_id, token_data)
    finally:
        conn.close()

    return _settings_redirect()


@spotify_bp.route('/spotify/disconnect', methods=['POST'])
@limiter.limit('10 per minute')
def spotify_disconnect():
    if 'user_id' not in session:
        return _unauthorized()

    conn = get_db_connection()
    try:
        revoke_tokens(conn, int(session['user_id']))
    finally:
        conn.close()

    return jsonify({'success': True})


@spotify_bp.route('/spotify/status')
@limiter.limit('30 per minute')
def spotify_status():
    if 'user_id' not in session:
        return _unauthorized()

    cfg_ok = _spotify_configured() is not None
    if not cfg_ok:
        return jsonify({
            'success': True,
            'configured': False,
            'connected': False,
        })

    conn = get_db_connection()
    try:
        connected = is_connected(conn, int(session['user_id']))
    finally:
        conn.close()

    return jsonify({
        'success': True,
        'configured': cfg_ok,
        'connected': connected,
    })
