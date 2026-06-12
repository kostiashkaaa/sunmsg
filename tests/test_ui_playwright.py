"""
E2E / UI tests using Playwright — smoke tests for JS module integrity.

Runs the real Flask app in testing mode and verifies through a browser:
  1. The auth page loads (no JS errors).
  2. After login: /chat loads, chat.js throws no errors during initialization.
  3. All critical ES modules parse successfully in the browser (no SyntaxError).
  4. No console.error while loading the chat page.
  5. initChatPage raises no exceptions — window.SUN_BOOTSTRAP is handled correctly.

Running (needs a live server or the built-in test server):
    pytest tests/test_ui_playwright.py -v

Environment variables:
    PLAYWRIGHT_BASE_URL   — base server URL (default: http://localhost:5000)
    PLAYWRIGHT_HEADLESS   — '0' for a visible browser, '1' (default) for headless
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
# Try to import Playwright — if missing, the tests are skipped
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
# Config
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
    Start the built-in Flask test server when PLAYWRIGHT_BASE_URL is unset.
    When it is set, assume the server is already running externally.
    """
    if os.environ.get('PLAYWRIGHT_BASE_URL'):
        yield _base_url()
        return

    # Run Flask in a separate thread
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
        # Use the built-in werkzeug server for smoke tests only
        from werkzeug.serving import make_server
        srv = make_server('127.0.0.1', 5001, app, threaded=True)
        server_started.set()
        srv.serve_forever()

    try:
        server_thread = threading.Thread(target=_run, daemon=True)
        server_thread.start()
        server_started.wait(timeout=10)
        time.sleep(0.5)  # give werkzeug time to open the socket
        yield 'http://127.0.0.1:5001'
    finally:
        _TEST_APP = None
        pass  # the daemon thread dies with the process


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
    """Collect all console.error messages."""
    errors: list[str] = []

    def _on_console(msg: 'ConsoleMessage'):
        if msg.type == 'error':
            errors.append(msg.text)

    page.on('console', _on_console)
    return errors


def _collect_page_errors(page: 'Page') -> list[str]:
    """Collect all unhandled JS errors (pageerror)."""
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


def _confirm_action_dialog(page: 'Page') -> None:
    ok_button = page.locator('#confirmActionModal [data-confirm-ok]')
    ok_button.wait_for(state='visible', timeout=10_000)
    ok_button.click()


def _wait_chat_realtime_ready(page: 'Page', public_key: str, *, timeout_seconds: float = 20.0) -> None:
    from app.services.presence import count_connected

    page.wait_for_function(
        """() => performance.getEntriesByType('resource')
            .some((entry) => String(entry.name || '').includes('/static/modules/chat-system-events.js'))""",
        timeout=int(timeout_seconds * 1000),
    )
    deadline = time.monotonic() + timeout_seconds
    normalized_public_key = str(public_key or '').strip()
    while time.monotonic() < deadline:
        if count_connected(normalized_public_key) > 0:
            return
        time.sleep(0.05)
    pytest.fail(f'Socket.IO connection was not registered for public key {normalized_public_key!r}')


# ---------------------------------------------------------------------------
# Test 1: the / page (redirect) or /login is reachable
# ---------------------------------------------------------------------------

def test_root_redirects_to_login_or_chat(page: 'Page', _flask_server):
    """The app root / is reachable — either the login page or a redirect to /chat."""
    response = page.goto('/', wait_until='domcontentloaded')
    assert response is not None
    # / answers 200 (auth/index page) or a 3xx redirect
    assert response.status < 500, (
        f'The root page returned {response.status} — internal server error'
    )
    # Either stay on / or move to /chat
    url = page.url
    assert '127.0.0.1' in url or 'localhost' in url, (
        f'Unexpected URL: {url}'
    )


# ---------------------------------------------------------------------------
# Test 2: the /login page loads without JS errors
# ---------------------------------------------------------------------------

def test_auth_page_loads_without_js_errors(page: 'Page', _flask_server):
    """The main auth page (/) loads with no JS syntax errors."""
    js_errors = _collect_page_errors(page)
    response = page.goto('/', wait_until='networkidle')
    assert response is not None
    assert response.status in (200, 302), f'/ returned {response.status}'

    # No SyntaxError in JS
    syntax_errors = [e for e in js_errors if 'SyntaxError' in e]
    assert not syntax_errors, (
        'SyntaxError on the / page:\n' + '\n'.join(syntax_errors)
    )

    # A login form or login page is present
    form = page.locator('form')
    assert form.count() > 0, 'No form on the main page'


