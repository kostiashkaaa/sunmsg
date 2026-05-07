from app.sockets.chat_access import (
    chat_partner_state,
    emit_blocked_error,
    emit_chat_status_for_user,
)


def test_emit_blocked_error_builds_payload_and_request_id():
    emitted = []

    def _emit(name, payload):
        emitted.append((name, payload))

    emit_blocked_error(
        'fallback message',
        state={'blocked_by_me': True},
        request_id='req-1',
        block_error_payload_func=lambda message, state: {
            'error': {
                'code': 'BLOCKED',
                'message': message,
                'blocked_by_me': state.get('blocked_by_me'),
                'blocked_me': state.get('blocked_me', False),
            }
        },
        normalize_block_state_func=lambda state: {
            'blocked_by_me': bool((state or {}).get('blocked_by_me')),
            'blocked_me': bool((state or {}).get('blocked_me')),
        },
        emit_func=_emit,
    )

    assert emitted == [
        (
            'error',
            {
                'code': 'BLOCKED',
                'message': 'fallback message',
                'blocked_by_me': True,
                'blocked_me': False,
                'request_id': 'req-1',
            },
        )
    ]


def test_chat_partner_state_returns_none_when_partner_missing():
    partner, state = chat_partner_state(
        conn=object(),
        user_id=10,
        chat_id='chat-x',
        get_chat_partner_func=lambda conn, user_id, chat_id: None,
        build_block_state_func=lambda conn, user_id, contact_id: {'is_blocked': False},
        normalize_block_state_func=lambda state: state,
    )

    assert partner is None
    assert state is None


def test_chat_partner_state_builds_normalized_state():
    partner, state = chat_partner_state(
        conn=object(),
        user_id=10,
        chat_id='chat-x',
        get_chat_partner_func=lambda conn, user_id, chat_id: {'contact_id': 77, 'public_key': 'pk-77'},
        build_block_state_func=lambda conn, user_id, contact_id: {'is_blocked': contact_id == 77},
        normalize_block_state_func=lambda raw: {
            'is_blocked': bool(raw.get('is_blocked')),
            'blocked_by_me': False,
            'blocked_me': True,
        },
    )

    assert partner == {'contact_id': 77, 'public_key': 'pk-77'}
    assert state == {'is_blocked': True, 'blocked_by_me': False, 'blocked_me': True}


def test_emit_chat_status_for_user_emits_to_all_visible_contacts():
    emitted = []

    emit_chat_status_for_user(
        conn=object(),
        user_id=5,
        payload={'public_key': 'pk-5', 'online': True},
        list_visible_contact_public_keys_func=lambda conn, user_id: [
            {'public_key': 'pk-1'},
            {'public_key': 'pk-2'},
        ],
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    assert emitted == [
        ('user_status', {'public_key': 'pk-5', 'online': True}, {'room': 'pk-1'}),
        ('user_status', {'public_key': 'pk-5', 'online': True}, {'room': 'pk-2'}),
    ]
