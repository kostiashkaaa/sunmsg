from __future__ import annotations

import io
import os
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Callable

import pytest
from PIL import Image, ImageChops

try:
    from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright

    _PLAYWRIGHT_AVAILABLE = True
except ImportError:
    _PLAYWRIGHT_AVAILABLE = False

pytestmark = pytest.mark.skipif(
    not _PLAYWRIGHT_AVAILABLE,
    reason='playwright not installed - run: pip install playwright && playwright install chromium',
)

ROOT = Path(__file__).resolve().parents[1]
VISUAL_BASELINE_DIR = ROOT / 'tests' / 'visual_baselines'
VISUAL_ARTIFACTS_DIR = ROOT / 'tests' / '.visual_artifacts'

_HEADLESS = os.environ.get('PLAYWRIGHT_HEADLESS', '1') != '0'
_SLOW_MO = int(os.environ.get('PLAYWRIGHT_SLOW_MO', '0'))
_TIMEOUT = int(os.environ.get('PLAYWRIGHT_TIMEOUT', '10000'))
_UPDATE_BASELINE = os.environ.get('PLAYWRIGHT_UPDATE_BASELINE', '0') == '1'


def _image_diff_ratio(actual_bytes: bytes, baseline_path: Path) -> tuple[float, bytes]:
    actual_img = Image.open(io.BytesIO(actual_bytes)).convert('RGBA')
    baseline_img = Image.open(baseline_path).convert('RGBA')
    if actual_img.size != baseline_img.size:
        raise AssertionError(
            f'Размер скриншота изменился для {baseline_path.name}: '
            f'actual={actual_img.size}, baseline={baseline_img.size}'
        )

    diff = ImageChops.difference(actual_img, baseline_img)
    gray = diff.convert('L')
    histogram = gray.histogram()
    total_pixels = actual_img.size[0] * actual_img.size[1]
    changed_pixels = total_pixels - int(histogram[0])
    ratio = changed_pixels / float(total_pixels or 1)

    buf = io.BytesIO()
    diff.save(buf, format='PNG')
    return ratio, buf.getvalue()


def _assert_visual_snapshot(page: Page, snapshot_name: str, *, max_diff_ratio: float = 0.001) -> None:
    VISUAL_BASELINE_DIR.mkdir(parents=True, exist_ok=True)
    VISUAL_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    baseline_path = VISUAL_BASELINE_DIR / f'{snapshot_name}.png'
    actual_bytes = page.screenshot(full_page=False, animations='disabled', caret='hide')

    if _UPDATE_BASELINE:
        baseline_path.write_bytes(actual_bytes)
        return

    if not baseline_path.exists():
        actual_path = VISUAL_ARTIFACTS_DIR / f'{snapshot_name}.actual.png'
        actual_path.write_bytes(actual_bytes)
        pytest.fail(
            'Не найден baseline snapshot: '
            f'{baseline_path}. '
            'Сгенерируйте baseline: PLAYWRIGHT_UPDATE_BASELINE=1 pytest tests/test_ui_visual_regression_playwright.py -v'
        )

    ratio, diff_bytes = _image_diff_ratio(actual_bytes, baseline_path)
    if ratio <= max_diff_ratio:
        return

    actual_path = VISUAL_ARTIFACTS_DIR / f'{snapshot_name}.actual.png'
    diff_path = VISUAL_ARTIFACTS_DIR / f'{snapshot_name}.diff.png'
    actual_path.write_bytes(actual_bytes)
    diff_path.write_bytes(diff_bytes)
    pytest.fail(
        f'Визуальная регрессия для {snapshot_name}: diff_ratio={ratio:.5f} (> {max_diff_ratio:.5f}). '
        f'Actual: {actual_path}; Diff: {diff_path}'
    )


