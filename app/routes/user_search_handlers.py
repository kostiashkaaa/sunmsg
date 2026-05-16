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
                   EXISTS(SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = users.id) as is_contact,
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
            results.append(
                {
                    'userId': user['id'],
                    'user_id': user['id'],
                    'username': user['username'],
                    'display_name': user['display_name'],
                    'public_key': user['public_key'],
                    'avatar_url': get_safe_avatar_url_func(user, user_id),
                    'can_group_add_direct': _coerce_bool_flag(user['can_group_add_direct'], default=True),
                }
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
        SELECT id, username, display_name, avatar_url, avatar_visibility,
               EXISTS(SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = users.id) as is_contact,
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
            {
                'userId': user['id'],
                'user_id': user['id'],
                'username': user['username'],
                'display_name': user['display_name'],
                'avatar_url': get_safe_avatar_url_func(user, user_id),
                'can_group_add_direct': _coerce_bool_flag(user['can_group_add_direct'], default=True),
            }
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
