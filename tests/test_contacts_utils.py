from datetime import datetime, timedelta

from app.routes.contacts_utils import (
    ENCRYPTED_PREVIEW_LOADING_TOKEN,
    build_initial_last_message_preview,
    canonical_username,
    format_sidebar_time,
    is_encrypted_message_payload,
    like_pattern,
    parse_int,
)


def test_is_encrypted_message_payload_detection():
    assert is_encrypted_message_payload('{"encrypted_message":"x"}') is True
    assert is_encrypted_message_payload(' {"encrypted_message":"x"} ') is True
    assert is_encrypted_message_payload('plain-text') is False
    assert is_encrypted_message_payload(None) is False


def test_format_sidebar_time_for_today_yesterday_and_older():
    now = datetime.now()
    today_raw = now.strftime('%Y-%m-%d %H:%M:%S')
    yesterday_raw = (now - timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S')
    this_year_old_raw = (now - timedelta(days=10)).strftime('%Y-%m-%d %H:%M:%S')
    previous_year_raw = now.replace(year=now.year - 1).strftime('%Y-%m-%d %H:%M:%S')

    assert format_sidebar_time(today_raw, language='ru') == now.strftime('%H:%M')
    assert format_sidebar_time(yesterday_raw, language='ru') == 'Вчера'
    assert format_sidebar_time(yesterday_raw, language='en') == 'Yesterday'
    assert format_sidebar_time(this_year_old_raw, language='ru') == (now - timedelta(days=10)).strftime('%d.%m')
    assert format_sidebar_time(previous_year_raw, language='ru') == now.replace(year=now.year - 1).strftime('%d.%m.%Y')
    assert format_sidebar_time('bad-date', language='ru') == ''
    assert format_sidebar_time('', language='ru') == ''


def test_build_initial_last_message_preview_states():
    assert build_initial_last_message_preview(
        'hello',
        blocked_by_me=True,
        blocked_me=False,
        language='ru',
    ) == '🚫 Вы заблокировали пользователя'
    assert build_initial_last_message_preview(
        'hello',
        blocked_by_me=False,
        blocked_me=True,
        language='en',
    ) == '🚫 You are blocked'
    assert build_initial_last_message_preview(
        '{"encrypted_message":"x"}',
        blocked_by_me=False,
        blocked_me=False,
        language='en',
    ) == ENCRYPTED_PREVIEW_LOADING_TOKEN
    assert build_initial_last_message_preview(
        'plain',
        blocked_by_me=False,
        blocked_me=False,
        language='ru',
    ) == 'plain'


def test_parse_int_like_pattern_and_canonical_username():
    assert parse_int('10') == 10
    assert parse_int('-3') == -3
    assert parse_int('bad') is None
    assert parse_int(None) is None

    assert like_pattern('ab%_c\\d') == '%ab\\%\\_c\\\\d%'
    assert canonical_username('  Alice_01 ') == 'alice_01'
