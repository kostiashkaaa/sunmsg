from app import create_app
from app.routes import chat as chat_routes

from tests._chat_contacts_http_helpers import _authed_client, _connect


def test_create_group_chat_persists_chat_and_members(monkeypatch, tmp_path):
    db_path = tmp_path / 'group-chat-create-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

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
        conn.commit()

    emitted = []
    monkeypatch.setattr(
        chat_routes.socketio,
        'emit',
        lambda name, payload=None, *args, **kwargs: emitted.append(
            {'name': name, 'payload': payload, 'args': args, 'kwargs': kwargs}
        ),
    )

    client = _authed_client(app, 1, 'pk-1')
    response = client.post(
        '/api/chats/group/create',
        json={'title': 'Core Team', 'member_user_ids': [2, 3]},
    )
    payload = response.get_json()

    assert response.status_code == 201
    assert payload['success'] is True
    assert payload['chat_type'] == 'group'
    assert len(payload['chat_id']) == 64

    with _connect(db_path) as conn:
        chat_row = conn.execute(
            '''
            SELECT chat_name, chat_type, created_by_user_id
            FROM chats
            WHERE chat_id = ?
            ''',
            (payload['chat_id'],),
        ).fetchone()
        member_rows = conn.execute(
            '''
            SELECT user_id, role
            FROM chat_members
            WHERE chat_id = ?
            ORDER BY user_id ASC
            ''',
            (payload['chat_id'],),
        ).fetchall()

    assert chat_row['chat_name'] == 'Core Team'
    assert chat_row['chat_type'] == 'group'
    assert int(chat_row['created_by_user_id']) == 1
    assert [(int(row['user_id']), str(row['role'])) for row in member_rows] == [
        (1, 'owner'),
        (2, 'member'),
        (3, 'member'),
    ]
    created_for_bob = next((event for event in emitted if event['name'] == 'group_chat_created' and event['kwargs'].get('room') == 'pk-2'), None)
    created_for_carol = next((event for event in emitted if event['name'] == 'group_chat_created' and event['kwargs'].get('room') == 'pk-3'), None)
    assert created_for_bob is not None
    assert created_for_carol is not None
    assert int(created_for_bob['payload']['members_count']) == 3
    assert str(created_for_bob['payload']['chat_id']) == payload['chat_id']


def test_create_group_chat_creates_join_request_when_invitee_allows_contacts_only(monkeypatch, tmp_path):
    db_path = tmp_path / 'group-chat-create-join-request-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, group_invite_privacy)
            VALUES
                (1, 'pk-1', 'alice', 'Alice', 'all'),
                (2, 'pk-2', 'bob', 'Bob', 'contacts')
            '''
        )
        conn.commit()

    emitted = []
    monkeypatch.setattr(
        chat_routes.socketio,
        'emit',
        lambda name, payload=None, *args, **kwargs: emitted.append(
            {'name': name, 'payload': payload, 'args': args, 'kwargs': kwargs}
        ),
    )

    client = _authed_client(app, 1, 'pk-1')
    response = client.post(
        '/api/chats/group/create',
        json={'title': 'Invite Gate', 'member_user_ids': [2]},
    )
    payload = response.get_json()

    assert response.status_code == 201
    assert payload['success'] is True
    assert payload['members_count'] == 1
    assert payload['requested_member_ids'] == [2]

    with _connect(db_path) as conn:
        member_rows = conn.execute(
            '''
            SELECT user_id, role
            FROM chat_members
            WHERE chat_id = ?
            ORDER BY user_id ASC
            ''',
            (payload['chat_id'],),
        ).fetchall()
        invite_row = conn.execute(
            '''
            SELECT chat_id, inviter_user_id, invitee_user_id, status
            FROM group_invite_requests
            WHERE chat_id = ?
            ''',
            (payload['chat_id'],),
        ).fetchone()

    assert [(int(row['user_id']), str(row['role'])) for row in member_rows] == [
        (1, 'owner'),
    ]
    assert invite_row is not None
    assert str(invite_row['chat_id']) == payload['chat_id']
    assert int(invite_row['inviter_user_id']) == 1
    assert int(invite_row['invitee_user_id']) == 2
    assert str(invite_row['status']) == 'pending'

    created_for_bob = next(
        (
            event for event in emitted
            if event['name'] == 'group_chat_created' and event['kwargs'].get('room') == 'pk-2'
        ),
        None,
    )
    invite_for_bob = next(
        (
            event for event in emitted
            if event['name'] == 'new_group_invite_request' and event['kwargs'].get('room') == 'pk-2'
        ),
        None,
    )
    assert created_for_bob is None
    assert invite_for_bob is not None
    assert invite_for_bob['payload']['request_kind'] == 'group_invite'
    assert int(invite_for_bob['payload']['request_id']) > 0


def test_create_group_chat_denies_invitee_with_nobody_privacy(monkeypatch, tmp_path):
    db_path = tmp_path / 'group-chat-create-denied-invite-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, group_invite_privacy)
            VALUES
                (1, 'pk-1', 'alice', 'Alice', 'all'),
                (2, 'pk-2', 'bob', 'Bob', 'nobody')
            '''
        )
        conn.commit()

    emitted = []
    monkeypatch.setattr(
        chat_routes.socketio,
        'emit',
        lambda name, payload=None, *args, **kwargs: emitted.append(
            {'name': name, 'payload': payload, 'args': args, 'kwargs': kwargs}
        ),
    )

    client = _authed_client(app, 1, 'pk-1')
    response = client.post(
        '/api/chats/group/create',
        json={'title': 'Denied Gate', 'member_user_ids': [2]},
    )
    payload = response.get_json()

    assert response.status_code == 403
    assert payload['success'] is False
    assert payload['denied_member_ids'] == [2]
    assert emitted == []

    with _connect(db_path) as conn:
        chat_count = conn.execute('SELECT COUNT(*) AS cnt FROM chats').fetchone()['cnt']
        invite_count = conn.execute('SELECT COUNT(*) AS cnt FROM group_invite_requests').fetchone()['cnt']

    assert int(chat_count) == 0
    assert int(invite_count) == 0


