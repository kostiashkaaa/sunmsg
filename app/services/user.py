def get_safe_avatar_url(user, viewer_id=None):
    """
    Returns avatar_url only if visibility settings allow it.
    'user' should be a dict-like object with: avatar_url, avatar_visibility, id, is_contact (optional)
    """
    if not user:
        return None
        
    def get_val(obj, key, default=None):
        try:
            if hasattr(obj, 'get'):
                return obj.get(key, default)
            return obj[key]
        except (KeyError, IndexError, TypeError):
            return default

    def has_key(obj, key):
        try:
            if hasattr(obj, 'keys'):
                return key in obj.keys()
        except Exception:
            pass
        try:
            return key in obj
        except Exception:
            return False

    vis = get_val(user, 'avatar_visibility', 'all') or 'all'
    avatar_url = get_val(user, 'avatar_url')
    user_id_val = get_val(user, 'id')

    if vis == 'nobody':
        return None
    
    if vis == 'all':
        return avatar_url
        
    if vis == 'contacts':
        # Always show own avatar.
        try:
            if viewer_id is not None and user_id_val is not None and int(viewer_id) == int(user_id_val):
                return avatar_url
        except (TypeError, ValueError):
            pass

        # If caller already resolved relation, avoid extra DB round-trip.
        if has_key(user, 'is_contact'):
            return avatar_url if bool(get_val(user, 'is_contact')) else None

        # Fallback check if viewer/contact relation was not supplied.
        if viewer_id and user_id_val:
            from app.database import get_db_connection
            conn = get_db_connection()
            try:
                contact = conn.execute(
                    'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?',
                    (viewer_id, user_id_val)
                ).fetchone()
            finally:
                conn.close()
            if contact:
                return avatar_url
            
    return None
