from pathlib import Path

from app.sockets.presence_handlers import handle_activity_update_event
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            hide_online_status INTEGER NOT NULL DEFAULT 0,
            is_online INTEGER NOT NULL DEFAULT 0,
            last_seen TEXT
        )
        '''
    )
    conn.commit()


def _logger():
    return type('Logger', (), {'debug': lambda self, msg, *args: None})()


def test_handle_activity_update_event_transitions_to_online_and_emits(tmp_path):
    db_path = tmp_path / 'socket-presence-online.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute('INSERT INTO users (id, hide_online_status, is_online) VALUES (1, 0, 0)')
        conn.commit()

    active_tabs = {}
    emitted_status = []

    def _count_active(pub):
        return len(active_tabs.get(pub, set()))

    def _add_active(pub, sid):
        active_tabs.setdefault(pub, set()).add(sid)

    def _remove_active(pub, sid):
        active_tabs.setdefault(pub, set()).discard(sid)

    handle_activity_update_event(
        {'active': True},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        request_sid='sid-1',
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        add_active_func=_add_active,
        remove_active_func=_remove_active,
        count_active_func=_count_active,
        count_connected_func=lambda pub: 1,
        get_db_connection_func=lambda: _connect(db_path),
        emit_chat_status_for_user_func=lambda conn, uid, payload: emitted_status.append((uid, payload)),
        utc_now_text_func=lambda: '2026-01-01 12:34:56',
        logger=_logger(),
    )

    with _connect(db_path) as conn:
        row = conn.execute('SELECT is_online FROM users WHERE id = 1').fetchone()

    assert int(row['is_online']) == 1
    assert emitted_status == [(1, {'public_key': 'pk-1', 'online': True})]


def test_handle_activity_update_event_transitions_to_offline_with_last_seen(tmp_path):
    db_path = tmp_path / 'socket-presence-offline.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO users (id, hide_online_status, is_online, last_seen) VALUES (1, 0, 1, 'old')")
        conn.commit()

    active_tabs = {'pk-1': {'sid-1'}}
    emitted_status = []

    def _count_active(pub):
        return len(active_tabs.get(pub, set()))

    def _add_active(pub, sid):
        active_tabs.setdefault(pub, set()).add(sid)

    def _remove_active(pub, sid):
        active_tabs.setdefault(pub, set()).discard(sid)

    handle_activity_update_event(
        {'active': False},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        request_sid='sid-1',
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        add_active_func=_add_active,
        remove_active_func=_remove_active,
        count_active_func=_count_active,
        count_connected_func=lambda pub: 0,
        get_db_connection_func=lambda: _connect(db_path),
        emit_chat_status_for_user_func=lambda conn, uid, payload: emitted_status.append((uid, payload)),
        utc_now_text_func=lambda: '2026-02-02 23:59:59',
        logger=_logger(),
    )

    with _connect(db_path) as conn:
        row = conn.execute('SELECT is_online, last_seen FROM users WHERE id = 1').fetchone()

    assert int(row['is_online']) == 0
    assert row['last_seen'] == '2026-02-02 23:59:59'
    assert emitted_status == [
        (1, {'public_key': 'pk-1', 'online': False, 'last_seen': '2026-02-02 23:59:59'})
    ]


def test_handle_activity_update_event_no_transition_does_not_write_or_emit(tmp_path):
    db_path = tmp_path / 'socket-presence-no-transition.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO users (id, hide_online_status, is_online, last_seen) VALUES (1, 0, 0, 'same')")
        conn.commit()

    active_tabs = {}
    emitted_status = []

    def _count_active(pub):
        return len(active_tabs.get(pub, set()))

    def _add_active(pub, sid):
        active_tabs.setdefault(pub, set()).add(sid)

    def _remove_active(pub, sid):
        active_tabs.setdefault(pub, set()).discard(sid)

    handle_activity_update_event(
        {'active': False},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        request_sid='sid-1',
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        add_active_func=_add_active,
        remove_active_func=_remove_active,
        count_active_func=_count_active,
        count_connected_func=lambda pub: 0,
        get_db_connection_func=lambda: _connect(db_path),
        emit_chat_status_for_user_func=lambda conn, uid, payload: emitted_status.append((uid, payload)),
        utc_now_text_func=lambda: 'never-used',
        logger=_logger(),
    )

    with _connect(db_path) as conn:
        row = conn.execute('SELECT is_online, last_seen FROM users WHERE id = 1').fetchone()

    assert int(row['is_online']) == 0
    assert row['last_seen'] == 'same'
    assert emitted_status == []
