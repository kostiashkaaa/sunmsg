import logging
from datetime import datetime, timezone

from wtforms.validators import ValidationError

from app.sockets.validation import (
    clear_invalid_session_user,
    normalize_request_id,
    parse_db_utc_timestamp,
    positive_int,
    require_payload_dict,
    sanitize_message_type,
    socket_connect_csrf_ok,
    socket_csrf_ok,
)


def test_clear_invalid_session_user_removes_auth_keys_only():
    session_store = {
        'user_id': 7,
        'public_key_pem': 'pk-7',
        'other': 'keep-me',
    }

    clear_invalid_session_user(session_store)

    assert session_store == {'other': 'keep-me'}


def test_parse_db_utc_timestamp_handles_supported_shapes():
    assert parse_db_utc_timestamp(None) is None
    assert parse_db_utc_timestamp('') is None
    assert parse_db_utc_timestamp('bad-date') is None

    parsed_space = parse_db_utc_timestamp('2025-01-01 10:00:00')
    parsed_t = parse_db_utc_timestamp('2025-01-01T10:00:00')
    parsed_z = parse_db_utc_timestamp('2025-01-01T10:00:00Z')
    naive_dt = datetime(2025, 1, 1, 10, 0, 0)
    aware_dt = datetime(2025, 1, 1, 10, 0, 0, tzinfo=timezone.utc)

    assert parsed_space.tzinfo == timezone.utc
    assert parsed_t.tzinfo == timezone.utc
    assert parsed_z.tzinfo is not None
    assert parse_db_utc_timestamp(naive_dt).tzinfo == timezone.utc
    assert parse_db_utc_timestamp(aware_dt) == aware_dt


def test_payload_and_scalar_helpers():
    emitted = []

    assert require_payload_dict({'ok': True}, emit_func=lambda *_args, **_kwargs: emitted.append('x')) == {'ok': True}
    assert require_payload_dict('bad', emit_func=lambda name, payload: emitted.append((name, payload))) is None
    assert emitted == [('error', {'message': 'Некорректные данные socket-события.'})]

    assert positive_int('12') == 12
    assert positive_int('0') is None
    assert positive_int('x') is None

    assert normalize_request_id(' req-42 ') == 'req-42'
    assert normalize_request_id('') == ''
    assert normalize_request_id('x' * 73) == ''

    allowed = {'text', 'audio'}
    assert sanitize_message_type(' audio ', allowed_message_types=allowed) == 'audio'
    assert sanitize_message_type('video', allowed_message_types=allowed) == 'text'


def test_socket_csrf_ok_handles_missing_invalid_and_valid_tokens():
    logger = logging.getLogger('test_socket_csrf_ok')
    emitted = []

    def emit_func(name, payload):
        emitted.append((name, payload))

    assert socket_csrf_ok(
        {},
        validate_csrf_func=lambda token: None,
        emit_func=emit_func,
        logger=logger,
        user_id=1,
        validation_error_cls=ValidationError,
    ) is False
    assert emitted.pop() == ('error', {'message': 'Требуется CSRF-токен.'})

    assert socket_csrf_ok(
        {'csrf_token': 'bad'},
        validate_csrf_func=lambda token: (_ for _ in ()).throw(ValidationError('bad')),
        emit_func=emit_func,
        logger=logger,
        user_id=1,
        validation_error_cls=ValidationError,
    ) is False
    assert emitted.pop() == ('error', {'message': 'Недействительный CSRF-токен.'})

    assert socket_csrf_ok(
        {'csrf_token': 'boom'},
        validate_csrf_func=lambda token: (_ for _ in ()).throw(RuntimeError('boom')),
        emit_func=emit_func,
        logger=logger,
        user_id=1,
        validation_error_cls=ValidationError,
    ) is False
    assert emitted.pop() == ('error', {'message': 'Не удалось проверить CSRF-токен.'})

    assert socket_csrf_ok(
        {'csrf_token': 'ok'},
        validate_csrf_func=lambda token: None,
        emit_func=emit_func,
        logger=logger,
        user_id=1,
        validation_error_cls=ValidationError,
    ) is True


def test_socket_csrf_ok_preserves_request_id_on_error():
    logger = logging.getLogger('test_socket_csrf_ok_request_id')
    emitted = []

    assert socket_csrf_ok(
        {'request_id': 'client-123'},
        validate_csrf_func=lambda token: None,
        emit_func=lambda name, payload: emitted.append((name, payload)),
        logger=logger,
        user_id=1,
        validation_error_cls=ValidationError,
    ) is False

    assert emitted == [
        (
            'error',
            {
                'message': 'Требуется CSRF-токен.',
                'request_id': 'client-123',
            },
        ),
    ]


def test_socket_connect_csrf_ok_handles_missing_invalid_and_valid_tokens():
    logger = logging.getLogger('test_socket_connect_csrf_ok')

    assert socket_connect_csrf_ok(
        {},
        validate_csrf_func=lambda token: None,
        logger=logger,
        user_id=1,
        sid='sid-1',
        validation_error_cls=ValidationError,
    ) is False

    assert socket_connect_csrf_ok(
        {'csrf_token': 'bad'},
        validate_csrf_func=lambda token: (_ for _ in ()).throw(ValidationError('bad')),
        logger=logger,
        user_id=1,
        sid='sid-1',
        validation_error_cls=ValidationError,
    ) is False

    assert socket_connect_csrf_ok(
        {'csrf_token': 'boom'},
        validate_csrf_func=lambda token: (_ for _ in ()).throw(RuntimeError('boom')),
        logger=logger,
        user_id=1,
        sid='sid-1',
        validation_error_cls=ValidationError,
    ) is False

    assert socket_connect_csrf_ok(
        {'csrf_token': 'ok'},
        validate_csrf_func=lambda token: None,
        logger=logger,
        user_id=1,
        sid='sid-1',
        validation_error_cls=ValidationError,
    ) is True
