from app.sockets.message_handlers import _initialize_send_runtime_state


def test_initialize_send_runtime_state_does_not_recurse_for_direct_message():
    state = _initialize_send_runtime_state(
        conn=None,
        context={
            'data': {
                'reply_to_id': '42',
                'forward_from_name': 'A' * 180,
                'forward_from_user_id': '7',
            },
            'positive_int_func': lambda value: int(value) if str(value or '').isdigit() else None,
            'chat_type': 'direct',
            'chat_id': 'chat-1',
            'sender_id': 1,
            'message': 'ciphertext',
            'message_type': 'text',
            'session_store': {
                'display_name': 'Alice',
                'username': 'alice',
            },
        },
    )

    assert state['reply_to_id'] == 42
    assert state['forward_from_name'] == 'A' * 140
    assert state['forward_from_user_id'] == 7
    assert state['group_member_public_keys'] == []
    assert state['mentioned_members'] == []
    assert state['mentioned_user_ids'] == []
    assert state['mentioned_usernames'] == []
    assert state['group_chat_display_name'] == ''
    assert state['sender_display_name'] == 'Alice'
    assert state['sender_username'] == 'alice'
    assert state['sender_avatar_url'] == ''
