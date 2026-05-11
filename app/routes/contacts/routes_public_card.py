from flask import abort, flash, redirect, render_template, request, session, url_for

from app.database import get_db_connection
from app.extensions import limiter, socketio
from app.routes.socket_emit import build_route_socket_emitter
from app.routes.contacts_utils import canonical_username
from app.routes.dialog_request_workflows import send_dialog_request_workflow
from app.routes.public_card_route_handlers import (
    process_public_user_card_route,
    process_start_dialog_from_public_card_route,
)
from app.routes.public_card_start_handlers import (
    process_start_dialog_from_public_card,
    start_dialog_from_public_card_workflow,
)
from app.routes.public_user_card_handlers import (
    process_public_user_card,
    resolve_public_user_card_context,
)
from app.services.blocking import build_block_state, normalize_block_state
from app.services.locale import detect_auth_language, normalize_language
from app.services.user import get_safe_avatar_url

from .context import USERNAME_PATTERN, contacts_bp, _resolve_viewer_context

_emit_socket_event = build_route_socket_emitter(
    raw_emit_func=socketio.emit,
    get_db_connection_func=get_db_connection,
    logger=None,
)


def _resolve_ui_language() -> str:
    return normalize_language(
        session.get('ui_language') or session.get('guest_ui_language'),
        default=detect_auth_language(request),
    )


def _redirect_public_user_card(*, target_username: str):
    return redirect(url_for('contacts.public_user_card', username=target_username))


def _handle_start_dialog_status(*, target_username: str, processed: dict):
    status = processed.get('status')
    if status == 'session_expired':
        session.pop('user_id', None)
        session.pop('public_key_pem', None)
        flash('Session expired. Please sign in again.', 'warning')
        return redirect(url_for('auth.index'))
    if status == 'not_found':
        abort(404)
    if status == 'open_self':
        return redirect(url_for('chat.chat_index'))
    if status == 'blocked':
        flash('Cannot start chat: this user is blocked.', 'danger')
        return _redirect_public_user_card(target_username=target_username)
    if status == 'open_existing':
        return redirect(
            url_for(
                'chat.chat_index_by_contact_username',
                contact_username=target_username,
            )
        )
    if status == 'auto_decline':
        flash('This user automatically declines requests.', 'warning')
        return _redirect_public_user_card(target_username=target_username)
    if status == 'request_sent':
        event = processed.get('event')
        if event:
            _emit_socket_event('new_dialog_request', event['payload'], room=event['room'])
        return None
    return None


@contacts_bp.route('/u/<username>', methods=['GET'])
@limiter.limit("60 per minute")
def public_user_card(username):
    target_username = canonical_username(username)
    if not USERNAME_PATTERN.fullmatch(target_username):
        abort(404)

    conn = get_db_connection()
    ui_language = _resolve_ui_language()
    try:
        result = process_public_user_card_route(
            conn,
            target_username=target_username,
            resolve_viewer_context_func=_resolve_viewer_context,
            process_public_user_card_func=process_public_user_card,
            resolve_public_user_card_context_func=resolve_public_user_card_context,
            normalize_block_state_func=normalize_block_state,
            build_block_state_func=build_block_state,
            get_safe_avatar_url_func=get_safe_avatar_url,
        )
        if result['status'] == 'not_found':
            abort(404)
        if result['status'] == 'private':
            return render_template(
                'user_card.html',
                profile=None,
                stub_username=result['username'],
                stub_reason='private',
                viewer=None,
                ui_language=ui_language,
            ), 200
    finally:
        conn.close()

    return render_template(
        'user_card.html',
        profile=result['profile'],
        viewer=result['viewer'],
        can_message=result['can_message'],
        can_open_chat=result['can_open_chat'],
        can_send_request=result['can_send_request'],
        block_state=result['block_state'],
        ui_language=ui_language,
    )


@contacts_bp.route('/u/<username>/start', methods=['POST'])
@limiter.limit("20 per minute")
def start_dialog_from_public_card(username):
    target_username = canonical_username(username)
    if not USERNAME_PATTERN.fullmatch(target_username):
        abort(404)

    if 'user_id' not in session:
        flash('Sign in to continue.', 'warning')
        return redirect(url_for('auth.index'))

    conn = get_db_connection()
    try:
        processed = process_start_dialog_from_public_card_route(
            conn,
            target_username=target_username,
            resolve_viewer_context_func=_resolve_viewer_context,
            process_start_dialog_from_public_card_func=process_start_dialog_from_public_card,
            start_dialog_from_public_card_workflow_func=start_dialog_from_public_card_workflow,
            normalize_block_state_func=normalize_block_state,
            build_block_state_func=build_block_state,
            send_dialog_request_workflow_func=send_dialog_request_workflow,
        )
        status_response = _handle_start_dialog_status(
            target_username=target_username,
            processed=processed,
        )
        if status_response is not None:
            return status_response
    finally:
        conn.close()

    flash('Chat request sent.', 'success')
    return _redirect_public_user_card(target_username=target_username)