def test_get_group_chat_history_uses_member_receipts(monkeypatch, tmp_path):
    db_path = tmp_path / 'group-chat-history-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = '1' * 64

    emitted = []
    monkeypatch.setattr(
        chat_routes.socketio,
        'emit',
        lambda name, payload=None, *args, **kwargs: emitted.append(
            {'name': name, 'payload': payload, 'args': args, 'kwargs': kwargs}
        ),
    )

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
            INSERT INTO chats (chat_id, chat_name, chat_type, created_by_user_id)
            VALUES (?, 'Core Team', 'group', 1)
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, ?, 'owner'),
                (2, ?, 'member'),
                (3, ?, 'member')
            ''',
            (chat_id, chat_id, chat_id),
        )
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message, message_type, created_at, is_delivered)
            VALUES
                (301, ?, 2, NULL, 'hello group', 'text', '2025-01-01 10:00:00', 1),
                (302, ?, 1, NULL, 'reply', 'text', '2025-01-01 10:01:00', 1)
            ''',
            (chat_id, chat_id),
        )
        conn.execute(
            '''
            INSERT INTO message_receipts (
                message_id, user_id, is_delivered, is_read, deleted_for_user, delivered_at, read_at
            )
            VALUES
                (301, 1, 0, 0, 0, NULL, NULL),
                (302, 1, 1, 1, 0, '2025-01-01 10:01:00', '2025-01-01 10:01:00'),
                (302, 2, 1, 1, 0, '2025-01-01 10:01:03', '2025-01-01 10:01:03')
            '''
        )
        conn.execute(
            '''
            INSERT INTO favorite_messages (user_id, chat_id, message_id, message_content, sender_pub)
            VALUES (1, ?, 301, 'hello group', 'pk-2')
            ''',
            (chat_id,),
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.get(f'/get_chat_history?chat_id={chat_id}&limit=20')
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['total_messages'] == 2
    assert [msg['id'] for msg in payload['messages']] == [301, 302]
    assert payload['messages'][0]['is_read'] is True
    assert payload['messages'][0]['is_self'] is False
    assert payload['messages'][0]['is_favorite'] is True
    assert payload['messages'][1]['is_favorite'] is False
    assert payload['messages'][1]['is_self'] is True
    assert payload['messages'][1]['group_read_count'] == 1
    assert len(payload['messages'][1]['group_readers']) == 1
    assert payload['messages'][1]['group_readers'][0]['user_id'] == 2
    assert len(payload['favorites']) == 1
    assert payload['favorites'][0]['message_id'] == 301
    assert any(
        event['name'] == 'messages_read'
        and event['payload'] == {'chat_id': chat_id, 'is_group': True}
        and event['kwargs'].get('room') == chat_id
        for event in emitted
    )


def test_group_info_and_update_title_for_admin(monkeypatch, tmp_path):
    db_path = tmp_path / 'group-chat-info-update-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = '2' * 64

    emitted = []
    monkeypatch.setattr(
        chat_routes.socketio,
        'emit',
        lambda name, payload=None, *args, **kwargs: emitted.append(
            {'name': name, 'payload': payload, 'args': args, 'kwargs': kwargs}
        ),
    )

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_online)
            VALUES
                (1, 'pk-1', 'alice', 'Alice', 1),
                (2, 'pk-2', 'bob', 'Bob', 0),
                (3, 'pk-3', 'carol', 'Carol', 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name, chat_type, created_by_user_id)
            VALUES (?, 'Crypto Team', 'group', 1)
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, ?, 'owner'),
                (2, ?, 'member'),
                (3, ?, 'member')
            ''',
            (chat_id, chat_id, chat_id),
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    info_response = client.get(f'/api/chats/group/info?chat_id={chat_id}')
    info_payload = info_response.get_json()
    assert info_response.status_code == 200
    assert info_payload['success'] is True
    assert info_payload['_group_profile'] is True
    assert info_payload['chat_id'] == chat_id
    assert info_payload['display_name'] == 'Crypto Team'
    assert info_payload['members_count'] == 3
    assert info_payload['can_edit_group'] is True
    assert info_payload['my_role'] == 'owner'
    assert len(info_payload['members']) == 3

    update_response = client.post(
        '/api/chats/group/update',
        json={'chat_id': chat_id, 'title': 'Crypto Core'},
    )
    update_payload = update_response.get_json()
    assert update_response.status_code == 200
    assert update_payload['success'] is True
    assert update_payload['chat_name'] == 'Crypto Core'

    with _connect(db_path) as conn:
        chat_row = conn.execute(
            'SELECT chat_name FROM chats WHERE chat_id = ?',
            (chat_id,),
        ).fetchone()
    assert chat_row['chat_name'] == 'Crypto Core'
    assert any(event['name'] == 'group_chat_updated' and event['kwargs'].get('room') == 'pk-2' for event in emitted)


def test_group_info_works_for_legacy_chat_with_empty_chat_type(monkeypatch, tmp_path):
    db_path = tmp_path / 'group-chat-legacy-empty-type-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = '3' * 64

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_online)
            VALUES
                (1, 'pk-1', 'alice', 'Alice', 1),
                (2, 'pk-2', 'bob', 'Bob', 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name, chat_type, created_by_user_id)
            VALUES (?, 'Legacy Team', '', 1)
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, ?, 'owner'),
                (2, ?, 'member')
            ''',
            (chat_id, chat_id),
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    info_response = client.get(f'/api/chats/group/info?chat_id={chat_id}')
    payload = info_response.get_json()

    assert info_response.status_code == 200
    assert payload['success'] is True
    assert payload['_group_profile'] is True
    assert payload['chat_id'] == chat_id
    assert payload['display_name'] == 'Legacy Team'


