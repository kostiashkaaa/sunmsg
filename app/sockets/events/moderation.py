from datetime import datetime, timezone

from flask import current_app
from flask import session

from app.db_backend import DatabaseError
from app.database import (
    ensure_chat_exists,
    ensure_chat_pins_multiple_support,
    get_db_connection,
)
from app.extensions import socketio
from app.services.blocking import (
    build_block_state,
    normalize_block_state,
)
from app.services.chat_members import get_chat_type
from app.services.crypto import is_valid_chat_id, looks_like_ciphertext
from app.services import moderation as moderation_service
from app.services.group_authorization import authorize_group_action
from app.services.presence import count_connected
from app.services.reactions import (
    fetch_reactions_map,
    sanitize_reaction_emoji,
)
from app.services.web_push import send_chat_message_push
from app.sockets.message_handlers import (
    handle_delete_messages_event,
    handle_edit_message_event,
    handle_send_message_event,
)
from app.sockets.pin_handlers import (
    handle_pin_message_event,
    handle_unpin_message_event,
)
from app.sockets.favorite_handlers import (
    handle_favorite_message_event,
    handle_unfavorite_message_event,
)
from app.sockets.reaction_handlers import handle_toggle_reaction_event
from app.services.disappearing_messages import (
    set_chat_auto_delete,
    normalize_auto_delete_seconds,
)
from app.services.chat_members import is_chat_member

from . import context as ctx


def _can_group_action(conn, actor_user_id: int, chat_id: str, action: str) -> bool:
    decision = authorize_group_action(
        conn,
        actor_user_id=int(actor_user_id),
        chat_id=str(chat_id),
        action=str(action),
    )
    return bool(decision.allowed)


def _maybe_apply_automated_spam_mute(conn, *, sender_id: int, trigger: str, force: bool = False):
    cfg = current_app.config
    if not bool(cfg.get('ABUSE_AUTO_MUTE_ENABLED', True)):
        return None
    return moderation_service.maybe_apply_automated_spam_mute(
        conn,
        user_id=int(sender_id),
        trigger=str(trigger or 'pre_send'),
        force=bool(force),
        window_seconds=int(cfg.get('ABUSE_AUTO_MUTE_WINDOW_SECONDS', 3600) or 3600),
        reports_threshold=int(cfg.get('ABUSE_AUTO_MUTE_REPORTS_THRESHOLD', 3) or 3),
        blocks_threshold=int(cfg.get('ABUSE_AUTO_MUTE_BLOCKS_THRESHOLD', 5) or 5),
        ttl_seconds=int(cfg.get('ABUSE_AUTO_MUTE_TTL_SECONDS', 3600) or 3600),
    )


def _can_group_action_with_message(conn, actor_user_id: int, chat_id: str, action: str):
    decision = authorize_group_action(
        conn,
        actor_user_id=int(actor_user_id),
        chat_id=str(chat_id),
        action=str(action),
    )
    if decision.allowed:
        return True, ''
    return False, decision.message or 'Insufficient role for this action.'


@socketio.on('edit_message')
@ctx.authenticated_only
def handle_edit_message(data):
    handle_edit_message_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        positive_int_func=ctx._positive_int,
        socket_rate_ok_func=ctx._socket_rate_ok,
        sanitize_message_type_func=ctx._sanitize_message_type,
        is_valid_chat_id_func=is_valid_chat_id,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        emit_blocked_error_func=ctx._emit_blocked_error,
        emit_func=ctx._emit_socket_event,
        parse_db_utc_timestamp_func=ctx._parse_db_utc_timestamp,
        utc_now_func=lambda: datetime.now(timezone.utc),
        message_edit_window_seconds=ctx._MESSAGE_EDIT_WINDOW_SECONDS,
        max_message_edits=ctx._MAX_MESSAGE_EDITS,
        logger=ctx.logger,
        normalize_request_id_func=ctx._normalize_request_id,
    )


@socketio.on('delete_messages')
@ctx.authenticated_only
def handle_delete_messages(data):
    handle_delete_messages_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        positive_int_func=ctx._positive_int,
        socket_rate_ok_func=ctx._socket_rate_ok,
        is_valid_chat_id_func=is_valid_chat_id,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        emit_blocked_error_func=ctx._emit_blocked_error,
        emit_func=ctx._emit_socket_event,
        logger=ctx.logger,
        database_error_cls=DatabaseError,
        authorize_group_action_func=_can_group_action,
        normalize_request_id_func=ctx._normalize_request_id,
    )


@socketio.on('toggle_reaction')
@ctx.authenticated_only
def handle_toggle_reaction(data):
    handle_toggle_reaction_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        positive_int_func=ctx._positive_int,
        sanitize_reaction_emoji_func=sanitize_reaction_emoji,
        normalize_request_id_func=ctx._normalize_request_id,
        is_valid_chat_id_func=is_valid_chat_id,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        emit_blocked_error_func=ctx._emit_blocked_error,
        fetch_reactions_map_func=fetch_reactions_map,
        emit_func=ctx._emit_socket_event,
        utc_now_iso_func=lambda: datetime.now(timezone.utc).isoformat(timespec='milliseconds'),
        logger=ctx.logger,
        database_error_cls=DatabaseError,
    )