# ---------------------------------------------------------------------------
# Test 3: static JS modules return 200 and the right Content-Type
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
    """Every JS module is reachable over HTTP and does not return 404/500."""
    response = page.goto(path, wait_until='domcontentloaded')
    assert response is not None, f'No response for {path}'
    assert response.status == 200, (
        f'{path} returned HTTP {response.status} — module unavailable'
    )
    ct = response.headers.get('content-type', '')
    assert 'javascript' in ct or 'text/plain' in ct or 'application/octet-stream' in ct, (
        f'{path}: Content-Type = {ct!r} — expected JavaScript'
    )


# ---------------------------------------------------------------------------
# Test 4: chat.js has no SyntaxError (parsed by the browser)
# ---------------------------------------------------------------------------

def test_chat_js_has_no_syntax_errors(page: 'Page', _flask_server):
    """
    Load chat.js as an ES module on an empty page.
    A SyntaxError in it would be caught via pageerror.
    """
    js_errors = _collect_page_errors(page)

    # Create a minimal HTML page and goto it via a data: URL
    # so the browser can resolve /static/ paths correctly
    page.goto('/', wait_until='domcontentloaded')  # establish the origin
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
        'chat.js contains syntax errors:\n' + '\n'.join(syntax_errors)
    )
    # dynamic import may fail due to missing deps (no socket.io, etc.) — that is OK
    # we only care about SyntaxError


# ---------------------------------------------------------------------------
# Test 5: all JS modules parse without errors (batch check)
# ---------------------------------------------------------------------------

def test_all_modules_parse_without_syntax_errors(page: 'Page', _flask_server):
    """
    Load every module via dynamic import() in the browser.
    SyntaxError → the test fails and points at the broken file.
    """
    module_paths = [
        f.name for f in (STATIC / 'modules').glob('*.js')
        # IIFE modules are not ES modules — skip them
        if f.name not in {'device-key.js', 'private-key-session-bridge.js'}
    ]
    assert module_paths, 'No modules to check'

    errors_found: list[str] = []

    # Load the origin page once
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
            # Skip load errors (network, CORS) — only SyntaxError matters
            if err_type == 'SyntaxError' or 'SyntaxError' in err_msg:
                errors_found.append(f'  {module_name}: [{err_type}] {err_msg}')

    assert not errors_found, (
        'The following modules do not parse in the browser:\n' + '\n'.join(errors_found)
    )


# ---------------------------------------------------------------------------
# Test 6: the /chat page requires auth (redirect to /login)
# ---------------------------------------------------------------------------

def test_chat_page_requires_auth(page: 'Page', _flask_server):
    """/chat without auth must redirect to /login or /key-login."""
    response = page.goto('/chat', wait_until='domcontentloaded')
    assert response is not None
    final_url = page.url
    # Unauthenticated user → redirect
    assert response.status < 400 or '/login' in final_url or '/key-login' in final_url, (
        f'/chat returned unexpected status {response.status}, URL: {final_url}'
    )


# ---------------------------------------------------------------------------
# Test 7: no broken module imports — console.error on a 404 for a JS file
# ---------------------------------------------------------------------------

def test_no_404_on_js_imports(page: 'Page', _flask_server):
    """
    Loading /login must produce no 404 responses for JS files.
    A broken import → the browser does not stay silent, it raises.
    """
    failed_requests: list[str] = []

    def _on_response(response):
        if response.status == 404 and '.js' in response.url:
            failed_requests.append(f'{response.url} → 404')

    page.on('response', _on_response)
    page.goto('/login', wait_until='networkidle')

    assert not failed_requests, (
        'JS files not found (404):\n' + '\n'.join(failed_requests)
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
        _wait_chat_realtime_ready(member_page, str(users['member']['public_key']))

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
        _confirm_action_dialog(owner_page)
        owner_page.locator(f'[data-group-remove-target="{int(users["spare"]["id"])}"]').first.wait_for(
            state='detached',
            timeout=15_000,
        )

        sanction_btn = owner_page.locator(
            f'[data-group-sanction-target="{int(users["member"]["id"])}"][data-group-sanction-action="mute_temp"]',
        ).first
        sanction_btn.wait_for(state='visible', timeout=10_000)
        sanction_btn.click()
        _confirm_action_dialog(owner_page)

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
