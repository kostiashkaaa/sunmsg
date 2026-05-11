def _get_value(obj, key, default=None):
    try:
        if hasattr(obj, 'get'):
            return obj.get(key, default)
        return obj[key]
    except (KeyError, IndexError, TypeError):
        return default


def _has_key(obj, key):
    try:
        if hasattr(obj, 'keys'):
            return key in obj.keys()
    except Exception:
        pass
    try:
        return key in obj
    except Exception:
        return False


def _is_self_view(viewer_id, user_id_val) -> bool:
    try:
        return viewer_id is not None and user_id_val is not None and int(viewer_id) == int(user_id_val)
    except (TypeError, ValueError):
        return False


def _is_contact_for_viewer(viewer_id, user_id_val) -> bool:
    if not viewer_id or not user_id_val:
        return False
    from app.database import get_db_connection

    conn = get_db_connection()
    try:
        contact = conn.execute(
            'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?',
            (viewer_id, user_id_val),
        ).fetchone()
    finally:
        conn.close()
    return bool(contact)


def get_safe_avatar_url(user, viewer_id=None):
    """
    Returns avatar_url only if visibility settings allow it.
    'user' should be a dict-like object with: avatar_url, avatar_visibility, id, is_contact (optional)
    """
    if not user:
        return None

    visibility = _get_value(user, 'avatar_visibility', 'all') or 'all'
    avatar_url = _get_value(user, 'avatar_url')
    user_id_val = _get_value(user, 'id')

    if visibility == 'nobody':
        return None
    if visibility == 'all':
        return avatar_url
    if visibility != 'contacts':
        return None

    if _is_self_view(viewer_id, user_id_val):
        return avatar_url
    if _has_key(user, 'is_contact'):
        return avatar_url if bool(_get_value(user, 'is_contact')) else None
    if _is_contact_for_viewer(viewer_id, user_id_val):
        return avatar_url
    return None
