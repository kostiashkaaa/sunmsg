def process_pin_chat(
    conn,
    *,
    user_id: int,
    chat_id: str,
    pin_chat_for_user_func,
    ensure_pinned_chats_table_func,
    ensure_chat_exists_func,
    logger_error_func,
):
    try:
        result = pin_chat_for_user_func(
            conn,
            user_id=user_id,
            chat_id=chat_id,
            ensure_pinned_chats_table_func=ensure_pinned_chats_table_func,
            ensure_chat_exists_func=ensure_chat_exists_func,
        )
    except Exception as exc:
        logger_error_func(f"pin_chat error: {exc}")
        return {'status': 'error'}

    if result['status'] == 'chat_not_found':
        return {'status': 'chat_not_found'}

    return {'status': 'ok', 'pin_order': int(result['pin_order'])}


def process_unpin_chat(
    conn,
    *,
    user_id: int,
    chat_id: str,
    unpin_chat_for_user_func,
    ensure_pinned_chats_table_func,
    logger_error_func,
):
    try:
        unpin_chat_for_user_func(
            conn,
            user_id=user_id,
            chat_id=chat_id,
            ensure_pinned_chats_table_func=ensure_pinned_chats_table_func,
        )
    except Exception as exc:
        logger_error_func(f"unpin_chat error: {exc}")
        return {'status': 'error'}

    return {'status': 'ok'}


def process_reorder_pinned_chats(
    conn,
    *,
    user_id: int,
    ordered_ids,
    reorder_pinned_chats_for_user_func,
    ensure_pinned_chats_table_func,
    logger_error_func,
):
    try:
        normalized_ids = reorder_pinned_chats_for_user_func(
            conn,
            user_id=user_id,
            ordered_ids=ordered_ids,
            ensure_pinned_chats_table_func=ensure_pinned_chats_table_func,
        )
    except Exception as exc:
        logger_error_func(f"reorder_pinned_chats error: {exc}")
        return {'status': 'error'}

    return {'status': 'ok', 'chat_ids': normalized_ids}
