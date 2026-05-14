import logging
import os

from flask import Blueprint, request, session

from app.database import ensure_chat_exists, get_db_connection
from app.extensions import limiter, socketio
from app.services.av_scan import scan_file
from app.services.blocking import (
    block_forbidden_response,
    build_block_state,
    get_chat_partner,
    list_visible_contact_public_keys,
)
from app.services.chat_page_state import (
    build_socketio_client_config,
    fetch_chat_page_context,
    normalize_initial_chat_contact_username,
)
from app.services.crypto import is_valid_chat_id
from app.services.locale import language_from_user_row
from app.services.presence import is_effectively_online
from app.services.session_state import clear_invalid_session_user as _clear_invalid_session_user_impl
from app.services.user import get_safe_avatar_url
from app.services.web_push import web_push_bootstrap_payload
from app.routes.chat_history_routes import register_chat_history_routes
from app.routes.chat_draft_routes import register_chat_draft_routes
from app.routes.chat_group_routes import register_chat_group_routes
from app.routes.chat_link_preview_routes import register_chat_link_preview_routes
from app.routes.chat_media_routes import register_chat_media_routes
from app.routes.chat_media_utils import (
    allowed_file,
    canonical_username,
    detect_chat_media_type,
    normalize_chat_media_mime,
    serialize_block_state,
    validate_chat_media_content,
    validate_magic,
)
from app.routes.chat_page_routes import register_chat_page_routes
from app.routes.chat_presence_route_handlers import process_get_online_status as _process_get_online_status
from app.routes.chat_profile_routes import register_chat_profile_routes
from app.routes.chat_profile_utils import fetch_conversation_stats
from app.routes.chat_user_profile_route_handlers import process_get_user_profile as _process_get_user_profile
from app.routes.chat_group_invite_link_routes import register_chat_group_invite_link_routes
from app.routes.contacts import fetch_contacts_for_user
from app.routes.socket_emit import build_route_socket_emitter

logger = logging.getLogger(__name__)
chat_bp = Blueprint('chat', __name__)
INITIAL_CONTACTS_SSR_LIMIT = 18

_BASE_DIR = os.path.join(os.path.dirname(__file__), '..', '..')
PROJECT_ROOT = os.path.abspath(_BASE_DIR)
UPLOAD_FOLDER = os.path.join(PROJECT_ROOT, 'static', 'avatars')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'gif'}
MAX_AVATAR_SIZE = 4 * 1024 * 1024  # 4 MB
CHAT_MEDIA_FOLDER = os.path.join(PROJECT_ROOT, 'storage', 'chat_media')
MAX_CHAT_MEDIA_SIZE = 100 * 1024 * 1024  # 100 MB
ALLOWED_CHAT_MEDIA_EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif',
    'mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'mpeg', 'mpg', '3gp',
    'ogg', 'wav', 'mp3', 'm4a', 'aac', 'opus',
    'pdf', 'doc', 'docx', 'txt', 'zip', 'rar', '7z', 'csv', 'xlsx',
}

