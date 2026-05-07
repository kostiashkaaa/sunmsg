from app import create_app

from tests._chat_contacts_http_helpers import _authed_client, _connect


def _seed_users(conn):
    conn.execute(
        '''
        INSERT INTO users (id, public_key, username, display_name)
        VALUES
            (1, 'pk-1', 'alice', 'Alice'),
            (2, 'pk-2', 'bob', 'Bob'),
            (99, 'pk-99', 'moderator', 'Moderator')
        '''
    )
    conn.commit()


def _grant_moderator_role(conn, *, user_id: int = 99):
    conn.execute(
        '''
        INSERT INTO moderation_user_roles (user_id, role)
        VALUES (?, 'moderator')
        ON CONFLICT(user_id, role) DO NOTHING
        ''',
        (int(user_id),),
    )
    conn.commit()


def test_support_request_guest_submit(monkeypatch, tmp_path):
    db_path = tmp_path / 'support-guest-submit.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = app.test_client()

    response = client.post(
        '/api/support/requests',
        json={
            'source_page': 'auth_login',
            'category': 'registration',
            'contact_email': 'guest@example.com',
            'subject': 'Cannot register',
            'message': 'Captcha keeps failing',
        },
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    request_id = int(payload['request_id'])
    assert request_id > 0

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT id, status, category, source_page, contact_email
            FROM support_requests
            WHERE id = ?
            ''',
            (request_id,),
        ).fetchone()
    assert row is not None
    assert int(row['id']) == request_id
    assert str(row['status']) == 'open'
    assert str(row['category']) == 'registration'
    assert str(row['source_page']) == 'auth_login'
    assert str(row['contact_email']) == 'guest@example.com'


def test_support_console_resolve_and_manual_user_action(monkeypatch, tmp_path):
    db_path = tmp_path / 'support-console-actions.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'MODERATOR_USER_IDS': '',
        },
    )

    with _connect(db_path) as conn:
        _seed_users(conn)
        _grant_moderator_role(conn, user_id=99)

    user_client = _authed_client(app, 1, 'pk-1')
    moderator_client = _authed_client(app, 99, 'pk-99')

    create_response = user_client.post(
        '/api/support/requests',
        json={
            'source_page': 'settings',
            'category': 'bug',
            'subject': 'UI lag',
            'message': 'List freezes when opening profile',
        },
    )
    create_payload = create_response.get_json()
    assert create_response.status_code == 200
    assert create_payload['success'] is True
    request_id = int(create_payload['request_id'])

    page_response = moderator_client.get('/moderation/console/support')
    assert page_response.status_code == 200
    html = page_response.get_data(as_text=True)
    assert 'Support Console' in html
    assert 'UI lag' in html

    resolve_response = moderator_client.post(
        f'/moderation/console/support/{request_id}/resolve',
        data={
            'status': 'resolved',
            'resolution_note': 'fixed in latest build',
        },
        follow_redirects=True,
    )
    assert resolve_response.status_code == 200
    assert 'Support request updated' in resolve_response.get_data(as_text=True)

    action_response = moderator_client.post(
        '/moderation/console/users/2/action',
        data={
            'action_type': 'ban_temp',
            'reason_code': 'manual_action',
            'duration_sec': '3600',
            'note': 'manual moderation',
            'lookup_query': 'bob',
        },
        follow_redirects=True,
    )
    assert action_response.status_code == 200
    assert 'User action applied' in action_response.get_data(as_text=True)
    action_html = action_response.get_data(as_text=True)
    assert 'Recent Sanctions' in action_html
    assert 'Recent Support Requests' in action_html
    assert 'manual_action' in action_html

    with _connect(db_path) as conn:
        support_row = conn.execute(
            'SELECT status, resolution_note FROM support_requests WHERE id = ?',
            (request_id,),
        ).fetchone()
        sanction_row = conn.execute(
            '''
            SELECT subject_type, subject_id, action_type, reason_code, status
            FROM moderation_sanctions
            WHERE subject_type = 'user' AND subject_id = '2'
            ORDER BY id DESC
            LIMIT 1
            '''
        ).fetchone()

    assert support_row is not None
    assert str(support_row['status']) == 'resolved'
    assert str(support_row['resolution_note']) == 'fixed in latest build'

    assert sanction_row is not None
    assert str(sanction_row['subject_type']) == 'user'
    assert str(sanction_row['subject_id']) == '2'
    assert str(sanction_row['action_type']) == 'ban_temp'
    assert str(sanction_row['reason_code']) == 'manual_action'
    assert str(sanction_row['status']) == 'active'

    lookup_response = moderator_client.get('/api/support/users/lookup?q=bob&include_history=1')
    lookup_payload = lookup_response.get_json()
    assert lookup_response.status_code == 200
    assert lookup_payload['success'] is True
    assert lookup_payload['users']
    first_user = lookup_payload['users'][0]
    assert 'moderation_summary' in first_user
    assert 'recent_sanctions' in first_user
    assert isinstance(first_user['recent_sanctions'], list)
