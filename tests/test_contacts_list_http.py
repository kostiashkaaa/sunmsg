from io import BytesIO

from app import create_app
from app.routes import chat as chat_routes
from app.services.crypto import generate_chat_id

from tests._chat_contacts_http_helpers import (
    _authed_client,
    _capture_socket_emits,
    _connect,
    _png_bytes,
)


def test_chat_media_rate_limit_key_prefers_user_and_falls_back_to_ip(monkeypatch, tmp_path):
    from flask import session

    db_path = tmp_path / 'chat-media-rate-key.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with app.test_request_context('/chat_media/1', environ_base={'REMOTE_ADDR': '198.51.100.10'}):
        session['user_id'] = 42
        assert chat_routes._chat_media_rate_limit_key() == 'user:42'

    with app.test_request_context('/chat_media/1', environ_base={'REMOTE_ADDR': '198.51.100.10'}):
        session.pop('user_id', None)
        assert chat_routes._chat_media_rate_limit_key() == 'ip:198.51.100.10'

def test_get_chat_history_marks_messages_read_and_paginates(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-history-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = generate_chat_id('pk-1', 'pk-2')
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
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, ?), (2, 1, ?)
            ''',
            (chat_id, chat_id),
        )
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message, created_at)
            VALUES (101, ?, 1, 2, 'older outbound', '2025-01-01 10:00:00')
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO messages (
                id, chat_id, sender_id, receiver_id, message, message_type,
                is_read, is_delivered, created_at
            )
            VALUES (
                102, ?, 2, 1, 'latest inbound', 'photo',
                0, 0, '2025-01-01 10:01:00'
            )
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO message_reactions (message_id, chat_id, user_id, emoji)
            VALUES (102, ?, 2, '👍')
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO chat_pins (chat_id, message_id, message_content, pinned_by, sender_pub)
            VALUES (?, 102, 'latest inbound', 2, 'pk-2')
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO favorite_messages (user_id, chat_id, message_id, message_content, sender_pub)
            VALUES (1, ?, 102, 'latest inbound', 'pk-2')
            ''',
            (chat_id,),
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    response = client.get(f'/get_chat_history?chat_id={chat_id}&limit=1')
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['has_more_before'] is True
    assert payload['block_state'] == {
        'is_blocked': False,
        'blocked_by_me': False,
        'blocked_me': False,
    }
    assert payload['pin'] == {
        'message_id': 102,
        'message_content': 'latest inbound',
        'sender_pub': 'pk-2',
    }
    assert payload['favorites'] == [
        {
            'message_id': 102,
            'message_content': 'latest inbound',
            'sender_pub': 'pk-2',
            'favorited_at': payload['favorites'][0]['favorited_at'],
            'created_at': '2025-01-01 10:01:00',
        }
    ]
    assert len(payload['messages']) == 1
    assert payload['messages'][0]['id'] == 102
    assert payload['messages'][0]['message'] == 'latest inbound'
    assert payload['messages'][0]['is_self'] is False
    assert payload['messages'][0]['is_favorite'] is True
    assert payload['messages'][0]['is_read'] is True
    assert payload['messages'][0]['is_delivered'] is True
    assert payload['messages'][0]['reactions'][0]['emoji'] == '👍'
    assert payload['messages'][0]['reactions'][0]['count'] == 1
    assert payload['messages'][0]['reactions'][0]['reacted_by_me'] is False

    with _connect(db_path) as conn:
        latest_row = conn.execute(
            'SELECT is_read, is_delivered FROM messages WHERE id = 102'
        ).fetchone()

    assert bool(latest_row['is_read']) is True
    assert bool(latest_row['is_delivered']) is True
    assert emitted == [
        {
            'name': 'messages_read',
            'payload': {'chat_id': chat_id},
            'args': (),
            'kwargs': {'room': 'pk-2'},
        }
    ]

    emitted.clear()
    response = client.get(f'/get_chat_history?chat_id={chat_id}&limit=5&before_id=102')
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['has_more_before'] is False
    assert [message['id'] for message in payload['messages']] == [101]
    assert payload['messages'][0]['is_favorite'] is False
    assert emitted == []

