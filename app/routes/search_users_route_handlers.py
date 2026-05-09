def _normalize_search_query(raw_query: str | None) -> str:
    query = str(raw_query or '').strip()
    if not query:
        return ''
    if query.startswith('@'):
        normalized_username = query.lstrip('@').strip().lower()
        if normalized_username:
            return normalized_username
    return query


def process_search_users(
    conn,
    *,
    user_id: int,
    raw_query: str | None,
    raw_limit,
    raw_offset,
    parse_int_func,
    build_search_users_payload_func,
    min_query_length: int,
    default_limit: int,
    max_limit: int,
    max_offset: int,
    like_pattern_func,
    get_safe_avatar_url_func,
):
    query = _normalize_search_query(raw_query)
    parsed_limit = parse_int_func(raw_limit)
    parsed_offset = parse_int_func(raw_offset)

    limit = parsed_limit if parsed_limit is not None else default_limit
    limit = max(1, min(limit, max_limit))
    offset = parsed_offset if parsed_offset is not None else 0
    offset = max(0, min(offset, max_offset))

    return build_search_users_payload_func(
        conn,
        user_id=user_id,
        query=query,
        limit=limit,
        offset=offset,
        min_query_length=min_query_length,
        like_pattern_func=like_pattern_func,
        get_safe_avatar_url_func=get_safe_avatar_url_func,
    )
