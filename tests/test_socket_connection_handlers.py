from pathlib import Path

import pytest

from app.db_backend import DatabaseError
from app.sockets.connection_handlers import (
    handle_connect_event,
    handle_disconnect_event,
)
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_user_schema(conn):
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
    return type(
        'Logger',
        (),
        {
            'info': lambda self, msg, *args: None,
            'warning': lambda self, msg, *args: None,
            'error': lambda self, msg, *args: None,
        },
    )()


def test_handle_connect_event_requires_authentication():
    clear_calls = []

    with pytest.raises(ConnectionRefusedError, match='authentication required'):
        handle_connect_event(
            None,
            session_store={},
            request_sid='sid-1',
            clear_invalid_session_user_func=lambda: clear_calls.append('clear'),
            socket_connect_csrf_ok_func=lambda auth: True,
            get_db_connection_func=lambda: None,
            join_room_func=lambda room: None,
            add_connected_func=lambda pub, sid: 0,
            collect_and_mark_delivered_func=lambda conn, uid: [],
            emit_delivered_events_func=lambda rows: None,
            logger=_logger(),
            database_error_cls=DatabaseError,
            connection_refused_error_cls=ConnectionRefusedError,
        )

    assert clear_calls == ['clear']


def test_handle_connect_event_rejects_invalid_csrf():
    with pytest.raises(ConnectionRefusedError, match='invalid csrf token'):
        handle_connect_event(
            None,
            session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
            request_sid='sid-1',
            clear_invalid_session_user_func=lambda: None,
            socket_connect_csrf_ok_func=lambda auth: False,
            get_db_connection_func=lambda: None,
            join_room_func=lambda room: None,
            add_connected_func=lambda pub, sid: 0,
            collect_and_mark_delivered_func=lambda conn, uid: [],
            emit_delivered_events_func=lambda rows: None,
            logger=_logger(),
            database_error_cls=DatabaseError,
            connection_refused_error_cls=ConnectionRefusedError,
        )


def test_handle_connect_event_rejects_ip_connect_flood(tmp_path):
    db_path = tmp_path / 'socket-connection-connect-ip-limit.db'
    with _connect(db_path) as conn:
        _prepare_user_schema(conn)
        conn.execute('INSERT INTO users (id, hide_online_status) VALUES (1, 0)')
        conn.commit()

    with pytest.raises(ConnectionRefusedError, match='connect rate limit exceeded'):
        handle_connect_event(
            None,
            session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
            request_sid='sid-1',
            request_remote_addr='203.0.113.9',
            clear_invalid_session_user_func=lambda: None,
            socket_connect_csrf_ok_func=lambda auth: True,
            socket_connect_ip_rate_ok_func=lambda ip, *, limit, window_seconds: False,
            socket_connect_ip_limit=1,
            socket_connect_ip_window_seconds=60,
            get_db_connection_func=lambda: _connect(db_path),
            join_room_func=lambda room: None,
            count_connected_func=lambda pub: 0,
            add_connected_func=lambda pub, sid: 0,
            max_connections_per_user=3,
            collect_and_mark_delivered_func=lambda conn, uid: [],
            emit_delivered_events_func=lambda rows: None,
            logger=_logger(),
            database_error_cls=DatabaseError,
            connection_refused_error_cls=ConnectionRefusedError,
        )


def test_handle_connect_event_rejects_too_many_tabs(tmp_path):
    db_path = tmp_path / 'socket-connection-connect-tab-cap.db'
    with _connect(db_path) as conn:
        _prepare_user_schema(conn)
        conn.execute('INSERT INTO users (id, hide_online_status) VALUES (1, 0)')
        conn.commit()

    joined = []
    added = []

    with pytest.raises(ConnectionRefusedError, match='too many concurrent connections'):
        handle_connect_event(
            None,
            session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
            request_sid='sid-1',
            clear_invalid_session_user_func=lambda: None,
            socket_connect_csrf_ok_func=lambda auth: True,
            socket_connect_ip_rate_ok_func=lambda ip, *, limit, window_seconds: True,
            socket_connect_ip_limit=10,
            socket_connect_ip_window_seconds=60,
            get_db_connection_func=lambda: _connect(db_path),
            join_room_func=lambda room: joined.append(room),
            count_connected_func=lambda pub: 3,
            add_connected_func=lambda pub, sid: added.append((pub, sid)) or 4,
            max_connections_per_user=3,
            collect_and_mark_delivered_func=lambda conn, uid: [],
            emit_delivered_events_func=lambda rows: None,
            logger=_logger(),
            database_error_cls=DatabaseError,
            connection_refused_error_cls=ConnectionRefusedError,
        )

    assert joined == []
    assert added == []


