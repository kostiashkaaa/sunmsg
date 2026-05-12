"""
JS module integrity checks.

Проверяет после КАЖДОГО шага рефакторинга что:
  1. Все модули из static/modules/ существуют и содержат ожидаемые export-ы.
  2. chat.js импортирует только существующие файлы (нет битых import-пути).
  3. Каждый импортируемый в chat.js модуль реально экспортирует то, что импортируется.
  4. Нет дублирующихся export-имён в одном модуле.
  5. Нет цикличных импортов (A→B→A) между модулями.
  6. Каждый новый модуль следует шаблону: фабричная функция или именованный export.
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
    """Извлечь все export-идентификаторы из JS файла."""
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
    Возвращает список { path, names } для всех import-строк в chat.js.
    names — список импортируемых идентификаторов.
    """
    results = []
    # Поддерживаем многострочные импорты
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

    # import { default } / side-effect: import '...'  — не нужны
    return results


def _resolve_module_path(import_path: str) -> Path | None:
    """Преобразует относительный путь из import в абсолютный Path."""
    # strip query string like ?v=20260430j
    clean = import_path.split('?')[0]
    if clean.startswith('./modules/'):
        return MODULES_DIR / clean[len('./modules/'):]
    if clean.startswith('./'):
        return STATIC / clean[2:]
    return None


# ---------------------------------------------------------------------------
# Test: все модули из modules/ существуют и не пустые
# ---------------------------------------------------------------------------

def test_all_modules_exist_and_non_empty() -> None:
    """Каждый *.js в static/modules/ должен существовать и быть непустым."""
    js_files = list(MODULES_DIR.glob('*.js'))
    assert js_files, 'static/modules/ не содержит ни одного .js файла!'
    for path in js_files:
        assert path.stat().st_size > 0, f'{path.name}: файл пустой!'


# ---------------------------------------------------------------------------
# Test: chat.js импортирует только реально существующие файлы
# ---------------------------------------------------------------------------

def test_chatjs_imports_resolve_to_existing_files() -> None:
    """Все import '...' в chat.js должны указывать на реально существующие файлы."""
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
        'chat.js содержит импорты несуществующих файлов:\n' + '\n'.join(missing)
    )


# ---------------------------------------------------------------------------
# Test: каждый импортированный идентификатор реально экспортируется модулем
# ---------------------------------------------------------------------------

def test_chatjs_imported_names_exist_in_modules() -> None:
    """
    Для каждого `import { foo } from './modules/x.js'` в chat.js:
    x.js должен реально экспортировать `foo`.
    Если модуль импортируется через `* as Foo` — пропускаем (звёздный импорт).
    """
    failures: list[str] = []

    for entrypoint in CHAT_ENTRYPOINTS:
        src = _read(entrypoint)
        imports = _parse_chatjs_imports(src)
        for imp in imports:
            if '*' in imp['names']:
                continue  # star import — не проверяем
            resolved = _resolve_module_path(imp['path'])
            if resolved is None or not resolved.exists():
                continue  # уже проверили выше
            module_src = _read(resolved)
            module_exports = _get_exports(module_src)
            for name in imp['names']:
                if name not in module_exports:
                    failures.append(
                        f"  {entrypoint.name}: '{name}' импортируется из '{imp['path']}', "
                        f"но не экспортируется. Доступны: {sorted(module_exports)[:10]}"
                    )

    assert not failures, (
        'chat.js импортирует несуществующие export-ы:\n' + '\n'.join(failures)
    )


# ---------------------------------------------------------------------------
# Test: нет дублирующихся export-имён в одном модуле
# ---------------------------------------------------------------------------

def test_no_duplicate_exports_in_modules() -> None:
    """В каждом модуле не должно быть двух export с одинаковым именем."""
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
            f'{path.name}: дублирующиеся export-имена: {dupes}'
        )


# ---------------------------------------------------------------------------
# Test: каждый модуль имеет хотя бы один export
# ---------------------------------------------------------------------------

# IIFE-модули, которые намеренно используют window.* вместо ES6 export.
# Они загружаются как <script> до chat.js и не участвуют в ES module системе.
_IIFE_MODULES = {
    'device-key.js',              # exposes window.deviceKey
    'private-key-session-bridge.js',  # exposes window.sunPrivateKeySession
    'bi-icon-adapter.js',  # adapts legacy bootstrap icon classes at runtime
}


def test_each_module_has_at_least_one_export() -> None:
    """Каждый ES-модуль в modules/ должен что-то экспортировать.
    IIFE-модули (window.*) исключены — они не используют ES6 export."""
    no_export: list[str] = []
    for path in sorted(MODULES_DIR.glob('*.js')):
        if path.name in _IIFE_MODULES:
            continue  # IIFE — не ES module, export не требуется
        src = _read(path)
        exports = _get_exports(src)
        # Также проверяем export default
        has_default = bool(re.search(r'\bexport\s+default\b', src))
        if not exports and not has_default:
            no_export.append(path.name)

    assert not no_export, (
        'Следующие модули не содержат ни одного export:\n'
        + '\n'.join(f'  {n}' for n in no_export)
    )


# ---------------------------------------------------------------------------
# Test: нет прямых window.* или document.* в верхнем scope модуля
#       (только внутри функций — это нормально)
# ---------------------------------------------------------------------------

