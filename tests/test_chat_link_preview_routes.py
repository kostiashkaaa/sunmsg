from app import create_app
from app.routes.chat_link_preview_routes import (
    _socket_create_connection_address,
    resolve_link_preview_payload,
)


def _noop_persist_link_preview_payload(*args, **kwargs):
    return None


def _empty_persisted_link_preview(*args, **kwargs):
    return None


def _disable_persistent_link_preview_store(monkeypatch):
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes.persist_link_preview_payload',
        _noop_persist_link_preview_payload,
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes.load_persisted_link_preview',
        _empty_persisted_link_preview,
    )


def test_resolve_link_preview_payload_rejects_invalid_url():
    payload, status = resolve_link_preview_payload('not-a-link')
    assert status == 400
    assert payload['success'] is False
    assert payload['error'] == 'invalid_url'


def test_resolve_link_preview_payload_rejects_forbidden_host(monkeypatch):
    _disable_persistent_link_preview_store(monkeypatch)
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_hostname',
        lambda hostname: False,
    )

    payload, status = resolve_link_preview_payload('https://example.com')
    assert status == 400
    assert payload == {'success': False, 'error': 'forbidden_host'}


def test_resolve_link_preview_payload_parses_meta_and_caches(monkeypatch):
    _disable_persistent_link_preview_store(monkeypatch)
    calls = {'fetch': 0}

    def fake_fetch(url):
        calls['fetch'] += 1
        return (
            '<html><head>'
            '<title>Fallback title</title>'
            '<meta property="og:title" content="Preview title">'
            '<meta property="og:description" content="Preview description">'
            '<meta property="og:site_name" content="Preview site">'
            '</head><body></body></html>',
            url,
        )

    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_hostname',
        lambda hostname: True,
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._hostname_resolves_public_only',
        lambda hostname, port=443: True,
    )
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_CACHE', {})
    monkeypatch.setattr('app.routes.chat_link_preview_routes._fetch_preview_html', fake_fetch)

    first_payload, first_status = resolve_link_preview_payload('https://example.com/path')
    second_payload, second_status = resolve_link_preview_payload('https://example.com/path')

    assert first_status == 200
    assert second_status == 200
    assert first_payload['success'] is True
    assert first_payload['title'] == 'Preview title'
    assert first_payload['description'] == 'Preview description'
    assert first_payload['site_name'] == 'Preview site'
    assert first_payload['has_meta'] is True
    assert second_payload == first_payload
    assert calls['fetch'] == 1


def test_resolve_link_preview_payload_uses_persisted_cache_before_network(monkeypatch):
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes.persist_link_preview_payload',
        _noop_persist_link_preview_payload,
    )
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_CACHE', {})
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_url',
        lambda url: True,
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes.load_persisted_link_preview',
        lambda normalized_url, *, schema_version: {
            'success': True,
            'url': normalized_url,
            'hostname': 'example.com',
            'site_name': 'Example',
            'title': 'Persisted',
            'description': 'Persisted payload',
            'image_url': 'https://example.com/favicon.ico',
            'image_width': 0,
            'image_height': 0,
            'image_aspect_ratio': '1.7778',
            'image_layout': 'compact',
            'has_meta': True,
        },
    )

    def _unexpected_fetch(url):
        raise AssertionError('network fetch must not run when persisted cache exists')

    monkeypatch.setattr('app.routes.chat_link_preview_routes._fetch_preview_html', _unexpected_fetch)

    payload, status = resolve_link_preview_payload('https://example.com/persisted')
    assert status == 200
    assert payload['success'] is True
    assert payload['title'] == 'Persisted'


def test_resolve_link_preview_payload_retries_after_empty_meta_cache_ttl(monkeypatch):
    _disable_persistent_link_preview_store(monkeypatch)
    calls = {'fetch': 0}
    now = {'value': 10_000.0}

    def fake_fetch(url):
        calls['fetch'] += 1
        if calls['fetch'] == 1:
            return ('<html><head></head><body></body></html>', url)
        return (
            '<html><head>'
            '<meta property="og:title" content="Recovered title">'
            '<meta property="og:description" content="Recovered description">'
            '</head></html>',
            url,
        )

    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_CACHE', {})
    monkeypatch.setattr('app.routes.chat_link_preview_routes._fetch_preview_html', fake_fetch)
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_url',
        lambda url: True,
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes.time.time',
        lambda: float(now['value']),
    )

    first_payload, first_status = resolve_link_preview_payload('https://example.com/recover')
    assert first_status == 200
    assert first_payload['has_meta'] is False
    assert calls['fetch'] == 1

    # Empty-meta cache entry should expire quickly.
    now['value'] += 60

    second_payload, second_status = resolve_link_preview_payload('https://example.com/recover')
    assert second_status == 200
    assert second_payload['has_meta'] is True
    assert second_payload['title'] == 'Recovered title'
    assert calls['fetch'] == 2


