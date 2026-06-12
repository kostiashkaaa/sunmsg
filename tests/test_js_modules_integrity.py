"""
JS module integrity checks.

Verifies after EVERY refactoring step that:
  1. All modules in static/modules/ exist and contain the expected exports.
  2. chat.js only imports files that exist (no broken import paths).
  3. Every module imported in chat.js actually exports what is imported.
  4. No duplicate export names within a module.
  5. No cyclic imports (A→B→A) between modules.
  6. Every new module follows the pattern: factory function or named export.
"""

from __future__ import annotations

import re
from pathlib import Path
from collections import defaultdict

import pytest

ROOT  = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'static'
MODULES_DIR = STATIC / 'modules'
CHAT_JS = STATIC / 'chat.js'
CHAT_RUNTIME_JS = STATIC / 'chat-runtime.js'
CHAT_ENTRYPOINTS = [CHAT_JS, CHAT_RUNTIME_JS]
SETTINGS_NAV_SHELL_JS = STATIC / 'pages' / 'settings' / 'nav-shell.js'
SEARCH_OVERLAY_JS = MODULES_DIR / 'search-overlay.js'
CHAT_SHELL_SETTINGS_OVERLAY_JS = STATIC / 'pages' / 'chat-shell' / 'settings-overlay.js'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read(path: Path) -> str:
    return path.read_text(encoding='utf-8')


def _get_exports(src: str) -> set[str]:
    """Extract all export identifiers from a JS file."""
    exports: set[str] = set()
    # export function foo(  /  export async function foo(
    for m in re.finditer(r'export\s+(?:async\s+)?function\s+(\w+)', src):
        exports.add(m.group(1))
    # export const/let/var FOO =
    for m in re.finditer(r'export\s+(?:const|let|var)\s+(\w+)', src):
        exports.add(m.group(1))
    # export class Foo
    for m in re.finditer(r'export\s+class\s+(\w+)', src):
        exports.add(m.group(1))
    # export { foo, bar as baz }
    for m in re.finditer(r'export\s*\{([^}]+)\}', src):
        for item in m.group(1).split(','):
            item = item.strip()
            # handle "foo as bar"
            alias_m = re.match(r'\w+\s+as\s+(\w+)', item)
            if alias_m:
                exports.add(alias_m.group(1))
            elif re.match(r'^\w+$', item):
                exports.add(item)
    # export default function / export default class
    for m in re.finditer(r'export\s+default\s+(?:function|class)\s+(\w+)', src):
        exports.add(m.group(1))
    return exports


def _parse_chatjs_imports(src: str) -> list[dict]:
    """
    Return a list of { path, names } for all import statements in chat.js.
    names is the list of imported identifiers.
    """
    results = []
    # Support multiline imports
    import_blocks = re.finditer(
        r"import\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"]",
        src,
        re.DOTALL,
    )
    for m in import_blocks:
        raw_names = m.group(1)
        module_path = m.group(2)
        names = []
        for raw in raw_names.split(','):
            raw = raw.strip()
            if not raw:
                continue
            # "foo as bar" → bar is the local name, foo is the export
            alias_m = re.match(r'(\w+)\s+as\s+(\w+)', raw)
            if alias_m:
                names.append(alias_m.group(1))   # exported name
            elif re.match(r'^\w+$', raw):
                names.append(raw)
        results.append({'path': module_path, 'names': names})

    # import * as Foo from '...'
    star_imports = re.finditer(
        r"import\s*\*\s*as\s+\w+\s+from\s*['\"]([^'\"]+)['\"]",
        src,
    )
    for m in star_imports:
        results.append({'path': m.group(1), 'names': ['*']})

    # import { default } / side-effect imports: import '...' — not needed
    return results


def _resolve_module_path(import_path: str) -> Path | None:
    """Resolve a relative import path to an absolute Path."""
    # strip query string like ?v=20260430j
    clean = import_path.split('?')[0]
    if clean.startswith('./modules/'):
        return MODULES_DIR / clean[len('./modules/'):]
    if clean.startswith('./'):
        return STATIC / clean[2:]
    return None