def test_group_update_description_set_role_and_leave(monkeypatch, tmp_path):
    db_path = tmp_path / 'group-chat-role-leave-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = '4' * 64

    emitted = []
    monkeypatch.setattr(
        chat_routes.socketio,
        'emit',
        lambda name, payload=None, *args, **kwargs: emitted.append(
            {'name': name, 'payload': payload, 'args': args, 'kwargs': kwargs}
        ),
    )

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
            INSERT INTO chats (chat_id, chat_name, chat_type, created_by_user_id)
            VALUES (?, 'Core Group', 'group', 1)
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, ?, 'owner'),
                (2, ?, 'member'),
                (3, ?, 'member')
            ''',
            (chat_id, chat_id, chat_id),
        )
        conn.commit()

    admin_client = _authed_client(app, 1, 'pk-1')
    update_response = admin_client.post(
        '/api/chats/group/update',
        json={
            'chat_id': chat_id,
            'title': 'Core Group Updated',
            'description': 'Engineering squad',
        },
    )
    assert update_response.status_code == 200
    assert update_response.get_json()['success'] is True

    promote_response = admin_client.post(
        '/api/chats/group/set_role',
        json={'chat_id': chat_id, 'target_user_id': 2, 'role': 'admin'},
    )
    assert promote_response.status_code == 200
    assert promote_response.get_json()['success'] is True

    member_client = _authed_client(app, 2, 'pk-2')
    leave_response = member_client.post(
        '/api/chats/group/leave',
        json={'chat_id': chat_id},
    )
    assert leave_response.status_code == 200
    assert leave_response.get_json()['success'] is True

    with _connect(db_path) as conn:
        chat_row = conn.execute(
            '''
            SELECT chat_name, chat_description
            FROM chats
            WHERE chat_id = ?
            ''',
            (chat_id,),
        ).fetchone()
        remaining_members = conn.execute(
            '''
            SELECT user_id
            FROM chat_members
            WHERE chat_id = ?
            ORDER BY user_id
            ''',
            (chat_id,),
        ).fetchall()

    assert chat_row['chat_name'] == 'Core Group Updated'
    assert chat_row['chat_description'] == 'Engineering squad'
    assert [int(row['user_id']) for row in remaining_members] == [1, 3]
    assert any(event['name'] == 'group_members_updated' for event in emitted)


def test_group_remove_member_requires_elevated_role(monkeypatch, tmp_path):
    db_path = tmp_path / 'group-chat-remove-member-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = '5' * 64

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'owner', 'Owner'),
                (2, 'pk-2', 'mod', 'Mod'),
                (3, 'pk-3', 'member', 'Member')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name, chat_type, created_by_user_id)
            VALUES (?, 'Ops', 'group', 1)
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, ?, 'owner'),
                (2, ?, 'moderator'),
                (3, ?, 'member')
            ''',
            (chat_id, chat_id, chat_id),
        )
        conn.commit()

    member_client = _authed_client(app, 3, 'pk-3')
    response = member_client.post(
        '/api/chats/group/remove_member',
        json={'chat_id': chat_id, 'target_user_id': 2},
    )
    assert response.status_code == 403

    moderator_client = _authed_client(app, 2, 'pk-2')
    response = moderator_client.post(
        '/api/chats/group/remove_member',
        json={'chat_id': chat_id, 'target_user_id': 3},
    )
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True

    with _connect(db_path) as conn:
        rows = conn.execute(
            '''
            SELECT user_id
            FROM chat_members
            WHERE chat_id = ?
            ORDER BY user_id
            ''',
            (chat_id,),
        ).fetchall()
    assert [int(row['user_id']) for row in rows] == [1, 2]


