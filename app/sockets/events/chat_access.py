from app.services.blocking import (
    build_block_state,
    get_chat_partner,
    list_visible_contact_public_keys,
    normalize_block_state,
)


def chat_partner_state(conn, user_id: int, chat_id: str):
    partner = get_chat_partner(conn, user_id, chat_id)
    if not partner:
        return None, None
    state = normalize_block_state(build_block_state(conn, user_id, partner['contact_id']))
    return partner, state


def emit_chat_status_for_user(conn, user_id: int, payload: dict, *, emit_func):
    for viewer in list_visible_contact_public_keys(conn, user_id):
        emit_func('user_status', payload, room=viewer['public_key'])