# ---------------------------------------------------------------------------
# Test: all modules in modules/ exist and are non-empty
# ---------------------------------------------------------------------------

def test_all_modules_exist_and_non_empty() -> None:
    """Every *.js in static/modules/ must exist and be non-empty."""
    js_files = list(MODULES_DIR.glob('*.js'))
    assert js_files, 'static/modules/ contains no .js files!'
    for path in js_files:
        assert path.stat().st_size > 0, f'{path.name}: file is empty!'


# ---------------------------------------------------------------------------
# Test: chat.js only imports files that actually exist
# ---------------------------------------------------------------------------

def test_chatjs_imports_resolve_to_existing_files() -> None:
    """Every import '...' in chat.js must point to a file that actually exists."""
    missing = []
    for entrypoint in CHAT_ENTRYPOINTS:
        src = _read(entrypoint)
        imports = _parse_chatjs_imports(src)
        for imp in imports:
            resolved = _resolve_module_path(imp['path'])
            if resolved is None:
                continue  # external / ignored
            if not resolved.exists():
                missing.append(f"  {entrypoint.name}: import from '{imp['path']}' → {resolved} (NOT FOUND)")

    assert not missing, (
        'chat.js imports files that do not exist:\n' + '\n'.join(missing)
    )


# ---------------------------------------------------------------------------
# Test: every imported identifier is actually exported by its module
# ---------------------------------------------------------------------------

def test_chatjs_imported_names_exist_in_modules() -> None:
    """
    For every `import { foo } from './modules/x.js'` in chat.js:
    x.js must actually export `foo`.
    Modules imported via `* as Foo` are skipped (star import).
    """
    failures: list[str] = []

    for entrypoint in CHAT_ENTRYPOINTS:
        src = _read(entrypoint)
        imports = _parse_chatjs_imports(src)
        for imp in imports:
            if '*' in imp['names']:
                continue  # star import — not checked
            resolved = _resolve_module_path(imp['path'])
            if resolved is None or not resolved.exists():
                continue  # already checked above
            module_src = _read(resolved)
            module_exports = _get_exports(module_src)
            for name in imp['names']:
                if name not in module_exports:
                    failures.append(
                        f"  {entrypoint.name}: '{name}' is imported from '{imp['path']}' "
                        f"but never exported. Available: {sorted(module_exports)[:10]}"
                    )

    assert not failures, (
        'chat.js imports non-existent exports:\n' + '\n'.join(failures)
    )


# ---------------------------------------------------------------------------
# Test: no duplicate export names within a module
# ---------------------------------------------------------------------------

def test_no_duplicate_exports_in_modules() -> None:
    """No module may have two exports with the same name."""
    for path in sorted(MODULES_DIR.glob('*.js')):
        src = _read(path)
        seen: dict[str, int] = defaultdict(int)

        for m in re.finditer(r'export\s+(?:async\s+)?function\s+(\w+)', src):
            seen[m.group(1)] += 1
        for m in re.finditer(r'export\s+(?:const|let|var)\s+(\w+)', src):
            seen[m.group(1)] += 1
        for m in re.finditer(r'export\s+class\s+(\w+)', src):
            seen[m.group(1)] += 1

        dupes = [name for name, count in seen.items() if count > 1]
        assert not dupes, (
            f'{path.name}: duplicate export names: {dupes}'
        )


# ---------------------------------------------------------------------------
# Test: every module has at least one export
# ---------------------------------------------------------------------------

# IIFE modules that intentionally use window.* instead of ES6 exports.
# They load as <script> before chat.js and are not part of the ES module system.
_IIFE_MODULES = {
    'device-key.js',              # exposes window.deviceKey
    'key-rotation.js',            # exposes window.keyRotation
    'private-key-session-bridge.js',  # exposes window.sunPrivateKeySession
    'bi-icon-adapter.js',  # adapts legacy bootstrap icon classes at runtime
    'e2ee-status-ui.js',  # exposes window.e2eeStatusUI (E2EE badge + verify dialog)
}


