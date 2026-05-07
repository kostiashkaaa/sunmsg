from app import create_app
from app.services.crypto import generate_chat_id

from tests._chat_contacts_http_helpers import _authed_client, _capture_socket_emits, _connect


def test_decline_request_updates_status_and_emits_event(monkeypatch, tmp_path):
    db_path = tmp_path / 'decline-request-flow.db'
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

    emitted.clear()
    response = bob_client.post('/decline_request', json={'sender_public_key': 'pk-1'})

    assert response.status_code == 200
    assert response.get_json() == {'success': True}

    with _connect(db_path) as conn:
        row = conn.execute(
            'SELECT status FROM dialog_requests WHERE sender_id = 1 AND receiver_id = 2'
        ).fetchone()

    assert row['status'] == 'declined'
    assert len(emitted) == 1
    assert emitted[0]['name'] == 'dialog_request_updated'
    assert emitted[0]['kwargs'] == {'room': 'pk-1'}
    assert emitted[0]['payload']['sender_display_name'] == 'Bob'
    assert isinstance(emitted[0]['payload']['action'], str)
    assert emitted[0]['payload']['action']
    assert not any(event['name'] == 'you_are_blocked' for event in emitted)

def test_send_request_rejects_repeat_bursts_with_cooldown(monkeypatch, tmp_path):
    db_path = tmp_path / 'send-request-cooldown-http.db'
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

    first_response = alice_client.post('/send_request', json={'contact_user_id': 2})
    first_payload = first_response.get_json()
    assert first_response.status_code == 200
    assert first_payload['success'] is True
    assert len(emitted) == 1
    assert emitted[0]['name'] == 'new_dialog_request'

    emitted.clear()
    second_response = alice_client.post('/send_request', json={'contact_user_id': 2})
    second_payload = second_response.get_json()

    assert second_response.status_code == 429
    assert second_payload['success'] is False
    assert isinstance(second_payload['error'], str)
    assert int(second_payload['retry_after']) > 0
    assert emitted == []

    with _connect(db_path) as conn:
        row = conn.execute(
            'SELECT COUNT(*) AS cnt FROM dialog_requests WHERE sender_id = 1 AND receiver_id = 2 AND status = ?',
            ('pending',),
        ).fetchone()

    assert int(row['cnt']) == 1

def test_start_dialog_from_public_card_sends_request_or_opens_existing_chat(monkeypatch, tmp_path):
    db_path = tmp_path / 'public-user-card-start.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_public)
            VALUES
                (1, 'pk-1', 'alice', 'Alice', 1),
                (2, 'pk-2', 'bob', 'Bob', 1)
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    send_request_response = client.post('/u/bob/start')
    assert send_request_response.status_code == 302
    assert send_request_response.headers['Location'].endswith('/u/bob')

    with _connect(db_path) as conn:
        request_row = conn.execute(
            'SELECT 1 FROM dialog_requests WHERE sender_id = 1 AND receiver_id = 2'
        ).fetchone()
    assert request_row is not None

    with _connect(db_path) as conn:
        conn.execute('DELETE FROM dialog_requests')
        chat_id = generate_chat_id('pk-1', 'pk-2')
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, ?), (2, 1, ?)
            ''',
            (chat_id, chat_id),
        )
        conn.commit()

    open_chat_response = client.post('/u/bob/start')
    assert open_chat_response.status_code == 302
    assert open_chat_response.headers['Location'].endswith('/chat/bob')