def test_resolve_link_preview_payload_uses_host_budget_before_network(monkeypatch):
    _disable_persistent_link_preview_store(monkeypatch)
    calls = {'fetch': 0}

    def fake_fetch(url):
        calls['fetch'] += 1
        return (
            '<html><head><meta property="og:title" content="Allowed once"></head></html>',
            url,
        )

    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_CACHE', {})
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_HOST_BUDGET', {})
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_HOST_BUDGET_MAX_FETCHES', 1)
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_url',
        lambda url: True,
    )
    monkeypatch.setattr('app.routes.chat_link_preview_routes._fetch_preview_html', fake_fetch)

    first_payload, first_status = resolve_link_preview_payload('https://example.com/one')
    second_payload, second_status = resolve_link_preview_payload('https://example.com/two')

    assert first_status == 200
    assert first_payload['has_meta'] is True
    assert second_status == 200
    assert second_payload['success'] is True
    assert second_payload['has_meta'] is False
    assert calls['fetch'] == 1


def test_resolve_link_preview_payload_uses_compact_layout_for_portrait_images(monkeypatch):
    _disable_persistent_link_preview_store(monkeypatch)
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_CACHE', {})
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_url',
        lambda url: True,
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._fetch_preview_html',
        lambda url: (
            '<html><head>'
            '<meta property="og:title" content="Listing">'
            '<meta property="og:image" content="https://example.com/listing.jpg">'
            '<meta property="og:image:width" content="1080">'
            '<meta property="og:image:height" content="1920">'
            '</head></html>',
            'https://example.com/listing',
        ),
    )

    payload, status = resolve_link_preview_payload('https://example.com/listing')
    assert status == 200
    assert payload['success'] is True
    assert payload['image_layout'] == 'compact'
    assert payload['image_aspect_ratio'] == '0.5625'


def test_resolve_link_preview_payload_keeps_full_layout_for_wide_images(monkeypatch):
    _disable_persistent_link_preview_store(monkeypatch)
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_CACHE', {})
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_url',
        lambda url: True,
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._fetch_preview_html',
        lambda url: (
            '<html><head>'
            '<meta property="og:title" content="Wide article">'
            '<meta property="og:image" content="https://example.com/wide.jpg">'
            '<meta property="og:image:width" content="1600">'
            '<meta property="og:image:height" content="900">'
            '</head></html>',
            'https://example.com/wide',
        ),
    )

    payload, status = resolve_link_preview_payload('https://example.com/wide')
    assert status == 200
    assert payload['success'] is True
    assert payload['image_layout'] == 'full'


def test_resolve_link_preview_payload_rejects_forbidden_redirect_target(monkeypatch):
    _disable_persistent_link_preview_store(monkeypatch)
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_CACHE', {})
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_url',
        lambda url: not str(url or '').startswith('http://127.0.0.1'),
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._fetch_preview_html',
        lambda url: ('<html><head><title>ok</title></head></html>', 'http://127.0.0.1/internal'),
    )

    payload, status = resolve_link_preview_payload('https://example.com')
    assert status == 400
    assert payload == {'success': False, 'error': 'forbidden_host'}


def test_link_preview_image_rejects_forbidden_redirect_target(monkeypatch, tmp_path):
    _disable_persistent_link_preview_store(monkeypatch)
    app = create_app('testing', overrides={'DATABASE_PATH': str(tmp_path / 'link-preview-image.db')})
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_url',
        lambda url: not str(url or '').startswith('http://127.0.0.1'),
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._fetch_preview_image',
        lambda url: (b'image-bytes', 'image/png', 'http://127.0.0.1/internal-image'),
    )

    response = client.get('/link_preview_image', query_string={'url': 'https://example.com/image.png'})
    assert response.status_code == 400
    assert response.get_json() == {'success': False, 'error': 'forbidden_host'}


def test_resolve_link_preview_payload_rejects_domain_when_dns_public_check_fails(monkeypatch):
    _disable_persistent_link_preview_store(monkeypatch)
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_CACHE', {})
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_hostname',
        lambda hostname: True,
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._hostname_resolves_public_only',
        lambda hostname, port=443: False,
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._fetch_preview_html',
        lambda url: (_ for _ in ()).throw(AssertionError('network fetch must not run')),
    )

    payload, status = resolve_link_preview_payload('https://example.com')
    assert status == 400
    assert payload == {'success': False, 'error': 'forbidden_host'}


def test_socket_create_connection_address_accepts_ipv6_sockaddr():
    assert _socket_create_connection_address(('2606:50c0:8003::154', 443, 0, 0)) == (
        '2606:50c0:8003::154',
        443,
    )


