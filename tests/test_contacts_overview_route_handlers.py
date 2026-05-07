from app.routes.contacts_overview_route_handlers import process_get_contacts


def test_process_get_contacts_returns_contacts():
    captured = {}

    def _fetch_contacts(user_id, conn, *, limit, language, include_self_contact):
        captured['user_id'] = user_id
        captured['limit'] = limit
        captured['language'] = language
        captured['include_self_contact'] = include_self_contact
        return [{'userId': 2}]

    result = process_get_contacts(
        object(),
        user_id=1,
        ui_language='en',
        limit=25,
        fetch_contacts_for_user_func=_fetch_contacts,
        normalize_language_func=lambda value, default='ru': value or default,
        logger_error_func=lambda message: None,
    )

    assert captured == {
        'user_id': 1,
        'limit': 25,
        'language': 'en',
        'include_self_contact': False,
    }
    assert result == {'status': 'ok', 'contacts': [{'userId': 2}]}


def test_process_get_contacts_maps_error_and_logs():
    logged = []

    def _raise(*args, **kwargs):
        raise RuntimeError('db fail')

    result = process_get_contacts(
        object(),
        user_id=1,
        ui_language='ru',
        limit=None,
        fetch_contacts_for_user_func=_raise,
        normalize_language_func=lambda value, default='ru': value or default,
        logger_error_func=lambda message: logged.append(message),
    )

    assert result == {'status': 'error'}
    assert logged == ['get_contacts error: db fail']
