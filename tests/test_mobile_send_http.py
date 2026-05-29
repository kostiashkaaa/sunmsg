import base64
import json
from pathlib import Path

from app import create_app
from app.services.crypto import generate_chat_id
from tests._pg_test_db import connect_test_db


_E2EE_CIPHERTEXT = base64.b64encode(b'c' * 32).decode('ascii')
_E2EE_IV = base64.b64encode(b'i' * 12).decode('ascii')
_E2EE_KEY = base64.b64encode(b'k' * 256).decode('ascii')
_E2EE_SIGNATURE = base64.b64encode(b's' * 256).decode('ascii')
_E2EE_DIRECT_MESSAGE = json.dumps({
    'encrypted_message': _E2EE_CIPHERTEXT,
    'encrypted_key_receiver': _E2EE_KEY,
    'encrypted_key_sender': _E2EE_KEY,
    'iv': _E2EE_IV,
    'signature': _E2EE_SIGNATURE,
})


def _seed_direct_chat(db_path: Path) -> str:
    chat_id = generate_chat_id('pk-1', 'pk-2')
    conn = connect_test_db(db_path)
    try:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice'),
                   (2, 'pk-2', 'bob', 'Bob')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name, chat_type)
            VALUES (?, 'Seeded chat', 'direct')
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, ?), (2, 1, ?)
            ''',
            (chat_id, chat_id),
        )
        conn.commit()
    finally:
        conn.close()
    return chat_id


def test_mobile_send_persists_socket_update_events(monkeypatch, tmp_path):
    db_path = tmp_path / 'mobile-send.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = _seed_direct_chat(db_path)
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    response = client.post('/api/mobile/send', json={
        'chat_id': chat_id,
        'message': _E2EE_DIRECT_MESSAGE,
        'message_type': 'text',
        'request_id': 'ios-req-1',
    })

    assert response.status_code == 200
    conn = connect_test_db(db_path)
    try:
        rows = conn.execute(
            '''
            SELECT event_type, chat_id, chat_pts, request_id, payload_json
            FROM chat_update_events
            WHERE chat_id = ?
            ORDER BY chat_pts
            ''',
            (chat_id,),
        ).fetchall()
    finally:
        conn.close()

    assert [row['event_type'] for row in rows] == ['receive_message', 'message_sent']
    assert [int(row['chat_pts']) for row in rows] == [1, 2]
    assert all(row['request_id'] == 'ios-req-1' for row in rows)
    assert all(json.loads(row['payload_json'])['chat_id'] == chat_id for row in rows)
