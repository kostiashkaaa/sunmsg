from flask import current_app, flash, redirect, render_template, session, url_for


def _normalize_requested_username(
    raw_username: str,
    *,
    normalize_initial_chat_contact_username_func,
    canonical_username_func,
) -> str:
    return normalize_initial_chat_contact_username_func(
        raw_username,
        canonical_username=canonical_username_func,
    )


def _require_authenticated_session(*, clear_invalid_session_user_func, sign_in_message: str):
    if 'user_id' in session and 'public_key_pem' in session:
        return None
    clear_invalid_session_user_func(session)
    flash(sign_in_message, 'danger')
    return redirect(url_for('auth.index'))


def _fetch_chat_page_context_for_session_user(  # noqa: PLR0913
    *,
    get_db_connection_func,
    user_id: int,
    fetch_chat_page_context_func,
    fetch_contacts_for_user_func,
    language_from_user_row_func,
    initial_contacts_ssr_limit: int,
):
    conn = get_db_connection_func()
    try:
        return fetch_chat_page_context_func(
            conn=conn,
            user_id=user_id,
            fetch_contacts_for_user=fetch_contacts_for_user_func,
            language_from_user_row=language_from_user_row_func,
            initial_contacts_limit=initial_contacts_ssr_limit,
        )
    finally:
        conn.close()


def _fetch_session_username(*, get_db_connection_func, user_id: int):
    conn = get_db_connection_func()
    try:
        user_row = conn.execute(
            'SELECT username FROM users WHERE id = ?',
            (user_id,),
        ).fetchone()
    finally:
        conn.close()
    return user_row['username'] if user_row else None


def _render_chat_page(  # noqa: PLR0913
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
    initial_chat_contact_username: str = '',
):
    normalized_initial_chat_contact_username = _normalize_requested_username(
        initial_chat_contact_username,
        normalize_initial_chat_contact_username_func=normalize_initial_chat_contact_username_func,
        canonical_username_func=canonical_username_func,
    )

    auth_response = _require_authenticated_session(
        clear_invalid_session_user_func=clear_invalid_session_user_func,
        sign_in_message='Sign in to continue.',
    )
    if auth_response is not None:
        return auth_response

    user_id = session['user_id']
    page_context = _fetch_chat_page_context_for_session_user(
        get_db_connection_func=get_db_connection_func,
        user_id=user_id,
        fetch_chat_page_context_func=fetch_chat_page_context_func,
        fetch_contacts_for_user_func=fetch_contacts_for_user_func,
        language_from_user_row_func=language_from_user_row_func,
        initial_contacts_ssr_limit=initial_contacts_ssr_limit,
    )
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


def register_chat_page_routes(  # noqa: PLR0913
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
    @chat_bp.route('/chat')
    def chat_index():
        return _render_chat_page(
            logger=logger,
            get_db_connection_func=get_db_connection_func,
            clear_invalid_session_user_func=clear_invalid_session_user_func,
            fetch_chat_page_context_func=fetch_chat_page_context_func,
            fetch_contacts_for_user_func=fetch_contacts_for_user_func,
            language_from_user_row_func=language_from_user_row_func,
            build_socketio_client_config_func=build_socketio_client_config_func,
            web_push_bootstrap_payload_func=web_push_bootstrap_payload_func,
            normalize_initial_chat_contact_username_func=normalize_initial_chat_contact_username_func,
            canonical_username_func=canonical_username_func,
            initial_contacts_ssr_limit=initial_contacts_ssr_limit,
        )

    @chat_bp.route('/chat/<contact_username>')
    def chat_index_by_contact_username(contact_username):
        requested_contact_username = _normalize_requested_username(
            contact_username,
            normalize_initial_chat_contact_username_func=normalize_initial_chat_contact_username_func,
            canonical_username_func=canonical_username_func,
        )
        if not requested_contact_username:
            return redirect(url_for('chat.chat_index'))
        return _render_chat_page(
            logger=logger,
            get_db_connection_func=get_db_connection_func,
            clear_invalid_session_user_func=clear_invalid_session_user_func,
            fetch_chat_page_context_func=fetch_chat_page_context_func,
            fetch_contacts_for_user_func=fetch_contacts_for_user_func,
            language_from_user_row_func=language_from_user_row_func,
            build_socketio_client_config_func=build_socketio_client_config_func,
            web_push_bootstrap_payload_func=web_push_bootstrap_payload_func,
            normalize_initial_chat_contact_username_func=normalize_initial_chat_contact_username_func,
            canonical_username_func=canonical_username_func,
            initial_contacts_ssr_limit=initial_contacts_ssr_limit,
            initial_chat_contact_username=requested_contact_username,
        )

    @chat_bp.route('/<username>/chat')
    def chat_index_by_username(username):
        requested_username = _normalize_requested_username(
            username,
            normalize_initial_chat_contact_username_func=normalize_initial_chat_contact_username_func,
            canonical_username_func=canonical_username_func,
        )
        if not requested_username:
            return redirect(url_for('chat.chat_index'))

        auth_response = _require_authenticated_session(
            clear_invalid_session_user_func=clear_invalid_session_user_func,
            sign_in_message='Необходимо войти в систему.',
        )
        if auth_response is not None:
            return auth_response

        session_username_raw = _fetch_session_username(
            get_db_connection_func=get_db_connection_func,
            user_id=session['user_id'],
        )
        if not session_username_raw:
            clear_invalid_session_user_func(session)
            flash('Пользователь не найден.', 'danger')
            return redirect(url_for('auth.index'))

        session_username = canonical_username_func(session_username_raw)
        if requested_username != session_username:
            return redirect(url_for('chat.chat_index_by_username', username=session_username))

        return _render_chat_page(
            logger=logger,
            get_db_connection_func=get_db_connection_func,
            clear_invalid_session_user_func=clear_invalid_session_user_func,
            fetch_chat_page_context_func=fetch_chat_page_context_func,
            fetch_contacts_for_user_func=fetch_contacts_for_user_func,
            language_from_user_row_func=language_from_user_row_func,
            build_socketio_client_config_func=build_socketio_client_config_func,
            web_push_bootstrap_payload_func=web_push_bootstrap_payload_func,
            normalize_initial_chat_contact_username_func=normalize_initial_chat_contact_username_func,
            canonical_username_func=canonical_username_func,
            initial_contacts_ssr_limit=initial_contacts_ssr_limit,
        )
