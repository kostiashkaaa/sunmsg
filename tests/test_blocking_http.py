from io import BytesIO

from app import create_app
from app.routes import chat as chat_routes
from app.services.blocking import BLOCK_ERROR_CODE
from app.services.crypto import generate_chat_id

from tests._chat_contacts_http_helpers import _authed_client, _capture_socket_emits, _connect


def test_request_accept_block_and_unblock_flow(monkeypatch, tmp_path):
    db_path = tmp_path / 'request-block-flow.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    emitted = _capture_socket_emits(monkeypatch)

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'alice', 'Alice'),
                (2, 'pk-2', 'bob', 'Bob')
            '''
        )
        conn.commit()

    alice_client = _authed_client(app, 1, 'pk-1')
    bob_client = _authed_client(app, 2, 'pk-2')

    response = alice_client.post('/send_request', json={'contact_user_id': 2})
    assert response.status_code == 200
    assert response.get_json()['success'] is True

    with _connect(db_path) as conn:
        dialog_request = conn.execute(
            '''
            SELECT sender_id, receiver_id, status
            FROM dialog_requests
            WHERE sender_id = 1 AND receiver_id = 2
            '''
        ).fetchone()

    assert dialog_request['status'] == 'pending'
    assert emitted == [
        {
            'name': 'new_dialog_request',
            'payload': {
                'sender_public_key': 'pk-1',
                'sender_display_name': 'Alice',
                'sender_username': 'alice',
                'sender_avatar': None,
            },
            'args': (),
            'kwargs': {'room': 'pk-2'},
        }
    ]

    emitted.clear()
    response = bob_client.get('/get_dialog_requests')
    assert response.status_code == 200
    assert response.get_json() == {
        'success': True,
        'dialog_requests': [
            {
                'sender_public_key': 'pk-1',
                'sender_username': 'alice',
                'sender_display_name': 'Alice',
            }
        ],
    }

    response = bob_client.post('/accept_request', json={'sender_public_key': 'pk-1'})
    payload = response.get_json()
    chat_id = generate_chat_id('pk-1', 'pk-2')

    assert response.status_code == 200
    assert payload == {'success': True, 'chat_id': chat_id}

    with _connect(db_path) as conn:
        request_row = conn.execute(
            'SELECT status FROM dialog_requests WHERE sender_id = 1 AND receiver_id = 2'
        ).fetchone()
        chat_row = conn.execute(
            'SELECT chat_id FROM chats WHERE chat_id = ?',
            (chat_id,),
        ).fetchone()
        contact_rows = conn.execute(
            'SELECT user_id, contact_id, chat_id FROM contacts ORDER BY user_id ASC'
        ).fetchall()

    assert request_row['status'] == 'accepted'
    assert chat_row['chat_id'] == chat_id
    assert [(row['user_id'], row['contact_id'], row['chat_id']) for row in contact_rows] == [
        (1, 2, chat_id),
        (2, 1, chat_id),
    ]
    assert emitted == [
        {
            'name': 'chat_created',
            'payload': {
                'chat_id': chat_id,
                'contact': {
                    'userId': 1,
                    'display_name': 'Alice',
                    'username': 'alice',
                    'public_key': 'pk-1',
                    'chatId': chat_id,
                    'last_message': None,
                    'unreadCount': 0,
                    'avatar_url': None,
                    'blocked_by_me': False,
                    'blocked_me': False,
                    'is_blocked': False,
                },
            },
            'args': (),
            'kwargs': {'room': 'pk-2'},
        },
        {
            'name': 'chat_created',
            'payload': {
                'chat_id': chat_id,
                'contact': {
                    'userId': 2,
                    'display_name': 'Bob',
                    'username': 'bob',
                    'public_key': 'pk-2',
                    'chatId': chat_id,
                    'last_message': None,
                    'unreadCount': 0,
                    'avatar_url': None,
                    'blocked_by_me': False,
                    'blocked_me': False,
                    'is_blocked': False,
                },
            },
            'args': (),
            'kwargs': {'room': 'pk-1'},
        },
        {
            'name': 'dialog_request_updated',
            'payload': {'sender_public_key': 'pk-1', 'action': 'accepted'},
            'args': (),
            'kwargs': {'room': 'pk-2'},
        },
    ]

    emitted.clear()
    response = alice_client.post('/block_user', json={'blocked_user_id': 2})
    payload = response.get_json()

    assert response.status_code == 200
    assert payload == {
        'success': True,
        'block_state': {
            'is_blocked': True,
            'blocked_by_me': True,
            'blocked_me': False,
        },
    }

    with _connect(db_path) as conn:
        block_row = conn.execute(
            'SELECT blocker_id, blocked_id FROM block_list WHERE blocker_id = 1 AND blocked_id = 2'
        ).fetchone()

    assert block_row['blocker_id'] == 1
    assert block_row['blocked_id'] == 2

    response = alice_client.get('/get_blocked_users')
    payload = response.get_json()
    assert response.status_code == 200
    assert [entry['blocked_user_id'] for entry in payload['blocked_users']] == [2]

    assert any(
        event['name'] == 'chat_block_state'
        and event['payload']['partner_user_id'] == 2
        and event['payload']['blocked_by_me'] is True
        and event['kwargs']['room'] == 'pk-1'
        for event in emitted
    )
    assert any(
        event['name'] == 'chat_block_state'
        and event['payload']['partner_user_id'] == 1
        and event['payload']['blocked_me'] is True
        and event['kwargs']['room'] == 'pk-2'
        for event in emitted
    )
    assert any(
        event['name'] == 'force_leave_chat'
        and event['payload']['chat_id'] == chat_id
        and event['kwargs']['room'] == 'pk-1'
        for event in emitted
    )
    assert any(
        event['name'] == 'force_leave_chat'
        and event['payload']['chat_id'] == chat_id
        and event['kwargs']['room'] == 'pk-2'
        for event in emitted
    )
    assert any(
        event['name'] == 'partner_stop_typing'
        and event['payload']['chat_id'] == chat_id
        and event['kwargs']['room'] == 'pk-1'
        for event in emitted
    )
    assert any(
        event['name'] == 'partner_stop_typing'
        and event['payload']['chat_id'] == chat_id
        and event['kwargs']['room'] == 'pk-2'
        for event in emitted
    )
    assert any(
        event['name'] == 'you_are_blocked'
        and event['payload']['blocker_public_key'] == 'pk-1'
        and event['payload']['chat_id'] == chat_id
        and event['kwargs']['room'] == 'pk-2'
        for event in emitted
    )

    emitted.clear()
    response = alice_client.get('/get_online_status?user_id=2')
    payload = response.get_json()

    assert response.status_code == 403
    assert payload['success'] is False
    assert payload['error']['code'] == BLOCK_ERROR_CODE
    assert payload['error']['blocked_by_me'] is True

    response = alice_client.post('/mark_messages_read', json={'chat_id': chat_id})
    payload = response.get_json()
    assert response.status_code == 403
    assert payload['success'] is False
    assert payload['error']['code'] == BLOCK_ERROR_CODE

    response = alice_client.post('/unblock_user', json={'blocked_user_id': 2})
    payload = response.get_json()

    assert response.status_code == 200
    assert payload == {
        'success': True,
        'block_state': {
            'is_blocked': False,
            'blocked_by_me': False,
            'blocked_me': False,
        },
    }

    with _connect(db_path) as conn:
        block_row = conn.execute(
            'SELECT 1 FROM block_list WHERE blocker_id = 1 AND blocked_id = 2'
        ).fetchone()

    assert block_row is None
    response = alice_client.get('/get_blocked_users')
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['blocked_users'] == []
    assert any(
        event['name'] == 'chat_block_state'
        and event['payload']['partner_user_id'] == 2
        and event['payload']['is_blocked'] is False
        and event['kwargs']['room'] == 'pk-1'
        for event in emitted
    )
    assert any(
        event['name'] == 'chat_block_state'
        and event['payload']['partner_user_id'] == 1
        and event['payload']['is_blocked'] is False
        and event['kwargs']['room'] == 'pk-2'
        for event in emitted
    )

def test_upload_chat_media_rejects_invalid_content_and_blocked_chat(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-media-negative-http.db'
    media_dir = tmp_path / 'chat_media_negative'
    media_dir.mkdir()
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    monkeypatch.setattr(chat_routes, 'CHAT_MEDIA_FOLDER', str(media_dir))
    chat_id = generate_chat_id('pk-1', 'pk-2')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'alice', 'Alice'),
                (2, 'pk-2', 'bob', 'Bob')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, ?), (2, 1, ?)
            ''',
            (chat_id, chat_id),
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    response = client.post(
        '/upload_chat_media',
        data={
            'chat_id': chat_id,
            'file': (BytesIO(b'not-a-png'), 'broken.png', 'image/png'),
        },
        content_type='multipart/form-data',
    )
    assert response.status_code == 400
    assert response.get_json()['success'] is False

    with _connect(db_path) as conn:
        conn.execute(
            'INSERT INTO block_list (blocker_id, blocked_id) VALUES (2, 1)'
        )
        conn.commit()

    response = client.post(
        '/upload_chat_media',
        data={
            'chat_id': chat_id,
            'file': (BytesIO(b'blocked payload'), 'note.txt', 'text/plain'),
        },
        content_type='multipart/form-data',
    )
    payload = response.get_json()
    assert response.status_code == 403
    assert payload['success'] is False
    assert payload['error']['code'] == BLOCK_ERROR_CODE
    assert payload['error']['blocked_me'] is True
