import logging
import re

from flask import Blueprint, session

from app.database import get_db_connection
from app.extensions import socketio
from app.routes.socket_emit import build_route_socket_emitter
from app.services.blocking import (
    build_block_state,
    normalize_block_state,
)
from app.services.locale import normalize_language
from app.services.presence import is_effectively_online
from app.services.user import get_safe_avatar_url
from app.routes.blocking_handlers import (
    emit_block_state_events as _emit_block_state_events_impl,
)
from app.routes.contacts_data_utils import (
    ensure_pinned_chats_table as _ensure_pinned_chats_table_impl,
    resolve_viewer_context as _resolve_viewer_context_impl,
    shared_chat_id as _shared_chat_id_impl,
)
from app.routes.contacts_list_handlers import (
    fetch_contacts_for_user as _fetch_contacts_for_user_impl,
)
from app.routes.contacts_utils import (
    build_initial_last_message_preview as _build_initial_last_message_preview,
    format_sidebar_time as _format_sidebar_time,
)

logger = logging.getLogger(__name__)

contacts_bp = Blueprint('contacts', __name__)

SEARCH_USERS_MIN_QUERY_LEN = 3
SEARCH_USERS_DEFAULT_LIMIT = 20
SEARCH_USERS_MAX_LIMIT = 50
SEARCH_USERS_MAX_OFFSET = 500
USERNAME_PATTERN = re.compile(r'^[a-z0-9_]{1,50}$')

AUTH_REQUIRED_ERROR = 'Authorization required.'
EMPTY_CHAT_ID_ERROR = 'chat_id cannot be empty.'
INVALID_CHAT_IDS_ERROR = 'Invalid chat_ids list.'
CHAT_NOT_FOUND_ERROR = 'Chat not found.'
PIN_OPERATION_FAILED_ERROR = 'Failed to update pinned chats.'
INVALID_BLOCKED_USER_ID_ERROR = 'Invalid blocked_user_id.'
USER_NOT_FOUND_ERROR = 'User not found.'
BLOCK_OPERATION_FAILED_ERROR = 'Failed to update block state.'
DIALOG_REQUESTS_FETCH_FAILED_ERROR = 'Failed to fetch requests.'

INVALID_REQUEST_DATA_ERROR = 'Invalid request data.'
INVALID_CONTACT_USER_ID_ERROR = 'Invalid contact_user_id.'
SELF_REQUEST_ERROR = 'Cannot send a request to yourself.'
SEND_REQUEST_FAILED_ERROR = 'Failed to send request.'
BLOCKED_REQUEST_ERROR = 'Cannot send request: user is blocked.'
AUTO_DECLINE_REQUEST_ERROR = 'User automatically declines requests.'
SEND_REQUEST_COOLDOWN_ERROR = 'Too many repeated requests to this user. Please wait a bit before trying again.'
REQUEST_SENT_MESSAGE = 'Chat request sent.'
CONTACTS_FETCH_FAILED_ERROR = 'Failed to load contacts.'
DEFAULT_PRIVATE_CHAT_NAME = 'Private chat'
ACCEPT_REQUEST_BLOCKED_ERROR = 'Cannot accept request: user is blocked.'
GET_CONTACTS_DEFAULT_LIMIT = None
GET_CONTACTS_MAX_LIMIT = 200

_emit_socket_event = build_route_socket_emitter(
    raw_emit_func=socketio.emit,
    get_db_connection_func=get_db_connection,
    logger=logger,
)


def _shared_chat_id(conn, a_user_id: int, b_user_id: int):
    return _shared_chat_id_impl(conn, a_user_id, b_user_id)


def _resolve_viewer_context(conn):
    return _resolve_viewer_context_impl(conn, session)


def _ensure_pinned_chats_table(conn):
    _ensure_pinned_chats_table_impl(conn)


def fetch_contacts_for_user(
    user_id: int,
    conn,
    *,
    limit: int | None = None,
    language: str = 'ru',
    include_self_contact: bool = True,
):
    contacts = _fetch_contacts_for_user_impl(
        user_id,
        conn,
        limit=limit,
        language=language,
        normalize_language_func=normalize_language,
        ensure_pinned_chats_table_func=_ensure_pinned_chats_table,
        format_sidebar_time_func=_format_sidebar_time,
        build_initial_last_message_preview_func=_build_initial_last_message_preview,
        get_safe_avatar_url_func=get_safe_avatar_url,
        is_effectively_online_func=is_effectively_online,
        include_self_contact=include_self_contact,
    )
    return contacts


def _emit_block_state_events(conn, a_user_id: int, b_user_id: int):
    _emit_block_state_events_impl(
        conn,
        a_user_id=a_user_id,
        b_user_id=b_user_id,
        shared_chat_id_func=_shared_chat_id,
        normalize_block_state_func=normalize_block_state,
        build_block_state_func=build_block_state,
        emit_func=_emit_socket_event,
    )
