from app.routes.auth_session_utils import consume_register_challenge, issue_register_challenge


def test_issue_register_challenge_sets_session_fields():
    session_store = {}

    challenge = issue_register_challenge(session_store)

    assert isinstance(challenge, str) and challenge
    assert session_store['register_challenge'] == challenge
    assert isinstance(session_store['register_challenge_issued_at'], int)


def test_consume_register_challenge_returns_values_and_clears_session():
    session_store = {
        'register_challenge': ' challenge-value ',
        'register_challenge_issued_at': '12345',
        'keep': 'x',
    }

    challenge, issued_at = consume_register_challenge(session_store)

    assert challenge == 'challenge-value'
    assert issued_at == 12345
    assert 'register_challenge' not in session_store
    assert 'register_challenge_issued_at' not in session_store
    assert session_store['keep'] == 'x'


def test_consume_register_challenge_handles_missing_or_invalid_timestamp():
    session_store = {'register_challenge': None, 'register_challenge_issued_at': 'bad'}

    challenge, issued_at = consume_register_challenge(session_store)

    assert challenge == ''
    assert issued_at == 0
    assert session_store == {}