def test_group_permissions_update_allows_member_to_add_members(monkeypatch, tmp_path):
    db_path = tmp_path / 'group-chat-permissions-update-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = '7' * 64

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'owner', 'Owner'),
                (2, 'pk-2', 'member', 'Member'),
                (3, 'pk-3', 'target', 'Target')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name, chat_type, created_by_user_id)
            VALUES (?, 'Permissions', 'group', 1)
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, ?, 'owner'),
                (2, ?, 'member')
            ''',
            (chat_id, chat_id),
        )
        conn.commit()

    owner_client = _authed_client(app, 1, 'pk-1')
    permissions_response = owner_client.post(
        '/api/chats/group/update_permissions',
        json={
            'chat_id': chat_id,
            'group_permissions': {
                'members_can_send_messages': True,
                'members_can_send_media': True,
                'members_can_add_members': True,
                'members_can_pin_messages': False,
                'members_can_change_info': False,
                'slow_mode_seconds': 0,
            },
        },
    )
    permissions_payload = permissions_response.get_json()
    assert permissions_response.status_code == 200
    assert permissions_payload['success'] is True
    assert permissions_payload['group_permissions']['members_can_add_members'] is True

    member_client = _authed_client(app, 2, 'pk-2')
    add_response = member_client.post(
        '/api/chats/group/add_members',
        json={'chat_id': chat_id, 'member_user_ids': [3]},
    )
    add_payload = add_response.get_json()
    assert add_response.status_code == 200
    assert add_payload['success'] is True
    assert add_payload['added_member_ids'] == [3]

    with _connect(db_path) as conn:
        rows = conn.execute(
            '''
            SELECT user_id
            FROM chat_members
            WHERE chat_id = ?
            ORDER BY user_id
            ''',
            (chat_id,),
        ).fetchall()
    assert [int(row['user_id']) for row in rows] == [1, 2, 3]


def test_group_sanction_can_be_appealed_via_moderation_api(monkeypatch, tmp_path):
    db_path = tmp_path / 'group-chat-sanction-appeal-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = '6' * 64

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'owner', 'Owner'),
                (2, 'pk-2', 'member', 'Member')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name, chat_type, created_by_user_id)
            VALUES (?, 'Security', 'group', 1)
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, ?, 'owner'),
                (2, ?, 'member')
            ''',
            (chat_id, chat_id),
        )
        conn.commit()

    owner_client = _authed_client(app, 1, 'pk-1')
    target_client = _authed_client(app, 2, 'pk-2')

    sanction_response = owner_client.post(
        '/api/chats/group/sanctions',
        json={
            'chat_id': chat_id,
            'target_user_id': 2,
            'action_type': 'mute_temp',
            'duration_seconds': 600,
            'reason_code': 'flood',
            'note': 'slow mode violation',
        },
    )
    sanction_payload = sanction_response.get_json()
    assert sanction_response.status_code == 200
    assert sanction_payload['success'] is True
    assert sanction_payload['action_type'] == 'mute_temp'
    sanction_id = int(sanction_payload['sanction_id'])

    appeal_response = target_client.post(
        '/api/moderation/appeals',
        json={
            'sanction_id': sanction_id,
            'text': 'please review this sanction',
        },
    )
    appeal_payload = appeal_response.get_json()
    assert appeal_response.status_code == 200
    assert appeal_payload['success'] is True
    assert appeal_payload['state'] == 'submitted'