def test_each_module_has_at_least_one_export() -> None:
    """Every ES module in modules/ must export something.
    IIFE modules (window.*) are excluded — they do not use ES6 exports."""
    no_export: list[str] = []
    for path in sorted(MODULES_DIR.glob('*.js')):
        if path.name in _IIFE_MODULES:
            continue  # IIFE — not an ES module, no export required
        src = _read(path)
        exports = _get_exports(src)
        # Also check for export default
        has_default = bool(re.search(r'\bexport\s+default\b', src))
        if not exports and not has_default:
            no_export.append(path.name)

    assert not no_export, (
        'The following modules contain no exports:\n'
        + '\n'.join(f'  {n}' for n in no_export)
    )


# ---------------------------------------------------------------------------
# Test: no direct window.* or document.* access in module top-level scope
#       (inside functions is fine)
# ---------------------------------------------------------------------------

def test_modules_do_not_access_dom_at_top_level() -> None:
    """
    Modules must not touch document.getElementById / window.* at the top
    level on import. The DOM is only available after DOMContentLoaded.
    Only explicit assignments outside functions are checked.
    """
    top_level_dom_re = re.compile(
        r'^(?:const|let|var)\s+\w+\s*=\s*document\.',
        re.MULTILINE,
    )
    violations: list[str] = []
    # Exclude modules that intentionally cache at module level (legit)
    EXCLUDED = {'utils.js', 'csrf.js', 'app-url.js', 'check-glyph.js'}
    for path in sorted(MODULES_DIR.glob('*.js')):
        if path.name in EXCLUDED:
            continue
        src = _read(path)
        # Strip lines inside functions — simplified heuristic:
        # treat lines without 4+ spaces of indentation as top-level
        top_level_lines = [
            line for line in src.splitlines()
            if not line.startswith('    ') and not line.startswith('\t')
        ]
        top_level = '\n'.join(top_level_lines)
        if top_level_dom_re.search(top_level):
            violations.append(path.name)

    assert not violations, (
        'The following modules access document.* at the top level:\n'
        + '\n'.join(f'  {n}' for n in violations)
    )


# ---------------------------------------------------------------------------
# Test: the chat.js final initialization line is present
# ---------------------------------------------------------------------------

def test_chatjs_initialization_entry_point_present() -> None:
    """chat.js must end with an initChatPage call on DOMContentLoaded."""
    src = _read(CHAT_JS)
    assert 'initChatPage' in src, 'chat.js: initChatPage function is missing!'
    assert 'DOMContentLoaded' in src or "document.readyState === 'loading'" in src, (
        'chat.js: no DOMContentLoaded hook — initialization may never run'
    )


# ---------------------------------------------------------------------------
# Test: critical modules exist and export their key functions
# ---------------------------------------------------------------------------