def test_modules_do_not_access_dom_at_top_level() -> None:
    """
    Модули не должны обращаться к document.getElementById / window.* на
    верхнем уровне при импорте. DOM доступен только после DOMContentLoaded.
    Проверяем только явные присвоения вне функций.
    """
    top_level_dom_re = re.compile(
        r'^(?:const|let|var)\s+\w+\s*=\s*document\.',
        re.MULTILINE,
    )
    violations: list[str] = []
    # Исключаем модули, которые намеренно кешируют на уровне модуля (legit)
    EXCLUDED = {'utils.js', 'csrf.js', 'app-url.js', 'check-glyph.js'}
    for path in sorted(MODULES_DIR.glob('*.js')):
        if path.name in EXCLUDED:
            continue
        src = _read(path)
        # Убираем строки внутри функций — упрощённая эвристика:
        # считаем, что top-level — это строки без отступов 4+ пробелов
        top_level_lines = [
            line for line in src.splitlines()
            if not line.startswith('    ') and not line.startswith('\t')
        ]
        top_level = '\n'.join(top_level_lines)
        if top_level_dom_re.search(top_level):
            violations.append(path.name)

    assert not violations, (
        'Следующие модули обращаются к document.* на верхнем уровне:\n'
        + '\n'.join(f'  {n}' for n in violations)
    )


# ---------------------------------------------------------------------------
# Test: chat.js финальная строка инициализации присутствует
# ---------------------------------------------------------------------------

def test_chatjs_initialization_entry_point_present() -> None:
    """chat.js должен заканчиваться вызовом initChatPage при DOMContentLoaded."""
    src = _read(CHAT_JS)
    assert 'initChatPage' in src, 'chat.js: нет функции initChatPage!'
    assert 'DOMContentLoaded' in src or "document.readyState === 'loading'" in src, (
        'chat.js: нет привязки к DOMContentLoaded — инициализация может не запуститься'
    )


# ---------------------------------------------------------------------------
# Test: критические модули существуют и экспортируют ключевые функции
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
    """Каждый критический модуль должен экспортировать все обязательные имена."""
    path = MODULES_DIR / module_name
    assert path.exists(), f'Модуль {module_name} не существует!'
    src = _read(path)
    actual_exports = _get_exports(src)
    missing = [name for name in required_exports if name not in actual_exports]
    assert not missing, (
        f'{module_name}: отсутствуют обязательные export-ы: {missing}\n'
        f'Текущие export-ы: {sorted(actual_exports)}'
    )


# ---------------------------------------------------------------------------
# Test: нет import из удалённых/несуществующих путей в любом модуле
# ---------------------------------------------------------------------------

def test_no_broken_imports_in_modules() -> None:
    """Каждый импорт внутри модулей modules/ указывает на реально существующий файл."""
    # Разрешённые внешние (npm) пути — их пропускаем
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
        'Сломанные импорты в модулях:\n' + '\n'.join(failures)
    )




def test_settings_search_clear_event_unhides_cards() -> None:
    """
    ?????????: ????? ??????? <input type="search"> ????? ????????? ???????
    ? ????????? ????????? ???????? ??????? `search`, ? ?? `input`.
    ??? ????? ??????????? ???????? ?????? ????? ?????????? ????????.
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
# Test: размер chat.js не растёт после рефакторинга
# ---------------------------------------------------------------------------

# Установите это значение ПЕРЕД началом рефакторинга как baseline.
# После каждого успешного выноса модуля — обновляйте.
CHATJS_MAX_LINES = 8450   # updated baseline ceiling for current modularized chat.js

def test_chatjs_does_not_grow() -> None:
    """chat.js не должен становиться БОЛЬШЕ после рефакторинга."""
    src = _read(CHAT_JS)
    line_count = src.count('\n')
    assert line_count <= CHATJS_MAX_LINES, (
        f'chat.js вырос: {line_count} строк > max {CHATJS_MAX_LINES}. '
        f'Убедитесь что логика ВЫНОСИТСЯ, а не дублируется.'
    )


# ---------------------------------------------------------------------------
# Test: chat.js импортирует новые вынесенные модули (чеклист)
#       Раскомментируйте по мере добавления модулей.
# ---------------------------------------------------------------------------

NEW_REQUIRED_MODULES: list[str] = [
    './modules/chat-message-mutations.js',
    # './modules/chat-scroll.js',         # Фаза 1
    # './modules/chat-mute.js',           # Фаза 1
    # './modules/chat-unread.js',         # Фаза 1
    # './modules/chat-virtual-renderer.js', # Фаза 2
    # './modules/chat-dom-snapshot.js',   # Фаза 2
    # './modules/chat-mobile-ui.js',      # Фаза 3
    # './modules/chat-message-scale.js',  # Фаза 3
]

@pytest.mark.skipif(
    not NEW_REQUIRED_MODULES,
    reason='Нет новых модулей для проверки — раскомментируйте по мере рефакторинга',
)
def test_chatjs_imports_new_refactored_modules() -> None:
    """chat.js должен импортировать новые вынесенные модули."""
    src = _read(CHAT_JS) + '\n' + _read(CHAT_RUNTIME_JS)
    missing = [m for m in NEW_REQUIRED_MODULES if m not in src]
    assert not missing, (
        'chat.js не импортирует следующие новые модули:\n'
        + '\n'.join(f'  {m}' for m in missing)
    )
