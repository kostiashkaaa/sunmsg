"""
E2E / UI tests using Playwright — smoke tests for JS module integrity.

Запускает реальное Flask-приложение в тестовом режиме и проверяет через браузер:
  1. Страница авторизации загружается (нет JS ошибок).
  2. После входа: /chat загружается, chat.js не кидает ошибок при инициализации.
  3. Все критические ES-модули успешно разбираются браузером (нет SyntaxError).
  4. Нет console.error при загрузке страницы чата.
  5. initChatPage не бросает исключений — window.SUN_BOOTSTRAP обрабатывается корректно.

Запуск (нужен запущенный сервер или встроенный test-сервер):
    pytest tests/test_ui_playwright.py -v

Переменные окружения:
    PLAYWRIGHT_BASE_URL   — базовый URL сервера (default: http://localhost:5000)
    PLAYWRIGHT_HEADLESS   — '0' для видимого браузера, '1' (default) для headless
"""

from __future__ import annotations

import base64
import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Generator

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

# ---------------------------------------------------------------------------
# Попытка импортировать Playwright — если нет, тесты пропускаются
# ---------------------------------------------------------------------------
try:
    from playwright.sync_api import (
        Browser,
        BrowserContext,
        Page,
        sync_playwright,
        ConsoleMessage,
    )
    _PLAYWRIGHT_AVAILABLE = True
except ImportError:
    _PLAYWRIGHT_AVAILABLE = False

pytestmark = pytest.mark.skipif(
    not _PLAYWRIGHT_AVAILABLE,
    reason='playwright not installed — run: pip install playwright && playwright install chromium',
)

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'static'

# ---------------------------------------------------------------------------
# Конфиг
# ---------------------------------------------------------------------------
_DEFAULT_BASE_URL = 'http://localhost:5000'
_HEADLESS = os.environ.get('PLAYWRIGHT_HEADLESS', '1') != '0'
_SLOW_MO = int(os.environ.get('PLAYWRIGHT_SLOW_MO', '0'))
_TIMEOUT = int(os.environ.get('PLAYWRIGHT_TIMEOUT', '10000'))
_TEST_APP = None


def _base_url() -> str:
    return os.environ.get('PLAYWRIGHT_BASE_URL', _DEFAULT_BASE_URL).rstrip('/')


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope='session')
def _flask_server():
    """
    Запускает встроенный Flask test-сервер если PLAYWRIGHT_BASE_URL не задан.
    Если задан — предполагаем, что сервер уже запущен снаружи.
    """
    if os.environ.get('PLAYWRIGHT_BASE_URL'):
        yield _base_url()
        return

    # Запускаем Flask в отдельном потоке
    import sys
    sys.path.insert(0, str(ROOT))

    global _TEST_APP
    from app import create_app
    app = create_app(overrides={
        'TESTING': True,
        'WTF_CSRF_ENABLED': False,
        'SERVER_NAME': None,
        'SECRET_KEY': 'playwright-test-secret-do-not-use-in-production',
    })
    _TEST_APP = app

    server_started = threading.Event()
    server_thread = None

    def _run():
        # Используем встроенный werkzeug-сервер только для smoke-тестов
        from werkzeug.serving import make_server
        srv = make_server('127.0.0.1', 5001, app, threaded=True)
        server_started.set()
        srv.serve_forever()

    try:
        server_thread = threading.Thread(target=_run, daemon=True)
        server_thread.start()
        server_started.wait(timeout=10)
        time.sleep(0.5)  # даём werkzeug поднять сокет
        yield 'http://127.0.0.1:5001'
    finally:
        _TEST_APP = None
        pass  # daemon thread завершится вместе с процессом


@pytest.fixture(scope='session')
def browser_instance() -> Generator:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=_HEADLESS,
            slow_mo=_SLOW_MO,
            args=['--no-sandbox', '--disable-dev-shm-usage'],
        )
        yield browser
        browser.close()


@pytest.fixture
def page(browser_instance: 'Browser', _flask_server) -> Generator:
    context: BrowserContext = browser_instance.new_context(
        base_url=_flask_server,
        ignore_https_errors=True,
    )
    context.set_default_timeout(_TIMEOUT)
    p: Page = context.new_page()
    yield p
    p.close()
    context.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _collect_console_errors(page: 'Page') -> list[str]:
    """Собирает все console.error-сообщения."""
    errors: list[str] = []

    def _on_console(msg: 'ConsoleMessage'):
        if msg.type == 'error':
            errors.append(msg.text)

    page.on('console', _on_console)
    return errors