@pytest.fixture(scope='session')
def visual_server():
    sys.path.insert(0, str(ROOT))

    from app import create_app
    from app.database import get_db_connection
    from flask import redirect, request, session

    app = create_app(
        overrides={
            'TESTING': True,
            'WTF_CSRF_ENABLED': False,
            'SERVER_NAME': None,
            'SECRET_KEY': 'playwright-visual-test-secret-do-not-use-in-production',
            'DATABASE_PATH': str(ROOT / '.runtime' / 'playwright-visual.db'),
        }
    )

    with app.app_context():
        conn = get_db_connection()
        try:
            conn.execute(
                '''
                INSERT INTO users (id, public_key, username, display_name, language)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET
                    public_key = EXCLUDED.public_key,
                    username = EXCLUDED.username,
                    display_name = EXCLUDED.display_name,
                    language = EXCLUDED.language
                ''',
                (4242, 'pk-visual-4242', 'visual_user', 'Visual User', 'ru'),
            )
            conn.commit()
        finally:
            conn.close()

    @app.route('/__visual_test__/login', methods=['GET'])
    def _visual_test_login_bootstrap():
        target = str(request.args.get('next') or '/settings')
        session.clear()
        session['user_id'] = 4242
        session['public_key_pem'] = 'pk-visual-4242'
        session['ui_language'] = 'ru'
        return redirect(target)

    from werkzeug.serving import make_server

    server = make_server('127.0.0.1', 0, app)
    server_port = int(server.socket.getsockname()[1])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.5)

    yield {
        'app': app,
        'base_url': f'http://127.0.0.1:{server_port}',
        'session_cookie_name': str(app.config.get('SESSION_COOKIE_NAME') or 'session'),
    }

    server.shutdown()


def _run_playwright_job(job: Callable[[Playwright, Browser], None], *, timeout_seconds: int = 120) -> None:
    state: dict[str, str | BaseException | None] = {'error': None, 'traceback': None}

    def _target() -> None:
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(
                    headless=_HEADLESS,
                    slow_mo=_SLOW_MO,
                    args=['--no-sandbox', '--disable-dev-shm-usage'],
                )
                try:
                    job(pw, browser)
                finally:
                    browser.close()
        except BaseException as exc:  # noqa: BLE001
            state['error'] = exc
            state['traceback'] = traceback.format_exc()

    worker = threading.Thread(target=_target, daemon=True)
    worker.start()
    worker.join(timeout_seconds)
    if worker.is_alive():
        pytest.fail(f'Playwright worker timed out after {timeout_seconds}s')
    if state['error'] is not None:
        tb = str(state['traceback'] or '')
        pytest.fail(f'Playwright worker failed:\n{tb}')


def _make_auth_cookie(server_data: dict[str, str], *, user_id: int = 4242, public_key: str = 'pk-visual-4242') -> str:
    app = server_data['app']
    serializer = app.session_interface.get_signing_serializer(app)
    assert serializer is not None
    return serializer.dumps(
        {
            'user_id': user_id,
            'public_key_pem': public_key,
            'ui_language': 'ru',
        }
    )


def _new_context(
    pw: Playwright,
    browser: Browser,
    *,
    base_url: str,
    mobile: bool = False,
    auth_cookie_name: str | None = None,
    auth_cookie_value: str | None = None,
) -> BrowserContext:
    options: dict = {
        'base_url': base_url,
        'ignore_https_errors': True,
        'reduced_motion': 'reduce',
        'color_scheme': 'light',
        'locale': 'ru-RU',
    }
    if mobile:
        device = dict(pw.devices['iPhone 13'])
        device.pop('default_browser_type', None)
        options.update(device)
    else:
        options.update({'viewport': {'width': 1440, 'height': 960}})

    context = browser.new_context(**options)
    context.set_default_timeout(_TIMEOUT)

    if auth_cookie_name and auth_cookie_value:
        context.add_cookies(
            [
                {
                    'name': auth_cookie_name,
                    'value': auth_cookie_value,
                    'url': base_url,
                    'httpOnly': True,
                }
            ]
        )
    return context


def _open_page(context: BrowserContext, path: str, wait_until: str = 'networkidle') -> Page:
    page = context.new_page()
    response = page.goto(path, wait_until=wait_until)
    assert response is not None
    assert response.status < 500, f'Страница {path} вернула {response.status}'
    return page


def _wait_settings_ready(page: Page) -> None:
    page.wait_for_selector('body.settings-ready')


def _open_settings_via_test_login(context: BrowserContext) -> Page:
    return _open_page(context, '/__visual_test__/login?next=/settings')


def _stub_qr_login_api(context: BrowserContext) -> None:
    def _sessions(route):
        route.fulfill(
            status=200,
            content_type='application/json',
            body='{"success": true, "session_id":"visual-session", "qr_text":"SUN-VISUAL-QR"}',
        )

    def _claim(route):
        route.fulfill(
            status=200,
            content_type='application/json',
            body='{"success": true, "state":"pending"}',
        )

    context.route(
        '**/api/key_transfer/login/sessions',
        _sessions,
    )
    context.route(
        '**/api/key_transfer/login/sessions/*/claim',
        _claim,
    )


