import time


PENDING_TOTP_SETUP_TTL_SECONDS = 10 * 60


def clear_pending_totp(session_state) -> None:
    for key in (
        'pending_totp_user_id',
        'pending_totp_public_key',
        'pending_totp_remember',
        'pending_totp_issued_at',
    ):
        session_state.pop(key, None)


def clear_pending_totp_setup(session_state) -> None:
    for key in (
        'pending_totp_setup_user_id',
        'pending_totp_setup_secret',
        'pending_totp_setup_issued_at',
    ):
        session_state.pop(key, None)


def stage_pending_totp_setup(session_state, *, user_id: int, secret: str) -> None:
    clear_pending_totp_setup(session_state)
    session_state['pending_totp_setup_user_id'] = int(user_id)
    session_state['pending_totp_setup_secret'] = str(secret or '').strip()
    session_state['pending_totp_setup_issued_at'] = int(time.time())


def pending_totp_setup_context(session_state, *, user_id: int | None = None):
    pending_user_id = session_state.get('pending_totp_setup_user_id')
    pending_secret = str(session_state.get('pending_totp_setup_secret') or '').strip()
    issued_at_raw = session_state.get('pending_totp_setup_issued_at')
    if not pending_user_id or not pending_secret or not issued_at_raw:
        clear_pending_totp_setup(session_state)
        return None
    try:
        issued_at = int(issued_at_raw)
        pending_user_id = int(pending_user_id)
    except (TypeError, ValueError):
        clear_pending_totp_setup(session_state)
        return None
    if user_id is not None and pending_user_id != int(user_id):
        clear_pending_totp_setup(session_state)
        return None
    if int(time.time()) - issued_at > PENDING_TOTP_SETUP_TTL_SECONDS:
        clear_pending_totp_setup(session_state)
        return None
    return {
        'user_id': pending_user_id,
        'secret': pending_secret,
    }
