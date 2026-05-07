from flask import current_app, flash, redirect, render_template, session, url_for


def register_chat_page_routes(
    chat_bp,
    *,
    logger,
    get_db_connection_func,
    clear_invalid_session_user_func,
    fetch_chat_page_context_func,
    fetch_contacts_for_user_func,
    language_from_user_row_func,
    build_socketio_client_config_func,
    web_push_bootstrap_payload_func,
    normalize_initial_chat_contact_username_func,
    canonical_username_func,
    initial_contacts_ssr_limit: int,
):
    def _render_chat_page(*, initial_chat_contact_username: str = ''):
        normalized_initial_chat_contact_username = normalize_initial_chat_contact_username_func(
            initial_chat_contact_username,
            canonical_username=canonical_username_func,
        )
        if 'user_id' not in session or 'public_key_pem' not in session:
            clear_invalid_session_user_func(session)
            flash('Sign in to continue.', 'danger')
            return redirect(url_for('auth.index'))

        user_id = session['user_id']
        conn = get_db_connection_func()
        try:
            page_context = fetch_chat_page_context_func(
                conn=conn,
                user_id=user_id,
                fetch_contacts_for_user=fetch_contacts_for_user_func,
                language_from_user_row=language_from_user_row_func,
                initial_contacts_limit=initial_contacts_ssr_limit,
            )
        finally:
            conn.close()

        if not page_context:
            logger.info('Clearing stale session for missing user_id=%s on chat', user_id)
            clear_invalid_session_user_func(session)
            flash('User not found.', 'danger')
            return redirect(url_for('auth.index'))

        session['ui_language'] = page_context['ui_language']

        return render_template(
            'chat.html',
            **page_context,
            initial_chat_contact_username=normalized_initial_chat_contact_username,
            socketio_client_config=build_socketio_client_config_func(current_app.config),
            web_push_bootstrap_payload=web_push_bootstrap_payload_func(current_app.config),
        )

    @chat_bp.route('/chat')
    def chat_index():
        return _render_chat_page()

    @chat_bp.route('/chat/<contact_username>')
    def chat_index_by_contact_username(contact_username):
        requested_contact_username = normalize_initial_chat_contact_username_func(
            contact_username,
            canonical_username=canonical_username_func,
        )
        if not requested_contact_username:
            return redirect(url_for('chat.chat_index'))
        return _render_chat_page(initial_chat_contact_username=requested_contact_username)

    @chat_bp.route('/<username>/chat')
    def chat_index_by_username(username):
        requested_username = normalize_initial_chat_contact_username_func(
            username,
            canonical_username=canonical_username_func,
        )
        if not requested_username:
            return redirect(url_for('chat.chat_index'))

        if 'user_id' not in session or 'public_key_pem' not in session:
            clear_invalid_session_user_func(session)
            flash('Необходимо войти в систему.', 'danger')
            return redirect(url_for('auth.index'))

        conn = get_db_connection_func()
        try:
            user_row = conn.execute(
                'SELECT username FROM users WHERE id = ?',
                (session['user_id'],),
            ).fetchone()
        finally:
            conn.close()

        if not user_row:
            clear_invalid_session_user_func(session)
            flash('Пользователь не найден.', 'danger')
            return redirect(url_for('auth.index'))

        session_username = canonical_username_func(user_row['username'])
        if requested_username != session_username:
            return redirect(url_for('chat.chat_index_by_username', username=session_username))

        return _render_chat_page()