CRITICAL_MODULE_EXPORTS = {
    'chat-state.js': [
        'getChatState', 'createChatState', 'getMessageKey',
        'upsertChatMessage', 'prependChatMessages', 'removeChatMessages',
        'setChatMessages', 'findMessageIndex', 'estimateMessageHeight',
        'CHAT_DEFAULT_MESSAGE_HEIGHT',
    ],
    'message-rendering.js': [
        'buildMessageElement', 'getMessageDayKey', 'getOutgoingStatus',
        'buildTickHtml', 'isSameMessageGroup', 'getMessageGroup',
    ],
    'reactions.js': [
        'normalizeMessageReactions', 'areMessageReactionsEqual',
        'computeOptimisticReactions', 'buildMessageReactionsHtml',
        'getReactionMessageKey', 'REACTION_PICKER_EMOJIS',
    ],
    'utils.js': [
        'escapeHtml', 'formatTime', 'formatFullTimestamp',
        'parseSunFilePayload', 'sanitizeFileUri', 'renderMessagePreviewHtml',
    ],
    'chat-socket-client.js': [
        'createChatSocketClient', 'createSocketEmitter',
    ],
    'chat-history-runtime.js': [
        'createChatHistoryRuntime',
    ],
    'chat-partner-network.js': [
        'createChatConnectionStatusPresenter',
        'createOnlineStatusStateController',
        'loadOnlineStatusFlow',
    ],
    'chat-sidebar-status.js': [
        'computeSidebarStatusSnapshot', 'syncSidebarStatusBar',
        'runSidebarStatusAction',
    ],
    'chat-tab-alerts.js': [
        'createTabAlertController',
    ],
    'profile-drawer.js': [
        'initProfileDrawer', 'parseUtcDate',
    ],
    'composer.js': [
        'initComposer',
    ],
    'voice-recorder.js': [
        'initVoiceRecorder',
    ],
    'keyboard-shortcuts.js': [
        'initKeyboardShortcuts',
    ],
    'message-context-menu.js': [
        'initMessageContextMenu',
    ],
    'reaction-picker.js': [
        'initReactionPickerController',
    ],
    'message-thread-banners.js': [
        'initReplyBar', 'initPinnedBar',
    ],
    'chat-contacts-sidebar.js': [
        'initChatContactsSidebar',
    ],
    'chat-file-send.js': [
        'sendFileMessageFlow',
    ],
    'chat-text-send.js': [
        'sendTextMessageFlow',
    ],
    'chat-edit-flow.js': [
        'handleComposerEditFlow',
    ],
    'block-ui.js': [
        'applyBlockNoticeUI', 'normalizeBlockState',
    ],
    'chat-shell-ui.js': [
        'getStoredString', 'setStoredString', 'hideBootOverlay',
        'copyTextToClipboard', 'showToast' if False else 'addTapFeedback',
    ],
    'chat-activity.js': [
        'createActivityReporter', 'bindWindowActivityEvents',
    ],
    'dialogs.js': [
        'showToast', 'initDialogRequests',
    ],
    'focus-trap.js': [
        'activateFocusTrap', 'deactivateFocusTrap',
    ],
    'pinned-contacts.js': [
        'initPinnedContactsDnD', 'sortContactsList', 'applyPinnedState',
    ],
    'chat-overlays.js': [
        'initContactContextMenu',
    ],
    'chat-idb.js': [
        'openChatDb',
        'readCachedMessages',
        'writeCachedMessages',
        'removeCachedMessages',
    ],
}


@pytest.mark.parametrize('module_name,required_exports', [
    (name, exports)
    for name, exports in CRITICAL_MODULE_EXPORTS.items()
])
def test_critical_module_exports(module_name: str, required_exports: list[str]) -> None:
    """Every critical module must export all required names."""
    path = MODULES_DIR / module_name
    assert path.exists(), f'Module {module_name} does not exist!'
    src = _read(path)
    actual_exports = _get_exports(src)
    missing = [name for name in required_exports if name not in actual_exports]
    assert not missing, (
        f'{module_name}: missing required exports: {missing}\n'
        f'Current exports: {sorted(actual_exports)}'
    )


# ---------------------------------------------------------------------------
# Test: no imports from removed/non-existent paths in any module
# ---------------------------------------------------------------------------

def test_no_broken_imports_in_modules() -> None:
    """Every import inside modules/ must point to a file that actually exists."""
    # Allowed external (npm) paths — skipped
    external_prefixes = ('socket.io', 'https://', 'http://')
    failures: list[str] = []

    for path in sorted(MODULES_DIR.glob('*.js')):
        src = _read(path)
        for m in re.finditer(r"(?:import|export)\s+.*?from\s+['\"]([^'\"]+)['\"]", src):
            raw_path = m.group(1).split('?')[0]
            if any(raw_path.startswith(pfx) for pfx in external_prefixes):
                continue
            if raw_path.startswith('./') or raw_path.startswith('../'):
                resolved = (path.parent / raw_path).resolve()
                if not resolved.exists():
                    failures.append(
                        f'  {path.name}: import from {raw_path!r} → {resolved} (NOT FOUND)'
                    )

    assert not failures, (
        'Broken imports in modules:\n' + '\n'.join(failures)
    )