def test_resolve_link_preview_payload_returns_empty_image_when_meta_image_missing(monkeypatch):
    _disable_persistent_link_preview_store(monkeypatch)
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_CACHE', {})
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_url',
        lambda url: True,
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._fetch_preview_html',
        lambda url: ('<html><head><title>No image</title></head></html>', 'https://example.com/page'),
    )

    payload, status = resolve_link_preview_payload('https://example.com/page')
    assert status == 200
    assert payload['success'] is True
    assert payload['image_url'] == 'https://example.com/favicon.ico'


def test_resolve_link_preview_payload_uses_best_html_icon_when_og_image_missing(monkeypatch):
    _disable_persistent_link_preview_store(monkeypatch)
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_CACHE', {})
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_url',
        lambda url: True,
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._fetch_preview_html',
        lambda url: (
            '<html><head>'
            '<link rel="icon" sizes="32x32" href="/favicon-32.png">'
            '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'
            '<meta property="og:title" content="Example">'
            '</head><body></body></html>',
            'https://example.com/page',
        ),
    )

    payload, status = resolve_link_preview_payload('https://example.com/page')
    assert status == 200
    assert payload['success'] is True
    assert payload['image_url'] == 'https://example.com/apple-touch-icon.png'


def test_resolve_link_preview_payload_ignores_challenge_redirect_payload(monkeypatch):
    _disable_persistent_link_preview_store(monkeypatch)
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_CACHE', {})
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._is_allowed_preview_url',
        lambda url: True,
    )
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._fetch_preview_html',
        lambda url: (
            '<html><head>'
            '<meta property="og:title" content="Captcha">'
            '<meta property="og:image" content="https://example.com/captcha.png">'
            '</head></html>',
            'https://example.com/showcaptcha?x=1',
        ),
    )

    payload, status = resolve_link_preview_payload('https://example.com/page')
    assert status == 200
    assert payload['success'] is True
    assert payload['url'] == 'https://example.com/page'
    assert payload['image_url'] == 'https://example.com/favicon.ico'
    assert payload['has_meta'] is False


def test_link_preview_image_returns_not_found_for_non_image_content(monkeypatch, tmp_path):
    _disable_persistent_link_preview_store(monkeypatch)
    app = create_app('testing', overrides={'DATABASE_PATH': str(tmp_path / 'link-preview-non-image.db')})
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    monkeypatch.setattr('app.routes.chat_link_preview_routes._is_allowed_preview_url', lambda url: True)

    def _raise_not_image(url):
        raise ValueError('not_image_content_type')

    monkeypatch.setattr('app.routes.chat_link_preview_routes._fetch_preview_image', _raise_not_image)

    response = client.get('/link_preview_image', query_string={'url': 'https://example.com/page'})
    assert response.status_code == 404
    assert response.get_json() == {'success': False, 'error': 'image_unavailable'}


def test_link_preview_image_uses_host_budget_before_network(monkeypatch, tmp_path):
    _disable_persistent_link_preview_store(monkeypatch)
    app = create_app('testing', overrides={'DATABASE_PATH': str(tmp_path / 'link-preview-image-budget.db')})
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    monkeypatch.setattr('app.routes.chat_link_preview_routes._is_allowed_preview_url', lambda url: True)
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_HOST_BUDGET_MAX_FETCHES', 1)
    monkeypatch.setattr('app.routes.chat_link_preview_routes._LINK_PREVIEW_HOST_BUDGET', {'example.com': [1000.0]})
    monkeypatch.setattr('app.routes.chat_link_preview_routes.time.time', lambda: 1000.0)
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes._fetch_preview_image',
        lambda url: (_ for _ in ()).throw(AssertionError('image fetch must not run when host budget is spent')),
    )

    response = client.get('/link_preview_image', query_string={'url': 'https://example.com/image.png'})
    assert response.status_code == 429
    assert response.get_json() == {'success': False, 'error': 'host_rate_limited'}


def test_link_preview_prewarm_route_queues_background_task(monkeypatch, tmp_path):
    _disable_persistent_link_preview_store(monkeypatch)
    app = create_app('testing', overrides={'DATABASE_PATH': str(tmp_path / 'link-preview-prewarm.db')})
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    monkeypatch.setattr('app.routes.chat_link_preview_routes._is_allowed_preview_url', lambda url: True)
    monkeypatch.setattr(
        'app.routes.chat_link_preview_routes.schedule_link_preview_prewarm',
        lambda normalized_url, *, resolve_preview_payload_func: True,
    )

    response = client.get('/link_preview_prewarm', query_string={'url': 'https://example.com/path'})
    assert response.status_code == 202
    assert response.get_json() == {'success': True, 'queued': True}
