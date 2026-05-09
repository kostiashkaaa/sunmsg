from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import pytest

try:
    from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

    _PLAYWRIGHT_AVAILABLE = True
except ImportError:
    _PLAYWRIGHT_AVAILABLE = False

pytestmark = pytest.mark.skipif(
    not _PLAYWRIGHT_AVAILABLE,
    reason='playwright not installed - run: pip install playwright && playwright install chromium',
)

ROOT = Path(__file__).resolve().parents[1]
_HEADLESS = os.environ.get('PLAYWRIGHT_HEADLESS', '1') != '0'
_SLOW_MO = int(os.environ.get('PLAYWRIGHT_SLOW_MO', '0'))
_TIMEOUT = int(os.environ.get('PLAYWRIGHT_TIMEOUT', '20000'))


@pytest.fixture(scope='session')
def perf_server():
    import sys

    sys.path.insert(0, str(ROOT))
    from app import create_app
    from app.database import get_db_connection
    from flask import redirect, request, session
    from werkzeug.serving import make_server

    db_path = ROOT / '.runtime' / 'playwright-perf-smoke.db'
    app = create_app(
        overrides={
            'TESTING': True,
            'WTF_CSRF_ENABLED': False,
            'SERVER_NAME': None,
            'SECRET_KEY': 'playwright-perf-smoke-secret',
            'DATABASE_PATH': str(db_path),
        }
    )

    with app.app_context():
        conn = get_db_connection()
        try:
            conn.execute(
                '''
                INSERT INTO users (id, public_key, username, display_name, language)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    public_key = EXCLUDED.public_key,
                    username = EXCLUDED.username,
                    display_name = EXCLUDED.display_name,
                    language = EXCLUDED.language
                ''',
                (7001, 'pk-perf-7001', 'perf_user', 'Perf User', 'ru'),
            )
            conn.commit()
        finally:
            conn.close()

    @app.route('/__perf_test__/login', methods=['GET'])
    def _perf_test_login():
        target = str(request.args.get('next') or '/chat')
        session.clear()
        session['user_id'] = 7001
        session['public_key_pem'] = 'pk-perf-7001'
        session['ui_language'] = 'ru'
        return redirect(target)

    server = make_server('127.0.0.1', 0, app)
    port = int(server.socket.getsockname()[1])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.5)
    try:
        yield {
            'base_url': f'http://127.0.0.1:{port}',
        }
    finally:
        server.shutdown()


def _run_perf_probe(
    browser: Browser,
    *,
    base_url: str,
    path: str,
    ready_selector: str,
    max_interactive_ms: float,
    max_requests: int,
) -> None:
    context: BrowserContext = browser.new_context(
        base_url=base_url,
        ignore_https_errors=True,
        reduced_motion='reduce',
        color_scheme='light',
        viewport={'width': 1366, 'height': 900},
    )
    context.set_default_timeout(_TIMEOUT)
    page: Page = context.new_page()

    request_count = 0

    def _on_request(req) -> None:
        nonlocal request_count
        if not str(req.url).startswith(base_url):
            return
        resource_type = str(req.resource_type or '')
        if resource_type in {'websocket'}:
            return
        request_count += 1

    page.on('request', _on_request)
    response = page.goto(path, wait_until='domcontentloaded')
    assert response is not None
    assert response.status < 500
    page.wait_for_selector(ready_selector)
    interactive_ms = float(page.evaluate('() => performance.now()'))
    page.close()
    context.close()

    assert interactive_ms <= max_interactive_ms, (
        f'{path}: first-interactive={interactive_ms:.1f}ms > {max_interactive_ms:.1f}ms'
    )
    assert request_count <= max_requests, (
        f'{path}: request_count={request_count} > {max_requests}'
    )


def test_ui_perf_smoke_auth_chat_settings(perf_server):
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=_HEADLESS,
            slow_mo=_SLOW_MO,
            args=['--no-sandbox', '--disable-dev-shm-usage'],
        )
        try:
            _run_perf_probe(
                browser,
                base_url=perf_server['base_url'],
                path='/',
                ready_selector='#authLanguageSwitch',
                max_interactive_ms=2200.0,
                max_requests=50,
            )
            _run_perf_probe(
                browser,
                base_url=perf_server['base_url'],
                path='/__perf_test__/login?next=/chat',
                ready_selector='#contactsList',
                max_interactive_ms=3200.0,
                max_requests=190,
            )
            _run_perf_probe(
                browser,
                base_url=perf_server['base_url'],
                path='/__perf_test__/login?next=/settings',
                ready_selector='body.settings-ready',
                max_interactive_ms=2600.0,
                max_requests=80,
            )
        finally:
            browser.close()
