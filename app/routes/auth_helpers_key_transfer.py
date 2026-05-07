import re
import time


KEY_TRANSFER_SESSION_TTL_SECONDS = 3 * 60
_KEY_TRANSFER_SESSION_ID_PATTERN = re.compile(r'^[A-Za-z0-9_-]{16,128}$')
_B64URL_PATTERN = re.compile(r'^[A-Za-z0-9_-]+$')


def is_valid_p256_jwk(value) -> bool:
    if not isinstance(value, dict):
        return False
    if str(value.get('kty') or '') != 'EC':
        return False
    if str(value.get('crv') or '') != 'P-256':
        return False
    x = str(value.get('x') or '').strip()
    y = str(value.get('y') or '').strip()
    if not x or not y:
        return False
    if len(x) > 200 or len(y) > 200:
        return False
    return bool(_B64URL_PATTERN.fullmatch(x) and _B64URL_PATTERN.fullmatch(y))


def is_valid_b64url_blob(value: str, *, max_len: int = 16384) -> bool:
    text = str(value or '').strip()
    if not text:
        return False
    if len(text) > max_len:
        return False
    return bool(_B64URL_PATTERN.fullmatch(text))


def is_valid_key_transfer_session_id(value: str) -> bool:
    return bool(_KEY_TRANSFER_SESSION_ID_PATTERN.fullmatch(str(value or '').strip()))


def cleanup_key_transfer_sessions(conn) -> None:
    now = int(time.time())
    conn.execute(
        '''
        DELETE FROM key_transfer_sessions
        WHERE expires_at <= ?
           OR (status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at <= ?)
        ''',
        (now, now - 60),
    )


def cleanup_login_key_transfer_sessions(conn) -> None:
    now = int(time.time())
    conn.execute(
        '''
        DELETE FROM key_transfer_login_sessions
        WHERE expires_at <= ?
           OR (status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at <= ?)
        ''',
        (now, now - 60),
    )


def clear_pending_login_qr(session_state) -> None:
    for key in (
        'pending_login_qr_session_id',
        'pending_login_qr_issued_at',
    ):
        session_state.pop(key, None)


def stage_pending_login_qr(session_state, session_id: str) -> None:
    clear_pending_login_qr(session_state)
    session_state['pending_login_qr_session_id'] = str(session_id or '').strip()
    session_state['pending_login_qr_issued_at'] = int(time.time())


def pending_login_qr_session_id(session_state) -> str:
    session_id = str(session_state.get('pending_login_qr_session_id') or '').strip()
    issued_at_raw = session_state.get('pending_login_qr_issued_at')
    if not session_id or not issued_at_raw:
        clear_pending_login_qr(session_state)
        return ''
    try:
        issued_at = int(issued_at_raw)
    except (TypeError, ValueError):
        clear_pending_login_qr(session_state)
        return ''
    if int(time.time()) - issued_at > KEY_TRANSFER_SESSION_TTL_SECONDS:
        clear_pending_login_qr(session_state)
        return ''
    if not is_valid_key_transfer_session_id(session_id):
        clear_pending_login_qr(session_state)
        return ''
    return session_id