def _switch_auth_to_key_mode(page: Page) -> None:
    page.wait_for_selector('#methodKeyBtn')
    page.wait_for_function('() => typeof window.setLoginMethod === "function"')
    page.evaluate("window.setLoginMethod && window.setLoginMethod('key')")
    page.wait_for_selector('#loginKeyGroup', state='visible')
    page.wait_for_selector('#loginKeyGroup.auth-method-entering', state='hidden')


def test_visual_auth_desktop_default(visual_server):
    def _job(pw: Playwright, browser: Browser) -> None:
        context = _new_context(pw, browser, base_url=visual_server['base_url'])
        _stub_qr_login_api(context)
        page = _open_page(context, '/', wait_until='domcontentloaded')
        _switch_auth_to_key_mode(page)
        page.wait_for_selector('#authLanguageSwitch')
        _assert_visual_snapshot(page, 'auth-desktop-default')
        page.close()
        context.close()

    _run_playwright_job(_job)


def test_visual_auth_desktop_selection_state(visual_server):
    def _job(pw: Playwright, browser: Browser) -> None:
        context = _new_context(pw, browser, base_url=visual_server['base_url'])
        _stub_qr_login_api(context)
        page = _open_page(context, '/', wait_until='domcontentloaded')
        _switch_auth_to_key_mode(page)
        page.click('#tab-register-btn')
        page.wait_for_selector('#panel-register.active')
        page.click('#authLanguageSwitch [data-lang="en"]')
        page.wait_for_selector('#authLanguageSwitch [data-lang="en"].is-active')
        page.evaluate('window.scrollTo(0, 0)')
        _assert_visual_snapshot(page, 'auth-desktop-selection')
        page.close()
        context.close()

    _run_playwright_job(_job)


def test_visual_auth_mobile_keyboard_state(visual_server):
    def _job(pw: Playwright, browser: Browser) -> None:
        context = _new_context(pw, browser, base_url=visual_server['base_url'], mobile=True)
        _stub_qr_login_api(context)
        page = _open_page(context, '/', wait_until='domcontentloaded')
        _switch_auth_to_key_mode(page)
        page.click('#tab-register-btn')
        page.wait_for_selector('#panel-register.active')
        page.click('#reg_username')
        page.wait_for_timeout(150)
        _assert_visual_snapshot(page, 'auth-mobile-keyboard-focus')
        page.close()
        context.close()

    _run_playwright_job(_job)


def test_visual_settings_mobile_dropdown_state(visual_server):
    def _job(pw: Playwright, browser: Browser) -> None:
        context = _new_context(
            pw,
            browser,
            base_url=visual_server['base_url'],
            mobile=True,
        )
        page = _open_settings_via_test_login(context)
        _wait_settings_ready(page)
        if page.is_visible('#settingsNavToggle'):
            page.click('#settingsNavToggle')
            page.wait_for_function("() => document.getElementById('settingsNav')?.classList.contains('mobile-open') === true")
        else:
            page.wait_for_selector('#settingsNavList')
        _assert_visual_snapshot(page, 'settings-mobile-dropdown-open')
        page.close()
        context.close()

    _run_playwright_job(_job)


def test_visual_settings_desktop_loading_and_empty_passkeys(visual_server):
    def _job(pw: Playwright, browser: Browser) -> None:
        context = _new_context(
            pw,
            browser,
            base_url=visual_server['base_url'],
        )

        def _handle_passkeys(route, _request):
            time.sleep(0.8)
            route.fulfill(
                status=200,
                content_type='application/json',
                body='{"success": true, "passkeys": []}',
            )

        context.route('**/api/passkeys', _handle_passkeys)
        page = _open_settings_via_test_login(context)
        _wait_settings_ready(page)

        page.click('.nav-item[data-section="keys"]')
        page.wait_for_selector('#section-keys.section-active')
        page.wait_for_selector('#section-keys #mnemonicUnlockCard')
        _assert_visual_snapshot(page, 'settings-desktop-passkeys-empty')

        page.close()
        context.close()

    _run_playwright_job(_job)