_MAGIC_BYTES = {
    'png': [(0, b'\x89PNG\r\n\x1a\n')],
    'jpg': [(0, b'\xff\xd8\xff')],
    'jpeg': [(0, b'\xff\xd8\xff')],
    'gif': [(0, b'GIF87a'), (0, b'GIF89a')],
    'webp': [(0, b'RIFF'), (8, b'WEBP')],
}
_CHAT_MEDIA_MAGIC_RULES = {
    'png': [[(0, b'\x89PNG\r\n\x1a\n')]],
    'jpg': [[(0, b'\xff\xd8\xff')]],
    'jpeg': [[(0, b'\xff\xd8\xff')]],
    'gif': [[(0, b'GIF87a')], [(0, b'GIF89a')]],
    'webp': [[(0, b'RIFF'), (8, b'WEBP')]],
    'bmp': [[(0, b'BM')]],
    'heic': [[(4, b'ftypheic')], [(4, b'ftypheix')], [(4, b'ftyphevc')], [(4, b'ftyphevx')], [(4, b'ftypmif1')], [(4, b'ftypmsf1')]],
    'heif': [[(4, b'ftypheif')], [(4, b'ftypheim')], [(4, b'ftypmif1')], [(4, b'ftypmsf1')]],
    'avif': [[(4, b'ftypavif')], [(4, b'ftypavis')]],
    'mp4': [[(4, b'ftyp')]],
    'm4v': [[(4, b'ftyp')]],
    'mov': [[(4, b'ftyp')]],
    '3gp': [[(4, b'ftyp3g')], [(4, b'ftyp')]],
    'webm': [[(0, b'\x1a\x45\xdf\xa3')]],
    'mkv': [[(0, b'\x1a\x45\xdf\xa3')]],
    'avi': [[(0, b'RIFF'), (8, b'AVI ')]],
    'mpeg': [[(0, b'\x00\x00\x01\xba')], [(0, b'\x00\x00\x01\xb3')]],
    'mpg': [[(0, b'\x00\x00\x01\xba')], [(0, b'\x00\x00\x01\xb3')]],
    'ogg': [[(0, b'OggS')]],
    'wav': [[(0, b'RIFF'), (8, b'WAVE')]],
    'mp3': [[(0, b'ID3')], [(0, b'\xff\xfb')], [(0, b'\xff\xfa')], [(0, b'\xff\xf3')], [(0, b'\xff\xf2')], [(0, b'\xff\xe3')], [(0, b'\xff\xe2')]],
    'm4a': [[(4, b'ftypM4A')], [(4, b'ftyp')]],
    'aac': [[(0, b'\xff\xf1')], [(0, b'\xff\xf9')]],
    'opus': [[(0, b'OggS')]],
    'pdf': [[(0, b'%PDF-')]],
    'doc': [[(0, b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')]],
    'zip': [[(0, b'PK\x03\x04')], [(0, b'PK\x05\x06')], [(0, b'PK\x07\x08')]],
    'rar': [[(0, b'Rar!\x1a\x07\x00')], [(0, b'Rar!\x1a\x07\x01\x00')]],
    '7z': [[(0, b"7z\xbc\xaf'\x1c")]],
    'docx': [[(0, b'PK\x03\x04')], [(0, b'PK\x05\x06')], [(0, b'PK\x07\x08')]],
    'xlsx': [[(0, b'PK\x03\x04')], [(0, b'PK\x05\x06')], [(0, b'PK\x07\x08')]],
}
_DANGEROUS_INLINE_MIME_PREFIXES = (
    'image/svg+xml',
    'text/html',
    'application/xhtml+xml',
    'application/javascript',
    'text/javascript',
    'application/xml',
    'text/xml',
)

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(CHAT_MEDIA_FOLDER, exist_ok=True)


def _allowed_file(filename):
    return allowed_file(filename, allowed_extensions=ALLOWED_EXTENSIONS)


def _validate_magic(file_obj, ext):
    return validate_magic(file_obj, ext, magic_bytes_map=_MAGIC_BYTES)


def _validate_chat_media_content(uploaded, ext: str) -> bool:
    return validate_chat_media_content(
        uploaded,
        ext,
        chat_media_magic_rules=_CHAT_MEDIA_MAGIC_RULES,
    )


def _detect_chat_media_type(mime_type: str) -> str:
    return detect_chat_media_type(mime_type)


def _normalize_chat_media_mime(uploaded_mime: str | None, filename: str, ext: str) -> str:
    return normalize_chat_media_mime(uploaded_mime, filename, ext)


def _chat_media_rate_limit_key() -> str:
    user_id = session.get('user_id')
    if user_id is not None:
        return f'user:{user_id}'
    remote_addr = str(request.remote_addr or '').strip()
    if remote_addr:
        return f'ip:{remote_addr}'
    return 'ip:unknown'


def _serialize_block_state(state):
    return serialize_block_state(state)


def _canonical_username(value) -> str:
    return canonical_username(value)


def _fetch_conversation_stats(conn, user_id: int, other_user_id: int):
    return fetch_conversation_stats(conn, user_id, other_user_id)


_socket_emit_with_envelope = build_route_socket_emitter(
    raw_emit_func=socketio.emit,
    get_db_connection_func=get_db_connection,
    logger=logger,
)


register_chat_page_routes(
    chat_bp,
    logger=logger,
    get_db_connection_func=get_db_connection,
    clear_invalid_session_user_func=_clear_invalid_session_user_impl,
    fetch_chat_page_context_func=fetch_chat_page_context,
    fetch_contacts_for_user_func=fetch_contacts_for_user,
    language_from_user_row_func=language_from_user_row,
    build_socketio_client_config_func=build_socketio_client_config,
    web_push_bootstrap_payload_func=web_push_bootstrap_payload,
    normalize_initial_chat_contact_username_func=normalize_initial_chat_contact_username,
    canonical_username_func=_canonical_username,
    initial_contacts_ssr_limit=INITIAL_CONTACTS_SSR_LIMIT,
)

register_chat_history_routes(
    chat_bp,
    logger=logger,
    limiter=limiter,
    socketio_emit_func=_socket_emit_with_envelope,
    get_db_connection_func=get_db_connection,
    is_valid_chat_id_func=is_valid_chat_id,
    get_chat_partner_func=get_chat_partner,
    build_block_state_func=build_block_state,
    serialize_block_state_func=_serialize_block_state,
    block_forbidden_response_func=block_forbidden_response,
)

register_chat_draft_routes(
    chat_bp,
    limiter=limiter,
    get_db_connection_func=get_db_connection,
    is_valid_chat_id_func=is_valid_chat_id,
    ensure_chat_exists_func=ensure_chat_exists,
    socketio_emit_func=_socket_emit_with_envelope,
)

register_chat_link_preview_routes(
    chat_bp,
    limiter=limiter,
)

register_chat_group_routes(
    chat_bp,
    limiter=limiter,
    get_db_connection_func=get_db_connection,
    socketio_emit_func=_socket_emit_with_envelope,
    is_effectively_online_func=is_effectively_online,
    get_safe_avatar_url_func=get_safe_avatar_url,
    allowed_avatar_file_func=_allowed_file,
    validate_avatar_magic_func=_validate_magic,
    get_upload_folder_func=lambda: UPLOAD_FOLDER,
    get_project_root_func=lambda: PROJECT_ROOT,
    get_max_avatar_size_func=lambda: MAX_AVATAR_SIZE,
)

register_chat_media_routes(
    chat_bp,
    logger=logger,
    limiter=limiter,
    socketio_emit_func=_socket_emit_with_envelope,
    get_db_connection_func=get_db_connection,
    is_valid_chat_id_func=is_valid_chat_id,
    ensure_chat_exists_func=ensure_chat_exists,
    scan_file_func=lambda *args, **kwargs: scan_file(*args, **kwargs),
    get_chat_partner_func=get_chat_partner,
    build_block_state_func=build_block_state,
    serialize_block_state_func=_serialize_block_state,
    block_forbidden_response_func=block_forbidden_response,
    list_visible_contact_public_keys_func=list_visible_contact_public_keys,
    allowed_avatar_file_func=_allowed_file,
    validate_avatar_magic_func=_validate_magic,
    validate_chat_media_content_func=_validate_chat_media_content,
    normalize_chat_media_mime_func=_normalize_chat_media_mime,
    detect_chat_media_type_func=_detect_chat_media_type,
    get_safe_avatar_url_func=get_safe_avatar_url,
    chat_media_rate_limit_key_func=_chat_media_rate_limit_key,
    get_upload_folder_func=lambda: UPLOAD_FOLDER,
    get_chat_media_folder_func=lambda: CHAT_MEDIA_FOLDER,
    get_allowed_chat_media_extensions_func=lambda: ALLOWED_CHAT_MEDIA_EXTENSIONS,
    get_max_avatar_size_func=lambda: MAX_AVATAR_SIZE,
    get_max_chat_media_size_func=lambda: MAX_CHAT_MEDIA_SIZE,
    get_dangerous_inline_mime_prefixes_func=lambda: _DANGEROUS_INLINE_MIME_PREFIXES,
    get_project_root_func=lambda: PROJECT_ROOT,
)

register_chat_profile_routes(
    chat_bp,
    limiter=limiter,
    get_db_connection_func=get_db_connection,
    process_get_online_status_func=_process_get_online_status,
    process_get_user_profile_func=_process_get_user_profile,
    build_block_state_func=build_block_state,
    serialize_block_state_func=_serialize_block_state,
    block_forbidden_response_func=block_forbidden_response,
    is_effectively_online_func=is_effectively_online,
    get_safe_avatar_url_func=get_safe_avatar_url,
    fetch_conversation_stats_func=_fetch_conversation_stats,
)
