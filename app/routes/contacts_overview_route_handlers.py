def process_get_contacts(  # noqa: PLR0913 - dependency-injected route handler contract
    conn,
    *,
    user_id: int,
    ui_language,
    limit,
    fetch_contacts_for_user_func,
    normalize_language_func,
    logger_error_func,
):
    try:
        contacts_list = fetch_contacts_for_user_func(
            user_id,
            conn,
            limit=limit,
            language=normalize_language_func(ui_language, default='ru'),
            include_self_contact=False,
        )
    except Exception as exc:
        logger_error_func(f"get_contacts error: {exc}")
        return {'status': 'error'}

    return {'status': 'ok', 'contacts': contacts_list}