def test_get_chat_history_supports_after_id_delta_and_rejects_conflicts(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-history-after-id.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
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
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message, created_at)
            VALUES
                (201, ?, 1, 2, 'm1', '2025-01-01 10:00:00'),
                (202, ?, 2, 1, 'm2', '2025-01-01 10:01:00'),
                (203, ?, 2, 1, 'm3', '2025-01-01 10:02:00')
            ''',
            (chat_id, chat_id, chat_id),
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    response = client.get(f'/get_chat_history?chat_id={chat_id}&after_id=201&limit=1')
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert [message['id'] for message in payload['messages']] == [202]
    assert payload['has_more_after'] is True

    response = client.get(f'/get_chat_history?chat_id={chat_id}&after_id=203&limit=10')
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['messages'] == []
    assert payload['has_more_after'] is False

    response = client.get(f'/get_chat_history?chat_id={chat_id}&before_id=203&after_id=201')
    payload = response.get_json()
    assert response.status_code == 400
    assert payload['success'] is False
    assert 'mutually exclusive' in payload['error']

def test_delete_chat_supports_for_me_and_for_both(monkeypatch, tmp_path):
    db_path = tmp_path / 'delete-chat-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id_a = generate_chat_id('pk-1', 'pk-2')
    chat_id_b = generate_chat_id('pk-1', 'pk-3')
    emitted = _capture_socket_emits(monkeypatch)

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'alice', 'Alice'),
                (2, 'pk-2', 'bob', 'Bob'),
                (3, 'pk-3', 'carol', 'Carol')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES
                (1, 2, ?), (2, 1, ?),
                (1, 3, ?), (3, 1, ?)
            ''',
            (chat_id_a, chat_id_a, chat_id_b, chat_id_b),
        )
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message)
            VALUES
                (201, ?, 1, 2, 'a-outbound'),
                (202, ?, 2, 1, 'a-inbound'),
                (301, ?, 1, 3, 'b-outbound')
            ''',
            (chat_id_a, chat_id_a, chat_id_b),
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    response = client.post('/delete_chat', json={'chat_id': chat_id_a, 'mode': 'for_me'})
    assert response.status_code == 200
    assert response.get_json()['success'] is True

    with _connect(db_path) as conn:
        own_contact_row = conn.execute(
            'SELECT 1 FROM contacts WHERE user_id = 1 AND chat_id = ?',
            (chat_id_a,),
        ).fetchone()
        partner_contact_row = conn.execute(
            'SELECT 1 FROM contacts WHERE user_id = 2 AND chat_id = ?',
            (chat_id_a,),
        ).fetchone()
        outbound_row = conn.execute(
            'SELECT deleted_by_sender, deleted_by_receiver FROM messages WHERE id = 201'
        ).fetchone()
        inbound_row = conn.execute(
            'SELECT deleted_by_sender, deleted_by_receiver FROM messages WHERE id = 202'
        ).fetchone()
        remaining_count = conn.execute(
            'SELECT COUNT(*) AS cnt FROM messages WHERE chat_id = ?',
            (chat_id_a,),
        ).fetchone()['cnt']

    assert own_contact_row is None
    assert partner_contact_row is not None
    assert bool(outbound_row['deleted_by_sender']) is True
    assert bool(outbound_row['deleted_by_receiver']) is False
    assert bool(inbound_row['deleted_by_sender']) is False
    assert bool(inbound_row['deleted_by_receiver']) is True
    assert remaining_count == 2
    assert emitted == []

    response = client.post('/delete_chat', json={'chat_id': chat_id_b, 'mode': 'for_both'})
    assert response.status_code == 200
    assert response.get_json()['success'] is True

    with _connect(db_path) as conn:
        remaining_contacts = conn.execute(
            'SELECT COUNT(*) AS cnt FROM contacts WHERE chat_id = ?',
            (chat_id_b,),
        ).fetchone()['cnt']
        remaining_messages = conn.execute(
            'SELECT COUNT(*) AS cnt FROM messages WHERE chat_id = ?',
            (chat_id_b,),
        ).fetchone()['cnt']

    assert remaining_contacts == 0
    assert remaining_messages == 0
    assert emitted == [
        {
            'name': 'chat_deleted',
            'payload': {'chat_id': chat_id_b},
            'args': (),
            'kwargs': {'room': chat_id_b},
        },
        {
            'name': 'chat_deleted',
            'payload': {'chat_id': chat_id_b},
            'args': (),
            'kwargs': {'room': 'pk-3'},
        },
    ]

def test_get_contacts_accepts_limit_query_param(monkeypatch, tmp_path):
    db_path = tmp_path / 'contacts-limit-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id_a = generate_chat_id('pk-1', 'pk-2')
    chat_id_b = generate_chat_id('pk-1', 'pk-3')
    chat_id_c = generate_chat_id('pk-1', 'pk-4')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'alice', 'Alice'),
                (2, 'pk-2', 'bob', 'Bob'),
                (3, 'pk-3', 'carol', 'Carol'),
                (4, 'pk-4', 'dave', 'Dave')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES
                (1, 2, ?), (2, 1, ?),
                (1, 3, ?), (3, 1, ?),
                (1, 4, ?), (4, 1, ?)
            ''',
            (chat_id_a, chat_id_a, chat_id_b, chat_id_b, chat_id_c, chat_id_c),
        )
        conn.execute(
            '''
            INSERT INTO messages (chat_id, sender_id, receiver_id, message, created_at)
            VALUES
                (?, 2, 1, 'oldest', '2025-01-01 10:00:00'),
                (?, 3, 1, 'middle', '2025-01-01 10:05:00'),
                (?, 4, 1, 'newest', '2025-01-01 10:10:00')
            ''',
            (chat_id_a, chat_id_b, chat_id_c),
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    limited_response = client.get('/get_contacts?limit=2')
    limited_payload = limited_response.get_json()
    assert limited_response.status_code == 200
    assert limited_payload['success'] is True
    assert len(limited_payload['contacts']) == 2

    full_response = client.get('/get_contacts')
    full_payload = full_response.get_json()
    assert full_response.status_code == 200
    assert full_payload['success'] is True
    assert len(full_payload['contacts']) == 4


def test_get_contacts_persists_saved_messages_contact(monkeypatch, tmp_path):
    db_path = tmp_path / 'contacts-saved-messages-persist.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    response = client.get('/get_contacts')
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True

    with _connect(db_path) as conn:
        self_contact = conn.execute(
            '''
            SELECT chat_id
            FROM contacts
            WHERE user_id = 1 AND contact_id = 1
            '''
        ).fetchone()

    assert self_contact is not None
    assert str(self_contact['chat_id'] or '').strip() != ''

def test_upload_avatar_persists_file_and_emits_profile_updates(monkeypatch, tmp_path):
    db_path = tmp_path / 'upload-avatar-http.db'
    avatar_dir = tmp_path / 'avatars'
    avatar_dir.mkdir()
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    emitted = _capture_socket_emits(monkeypatch)
    monkeypatch.setattr(chat_routes, 'UPLOAD_FOLDER', str(avatar_dir))

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
            VALUES (1, 2, 'chat-1'), (2, 1, 'chat-1')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.post(
        '/upload_avatar',
        data={'avatar': (BytesIO(_png_bytes()), 'avatar.png')},
        content_type='multipart/form-data',
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['avatar_url'].startswith('/static/avatars/')

    avatar_name = payload['avatar_url'].split('/')[-1]
    assert (avatar_dir / avatar_name).exists()

    with _connect(db_path) as conn:
        user_row = conn.execute(
            'SELECT avatar_url FROM users WHERE id = 1'
        ).fetchone()

    assert user_row['avatar_url'] == payload['avatar_url']
    assert emitted == [
        {
            'name': 'profile_updated',
            'payload': {
                'user_id': 1,
                'public_key': 'pk-1',
                'display_name': 'Alice',
                'username': 'alice',
                'avatar_url': payload['avatar_url'],
            },
            'args': (),
            'kwargs': {'room': 'pk-2'},
        },
        {
            'name': 'own_profile_updated',
            'payload': {
                'user_id': 1,
                'public_key': 'pk-1',
                'display_name': 'Alice',
                'username': 'alice',
                'avatar_url': payload['avatar_url'],
            },
            'args': (),
            'kwargs': {'room': 'pk-1'},
        },
    ]

def test_upload_avatar_validation_and_get_avatar_visibility(monkeypatch, tmp_path):
    db_path = tmp_path / 'avatar-visibility-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (
                id, public_key, username, display_name, avatar_url, avatar_visibility
            )
            VALUES
                (1, 'pk-1', 'alice', 'Alice', NULL, 'all'),
                (2, 'pk-2', 'bob', 'Bob', '/static/avatars/bob.png', 'contacts'),
                (3, 'pk-3', 'carol', 'Carol', '/static/avatars/carol.png', 'contacts')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-1'), (2, 1, 'chat-1')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    response = client.post(
        '/upload_avatar',
        data={'avatar': (BytesIO(b'not-a-real-png'), 'broken.png')},
        content_type='multipart/form-data',
    )
    assert response.status_code == 400
    assert response.get_json()['success'] is False

    response = client.get('/get_avatar?user_id=2')
    assert response.status_code == 200
    assert response.get_json() == {'success': True, 'avatar_url': '/static/avatars/bob.png'}

    response = client.get('/get_avatar?public_key=pk-3')
    assert response.status_code == 200
    assert response.get_json() == {'success': True, 'avatar_url': None}