def test_settings_search_clear_event_unhides_cards() -> None:
    """
    Regression: clearing an <input type="search"> via its clear button
    dispatches a `search` event, not `input`.
    Without the handler, section cards would stay hidden after clearing.
    """
    src = _read(SETTINGS_NAV_SHELL_JS)
    assert "addEventListener('search', runSearchFilter)" in src, (
        'settings nav-shell must listen to search event to handle clear-button resets.'
    )
    assert "if (!query) {" in src and "card.hidden = false;" in src, (
        'settings nav-shell must unhide section cards when search query is empty.'
    )
    assert "item.hidden = !(" not in src, (
        'settings nav-shell must not hide navigation tabs during search filtering.'
    )


def test_settings_mobile_nav_toggle_uses_section_title_without_nav_item() -> None:
    """Mobile settings toggle should show the open detail title even when a section has no nav item."""
    src = _read(SETTINGS_NAV_SHELL_JS)
    assert "function updateNavToggleLabel(activeItem, fallbackLabel = '')" in src
    assert "|| fallbackLabel" in src, (
        'settings nav-shell must let non-nav detail entries provide the mobile toggle label.'
    )
    assert 'const fallbackLabel = activeNavKey || id' in src
    assert 'navKeyTitles[activeNavKey] || sectionTitles[id]' in src
    assert 'updateNavToggleLabel(activeItem, fallbackLabel)' in src


def test_command_palette_api_opens_actions_panel() -> None:
    """Imperative command palette open should expose command actions, not just search."""
    overlay = _read(SEARCH_OVERLAY_JS)
    settings_overlay = _read(CHAT_SHELL_SETTINGS_OVERLAY_JS)

    assert "if (!query.trim()) {" in overlay
    assert "setTab('actions')" in overlay, (
        'search-overlay.js: window.openCommandPalette("") must reveal action buttons.'
    )
    assert 'const CONTROLLER_KEY = ' in overlay
    assert 'window[CONTROLLER_KEY] = controller' in overlay
    assert "import('../../modules/search-overlay.js')" in settings_overlay
    assert 'controller?.openCommandPalette?.(prefill)' in settings_overlay, (
        'settings-overlay.js: chat shell wrapper must open the real search overlay controller.'
    )

# ---------------------------------------------------------------------------
# Test: chat.js does not grow after refactoring
# ---------------------------------------------------------------------------

# Set this value BEFORE starting a refactor as the baseline.
# Update it after every successful module extraction.
CHATJS_MAX_LINES = 8450   # updated baseline ceiling for current modularized chat.js

def test_chatjs_does_not_grow() -> None:
    """chat.js must not get BIGGER after refactoring."""
    src = _read(CHAT_JS)
    line_count = src.count('\n')
    assert line_count <= CHATJS_MAX_LINES, (
        f'chat.js grew: {line_count} lines > max {CHATJS_MAX_LINES}. '
        f'Make sure logic is EXTRACTED, not duplicated.'
    )


# ---------------------------------------------------------------------------
# Test: chat.js imports newly extracted modules (checklist)
#       Uncomment entries as modules are added.
# ---------------------------------------------------------------------------

NEW_REQUIRED_MODULES: list[str] = [
    './modules/chat-message-mutations.js',
    # './modules/chat-scroll.js',         # Phase 1
    # './modules/chat-mute.js',           # Phase 1
    # './modules/chat-unread.js',         # Phase 1
    # './modules/chat-virtual-renderer.js', # Phase 2
    # './modules/chat-dom-snapshot.js',   # Phase 2
    # './modules/chat-mobile-ui.js',      # Phase 3
    # './modules/chat-message-scale.js',  # Phase 3
]

@pytest.mark.skipif(
    not NEW_REQUIRED_MODULES,
    reason='No new modules to check — uncomment entries as refactoring proceeds',
)
def test_chatjs_imports_new_refactored_modules() -> None:
    """chat.js must import the newly extracted modules."""
    src = _read(CHAT_JS) + '\n' + _read(CHAT_RUNTIME_JS)
    missing = [m for m in NEW_REQUIRED_MODULES if m not in src]
    assert not missing, (
        'chat.js does not import the following new modules:\n'
        + '\n'.join(f'  {m}' for m in missing)
    )
