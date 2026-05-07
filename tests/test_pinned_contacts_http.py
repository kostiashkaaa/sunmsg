from app import create_app
from app.services.crypto import generate_chat_id

from tests._chat_contacts_http_helpers import _authed_client, _connect


def test_pin_unpin_and_reorder_pinned_chats_affect_contact_order(monkeypatch, tmp_path):
    db_path = tmp_path / 'pinned-chats-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id_a = generate_chat_id('pk-1', 'pk-2')
    chat_id_b = generate_chat_id('pk-1', 'pk-3')

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
            INSERT INTO messages (chat_id, sender_id, receiver_id, message, created_at)
            VALUES
                (?, 2, 1, 'older contact', '2025-01-01 10:00:00'),
                (?, 3, 1, 'newer contact', '2025-01-01 10:05:00')
            ''',
            (chat_id_a, chat_id_b),
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    response = client.get('/get_contacts')
    payload = response.get_json()
    assert response.status_code == 200
    user_contacts = [contact for contact in payload['contacts'] if int(contact['userId']) != 1]
    assert [contact['chatId'] for contact in user_contacts] == [chat_id_b, chat_id_a]

    response = client.post('/pin_chat', json={'chat_id': chat_id_a})
    assert response.status_code == 200
    assert response.get_json() == {'success': True, 'pin_order': 0}

    response = client.post('/pin_chat', json={'chat_id': chat_id_b})
    assert response.status_code == 200
    assert response.get_json() == {'success': True, 'pin_order': 1}

    response = client.post(
        '/reorder_pinned_chats',
        json={'chat_ids': [chat_id_b, 'missing-chat', chat_id_b]},
    )
    assert response.status_code == 200
    assert response.get_json() == {'success': True, 'chat_ids': [chat_id_b, chat_id_a]}

    response = client.get('/get_contacts')
    payload = response.get_json()
    assert response.status_code == 200
    user_contacts = [contact for contact in payload['contacts'] if int(contact['userId']) != 1]
    assert [contact['chatId'] for contact in user_contacts] == [chat_id_b, chat_id_a]
    assert [contact['is_pinned'] for contact in user_contacts] == [True, True]
    assert [contact['pin_order'] for contact in user_contacts] == [0, 1]

    response = client.post('/unpin_chat', json={'chat_id': chat_id_b})
    assert response.status_code == 200
    assert response.get_json() == {'success': True}

    response = client.get('/get_contacts')
    payload = response.get_json()
    assert response.status_code == 200
    user_contacts = [contact for contact in payload['contacts'] if int(contact['userId']) != 1]
    assert [contact['chatId'] for contact in user_contacts] == [chat_id_a, chat_id_b]
    assert [contact['is_pinned'] for contact in user_contacts] == [True, False]

    with _connect(db_path) as conn:
        pinned_rows = conn.execute(
            'SELECT chat_id, pin_order FROM pinned_chats WHERE user_id = 1 ORDER BY pin_order ASC'
        ).fetchall()

    assert [(row['chat_id'], row['pin_order']) for row in pinned_rows] == [(chat_id_a, 1)]