def test_upload_chat_media_and_get_chat_media_cover_inline_and_attachment(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-media-http.db'
    media_dir = tmp_path / 'chat_media'
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
    media_body = b'hello media'
    response = client.post(
        '/upload_chat_media',
        data={
            'chat_id': chat_id,
            'file': (BytesIO(media_body), 'note.txt', 'text/plain'),
        },
        content_type='multipart/form-data',
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload == {
        'success': True,
        'url': payload['url'],
        'mime': 'text/plain',
        'media_type': 'file',
        'name': 'note.txt',
        'size': len(media_body),
    }

    media_id = int(payload['url'].rsplit('/', 1)[-1])
    with _connect(db_path) as conn:
        media_row = conn.execute(
            '''
            SELECT storage_name, original_name, mime_type, size
            FROM chat_media
            WHERE id = ?
            ''',
            (media_id,),
        ).fetchone()
        conn.execute(
            '''
            INSERT INTO chat_media (id, chat_id, uploader_id, storage_name, original_name, mime_type, size)
            VALUES (999, ?, 1, 'danger.html', 'danger.html', 'text/html', 12)
            ''',
            (chat_id,),
        )
        conn.commit()

    assert media_row['original_name'] == 'note.txt'
    assert media_row['mime_type'] == 'text/plain'
    assert media_row['size'] == len(media_body)
    assert (media_dir / media_row['storage_name']).read_bytes() == media_body

    response = client.get(f'/chat_media/{media_id}')
    assert response.status_code == 200
    assert response.data == media_body
    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    assert 'attachment' not in response.headers.get('Content-Disposition', '').lower()

    (media_dir / 'danger.html').write_text('<h1>danger</h1>', encoding='utf-8')
    response = client.get('/chat_media/999')
    assert response.status_code == 200
    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    assert 'attachment' in response.headers.get('Content-Disposition', '').lower()

def test_search_users_enforces_min_query_and_paginates_without_public_key(monkeypatch, tmp_path):
    db_path = tmp_path / 'search-users-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = _authed_client(app, 1, 'pk-1')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_public)
            VALUES
                (1, 'pk-1', 'owner', 'Owner', 1),
                (2, 'pk-2', 'alpha_one', 'Alpha One', 1),
                (3, 'pk-3', 'alpha_two', 'Alpha Two', 1),
                (4, 'pk-4', 'alpha_three', 'Alpha Three', 1),
                (5, 'pk-5', 'alpha_private', 'Alpha Private', 0)
            '''
        )
        conn.commit()

    short_response = client.get('/search_users?q=al')
    short_payload = short_response.get_json()
    assert short_response.status_code == 200
    assert short_payload['success'] is True
    assert short_payload['results'] == []
    assert short_payload['min_query_length'] == 3

    page_one_response = client.get('/search_users?q=alpha&limit=2&offset=0')
    page_one_payload = page_one_response.get_json()
    assert page_one_response.status_code == 200
    assert page_one_payload['success'] is True
    assert page_one_payload['has_more'] is True
    assert [entry['userId'] for entry in page_one_payload['results']] == [2, 3]
    assert all('public_key' not in entry for entry in page_one_payload['results'])

    page_two_response = client.get('/search_users?q=alpha&limit=2&offset=2')
    page_two_payload = page_two_response.get_json()
    assert page_two_response.status_code == 200
    assert page_two_payload['success'] is True
    assert page_two_payload['has_more'] is False
    assert [entry['userId'] for entry in page_two_payload['results']] == [4]
    assert all('public_key' not in entry for entry in page_two_payload['results'])

def test_search_users_key_query_keeps_public_key_field(monkeypatch, tmp_path):
    db_path = tmp_path / 'search-users-key-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = _authed_client(app, 1, 'pk-1')
    target_key = (
        '-----BEGIN PUBLIC KEY-----\n'
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtargetkeymaterial1234567890\n'
        '-----END PUBLIC KEY-----'
    )

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_public)
            VALUES
                (1, 'pk-1', 'owner', 'Owner', 1),
                (2, ?, 'hidden_user', 'Hidden User', 0)
            ''',
            (target_key,),
        )
        conn.commit()

    response = client.get('/search_users', query_string={'q': target_key, 'limit': 5})
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert len(payload['results']) == 1
    assert payload['results'][0]['userId'] == 2
    assert payload['results'][0]['public_key'] == target_key

def test_public_user_card_respects_visibility_and_contact_access(monkeypatch, tmp_path):
    db_path = tmp_path / 'public-user-card.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    guest_client = app.test_client()

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_public)
            VALUES
                (1, 'pk-1', 'alice', 'Alice', 1),
                (2, 'pk-2', 'bob', 'Bob', 1),
                (3, 'pk-3', 'hidden_user', 'Hidden User', 0)
            '''
        )
        conn.commit()

    public_response = guest_client.get('/u/bob')
    assert public_response.status_code == 200
    public_html = public_response.get_data(as_text=True)
    assert '@bob' in public_html
    assert 'Bob' in public_html

    # Private profiles render a stub page (200) instead of hard 404.
    private_response = guest_client.get('/u/hidden_user')
    assert private_response.status_code == 200
    private_html = private_response.get_data(as_text=True)
    assert '@hidden_user' in private_html or 'hidden_user' in private_html

    with _connect(db_path) as conn:
        chat_id = generate_chat_id('pk-1', 'pk-3')
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 3, ?), (3, 1, ?)
            ''',
            (chat_id, chat_id),
        )
        conn.commit()

    authed_client = _authed_client(app, 1, 'pk-1')
    contact_private_response = authed_client.get('/u/hidden_user')
    assert contact_private_response.status_code == 200
    assert '@hidden_user' in contact_private_response.get_data(as_text=True)

def test_username_chat_alias_serves_owner_and_canonicalizes(monkeypatch, tmp_path):
    db_path = tmp_path / 'username-chat-alias.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

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

    client = _authed_client(app, 1, 'pk-1')

    own_alias_response = client.get('/alice/chat')
    assert own_alias_response.status_code == 200
    own_alias_html = own_alias_response.get_data(as_text=True)
    assert 'data-current-username="alice"' in own_alias_html

    other_alias_response = client.get('/bob/chat')
    assert other_alias_response.status_code == 302
    assert other_alias_response.headers['Location'].endswith('/alice/chat')

def test_chat_contact_username_route_sets_initial_target(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-contact-username-route.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

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
            VALUES (1, 2, 'chat-1'), (2, 1, 'chat-1')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    response = client.get('/chat/bob')
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'data-initial-chat-contact-username="bob"' in html
    assert 'data-current-username="alice"' in html

    response = client.get('/chat/Bad-Name')
    assert response.status_code == 302
    assert response.headers['Location'].endswith('/chat')
