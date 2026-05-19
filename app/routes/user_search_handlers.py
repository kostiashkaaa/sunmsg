from app.services.user_privacy import can_find_by_public_key


def _coerce_bool_flag(value, *, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return int(value) != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {'1', 'true', 't', 'yes', 'on'}:
            return True
        if normalized in {'0', 'false', 'f', 'no', 'off'}:
            return False
    return bool(default)


def _build_relationship_status(user) -> str:
    if _coerce_bool_flag(user['is_contact'], default=False):
        return 'contact'
    if _coerce_bool_flag(user['has_pending_incoming_request'], default=False):
        return 'incoming_request'
    if _coerce_bool_flag(user['has_pending_outgoing_request'], default=False):
        return 'outgoing_request'
    return 'none'


def _build_search_result(user, *, viewer_id: int, get_safe_avatar_url_func, include_public_key: bool = False) -> dict:
    is_contact = _coerce_bool_flag(user['is_contact'], default=False)
    pending_incoming = _coerce_bool_flag(user['has_pending_incoming_request'], default=False)
    pending_outgoing = _coerce_bool_flag(user['has_pending_outgoing_request'], default=False)
    contact_chat_id = str(user['contact_chat_id'] or '').strip()
    result = {
        'userId': user['id'],
        'user_id': user['id'],
        'username': user['username'],
        'display_name': user['display_name'],
        'avatar_url': get_safe_avatar_url_func(user, viewer_id),
        'can_group_add_direct': _coerce_bool_flag(user['can_group_add_direct'], default=True),
        'is_contact': is_contact,
        'pending_incoming_request': pending_incoming,
        'pending_outgoing_request': pending_outgoing,
        'relationship_status': _build_relationship_status(user),
    }
    if contact_chat_id:
        result['chat_id'] = contact_chat_id
    if include_public_key or pending_incoming:
        result['public_key'] = user['public_key']
    return result


def fetch_public_search_results(conn, *, user_id: int, query: str):
    normalized_query = str(query or '').strip().lower()
    escaped_query = normalized_query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    contains_pattern = f'%{escaped_query}%'
    prefix_pattern = f'{escaped_query}%'
    users = conn.execute(
        '''
        SELECT u.id, u.username, u.display_name, u.public_key
        FROM users u
        WHERE (LOWER(u.username) LIKE ? ESCAPE '\\' OR LOWER(u.display_name) LIKE ? ESCAPE '\\')
          AND u.is_public = 1
          AND u.id != ?
          AND NOT EXISTS (
              SELECT 1
              FROM block_list b
              WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
                 OR (b.blocker_id = u.id AND b.blocked_id = ?)
          )
        ORDER BY
          CASE
            WHEN LOWER(u.username) = ? THEN 0
            WHEN LOWER(u.username) LIKE ? ESCAPE '\\' THEN 1
            WHEN LOWER(u.display_name) LIKE ? ESCAPE '\\' THEN 2
            ELSE 3
          END,
          LOWER(u.username),
          u.id ASC
        ''',
        (
            contains_pattern,
            contains_pattern,
            user_id,
            user_id,
            user_id,
            normalized_query,
            prefix_pattern,
            prefix_pattern,
        ),
    ).fetchall()

    return [
        {
            'userId': user['id'],
            'username': user['username'],
            'display_name': user['display_name'],
            'is_blocked': False,
        }
        for user in users
    ]


def build_search_users_payload(  # noqa: PLR0913 - dependency-injected payload builder contract
    conn,
    *,
    user_id: int,
    query: str,
    limit: int,
    offset: int,
    min_query_length: int,
    like_pattern_func,
    get_safe_avatar_url_func,
):
    group_add_direct_select_sql = '''
        CASE
            WHEN LOWER(COALESCE(users.group_invite_privacy, 'all')) = 'nobody' THEN 0
            WHEN LOWER(COALESCE(users.group_invite_privacy, 'all')) = 'contacts'
                 AND EXISTS(
                    SELECT 1
                    FROM contacts invite_contacts
                    WHERE invite_contacts.user_id = users.id
                      AND invite_contacts.contact_id = ?
                 ) THEN 1
            WHEN LOWER(COALESCE(users.group_invite_privacy, 'all')) = 'contacts' THEN 0
            ELSE 1
        END AS can_group_add_direct
    '''

    if not query:
        return {
            'success': True,
            'users': [],
            'results': [],
            'limit': limit,
            'offset': offset,
            'has_more': False,
            'min_query_length': min_query_length,
        }

    is_key_query = len(query) > 40 or 'BEGIN' in query or 'PUBLIC' in query
    results = []

    if is_key_query:
        clean_query = query.replace('-----BEGIN PUBLIC KEY-----', '').replace('-----END PUBLIC KEY-----', '')
        clean_query = clean_query.replace('\n', '').replace('\r', '').replace(' ', '').strip()
        key_pattern = like_pattern_func(query)
        clean_key_pattern = like_pattern_func(clean_query)
        users = conn.execute(
            f'''
            SELECT id, username, display_name, public_key, avatar_url, avatar_visibility,
                   public_key_search_privacy,
                   (SELECT contact_chat.chat_id
                    FROM contacts contact_chat
                    WHERE contact_chat.user_id = ? AND contact_chat.contact_id = users.id
                    LIMIT 1) as contact_chat_id,
                   EXISTS(SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = users.id) as is_contact,
                   EXISTS(
                       SELECT 1 FROM dialog_requests outgoing_requests
                       WHERE outgoing_requests.sender_id = ?
                         AND outgoing_requests.receiver_id = users.id
                         AND outgoing_requests.status = 'pending'
                   ) as has_pending_outgoing_request,
                   EXISTS(
                       SELECT 1 FROM dialog_requests incoming_requests
                       WHERE incoming_requests.sender_id = users.id
                         AND incoming_requests.receiver_id = ?
                         AND incoming_requests.status = 'pending'
                   ) as has_pending_incoming_request,
                   {group_add_direct_select_sql}
            FROM users
            WHERE (
                public_key LIKE ? ESCAPE '\\'
                OR REPLACE(REPLACE(REPLACE(public_key, '\n', ''), '\r', ''), ' ', '') LIKE ? ESCAPE '\\'
            )
              AND id != ?
              AND NOT EXISTS (
                  SELECT 1
                  FROM block_list b
                  WHERE (b.blocker_id = ? AND b.blocked_id = users.id)
                     OR (b.blocker_id = users.id AND b.blocked_id = ?)
              )
            ORDER BY id ASC
            LIMIT ? OFFSET ?
            ''',
            (
                user_id,
                user_id,
                user_id,
                user_id,
                user_id,
                key_pattern,
                clean_key_pattern,
                user_id,
                user_id,
                user_id,
                limit + 1,
                offset,
            ),
        ).fetchall()

        for user in users[:limit]:
            if not can_find_by_public_key(conn, owner_id=int(user['id']), viewer_id=user_id):
                continue
            results.append(
                _build_search_result(
                    user,
                    viewer_id=user_id,
                    get_safe_avatar_url_func=get_safe_avatar_url_func,
                    include_public_key=True,
                )
            )

        return {
            'success': True,
            'users': results,
            'results': results,
            'limit': limit,
            'offset': offset,
            'has_more': len(users) > limit,
            'min_query_length': min_query_length,
        }

    if len(query) < min_query_length:
        return {
            'success': True,
            'users': [],
            'results': [],
            'limit': limit,
            'offset': offset,
            'has_more': False,
            'min_query_length': min_query_length,
        }

    normalized_query = str(query or '').strip().lower()
    broad_pattern = like_pattern_func(normalized_query)
    prefix_pattern = broad_pattern[1:] if broad_pattern.startswith('%') else broad_pattern
    users = conn.execute(
        f'''
        SELECT id, username, display_name, public_key, avatar_url, avatar_visibility,
               (SELECT contact_chat.chat_id
                FROM contacts contact_chat
                WHERE contact_chat.user_id = ? AND contact_chat.contact_id = users.id
                LIMIT 1) as contact_chat_id,
               EXISTS(SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = users.id) as is_contact,
               EXISTS(
                   SELECT 1 FROM dialog_requests outgoing_requests
                   WHERE outgoing_requests.sender_id = ?
                     AND outgoing_requests.receiver_id = users.id
                     AND outgoing_requests.status = 'pending'
               ) as has_pending_outgoing_request,
               EXISTS(
                   SELECT 1 FROM dialog_requests incoming_requests
                   WHERE incoming_requests.sender_id = users.id
                     AND incoming_requests.receiver_id = ?
                     AND incoming_requests.status = 'pending'
               ) as has_pending_incoming_request,
               {group_add_direct_select_sql}
        FROM users
        WHERE (LOWER(username) LIKE ? ESCAPE '\\' OR LOWER(display_name) LIKE ? ESCAPE '\\')
          AND id != ?
          AND is_public = 1
          AND NOT EXISTS (
              SELECT 1
              FROM block_list b
              WHERE (b.blocker_id = ? AND b.blocked_id = users.id)
                 OR (b.blocker_id = users.id AND b.blocked_id = ?)
          )
        ORDER BY
          is_contact DESC,
          CASE
            WHEN LOWER(username) = ? THEN 0
            WHEN LOWER(username) LIKE ? ESCAPE '\\' THEN 1
            WHEN LOWER(display_name) LIKE ? ESCAPE '\\' THEN 2
            ELSE 3
          END,
          id ASC
        LIMIT ? OFFSET ?
        ''',
        (
            user_id,
            user_id,
            user_id,
            user_id,
            user_id,
            broad_pattern,
            broad_pattern,
            user_id,
            user_id,
            user_id,
            normalized_query,
            prefix_pattern,
            prefix_pattern,
            limit + 1,
            offset,
        ),
    ).fetchall()

    for user in users[:limit]:
        results.append(
            _build_search_result(
                user,
                viewer_id=user_id,
                get_safe_avatar_url_func=get_safe_avatar_url_func,
            )
        )

    return {
        'success': True,
        'users': results,
        'results': results,
        'limit': limit,
        'offset': offset,
        'has_more': len(users) > limit,
        'min_query_length': min_query_length,
    }