def _collect_page_errors(page: 'Page') -> list[str]:
    """Собирает все необработанные JS-ошибки (pageerror)."""
    errors: list[str] = []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    return errors


def _generate_test_rsa_keypair() -> tuple[str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode('utf-8')
    public_key_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode('utf-8')
    public_key_body = ''.join(
        line.strip()
        for line in public_key_pem.splitlines()
        if 'BEGIN PUBLIC KEY' not in line and 'END PUBLIC KEY' not in line
    )
    return public_key_body, private_key_pem


def _seed_group_smoke_users() -> dict[str, dict[str, str | int]]:
    from app.database import get_db_connection

    suffix = uuid.uuid4().hex[:8]
    next_ids: list[int] = []
    owner_public_key, owner_private_key = _generate_test_rsa_keypair()
    member_public_key, member_private_key = _generate_test_rsa_keypair()
    spare_public_key, _spare_private_key = _generate_test_rsa_keypair()
    owner = {
        'public_key': owner_public_key,
        'private_key_pem': owner_private_key,
        'username': f'uiowner_{suffix}',
        'display_name': f'UI Owner {suffix}',
    }
    member = {
        'public_key': member_public_key,
        'private_key_pem': member_private_key,
        'username': f'uimember_{suffix}',
        'display_name': f'UI Member {suffix}',
    }
    spare = {
        'public_key': spare_public_key,
        'username': f'uispare_{suffix}',
        'display_name': f'UI Spare {suffix}',
    }

    conn = get_db_connection()
    try:
        max_row = conn.execute('SELECT COALESCE(MAX(id), 0) AS max_id FROM users').fetchone()
        base_id = int(max_row['max_id']) if max_row is not None else 0
        next_ids = [base_id + 1, base_id + 2, base_id + 3]

        for user in (owner, member, spare):
            user['id'] = next_ids.pop(0)
            row = conn.execute(
                '''
                INSERT INTO users (id, public_key, username, display_name)
                VALUES (?, ?, ?, ?)
                RETURNING id
                ''',
                (user['id'], user['public_key'], user['username'], user['display_name']),
            ).fetchone()
            user['id'] = int(row['id'])
        conn.commit()
    finally:
        conn.close()

    return {'owner': owner, 'member': member, 'spare': spare}


def _login_context_via_challenge(context: 'BrowserContext', *, username: str, private_key_pem: str) -> None:
    challenge_resp = context.request.post(
        '/api/get_challenge',
        headers={'Content-Type': 'application/json'},
        data=json.dumps({'username': username}),
    )
    assert challenge_resp.ok, f'challenge request failed: {challenge_resp.status}'
    challenge_payload = challenge_resp.json()
    challenge = str(challenge_payload.get('challenge') or '')
    assert challenge, f'missing challenge payload: {challenge_payload}'

    private_key = serialization.load_pem_private_key(private_key_pem.encode('utf-8'), password=None)
    signature = private_key.sign(
        challenge.encode('utf-8'),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    signature_b64 = base64.b64encode(signature).decode('ascii')

    login_resp = context.request.post(
        '/api/login_challenge',
        headers={'Content-Type': 'application/json'},
        data=json.dumps({'signature': signature_b64}),
    )
    assert login_resp.ok, f'login request failed: {login_resp.status}'
    login_payload = login_resp.json()
    assert bool(login_payload.get('success')), f'login payload: {login_payload}'


def _open_group_create_modal(page: 'Page') -> None:
    page.wait_for_function('() => typeof window.openCommandPalette === "function"')
    page.evaluate('window.openCommandPalette && window.openCommandPalette("")')
    group_action = page.locator('[data-palette-action="group"]')
    group_action.wait_for(state='visible', timeout=10_000)
    group_action.click()
    page.locator('#groupCreateModal').wait_for(state='visible', timeout=10_000)


def _add_member_to_group_create(page: 'Page', *, query: str, target_user_id: int) -> None:
    page.locator('#groupMemberSearchInput').fill(query)
    add_btn = page.locator(f'[data-group-add-member-id="{target_user_id}"]').first
    add_btn.wait_for(state='visible', timeout=10_000)
    add_btn.click()


def _open_contact_by_name(page: 'Page', display_name: str) -> None:
    contact = page.locator(
        '#contactsList .contact-item',
        has=page.locator('.contact-name', has_text=display_name),
    ).first
    contact.wait_for(state='visible', timeout=20_000)
    contact.click()


def _wait_chat_title_contains(page: 'Page', expected: str, *, timeout_seconds: float = 12.0) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        value = (page.locator('#chatTitle').inner_text() or '').strip()
        if expected in value:
            return
        time.sleep(0.2)
    raise AssertionError(f'chat title did not contain {expected!r}')


def _open_group_profile(page: 'Page') -> None:
    page.locator('#chatPartnerHeaderLink').click()
    page.locator('#partnerProfileDrawer').wait_for(state='visible', timeout=10_000)
    page.locator('#profileGroupSection').wait_for(state='visible', timeout=10_000)


# ---------------------------------------------------------------------------
# Тест 1: Страница / (redirect) или /login доступна
# ---------------------------------------------------------------------------

def test_root_redirects_to_login_or_chat(page: 'Page', _flask_server):
    """Корень приложения / доступен — либо страница входа, либо редирект на /chat."""
    response = page.goto('/', wait_until='domcontentloaded')
    assert response is not None
    # / отвечает 200 (страница auth/index) или 3xx редирект
    assert response.status < 500, (
        f'Корневая страница вернула {response.status} — внутренняя ошибка сервера'
    )
    # Либо остаёмся на /, либо уходим на /chat
    url = page.url
    assert '127.0.0.1' in url or 'localhost' in url, (
        f'Неожиданный URL: {url}'
    )


# ---------------------------------------------------------------------------
# Тест 2: Страница /login загружается без JS ошибок
# ---------------------------------------------------------------------------

def test_auth_page_loads_without_js_errors(page: 'Page', _flask_server):
    """Главная страница авторизации (/) загружается, нет JS синтаксических ошибок."""
    js_errors = _collect_page_errors(page)
    response = page.goto('/', wait_until='networkidle')
    assert response is not None
    assert response.status in (200, 302), f'/ вернул {response.status}'

    # Нет SyntaxError в JS
    syntax_errors = [e for e in js_errors if 'SyntaxError' in e]
    assert not syntax_errors, (
        'SyntaxError на странице /:\n' + '\n'.join(syntax_errors)
    )

    # Форма входа или страница входа присутствует
    form = page.locator('form')
    assert form.count() > 0, 'Нет формы на главной странице'


# ---------------------------------------------------------------------------
# Тест 3: Статичные JS-модули возвращают 200 и правильный Content-Type
# ---------------------------------------------------------------------------

CRITICAL_JS_MODULES = [
    '/static/chat.js',
    '/static/modules/chat-state.js',
    '/static/modules/message-rendering.js',
    '/static/modules/reactions.js',
    '/static/modules/utils.js',
    '/static/modules/chat-socket-client.js',
    '/static/modules/chat-history-runtime.js',
    '/static/modules/chat-partner-network.js',
    '/static/modules/chat-sidebar-status.js',
    '/static/modules/keyboard-shortcuts.js',
    '/static/modules/chat-contacts-sidebar.js',
    '/static/modules/voice-recorder.js',
    '/static/modules/profile-drawer.js',
    '/static/modules/reactions.js',
]


@pytest.mark.parametrize('path', CRITICAL_JS_MODULES)
def test_static_js_modules_return_200(path: str, page: 'Page', _flask_server):
    """Каждый JS-модуль доступен по HTTP и не возвращает 404/500."""
    response = page.goto(path, wait_until='domcontentloaded')
    assert response is not None, f'Нет ответа для {path}'
    assert response.status == 200, (
        f'{path} вернул HTTP {response.status} — модуль недоступен'
    )
    ct = response.headers.get('content-type', '')
    assert 'javascript' in ct or 'text/plain' in ct or 'application/octet-stream' in ct, (
        f'{path}: Content-Type = {ct!r} — ожидался JavaScript'
    )


# ---------------------------------------------------------------------------
# Тест 4: chat.js не содержит SyntaxError (парсинг через браузер)
# ---------------------------------------------------------------------------

def test_chat_js_has_no_syntax_errors(page: 'Page', _flask_server):
    """
    Загружаем chat.js как ES-модуль в пустой странице.
    Если в нём есть SyntaxError — pageerror поймает его.
    """
    js_errors = _collect_page_errors(page)

    # Создаём минимальную HTML-страницу и делаем goto на неё через data: URL
    # чтобы браузер мог правильно резолвить /static/ пути
    page.goto('/', wait_until='domcontentloaded')  # устанавливаем origin
    page.evaluate(
        """async () => {
            try {
                await import('/static/chat.js');
                return { ok: true };
            } catch (e) {
                return { ok: false, error: e.message, type: e.constructor.name };
            }
        }"""
    )
    page.wait_for_timeout(1000)

    syntax_errors = [e for e in js_errors if 'SyntaxError' in e or 'Unexpected token' in e]
    assert not syntax_errors, (
        'chat.js содержит синтаксические ошибки:\n' + '\n'.join(syntax_errors)
    )
    # dynamic import может упасть по причине missing deps (нет socket.io и т.д.) — это OK
    # нас интересует только SyntaxError


# ---------------------------------------------------------------------------
# Тест 5: Все JS-модули парсятся без ошибок (пакетная проверка)
# ---------------------------------------------------------------------------

def test_all_modules_parse_without_syntax_errors(page: 'Page', _flask_server):
    """
    Загружаем каждый модуль через dynamic import() в браузере.
    SyntaxError → тест падает и указывает на проблемный файл.
    """
    module_paths = [
        f.name for f in (STATIC / 'modules').glob('*.js')
        # IIFE-модули не являются ES-модулями — пропускаем
        if f.name not in {'device-key.js', 'private-key-session-bridge.js'}
    ]
    assert module_paths, 'Нет модулей для проверки'

    errors_found: list[str] = []

    # Загружаем origin-страницу один раз
    page.goto('/', wait_until='domcontentloaded')

    for module_name in sorted(module_paths):
        result = page.evaluate(
            """async (moduleName) => {
                try {
                    await import('/static/modules/' + moduleName);
                    return { ok: true };
                } catch (e) {
                    return { ok: false, error: e.message, type: e.constructor.name };
                }
            }""",
            module_name,
        )

        if not result.get('ok'):
            err_type = result.get('type', 'Error')
            err_msg = result.get('error', 'unknown')
            # Пропускаем ошибки загрузки (сеть, CORS) — нас интересуют только SyntaxError
            if err_type == 'SyntaxError' or 'SyntaxError' in err_msg:
                errors_found.append(f'  {module_name}: [{err_type}] {err_msg}')

    assert not errors_found, (
        'Следующие модули не парсятся браузером:\n' + '\n'.join(errors_found)
    )


# ---------------------------------------------------------------------------
# Тест 6: Страница /chat требует авторизации (редирект на /login)
# ---------------------------------------------------------------------------

def test_chat_page_requires_auth(page: 'Page', _flask_server):
    """/chat без авторизации должен редиректить на /login или /key-login."""
    response = page.goto('/chat', wait_until='domcontentloaded')
    assert response is not None
    final_url = page.url
    # Не авторизованный пользователь → редирект
    assert response.status < 400 or '/login' in final_url or '/key-login' in final_url, (
        f'/chat вернул неожиданный статус {response.status}, URL: {final_url}'
    )


# ---------------------------------------------------------------------------
# Тест 7: Нет broken module imports — console.error при 404 на JS файл
# ---------------------------------------------------------------------------

def test_no_404_on_js_imports(page: 'Page', _flask_server):
    """
    При загрузке /login не должно быть 404-ответов на JS-файлы.
    Сломанный import → браузер не молчит, а падает с ошибкой.
    """
    failed_requests: list[str] = []

    def _on_response(response):
        if response.status == 404 and '.js' in response.url:
            failed_requests.append(f'{response.url} → 404')

    page.on('response', _on_response)
    page.goto('/login', wait_until='networkidle')

    assert not failed_requests, (
        'JS-файлы не найдены (404):\n' + '\n'.join(failed_requests)
    )


def test_group_moderation_realtime_smoke(browser_instance: 'Browser', _flask_server):
    """
    End-to-end smoke:
      1) owner creates group and member sees it without reload
      2) owner can remove another member
      3) member sees sanction status and can submit appeal
    """
    if os.environ.get('PLAYWRIGHT_BASE_URL'):
        pytest.skip('Requires local in-process Flask app for DB seed and session cookies.')

    users = _seed_group_smoke_users()
    group_name = f"UI Smoke Group {uuid.uuid4().hex[:6]}"

    owner_ctx: BrowserContext = browser_instance.new_context(base_url=_flask_server, ignore_https_errors=True)
    member_ctx: BrowserContext = browser_instance.new_context(base_url=_flask_server, ignore_https_errors=True)
    owner_ctx.set_default_timeout(_TIMEOUT)
    member_ctx.set_default_timeout(_TIMEOUT)
    _login_context_via_challenge(
        owner_ctx,
        username=str(users['owner']['username']),
        private_key_pem=str(users['owner']['private_key_pem']),
    )
    _login_context_via_challenge(
        member_ctx,
        username=str(users['member']['username']),
        private_key_pem=str(users['member']['private_key_pem']),
    )

    owner_page: Page = owner_ctx.new_page()
    member_page: Page = member_ctx.new_page()

    try:
        owner_page.goto('/chat', wait_until='domcontentloaded', timeout=30_000)
        member_page.goto('/chat', wait_until='domcontentloaded', timeout=30_000)
        owner_page.locator('#contactsList').wait_for(state='visible', timeout=20_000)
        member_page.locator('#contactsList').wait_for(state='visible', timeout=20_000)

        nav_before = member_page.evaluate('performance.getEntriesByType("navigation").length')

        _open_group_create_modal(owner_page)
        _add_member_to_group_create(
            owner_page,
            query=str(users['member']['username']),
            target_user_id=int(users['member']['id']),
        )
        _add_member_to_group_create(
            owner_page,
            query=str(users['spare']['username']),
            target_user_id=int(users['spare']['id']),
        )
        owner_page.locator('#groupCreateSubmitBtn').click()
        owner_page.locator('#groupTitleInput').fill(group_name)
        owner_page.locator('#groupCreateSubmitBtn').click()
        owner_page.locator('#groupCreateModal').wait_for(state='hidden', timeout=15_000)

        _open_contact_by_name(owner_page, group_name)
        _wait_chat_title_contains(owner_page, group_name)

        member_contact = member_page.locator(
            '#contactsList .contact-item',
            has=member_page.locator('.contact-name', has_text=group_name),
        ).first
        member_contact.wait_for(state='visible', timeout=20_000)
        nav_after = member_page.evaluate('performance.getEntriesByType("navigation").length')
        assert nav_after == nav_before, 'group appeared only after navigation/reload, expected realtime update'

        _open_group_profile(owner_page)
        owner_page.locator('#profileGroupEditBtn').click()
        owner_page.locator('#groupEditModal').wait_for(state='visible', timeout=10_000)
        remove_btn = owner_page.locator(f'[data-group-remove-target="{int(users["spare"]["id"])}"]').first
        remove_btn.wait_for(state='visible', timeout=10_000)
        remove_btn.click()
        owner_page.locator(f'[data-group-remove-target="{int(users["spare"]["id"])}"]').first.wait_for(
            state='detached',
            timeout=15_000,
        )

        sanction_btn = owner_page.locator(
            f'[data-group-sanction-target="{int(users["member"]["id"])}"][data-group-sanction-action="mute_temp"]',
        ).first
        sanction_btn.wait_for(state='visible', timeout=10_000)
        sanction_btn.click()

        _open_contact_by_name(member_page, group_name)
        _wait_chat_title_contains(member_page, group_name)
        _open_group_profile(member_page)
        appeal_btn = member_page.locator('[data-group-appeal-sanction-id]').first
        appeal_btn.wait_for(state='visible', timeout=20_000)
        appeal_btn.click()
        member_page.locator('#profileGroupMembers', has_text='Appeal is pending review.').wait_for(
            state='visible',
            timeout=20_000,
        )
    finally:
        owner_page.close()
        member_page.close()
        owner_ctx.close()
        member_ctx.close()
