from app.routes.call_routes import _parse_turn_urls


def test_parse_turn_urls_accepts_comma_separated_turn_and_turns_urls():
    urls = _parse_turn_urls(
        ' turn:turn.example.com:3478?transport=udp,'
        'turn:turn.example.com:3478?transport=tcp,'
        'turns:turn.example.com:5349?transport=tcp,'
        'https://example.com/not-turn '
    )

    assert urls == [
        'turn:turn.example.com:3478?transport=udp',
        'turn:turn.example.com:3478?transport=tcp',
        'turns:turn.example.com:5349?transport=tcp',
    ]