def test_handle_connect_event_success_joins_and_emits_delivered(tmp_path):
    db_path = tmp_path / 'socket-connection-connect-ok.db'
    with _connect(db_path) as conn:
        _prepare_user_schema(conn)
        conn.execute('INSERT INTO users (id, hide_online_status) VALUES (1, 0)')
        conn.commit()

    joined = []
    added = []
    delivered = []

    handle_connect_event(
        None,
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        request_sid='sid-1',
        clear_invalid_session_user_func=lambda: None,
        socket_connect_csrf_ok_func=lambda auth: True,
        get_db_connection_func=lambda: _connect(db_path),
        join_room_func=lambda room: joined.append(room),
        add_connected_func=lambda pub, sid: added.append((pub, sid)) or 1,
        collect_and_mark_delivered_func=lambda conn, uid: [{'message_id': 42}],
        emit_delivered_events_func=lambda rows: delivered.append(rows),
        logger=_logger(),
        database_error_cls=DatabaseError,
        connection_refused_error_cls=ConnectionRefusedError,
    )

    assert joined == ['pk-1', 'user_1']
    assert added == [('pk-1', 'sid-1')]
    assert delivered == [[{'message_id': 42}]]


def test_handle_connect_event_rejects_missing_user_and_clears_session(tmp_path):
    db_path = tmp_path / 'socket-connection-connect-missing-user.db'
    with _connect(db_path) as conn:
        _prepare_user_schema(conn)

    clear_calls = []

    with pytest.raises(ConnectionRefusedError, match='user not found'):
        handle_connect_event(
            None,
            session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
            request_sid='sid-1',
            clear_invalid_session_user_func=lambda: clear_calls.append('clear'),
            socket_connect_csrf_ok_func=lambda auth: True,
            get_db_connection_func=lambda: _connect(db_path),
            join_room_func=lambda room: None,
            add_connected_func=lambda pub, sid: 0,
            collect_and_mark_delivered_func=lambda conn, uid: [],
            emit_delivered_events_func=lambda rows: None,
            logger=_logger(),
            database_error_cls=DatabaseError,
            connection_refused_error_cls=ConnectionRefusedError,
        )

    assert clear_calls == ['clear']


def test_handle_disconnect_event_updates_offline_and_emits_status(tmp_path):
    db_path = tmp_path / 'socket-connection-disconnect-offline.db'
    with _connect(db_path) as conn:
        _prepare_user_schema(conn)
        conn.execute('INSERT INTO users (id, hide_online_status, is_online) VALUES (1, 0, 1)')
        conn.commit()

    connected_tabs = {'pk-1': {'sid-1'}}
    active_tabs = {'pk-1': {'sid-1'}}
    left_rooms = []
    emitted_status = []

    def _count_active(pub):
        return len(active_tabs.get(pub, set()))

    def _remove_active(pub, sid):
        active_tabs.setdefault(pub, set()).discard(sid)

    def _remove_connected(pub, sid):
        connected_tabs.setdefault(pub, set()).discard(sid)

    def _count_connected(pub):
        return len(connected_tabs.get(pub, set()))

    handle_disconnect_event(
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        request_sid='sid-1',
        leave_room_func=lambda room: left_rooms.append(room),
        count_active_func=_count_active,
        remove_connected_func=_remove_connected,
        remove_active_func=_remove_active,
        count_connected_func=_count_connected,
        get_db_connection_func=lambda: _connect(db_path),
        emit_chat_status_for_user_func=lambda conn, uid, payload: emitted_status.append((uid, payload)),
        utc_now_text_func=lambda: '2026-03-03 03:03:03',
        logger=_logger(),
    )

    with _connect(db_path) as conn:
        row = conn.execute('SELECT is_online, last_seen FROM users WHERE id = 1').fetchone()

    assert left_rooms == ['pk-1', 'user_1']
    assert int(row['is_online']) == 0
    assert row['last_seen'] == '2026-03-03 03:03:03'
    assert emitted_status == [
        (1, {'public_key': 'pk-1', 'online': False, 'last_seen': '2026-03-03 03:03:03'})
    ]


def test_handle_disconnect_event_skips_when_session_missing():
    left_rooms = []

    handle_disconnect_event(
        session_store={},
        request_sid='sid-1',
        leave_room_func=lambda room: left_rooms.append(room),
        count_active_func=lambda pub: 0,
        remove_connected_func=lambda pub, sid: None,
        remove_active_func=lambda pub, sid: None,
        count_connected_func=lambda pub: 0,
        get_db_connection_func=lambda: None,
        emit_chat_status_for_user_func=lambda conn, uid, payload: None,
        utc_now_text_func=lambda: '2026-03-03 03:03:03',
        logger=_logger(),
    )

    assert left_rooms == []
