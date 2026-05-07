from app.routes.pinned_chat_route_handlers import (
    process_pin_chat,
    process_reorder_pinned_chats,
    process_unpin_chat,
)


def test_process_pin_chat_maps_not_found():
    result = process_pin_chat(
        object(),
        user_id=1,
        chat_id='chat-1',
        pin_chat_for_user_func=lambda conn, **kwargs: {'status': 'chat_not_found'},
        ensure_pinned_chats_table_func=lambda conn: None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        logger_error_func=lambda message: None,
    )

    assert result == {'status': 'chat_not_found'}


def test_process_pin_chat_maps_error_and_logs():
    logged = []

    def _raise(*args, **kwargs):
        raise RuntimeError('boom')

    result = process_pin_chat(
        object(),
        user_id=1,
        chat_id='chat-1',
        pin_chat_for_user_func=_raise,
        ensure_pinned_chats_table_func=lambda conn: None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        logger_error_func=lambda message: logged.append(message),
    )

    assert result == {'status': 'error'}
    assert logged == ['pin_chat error: boom']


def test_process_pin_chat_returns_pin_order():
    result = process_pin_chat(
        object(),
        user_id=1,
        chat_id='chat-1',
        pin_chat_for_user_func=lambda conn, **kwargs: {'status': 'ok', 'pin_order': '7'},
        ensure_pinned_chats_table_func=lambda conn: None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        logger_error_func=lambda message: None,
    )

    assert result == {'status': 'ok', 'pin_order': 7}


def test_process_unpin_chat_maps_error_and_success():
    logged = []

    def _raise(*args, **kwargs):
        raise RuntimeError('boom')

    error_result = process_unpin_chat(
        object(),
        user_id=1,
        chat_id='chat-1',
        unpin_chat_for_user_func=_raise,
        ensure_pinned_chats_table_func=lambda conn: None,
        logger_error_func=lambda message: logged.append(message),
    )
    ok_result = process_unpin_chat(
        object(),
        user_id=1,
        chat_id='chat-1',
        unpin_chat_for_user_func=lambda conn, **kwargs: None,
        ensure_pinned_chats_table_func=lambda conn: None,
        logger_error_func=lambda message: None,
    )

    assert error_result == {'status': 'error'}
    assert logged == ['unpin_chat error: boom']
    assert ok_result == {'status': 'ok'}


def test_process_reorder_pinned_chats_maps_error_and_success():
    logged = []

    def _raise(*args, **kwargs):
        raise RuntimeError('boom')

    error_result = process_reorder_pinned_chats(
        object(),
        user_id=1,
        ordered_ids=['chat-1'],
        reorder_pinned_chats_for_user_func=_raise,
        ensure_pinned_chats_table_func=lambda conn: None,
        logger_error_func=lambda message: logged.append(message),
    )
    ok_result = process_reorder_pinned_chats(
        object(),
        user_id=1,
        ordered_ids=['chat-1'],
        reorder_pinned_chats_for_user_func=lambda conn, **kwargs: ['chat-1', 'chat-2'],
        ensure_pinned_chats_table_func=lambda conn: None,
        logger_error_func=lambda message: None,
    )

    assert error_result == {'status': 'error'}
    assert logged == ['reorder_pinned_chats error: boom']
    assert ok_result == {'status': 'ok', 'chat_ids': ['chat-1', 'chat-2']}
