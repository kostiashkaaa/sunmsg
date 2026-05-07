from flask import jsonify, request, session

from app.services.chat_members import is_chat_member


def register_chat_draft_routes(
    chat_bp,
    *,
    limiter,
    get_db_connection_func,
    is_valid_chat_id_func,
    ensure_chat_exists_func,
    socketio_emit_func=None,
):
    def _has_chat_access(conn, user_id: int, chat_id: str) -> bool:
        return is_chat_member(conn, int(user_id), str(chat_id))

    @chat_bp.route('/get_chat_draft', methods=['GET'])
    @limiter.limit("240 per minute")
    def get_chat_draft():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401

        user_id = session['user_id']
        chat_id = str(request.args.get('chat_id', '') or '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'chat_id is required.'}), 400
        if not is_valid_chat_id_func(chat_id):
            return jsonify({'success': False, 'error': 'Invalid chat ID.'}), 400

        conn = get_db_connection_func()
        try:
            if not _has_chat_access(conn, user_id, chat_id):
                return jsonify({'success': False, 'error': 'Chat not found.'}), 403

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

    @chat_bp.route('/save_chat_draft', methods=['POST'])
    @limiter.limit("360 per minute")
    def save_chat_draft():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'Invalid payload.'}), 400

        user_id = session['user_id']
        chat_id = str(data.get('chat_id', '') or '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'chat_id is required.'}), 400
        if not is_valid_chat_id_func(chat_id):
            return jsonify({'success': False, 'error': 'Invalid chat ID.'}), 400

        raw_draft = data.get('draft_text', '')
        if raw_draft is None:
            raw_draft = ''
        if not isinstance(raw_draft, str):
            return jsonify({'success': False, 'error': 'draft_text must be a string.'}), 400
        if len(raw_draft) > 64000:
            return jsonify({'success': False, 'error': 'Draft is too long.'}), 400

        draft_text = raw_draft.replace('\r\n', '\n')
        has_draft = bool(draft_text.strip())

        conn = get_db_connection_func()
        try:
            if not _has_chat_access(conn, user_id, chat_id):
                return jsonify({'success': False, 'error': 'Chat not found.'}), 403

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
                updated_at = str(row['updated_at'] or '').strip() if row else ''
            else:
                conn.execute(
                    '''
                    DELETE FROM chat_drafts
                    WHERE user_id = ? AND chat_id = ?
                    ''',
                    (user_id, chat_id),
                )
                marker_row = conn.execute('SELECT CURRENT_TIMESTAMP AS now_ts').fetchone()
                updated_at = str(marker_row['now_ts'] or '').strip() if marker_row else ''

            conn.commit()
            user_public_key = str(session.get('public_key_pem') or '').strip()
            if user_public_key and callable(socketio_emit_func):
                socketio_emit_func(
                    'chat_draft_updated',
                    {
                        'chat_id': chat_id,
                        'draft_text': draft_text if has_draft else '',
                        'updated_at': updated_at,
                        'has_draft': has_draft,
                    },
                    room=user_public_key,
                )
            return jsonify(
                {
                    'success': True,
                    'chat_id': chat_id,
                    'draft_text': draft_text if has_draft else '',
                    'updated_at': updated_at,
                    'has_draft': has_draft,
                }
            ), 200
        finally:
            conn.close()
