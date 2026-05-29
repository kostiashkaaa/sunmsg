import logging

from flask import Blueprint, current_app, jsonify, request, session
from flask_wtf.csrf import generate_csrf

from app.database import get_db_connection
from app.db_backend import IntegrityError
from app.extensions import limiter, socketio
from app.routes.contacts import fetch_contacts_for_user
from app.routes.socket_emit import build_route_socket_emitter
from app.services.apns import (
    apns_config,
    deactivate_apns_device_token,
    save_apns_device_token,
)
from app.services.call_feature_access import can_user_use_calls
from app.services.chat_members import get_chat_type
from app.services.chat_page_state import build_socketio_client_config, fetch_chat_page_context
from app.services.crypto import is_valid_chat_id, looks_like_ciphertext
from app.services.locale import language_from_user_row
from app.services.session_state import clear_invalid_session_user

logger = logging.getLogger(__name__)

mobile_bp = Blueprint('mobile', __name__, url_prefix='/api/mobile')

_socket_emit_with_envelope = build_route_socket_emitter(
    raw_emit_func=socketio.emit,
    get_db_connection_func=get_db_connection,
    logger=logger,
)


def _to_unix(ts) -> float:
    """Convert a DB timestamp (datetime, str, or numeric) to a Unix epoch float."""
    if ts is None:
        return 0.0
    if hasattr(ts, 'timestamp'):
        return ts.timestamp()
    if isinstance(ts, (int, float)):
        return float(ts)
    # datetime string from psycopg — e.g. "2026-05-25 18:59:12" or "2026-05-25 18:59:12+03:00"
    from datetime import datetime, timezone
    for fmt in ('%Y-%m-%d %H:%M:%S.%f%z', '%Y-%m-%d %H:%M:%S%z',
                '%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S'):
        try:
            dt = datetime.strptime(str(ts).strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except ValueError:
            continue
    return 0.0

MOBILE_BOOTSTRAP_CONTACTS_LIMIT = 50


def _unauthorized_response(message: str = 'Authorization required.'):
    return jsonify({'success': False, 'error': message}), 401


def _session_user_id() -> int | None:
    raw_user_id = session.get('user_id')
    if raw_user_id is None:
        return None
    try:
        user_id = int(raw_user_id)
    except (TypeError, ValueError):
        return None
    return user_id if user_id > 0 else None


def _fetch_existing_mobile_send(conn, *, sender_id: int, request_id: str):
    normalized_request_id = str(request_id or '').strip()
    if not normalized_request_id:
        return None
    return conn.execute(
        '''
        SELECT id, chat_id, created_at, message, message_type, is_read, is_delivered
        FROM messages
        WHERE sender_id = %s AND request_id = %s
        ORDER BY id DESC
        LIMIT 1
        ''',
        (int(sender_id), normalized_request_id),
    ).fetchone()


def _resolve_calls_feature(conn, *, user_id: int) -> bool:
    try:
        return bool(can_user_use_calls(conn, user_id=user_id))
    except Exception:  # noqa: BLE001
        logger.exception('Failed to resolve mobile calls feature for user_id=%s', user_id)
        return False


def _build_mobile_bootstrap_payload(
    *,
    page_context: dict,
    user_id: int,
    calls_enabled: bool,
) -> dict:
    socketio_config = build_socketio_client_config(current_app.config)
    socketio_config.setdefault('path', '/socket.io')

    return {
        'success': True,
        'csrf_token': generate_csrf(),
        'user': {
            'id': user_id,
            'username': str(page_context.get('current_username') or ''),
            'display_name': str(page_context.get('current_display_name') or ''),
            'public_key': str(page_context.get('current_public_key') or ''),
            'avatar_url': str(page_context.get('current_avatar_url') or ''),
            'ui_language': str(page_context.get('ui_language') or session.get('ui_language') or 'ru'),
            'mute_dialog_requests': bool(page_context.get('mute_dialog_requests')),
            'client_preferences': page_context.get('client_preferences') or {},
        },
        'session': {
            'auto_logout_seconds': int(session.get('session_auto_logout_seconds') or 2592000),
            'expires_at': int(session.get('session_expires_at') or 0),
        },
        'crypto': {
            'x25519_public_key': str(page_context.get('current_x25519_public_key') or ''),
            'ed25519_public_key': str(page_context.get('current_ed25519_public_key') or ''),
            'crypto_version': int(page_context.get('current_crypto_version') or 2),
        },
        'socketio': socketio_config,
        'features': {
            'calls': bool(calls_enabled),
            'groups': True,
            'media': True,
            'push_apns': bool(apns_config(current_app.config)['enabled']),
        },
        'contacts': page_context.get('initial_contacts') or [],
        'has_more_contacts': bool(page_context.get('has_more_initial_contacts')),
    }


@mobile_bp.route('/csrf', methods=['GET'])
@limiter.limit('120 per minute')
def mobile_csrf():
    """Returns a CSRF token for use by the native app before login."""
    return jsonify({'csrf_token': generate_csrf()})


@mobile_bp.route('/apns/register', methods=['POST'])
@limiter.limit('60 per minute')
def mobile_register_apns_token():
    user_id = _session_user_id()
    if user_id is None or not session.get('public_key_pem'):
        clear_invalid_session_user(session)
        return _unauthorized_response()

    data = request.get_json(silent=True) or {}
    token = str(data.get('token') or '').strip()
    push_type = str(data.get('push_type') or 'voip').strip().lower()
    environment = str(data.get('environment') or current_app.config.get('APNS_ENVIRONMENT') or 'sandbox')
    device_id = str(data.get('device_id') or '').strip()
    cfg = apns_config(current_app.config)
    bundle_id = str(current_app.config.get('APNS_BUNDLE_ID') or '').strip()

    conn = get_db_connection()
    try:
        if not save_apns_device_token(
            conn,
            user_id=user_id,
            token=token,
            push_type='voip' if push_type == 'voip' else 'alert',
            environment=environment,
            bundle_id=bundle_id,
            device_id=device_id,
        ):
            return jsonify({'success': False, 'error': 'invalid_apns_token'}), 400
        conn.commit()
        return jsonify({'success': True, 'apns_enabled': bool(cfg['enabled'])})
    except Exception:
        conn.rollback()
        logger.exception('mobile_register_apns_token error for user_id=%s', user_id)
        return jsonify({'success': False, 'error': 'Failed to register APNs token.'}), 500
    finally:
        conn.close()


@mobile_bp.route('/apns/unregister', methods=['POST'])
@limiter.limit('60 per minute')
def mobile_unregister_apns_token():
    user_id = _session_user_id()
    if user_id is None or not session.get('public_key_pem'):
        clear_invalid_session_user(session)
        return _unauthorized_response()

    data = request.get_json(silent=True) or {}
    token = str(data.get('token') or '').strip()
    push_type = str(data.get('push_type') or 'voip').strip().lower()
    conn = get_db_connection()
    try:
        removed = deactivate_apns_device_token(
            conn,
            user_id=user_id,
            token=token,
            push_type='voip' if push_type == 'voip' else 'alert',
        )
        if not removed:
            return jsonify({'success': False, 'error': 'invalid_or_unknown_apns_token'}), 400
        conn.commit()
        return jsonify({'success': True})
    except Exception:
        conn.rollback()
        logger.exception('mobile_unregister_apns_token error for user_id=%s', user_id)
        return jsonify({'success': False, 'error': 'Failed to unregister APNs token.'}), 500
    finally:
        conn.close()


@mobile_bp.route('/bootstrap', methods=['GET'])
@limiter.limit('120 per minute')
def mobile_bootstrap():
    user_id = _session_user_id()
    if user_id is None or not session.get('public_key_pem'):
        clear_invalid_session_user(session)
        return _unauthorized_response()

    conn = get_db_connection()
    try:
        page_context = fetch_chat_page_context(
            conn=conn,
            user_id=user_id,
            fetch_contacts_for_user=fetch_contacts_for_user,
            language_from_user_row=language_from_user_row,
            initial_contacts_limit=MOBILE_BOOTSTRAP_CONTACTS_LIMIT,
        )
        if not page_context:
            logger.info('Clearing stale session for missing user_id=%s on mobile bootstrap', user_id)
            clear_invalid_session_user(session)
            return _unauthorized_response('User not found.')

        session['ui_language'] = page_context['ui_language']
        calls_enabled = _resolve_calls_feature(conn, user_id=user_id)
        return jsonify(
            _build_mobile_bootstrap_payload(
                page_context=page_context,
                user_id=user_id,
                calls_enabled=calls_enabled,
            )
        )
    finally:
        conn.close()


@mobile_bp.route('/start_chat', methods=['POST'])
@limiter.limit('30 per minute')
def mobile_start_chat():
    """Open or create a direct chat with a user by username."""
    user_id = _session_user_id()
    if user_id is None or not session.get('public_key_pem'):
        clear_invalid_session_user(session)
        return _unauthorized_response()

    data = request.get_json(silent=True) or {}
    target_username = str(data.get('username') or '').strip().lower().lstrip('@')
    if not target_username:
        return jsonify({'success': False, 'error': 'username is required.'}), 400

    conn = get_db_connection()
    try:
        target = conn.execute(
            'SELECT id, username, display_name, public_key FROM users WHERE username = %s',
            (target_username,),
        ).fetchone()
        if not target:
            return jsonify({'success': False, 'error': 'User not found.'}), 404
        if target['id'] == user_id:
            return jsonify({'success': False, 'error': 'Cannot chat with yourself.'}), 400

        # Check existing contact/chat
        existing = conn.execute(
            'SELECT chat_id FROM contacts WHERE user_id = %s AND contact_id = %s',
            (user_id, target['id']),
        ).fetchone()
        if existing:
            return jsonify({
                'success': True,
                'status': 'existing',
                'chat_id': existing['chat_id'],
                'contact': {
                    'chatId': existing['chat_id'],
                    'userId': target['id'],
                    'username': target['username'],
                    'display_name': target['display_name'],
                    'public_key': target['public_key'],
                },
            })

        # Check for pending outgoing dialog request
        pending = conn.execute(
            "SELECT id FROM dialog_requests WHERE sender_id = %s AND receiver_id = %s AND status = 'pending'",
            (user_id, target['id']),
        ).fetchone()
        if pending:
            return jsonify({'success': True, 'status': 'request_pending'})

        # Send a new dialog request
        conn.execute(
            'INSERT INTO dialog_requests (sender_id, receiver_id, status) VALUES (%s, %s, %s)',
            (user_id, target['id'], 'pending'),
        )
        conn.commit()

        # Notify target via Socket.IO (their public key room)
        if target['public_key']:
            socketio.emit('dialog_request_updated', {
                'sender_id': user_id,
                'receiver_id': target['id'],
                'status': 'pending',
            }, room=target['public_key'])

        return jsonify({'success': True, 'status': 'request_sent'})
    except Exception:
        logger.exception('mobile_start_chat error for user_id=%s', user_id)
        return jsonify({'success': False, 'error': 'Failed to start chat.'}), 500
    finally:
        conn.close()


@mobile_bp.route('/send', methods=['POST'])
@limiter.limit('60 per minute')
def mobile_send():
    """Send an encrypted message from the native iOS app via HTTP (no Socket.IO required)."""
    user_id = _session_user_id()
    if user_id is None or not session.get('public_key_pem'):
        clear_invalid_session_user(session)
        return _unauthorized_response()

    data = request.get_json(silent=True) or {}
    chat_id = str(data.get('chat_id') or '').strip()
    message = str(data.get('message') or '').strip()
    message_type = str(data.get('message_type') or 'text').strip()
    request_id = str(data.get('request_id') or '').strip()[:64]

    if not chat_id or not message:
        return jsonify({'success': False, 'error': 'chat_id and message are required.'}), 400
    if not is_valid_chat_id(chat_id):
        return jsonify({'success': False, 'error': 'Invalid chat_id.'}), 400
    if not looks_like_ciphertext(message):
        return jsonify({'success': False, 'error': 'Message must be encrypted ciphertext.'}), 400

    sender_pub = session.get('public_key_pem', '')

    conn = get_db_connection()
    try:
        chat_type = get_chat_type(conn, chat_id)

        receiver_id = None
        receiver_pub = ''
        if chat_type != 'group':
            contact = conn.execute(
                '''SELECT c.contact_id, u.public_key
                   FROM contacts c
                   LEFT JOIN users u ON u.id = c.contact_id
                   WHERE c.user_id = %s AND c.chat_id = %s''',
                (user_id, chat_id),
            ).fetchone()
            if not contact:
                # Fallback: saved messages (self-chat) — contact_id == user_id
                # The chat_id is derived from the user's own public key via saved_messages_chat_id()
                from app.services.favorites_chat import saved_messages_chat_id
                self_user = conn.execute(
                    'SELECT public_key FROM users WHERE id = %s', (user_id,)
                ).fetchone()
                if self_user and chat_id == saved_messages_chat_id(self_user['public_key']):
                    receiver_id = user_id
                    receiver_pub = self_user['public_key'] or ''
                else:
                    return jsonify({'success': False, 'error': 'Chat not found or not a contact.'}), 404
            else:
                receiver_id = contact['contact_id']
                receiver_pub = contact['public_key'] or ''

        sender_row = conn.execute(
            'SELECT display_name, username FROM users WHERE id = %s', (user_id,)
        ).fetchone()
        sender_display_name = sender_row['display_name'] if sender_row else ''
        sender_username = sender_row['username'] if sender_row else ''

        duplicate = False
        row = _fetch_existing_mobile_send(conn, sender_id=user_id, request_id=request_id)
        if row is not None:
            conn.rollback()
            duplicate = True
            chat_id = row['chat_id']
            message = row['message']
            message_type = row['message_type']
        else:
            try:
                cur = conn.execute(
                    '''INSERT INTO messages
                       (chat_id, sender_id, receiver_id, message, message_type, request_id)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       RETURNING id, created_at, is_read, is_delivered''',
                    (chat_id, user_id, receiver_id, message, message_type, request_id or None),
                )
                row = cur.fetchone()
                conn.commit()
            except IntegrityError:
                conn.rollback()
                row = _fetch_existing_mobile_send(conn, sender_id=user_id, request_id=request_id)
                if row is None:
                    raise
                duplicate = True
                chat_id = row['chat_id']
                message = row['message']
                message_type = row['message_type']
        msg_id = row['id']
        created_at = row['created_at']
    except Exception:
        logger.exception('mobile_send: DB error for user_id=%s chat_id=%s', user_id, chat_id)
        return jsonify({'success': False, 'error': 'Failed to save message.'}), 500
    finally:
        conn.close()

    payload = {
        'id': msg_id,
        'chat_id': chat_id,
        'sender_user_id': user_id,
        'sender_public_key': sender_pub,
        'sender_display_name': sender_display_name,
        'sender_username': sender_username,
        'message': message,
        'message_type': message_type,
        'is_read': bool(row['is_read']),
        'is_delivered': bool(row['is_delivered']),
        'created_at': _to_unix(created_at),
        'request_id': request_id,
        'reply_to_id': None,
        'reactions': [],
        'expires_at': None,
    }
    if duplicate:
        payload['duplicate'] = True

    if not duplicate:
        # Broadcast to the receiver's Socket.IO room (public key room)
        if receiver_pub:
            _socket_emit_with_envelope(
                'receive_message',
                payload,
                room=receiver_pub,
                chat_id=chat_id,
                request_id=request_id,
            )
        # Echo back to sender so other sessions update
        if sender_pub and sender_pub != receiver_pub:
            _socket_emit_with_envelope(
                'message_sent',
                payload,
                room=sender_pub,
                chat_id=chat_id,
                request_id=request_id,
            )

    return jsonify({'success': True, 'message': payload})
