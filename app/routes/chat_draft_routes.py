from flask import jsonify, request, session

from app.services.chat_members import is_chat_member


def _auth_user_id_or_error():
    if 'user_id' not in session:
        return None, (jsonify({'success': False, 'error': 'Authorization required.'}), 401)
    return session['user_id'], None


def _validate_chat_id_or_error(chat_id: str, *, is_valid_chat_id_func):
    if not chat_id:
        return jsonify({'success': False, 'error': 'chat_id is required.'}), 400
    if not is_valid_chat_id_func(chat_id):
        return jsonify({'success': False, 'error': 'Invalid chat ID.'}), 400
    return None


def _validate_draft_text_or_error(raw_draft):
    normalized_raw = '' if raw_draft is None else raw_draft
    if not isinstance(normalized_raw, str):
        return None, None, (jsonify({'success': False, 'error': 'draft_text must be a string.'}), 400)
    if len(normalized_raw) > 64000:
        return None, None, (jsonify({'success': False, 'error': 'Draft is too long.'}), 400)
    draft_text = normalized_raw.replace('\r\n', '\n')
    has_draft = bool(draft_text.strip())
    return draft_text, has_draft, None


def _has_chat_access(conn, *, user_id: int, chat_id: str) -> bool:
    return is_chat_member(conn, int(user_id), str(chat_id))


def _load_chat_draft(conn, *, user_id: int, chat_id: str) -> tuple[str, str, bool]:
    row = conn.execute(
        '''
        SELECT draft_text, updated_at
        FROM chat_drafts
        WHERE user_id = ? AND chat_id = ?
        ''',
        (user_id, chat_id),
    ).fetchone()
    draft_text = str(row['draft_text'] or '') if row else ''
    updated_at = str(row['updated_at'] or '').strip() if row else ''
    has_draft = bool(draft_text.strip())
    return draft_text, updated_at, has_draft


def _persist_chat_draft(  # noqa: PLR0913 - explicit draft persistence contract
    conn,
    *,
    user_id: int,
    chat_id: str,
    draft_text: str,
    has_draft: bool,
    ensure_chat_exists_func,
) -> str:
    if has_draft:
        ensure_chat_exists_func(conn, chat_id)
        conn.execute(
            '''
            INSERT INTO chat_drafts (user_id, chat_id, draft_text, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, chat_id) DO UPDATE SET
                draft_text = EXCLUDED.draft_text,
                updated_at = CURRENT_TIMESTAMP
            ''',
            (user_id, chat_id, draft_text),
        )
        row = conn.execute(
            '''
            SELECT updated_at
            FROM chat_drafts
            WHERE user_id = ? AND chat_id = ?
            ''',
            (user_id, chat_id),
        ).fetchone()
        return str(row['updated_at'] or '').strip() if row else ''

    conn.execute(
        '''
        DELETE FROM chat_drafts
        WHERE user_id = ? AND chat_id = ?
        ''',
        (user_id, chat_id),
    )
    marker_row = conn.execute('SELECT CURRENT_TIMESTAMP AS now_ts').fetchone()
    return str(marker_row['now_ts'] or '').strip() if marker_row else ''


def _draft_payload(*, chat_id: str, draft_text: str, updated_at: str, has_draft: bool) -> dict:
    return {
        'chat_id': chat_id,
        'draft_text': draft_text if has_draft else '',
        'updated_at': updated_at,
        'has_draft': has_draft,
    }


def _emit_draft_updated(*, socketio_emit_func, payload: dict) -> None:
    user_public_key = str(session.get('public_key_pem') or '').strip()
    if user_public_key and callable(socketio_emit_func):
        socketio_emit_func(
            'chat_draft_updated',
            payload,
            room=user_public_key,
        )


def _handle_get_chat_draft(
    *,
    get_db_connection_func,
    is_valid_chat_id_func,
):
    user_id, auth_error = _auth_user_id_or_error()
    if auth_error:
        return auth_error

    chat_id = str(request.args.get('chat_id', '') or '').strip()
    chat_id_error = _validate_chat_id_or_error(chat_id, is_valid_chat_id_func=is_valid_chat_id_func)
    if chat_id_error:
        return chat_id_error

    conn = get_db_connection_func()
    try:
        if not _has_chat_access(conn, user_id=int(user_id), chat_id=chat_id):
            return jsonify({'success': False, 'error': 'Chat not found.'}), 403
        draft_text, updated_at, has_draft = _load_chat_draft(conn, user_id=int(user_id), chat_id=chat_id)
        return jsonify(
            {
                'success': True,
                'chat_id': chat_id,
                'draft_text': draft_text,
                'updated_at': updated_at,
                'has_draft': has_draft,
            }
        ), 200
    finally:
        conn.close()


def _handle_save_chat_draft(
    *,
    get_db_connection_func,
    is_valid_chat_id_func,
    ensure_chat_exists_func,
    socketio_emit_func=None,
):
    user_id, auth_error = _auth_user_id_or_error()
    if auth_error:
        return auth_error

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({'success': False, 'error': 'Invalid payload.'}), 400

    chat_id = str(data.get('chat_id', '') or '').strip()
    chat_id_error = _validate_chat_id_or_error(chat_id, is_valid_chat_id_func=is_valid_chat_id_func)
    if chat_id_error:
        return chat_id_error

    draft_text, has_draft, draft_error = _validate_draft_text_or_error(data.get('draft_text', ''))
    if draft_error:
        return draft_error

    conn = get_db_connection_func()
    try:
        if not _has_chat_access(conn, user_id=int(user_id), chat_id=chat_id):
            return jsonify({'success': False, 'error': 'Chat not found.'}), 403
        updated_at = _persist_chat_draft(
            conn,
            user_id=int(user_id),
            chat_id=chat_id,
            draft_text=draft_text,
            has_draft=bool(has_draft),
            ensure_chat_exists_func=ensure_chat_exists_func,
        )
        conn.commit()
    finally:
        conn.close()

    payload = _draft_payload(
        chat_id=chat_id,
        draft_text=str(draft_text or ''),
        updated_at=updated_at,
        has_draft=bool(has_draft),
    )
    _emit_draft_updated(socketio_emit_func=socketio_emit_func, payload=payload)
    return jsonify({'success': True, **payload}), 200


def register_chat_draft_routes(  # noqa: PLR0913 - dependency-injected route registration contract
    chat_bp,
    *,
    limiter,
    get_db_connection_func,
    is_valid_chat_id_func,
    ensure_chat_exists_func,
    socketio_emit_func=None,
):
    @chat_bp.route('/get_chat_draft', methods=['GET'])
    @limiter.limit("240 per minute")
    def get_chat_draft():
        return _handle_get_chat_draft(
            get_db_connection_func=get_db_connection_func,
            is_valid_chat_id_func=is_valid_chat_id_func,
        )

    @chat_bp.route('/save_chat_draft', methods=['POST'])
    @limiter.limit("360 per minute")
    def save_chat_draft():
        return _handle_save_chat_draft(
            get_db_connection_func=get_db_connection_func,
            is_valid_chat_id_func=is_valid_chat_id_func,
            ensure_chat_exists_func=ensure_chat_exists_func,
            socketio_emit_func=socketio_emit_func,
        )
