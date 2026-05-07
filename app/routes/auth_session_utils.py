import secrets
import time


def issue_register_challenge(session_store) -> str:
    challenge = secrets.token_hex(32)
    session_store['register_challenge'] = challenge
    session_store['register_challenge_issued_at'] = int(time.time())
    return challenge


def consume_register_challenge(session_store):
    challenge = str(session_store.get('register_challenge') or '').strip()
    issued_at_raw = session_store.get('register_challenge_issued_at')
    session_store.pop('register_challenge', None)
    session_store.pop('register_challenge_issued_at', None)
    try:
        issued_at = int(issued_at_raw)
    except (TypeError, ValueError):
        issued_at = 0
    return challenge, issued_at
