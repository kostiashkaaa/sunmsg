import logging

from flask import jsonify, redirect, render_template, request, session, url_for

from app.database import ensure_chat_exists, get_db_connection
from app.extensions import limiter
from app.routes.contacts_data_utils import ensure_pinned_chats_table
from app.routes.contacts_overview_route_handlers import process_get_contacts
from app.routes.contacts_utils import like_pattern, parse_int
from app.routes.pinned_chat_handlers import (
    pin_chat_for_user,
    reorder_pinned_chats_for_user,
    unpin_chat_for_user,
)
from app.routes.pinned_chat_route_handlers import (
    process_pin_chat,
    process_reorder_pinned_chats,
    process_unpin_chat,
)
from app.routes.search_page_route_handlers import process_search_page
from app.routes.search_users_route_handlers import process_search_users
from app.routes.user_search_handlers import (
    build_search_users_payload,
    fetch_public_search_results,
)
from app.services.locale import normalize_language
from app.services.user import get_safe_avatar_url

from .context import (
    AUTH_REQUIRED_ERROR,
    CHAT_NOT_FOUND_ERROR,
    CONTACTS_FETCH_FAILED_ERROR,
    EMPTY_CHAT_ID_ERROR,
    GET_CONTACTS_DEFAULT_LIMIT,
    GET_CONTACTS_MAX_LIMIT,
    INVALID_CHAT_IDS_ERROR,
    PIN_OPERATION_FAILED_ERROR,
    SEARCH_USERS_DEFAULT_LIMIT,
    SEARCH_USERS_MAX_LIMIT,
    SEARCH_USERS_MAX_OFFSET,
    SEARCH_USERS_MIN_QUERY_LEN,
    contacts_bp,
    fetch_contacts_for_user,
)

logger = logging.getLogger(__name__)


@contacts_bp.route('/get_contacts', methods=['GET'])
@limiter.limit("60 per minute")
def get_contacts():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': AUTH_REQUIRED_ERROR}), 401

    user_id = session['user_id']
    limit = parse_int(request.args.get('limit'))
    if limit is not None:
        limit = max(1, min(limit, GET_CONTACTS_MAX_LIMIT))
    else:
        limit = GET_CONTACTS_DEFAULT_LIMIT

    conn = get_db_connection()
    try:
        result = process_get_contacts(
            conn,
            user_id=user_id,
            ui_language=session.get('ui_language'),
            limit=limit,
            fetch_contacts_for_user_func=fetch_contacts_for_user,
            normalize_language_func=normalize_language,
            logger_error_func=logger.error,
        )
        if result['status'] == 'ok':
            conn.commit()
    finally:
        conn.close()

    if result['status'] == 'error':
        return jsonify({'success': False, 'error': CONTACTS_FETCH_FAILED_ERROR}), 500

    return jsonify({'success': True, 'contacts': result['contacts']}), 200


@contacts_bp.route('/pin_chat', methods=['POST'])
@limiter.limit("30 per minute")
def pin_chat():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': AUTH_REQUIRED_ERROR}), 401

    user_id = session['user_id']
    data = request.get_json(silent=True) or {}
    chat_id = str(data.get('chat_id', '')).strip()
    if not chat_id:
        return jsonify({'success': False, 'error': EMPTY_CHAT_ID_ERROR}), 400

    conn = get_db_connection()
    result = process_pin_chat(
        conn,
        user_id=user_id,
        chat_id=chat_id,
        pin_chat_for_user_func=pin_chat_for_user,
        ensure_pinned_chats_table_func=ensure_pinned_chats_table,
        ensure_chat_exists_func=ensure_chat_exists,
        logger_error_func=logger.error,
    )
    conn.close()

    if result['status'] == 'chat_not_found':
        return jsonify({'success': False, 'error': CHAT_NOT_FOUND_ERROR}), 404
    if result['status'] == 'error':
        return jsonify({'success': False, 'error': PIN_OPERATION_FAILED_ERROR}), 500

    return jsonify({'success': True, 'pin_order': result['pin_order']}), 200


@contacts_bp.route('/unpin_chat', methods=['POST'])
@limiter.limit("30 per minute")
def unpin_chat():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': AUTH_REQUIRED_ERROR}), 401

    user_id = session['user_id']
    data = request.get_json(silent=True) or {}
    chat_id = str(data.get('chat_id', '')).strip()
    if not chat_id:
        return jsonify({'success': False, 'error': EMPTY_CHAT_ID_ERROR}), 400

    conn = get_db_connection()
    result = process_unpin_chat(
        conn,
        user_id=user_id,
        chat_id=chat_id,
        unpin_chat_for_user_func=unpin_chat_for_user,
        ensure_pinned_chats_table_func=ensure_pinned_chats_table,
        logger_error_func=logger.error,
    )
    conn.close()

    if result['status'] == 'error':
        return jsonify({'success': False, 'error': PIN_OPERATION_FAILED_ERROR}), 500

    return jsonify({'success': True}), 200


@contacts_bp.route('/reorder_pinned_chats', methods=['POST'])
@limiter.limit("30 per minute")
def reorder_pinned_chats():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': AUTH_REQUIRED_ERROR}), 401

    user_id = session['user_id']
    data = request.get_json(silent=True) or {}
    ordered_ids = data.get('chat_ids', [])
    if not isinstance(ordered_ids, list):
        return jsonify({'success': False, 'error': INVALID_CHAT_IDS_ERROR}), 400

    conn = get_db_connection()
    result = process_reorder_pinned_chats(
        conn,
        user_id=user_id,
        ordered_ids=ordered_ids,
        reorder_pinned_chats_for_user_func=reorder_pinned_chats_for_user,
        ensure_pinned_chats_table_func=ensure_pinned_chats_table,
        logger_error_func=logger.error,
    )
    conn.close()

    if result['status'] == 'error':
        return jsonify({'success': False, 'error': PIN_OPERATION_FAILED_ERROR}), 500

    return jsonify({'success': True, 'chat_ids': result['chat_ids']}), 200


@contacts_bp.route('/search', methods=['GET'])
@limiter.limit("30 per minute")
def search():
    if 'user_id' not in session:
        return redirect(url_for('auth.index'))

    user_id = session['user_id']
    conn = get_db_connection()
    result = process_search_page(
        conn,
        user_id=user_id,
        raw_query=request.args.get('q', ''),
        fetch_public_search_results_func=fetch_public_search_results,
    )
    conn.close()
    return render_template('search.html', results=result['results'], query=result['query'])


@contacts_bp.route('/search_users', methods=['GET'])
@limiter.limit("60 per minute")
def search_users():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': AUTH_REQUIRED_ERROR}), 401

    user_id = session['user_id']
    conn = get_db_connection()
    try:
        payload = process_search_users(
            conn,
            user_id=user_id,
            raw_query=request.args.get('q', ''),
            raw_limit=request.args.get('limit'),
            raw_offset=request.args.get('offset'),
            parse_int_func=parse_int,
            build_search_users_payload_func=build_search_users_payload,
            min_query_length=SEARCH_USERS_MIN_QUERY_LEN,
            default_limit=SEARCH_USERS_DEFAULT_LIMIT,
            max_limit=SEARCH_USERS_MAX_LIMIT,
            max_offset=SEARCH_USERS_MAX_OFFSET,
            like_pattern_func=like_pattern,
            get_safe_avatar_url_func=get_safe_avatar_url,
        )
        return jsonify(payload)
    finally:
        conn.close()
