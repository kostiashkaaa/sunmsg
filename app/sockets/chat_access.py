def emit_blocked_error(  # noqa: PLR0913 - dependency-injected helper contract
    message: str,
    *,
    state,
    request_id: str | None,
    block_error_payload_func,
    normalize_block_state_func,
    emit_func,
):
    payload = block_error_payload_func(message, normalize_block_state_func(state))
    err = payload.get('error') or {}
    response = {
        'code': err.get('code'),
        'message': err.get('message', message),
        'blocked_by_me': bool(err.get('blocked_by_me')),
        'blocked_me': bool(err.get('blocked_me')),
    }
    if request_id:
        response['request_id'] = request_id
    emit_func('error', response)


def chat_partner_state(  # noqa: PLR0913 - dependency-injected helper contract
    conn,
    user_id: int,
    chat_id: str,
    *,
    get_chat_partner_func,
    build_block_state_func,
    normalize_block_state_func,
):
    partner = get_chat_partner_func(conn, user_id, chat_id)
    if not partner:
        return None, None
    state = normalize_block_state_func(build_block_state_func(conn, user_id, partner['contact_id']))
    return partner, state


def emit_chat_status_for_user(
    conn,
    user_id: int,
    payload: dict,
    *,
    list_visible_contact_public_keys_func,
    emit_func,
):
    for viewer in list_visible_contact_public_keys_func(conn, user_id):
        emit_func('user_status', payload, room=viewer['public_key'])
