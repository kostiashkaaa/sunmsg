from app.services.apns import (
    apns_config,
    build_call_voip_payload,
    normalize_apns_environment,
    normalize_apns_token,
)


def test_normalize_apns_token_accepts_hex_and_strips_separators():
    raw = 'AA BB-' + ('cc' * 31)

    assert normalize_apns_token(raw) == 'aabb' + ('cc' * 31)


def test_normalize_apns_token_rejects_short_or_non_hex_values():
    assert normalize_apns_token('aa' * 31) is None
    assert normalize_apns_token('zz' * 32) is None


def test_apns_config_stays_disabled_without_required_credentials():
    cfg = apns_config({
        'APNS_ENABLED': True,
        'APNS_TEAM_ID': 'TEAMID1234',
        'APNS_KEY_ID': '',
        'APNS_BUNDLE_ID': 'ru.sunmsg.ios.dev',
        'APNS_PRIVATE_KEY': 'key',
        'APNS_ENVIRONMENT': 'production',
        'APNS_TIMEOUT_SECONDS': 7,
    })

    assert cfg['enabled'] is False
    assert cfg['topic'] == 'ru.sunmsg.ios.dev.voip'
    assert cfg['environment'] == 'production'
    assert cfg['host'] == 'api.push.apple.com'
    assert cfg['timeout'] == 7.0


def test_build_call_voip_payload_matches_pushkit_contract():
    payload = build_call_voip_payload(
        call_id='call-1',
        chat_id='chat-1',
        call_type='video',
        initiator_user_id=2,
        initiator_display_name='Alice',
        initiator_username='alice',
        initiator_avatar_url='/avatar.png',
    )

    assert payload == {
        'aps': {'content-available': 1},
        'kind': 'call',
        'call_id': 'call-1',
        'chat_id': 'chat-1',
        'call_type': 'video',
        'caller': {
            'user_id': 2,
            'display_name': 'Alice',
            'username': 'alice',
            'avatar_url': '/avatar.png',
        },
    }


def test_normalize_apns_environment_defaults_to_sandbox():
    assert normalize_apns_environment(None) == 'sandbox'
    assert normalize_apns_environment('prod') == 'production'
