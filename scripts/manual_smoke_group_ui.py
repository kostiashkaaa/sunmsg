from __future__ import annotations

import json
import socket
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import create_app  # noqa: E402
from app.config import load_environment  # noqa: E402
from app.database import get_db_connection  # noqa: E402
from app.extensions import socketio  # noqa: E402
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ART_ROOT = ROOT / 'tests' / '.manual_artifacts'
ART_DIR = ART_ROOT / f"group-ui-smoke-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
ART_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = ROOT / '.tmp_manual_ui_smoke.db'
BASE_URL = 'http://127.0.0.1:5005'
GROUP_TITLE = 'Manual Smoke Group'


def _wait_port(host: str, port: int, timeout: float = 15.0) -> None:
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.5)
        try:
            sock.connect((host, port))
            sock.close()
            return
        except OSError as exc:
            last_error = exc
            time.sleep(0.2)
        finally:
            try:
                sock.close()
            except Exception:
                pass
    raise RuntimeError(f'Port {host}:{port} did not open in time: {last_error}')


def _seed_db() -> None:
    conn = get_db_connection()
    try:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'alice', 'Alice'),
                (2, 'pk-2', 'bob', 'Bob'),
                (3, 'pk-3', 'carol', 'Carol')
            '''
        )
        conn.commit()
    finally:
        conn.close()


def _session_cookie_for_user(app, user_id: int, public_key: str) -> str:
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = int(user_id)
        sess['public_key_pem'] = str(public_key)
    resp = client.get('/chat')
    if resp.status_code != 200:
        raise RuntimeError(f'/chat auth bootstrap failed for user {user_id}: {resp.status_code}')
    cookie = client.get_cookie('session')
    if not cookie or not cookie.value:
        raise RuntimeError(f'No session cookie for user {user_id}')
    return cookie.value


def _open_group_create(page):
    page.locator('#searchInput').click()
    page.locator('[data-palette-action="group"]').click()
    page.locator('#groupCreateModal').wait_for(state='visible', timeout=10_000)


def _add_member_in_group_modal(page, query: str, target_user_id: int):
    search_input = page.locator('#groupMemberSearchInput')
    search_input.fill(query)
    btn = page.locator(f'[data-group-add-member-id="{target_user_id}"]')
    btn.wait_for(state='visible', timeout=10_000)
    btn.click()


def _click_contact_by_title(page, title: str):
    item = page.locator('#contactsList .contact-item', has=page.locator('.contact-name', has_text=title)).first
    item.wait_for(state='visible', timeout=15_000)
    item.click()


def _assert_chat_opened(page, title: str):
    page.locator('#chatTitle').wait_for(state='visible', timeout=10_000)
    deadline = time.time() + 10.0
    while time.time() < deadline:
        current = (page.locator('#chatTitle').inner_text() or '').strip()
        if title in current:
            return
        time.sleep(0.2)
    raise RuntimeError(f'Chat title did not switch to "{title}"')


def _open_group_profile(page):
    page.locator('#chatPartnerHeaderLink').click()
    page.locator('#partnerProfileDrawer').wait_for(state='visible', timeout=10_000)
    page.locator('#profileGroupSection').wait_for(state='visible', timeout=10_000)


def _open_group_edit(page):
    page.locator('#profileGroupEditBtn').click()
    page.locator('#groupEditModal').wait_for(state='visible', timeout=10_000)
    page.locator('#groupEditMembersList').wait_for(state='visible', timeout=10_000)


def main() -> int:
    print(f'[INFO] artifacts: {ART_DIR}')
    load_environment()

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(DB_PATH),
            'TESTING': True,
            'WTF_CSRF_ENABLED': False,
            'SESSION_COOKIE_SECURE': False,
            'SERVER_NAME': None,
            'PREFERRED_URL_SCHEME': 'http',
        },
    )
    _seed_db()

    user1_cookie = _session_cookie_for_user(app, 1, 'pk-1')
    user2_cookie = _session_cookie_for_user(app, 2, 'pk-2')

    server_thread = threading.Thread(
        target=lambda: socketio.run(
            app,
            host='127.0.0.1',
            port=5005,
            debug=False,
            use_reloader=False,
            allow_unsafe_werkzeug=True,
        ),
        daemon=True,
    )
    server_thread.start()
    _wait_port('127.0.0.1', 5005)

    report: dict[str, object] = {
        'base_url': BASE_URL,
        'artifacts_dir': str(ART_DIR),
        'checks': {},
        'timestamps': {'started_at': datetime.now().isoformat()},
    }

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx1 = browser.new_context(base_url=BASE_URL)
        ctx2 = browser.new_context(base_url=BASE_URL)

        ctx1.add_cookies([{'name': 'session', 'value': user1_cookie, 'url': BASE_URL}])
        ctx2.add_cookies([{'name': 'session', 'value': user2_cookie, 'url': BASE_URL}])

        page1 = ctx1.new_page()
        page2 = ctx2.new_page()

        page1.goto('/chat', wait_until='domcontentloaded')
        page2.goto('/chat', wait_until='domcontentloaded')

        page1.locator('#contactsList').wait_for(state='visible', timeout=15_000)
        page2.locator('#contactsList').wait_for(state='visible', timeout=15_000)
        page1.screenshot(path=str(ART_DIR / '00_user1_chat_ready.png'), full_page=True)
        page2.screenshot(path=str(ART_DIR / '00_user2_chat_ready.png'), full_page=True)

        nav_entries_before = page2.evaluate("performance.getEntriesByType('navigation').length")

        _open_group_create(page1)
        page1.locator('#groupTitleInput').fill(GROUP_TITLE)
        _add_member_in_group_modal(page1, 'bob', 2)
        _add_member_in_group_modal(page1, 'car', 3)
        page1.screenshot(path=str(ART_DIR / '01_group_create_modal_filled.png'), full_page=True)

        page1.locator('#groupCreateSubmitBtn').click()
        page1.locator('#groupCreateModal').wait_for(state='hidden', timeout=15_000)

        _click_contact_by_title(page1, GROUP_TITLE)
        _assert_chat_opened(page1, GROUP_TITLE)
        page1.screenshot(path=str(ART_DIR / '02_user1_group_opened.png'), full_page=True)

        # Realtime appearance on second participant without reload.
        contact_user2 = page2.locator('#contactsList .contact-item .contact-name', has_text=GROUP_TITLE).first
        contact_user2.wait_for(state='visible', timeout=20_000)
        nav_entries_after = page2.evaluate("performance.getEntriesByType('navigation').length")
        report['checks']['group_create_realtime_no_reload'] = {
            'ok': bool(nav_entries_after == nav_entries_before),
            'navigation_entries_before': nav_entries_before,
            'navigation_entries_after': nav_entries_after,
        }
        page2.screenshot(path=str(ART_DIR / '03_user2_group_appeared_realtime.png'), full_page=True)

        # Owner removes member #3 in group manage panel.
        _open_group_profile(page1)
        _open_group_edit(page1)

        remove_btn = page1.locator('[data-group-remove-target="3"]').first
        remove_btn.wait_for(state='visible', timeout=10_000)
        remove_btn.click()

        deadline = time.time() + 15.0
        while time.time() < deadline:
            if page1.locator('[data-group-remove-target=\"3\"]').count() == 0:
                break
            time.sleep(0.2)
        else:
            raise RuntimeError('User #3 remove button is still visible after remove_member.')
        page1.screenshot(path=str(ART_DIR / '04_after_remove_member_user3.png'), full_page=True)
        report['checks']['remove_member_visible_effect'] = {'ok': True}

        # Owner applies sanction to member #2.
        sanction_btn = page1.locator('[data-group-sanction-target="2"][data-group-sanction-action="mute_temp"]').first
        sanction_btn.wait_for(state='visible', timeout=10_000)
        sanction_btn.click()
        page1.screenshot(path=str(ART_DIR / '05_after_sanction_user2.png'), full_page=True)

        # User2 sees sanction + submits appeal in members panel.
        _click_contact_by_title(page2, GROUP_TITLE)
        _assert_chat_opened(page2, GROUP_TITLE)
        _open_group_profile(page2)

        appeal_btn = page2.locator('[data-group-appeal-sanction-id]').first
        appeal_btn.wait_for(state='visible', timeout=20_000)
        page2.screenshot(path=str(ART_DIR / '06_user2_sanction_visible_with_appeal.png'), full_page=True)

        appeal_btn.click()
        page2.locator('#profileGroupMembers', has_text='Appeal is pending review.').wait_for(state='visible', timeout=20_000)
        page2.screenshot(path=str(ART_DIR / '07_user2_appeal_pending.png'), full_page=True)

        report['checks']['sanction_and_appeal_states_visible'] = {'ok': True}

        ctx1.close()
        ctx2.close()
        browser.close()

    report['timestamps']['finished_at'] = datetime.now().isoformat()
    report_path = ART_DIR / 'report.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'[OK] report: {report_path}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except PlaywrightTimeoutError as exc:
        print(f'[FAIL] Playwright timeout: {exc}')
        raise
