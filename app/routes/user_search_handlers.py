def fetch_public_search_results(conn, *, user_id: int, query: str):
    users = conn.execute(
        '''
        SELECT u.id, u.username, u.display_name, u.public_key
        FROM users u
        WHERE (u.username LIKE ? OR u.display_name LIKE ?)
          AND u.is_public = 1
          AND u.id != ?
          AND NOT EXISTS (
              SELECT 1
              FROM block_list b
              WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
                 OR (b.blocker_id = u.id AND b.blocked_id = ?)
          )
        ''',
        (f'%{query}%', f'%{query}%', user_id, user_id, user_id),
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


def build_search_users_payload(
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
            '''
            SELECT id, username, display_name, public_key, avatar_url, avatar_visibility,
                   EXISTS(SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = users.id) as is_contact
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
            (user_id, key_pattern, clean_key_pattern, user_id, user_id, user_id, limit + 1, offset),
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

    broad_pattern = like_pattern_func(query)
    users = conn.execute(
        '''
        SELECT id, username, display_name, avatar_url, avatar_visibility,
               EXISTS(SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = users.id) as is_contact
        FROM users
        WHERE (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
          AND id != ?
          AND is_public = 1
          AND NOT EXISTS (
              SELECT 1
              FROM block_list b
              WHERE (b.blocker_id = ? AND b.blocked_id = users.id)
                 OR (b.blocker_id = users.id AND b.blocked_id = ?)
          )
        ORDER BY id ASC
        LIMIT ? OFFSET ?
        ''',
        (user_id, broad_pattern, broad_pattern, user_id, user_id, user_id, limit + 1, offset),
    ).fetchall()

    for user in users[:limit]:
        results.append(
            {
                'userId': user['id'],
                'user_id': user['id'],
                'username': user['username'],
                'display_name': user['display_name'],
                'avatar_url': get_safe_avatar_url_func(user, user_id),
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
