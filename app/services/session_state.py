from __future__ import annotations

from app.db_backend import DatabaseError


def clear_invalid_session_user(session_state) -> None:
    session_state.pop('user_id', None)
    session_state.pop('public_key_pem', None)


def resolve_guest_ui_language(
    *,
    req,
    session_state,
    detect_auth_language,
    normalize_language,
) -> str:
    detected = detect_auth_language(req)
    resolved = normalize_language(session_state.get('guest_ui_language'), default=detected)
    session_state['guest_ui_language'] = resolved
    return resolved


def session_user_exists(
    *,
    user_id,
    public_key,
    get_db_connection,
    logger,
) -> bool:
    if not user_id or not public_key:
        return False

    conn = get_db_connection()
    try:
        try:
            row = conn.execute(
                'SELECT 1 FROM users WHERE id = ? AND public_key = ? LIMIT 1',
                (user_id, public_key),
            ).fetchone()
            return row is not None
        except DatabaseError:
            logger.exception('session user validation failed user_id=%s', user_id)
            return False
    finally:
        conn.close()
