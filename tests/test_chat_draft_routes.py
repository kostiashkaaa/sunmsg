from app import create_app
from app.routes import chat as chat_routes
from app.services.crypto import generate_chat_id

from tests._chat_contacts_http_helpers import _authed_client, _connect


def test_save_and_get_chat_draft_and_clear(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-draft-routes.db'
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
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    emitted = []
    monkeypatch.setattr(
        chat_routes.socketio,
        'emit',
        lambda name, payload=None, *args, **kwargs: emitted.append(
            {'name': name, 'payload': payload, 'args': args, 'kwargs': kwargs}
        ),
    )

    save_response = client.post(
        '/save_chat_draft',
        json={'chat_id': chat_id, 'draft_text': 'hello draft'},
    )
    save_payload = save_response.get_json()
    assert save_response.status_code == 200
    assert save_payload['success'] is True
    assert save_payload['has_draft'] is True
    assert save_payload['draft_text'] == 'hello draft'
    assert save_payload['updated_at']
    assert emitted and emitted[-1]['name'] == 'chat_draft_updated'
    assert emitted[-1]['payload']['chat_id'] == chat_id
    assert emitted[-1]['payload']['draft_text'] == 'hello draft'
    assert emitted[-1]['kwargs'].get('room') == 'pk-1'

    get_response = client.get(f'/get_chat_draft?chat_id={chat_id}')
    get_payload = get_response.get_json()
    assert get_response.status_code == 200
    assert get_payload['success'] is True
    assert get_payload['has_draft'] is True
    assert get_payload['draft_text'] == 'hello draft'

    clear_response = client.post(
        '/save_chat_draft',
        json={'chat_id': chat_id, 'draft_text': '   \n'},
    )
    clear_payload = clear_response.get_json()
    assert clear_response.status_code == 200
    assert clear_payload['success'] is True
    assert clear_payload['has_draft'] is False
    assert clear_payload['draft_text'] == ''
    assert emitted and emitted[-1]['name'] == 'chat_draft_updated'
    assert emitted[-1]['payload']['chat_id'] == chat_id
    assert emitted[-1]['payload']['has_draft'] is False
    assert emitted[-1]['payload']['draft_text'] == ''

    get_after_clear = client.get(f'/get_chat_draft?chat_id={chat_id}')
    get_after_clear_payload = get_after_clear.get_json()
    assert get_after_clear.status_code == 200
    assert get_after_clear_payload['success'] is True
    assert get_after_clear_payload['has_draft'] is False
    assert get_after_clear_payload['draft_text'] == ''


def test_chat_draft_requires_chat_membership(monkeypatch, tmp_path):
    db_path = tmp_path / 'chat-draft-routes-forbidden.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    chat_id = generate_chat_id('pk-1', 'pk-2')
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
            VALUES (1, 2, ?), (2, 1, ?)
            ''',
            (chat_id, chat_id),
        )
        conn.commit()

    client = _authed_client(app, 3, 'pk-3')

    denied_get = client.get(f'/get_chat_draft?chat_id={chat_id}')
    denied_get_payload = denied_get.get_json()
    assert denied_get.status_code == 403
    assert denied_get_payload['success'] is False

    denied_save = client.post(
        '/save_chat_draft',
        json={'chat_id': chat_id, 'draft_text': 'forbidden'},
    )
    denied_save_payload = denied_save.get_json()
    assert denied_save.status_code == 403
    assert denied_save_payload['success'] is False