@socketio.on('send_message')
@ctx.authenticated_only
def handle_send_message(data):
    handle_send_message_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        is_valid_chat_id_func=is_valid_chat_id,
        get_db_connection_func=get_db_connection,
        count_connected_func=count_connected,
        build_block_state_func=build_block_state,
        normalize_block_state_func=normalize_block_state,
        sanitize_message_type_func=ctx._sanitize_message_type,
        positive_int_func=ctx._positive_int,
        ensure_chat_exists_func=ensure_chat_exists,
        looks_like_ciphertext_func=looks_like_ciphertext,
        emit_blocked_error_func=ctx._emit_blocked_error,
        emit_func=ctx._emit_socket_event,
        utc_now_text_func=lambda: datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
        logger=ctx.logger,
        database_error_cls=DatabaseError,
        send_web_push_notification_func=send_chat_message_push,
        moderation_user_restriction_func=moderation_service.active_user_restriction,
        moderation_public_link_check_func=lambda message_text: moderation_service.evaluate_public_links(
            message_text,
            blocked_domains=moderation_service.parse_csv(
                str(current_app.config.get('MODERATION_BLOCKED_PUBLIC_DOMAINS') or '').strip()
            ),
        ),
        group_restriction_lookup_func=moderation_service.active_group_restriction,
        socket_send_context_rate_check_func=ctx._socket_send_context_rate_check,
        moderation_auto_mute_func=_maybe_apply_automated_spam_mute,
        normalize_request_id_func=ctx._normalize_request_id,
    )


@socketio.on('pin_message')
@ctx.authenticated_only
def handle_pin_message(data):
    handle_pin_message_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        ensure_chat_pins_multiple_support_func=ensure_chat_pins_multiple_support,
        positive_int_func=ctx._positive_int,
        is_valid_chat_id_func=is_valid_chat_id,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        emit_blocked_error_func=ctx._emit_blocked_error,
        emit_func=ctx._emit_socket_event,
        utc_now_z_func=lambda: datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        get_chat_type_func=get_chat_type,
        authorize_group_action_func=_can_group_action_with_message,
    )


@socketio.on('unpin_message')
@ctx.authenticated_only
def handle_unpin_message(data):
    handle_unpin_message_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        ensure_chat_pins_multiple_support_func=ensure_chat_pins_multiple_support,
        positive_int_func=ctx._positive_int,
        is_valid_chat_id_func=is_valid_chat_id,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        emit_blocked_error_func=ctx._emit_blocked_error,
        emit_func=ctx._emit_socket_event,
        get_chat_type_func=get_chat_type,
        authorize_group_action_func=_can_group_action_with_message,
    )


@socketio.on('favorite_message')
@ctx.authenticated_only
def handle_favorite_message(data):
    handle_favorite_message_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        positive_int_func=ctx._positive_int,
        is_valid_chat_id_func=is_valid_chat_id,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        emit_blocked_error_func=ctx._emit_blocked_error,
        emit_func=ctx._emit_socket_event,
        utc_now_z_func=lambda: datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
    )


@socketio.on('unfavorite_message')
@ctx.authenticated_only
def handle_unfavorite_message(data):
    handle_unfavorite_message_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        positive_int_func=ctx._positive_int,
        is_valid_chat_id_func=is_valid_chat_id,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        emit_blocked_error_func=ctx._emit_blocked_error,
        emit_func=ctx._emit_socket_event,
    )


@socketio.on('set_chat_auto_delete')
@ctx.authenticated_only
def handle_set_chat_auto_delete(data):
    """Set or clear per-chat disappearing message timer. Admin/owner only for groups."""
    if not ctx._require_payload_dict(data):
        return
    if not ctx._socket_csrf_ok(data):
        return
    user_id = int(session.get('user_id', 0))
    chat_id = str(data.get('chat_id') or '').strip()
    if not chat_id or not is_valid_chat_id(chat_id):
        ctx._emit_socket_event('error', {'message': 'Invalid chat_id.'})
        return

    seconds = normalize_auto_delete_seconds(data.get('seconds'))
    if seconds is None:
        ctx._emit_socket_event('error', {'message': 'Invalid timer value.'})
        return

    conn = get_db_connection()
    try:
        if not is_chat_member(conn, user_id, chat_id):
            ctx._emit_socket_event('error', {'message': 'Not a member.'})
            return
        chat = conn.execute(
            'SELECT chat_type, created_by_user_id FROM chats WHERE chat_id = ?', (chat_id,)
        ).fetchone()
        if not chat:
            return
        if str(chat['chat_type'] or '') == 'group':
            decision = authorize_group_action(conn, actor_user_id=user_id, chat_id=chat_id, action='change_settings')
            if not decision.allowed:
                ctx._emit_socket_event('error', {'message': 'No permission.'})
                return
        set_chat_auto_delete(conn, chat_id, seconds)
        conn.commit()
    finally:
        conn.close()

    ctx._emit_socket_event(
        'chat_auto_delete_updated',
        {'chat_id': chat_id, 'seconds': seconds},
        room=chat_id,
    )
