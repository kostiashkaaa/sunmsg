"""
UI/CSS invariants.

Гарантирует, что фиксы из аудита 2026-04-30 не разъедутся:
  • никаких `transition: all` в CSS-файлах (ломает GPU-композитинг)
  • каждый `height|min-height: 100vh` сопровождается парным `100dvh`
  • motion.css содержит ключевые токены и keyframes
  • присутствует focus-visible / overscroll-behavior / tap-target ≥ 44px
  • safe-area-inset покрывает мобильные отступы
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'static'

CSS_FILES = [
    STATIC / 'style.css',
    STATIC / 'motion.css',
    STATIC / 'pages' / 'chat.css',
    STATIC / 'pages' / 'auth.css',
    STATIC / 'pages' / 'settings.css',
]

# `transition: all` в комментариях допустим (есть пояснительный комментарий
# в motion.css), но в реальных правилах — запрещён.
TRANSITION_ALL_RE = re.compile(r'^\s*transition:\s*all\b', re.MULTILINE)
COMMENT_RE = re.compile(r'/\*.*?\*/', re.DOTALL)
CSS_IMPORT_RE = re.compile(
    r'@import\s+url\((["\']?)([^"\')]+)\1\)\s*(?:layer\([^)]*\))?\s*;'
)


def _strip_comments(css: str) -> str:
    return COMMENT_RE.sub('', css)


def _read_css_text(path: Path, visited: set[Path] | None = None) -> str:
    """Read CSS file and inline imported css files for text-based invariants."""
    resolved_path = path.resolve()
    seen = visited or set()
    if resolved_path in seen:
        return ''
    seen.add(resolved_path)

    css = path.read_text(encoding='utf-8').lstrip('\ufeff')
    imports = CSS_IMPORT_RE.findall(css)
    if not imports:
        return css

    parts = [css]
    for _, import_path in imports:
        nested_path = (path.parent / import_path).resolve()
        if nested_path.exists():
            parts.append(_read_css_text(nested_path, seen))
    return '\n'.join(parts)


@pytest.mark.parametrize('path', CSS_FILES, ids=lambda p: p.name)
def test_no_transition_all(path: Path) -> None:
    """`transition: all` запрещён — он анимирует width/height/box-shadow и
    срывает GPU-композитинг. Используй конкретные свойства."""
    assert path.exists(), f'CSS file missing: {path}'
    css = _strip_comments(_read_css_text(path))
    matches = TRANSITION_ALL_RE.findall(css)
    assert not matches, (
        f'{path.name}: найден `transition: all` — замени на конкретные '
        f'свойства (background-color, color, transform, opacity, …). '
        f'Найдено вхождений: {len(matches)}'
    )


VH_RE = re.compile(r'(height|min-height|max-height):\s*100vh\b')
DVH_RE = re.compile(r'(height|min-height|max-height):\s*100dvh\b')


@pytest.mark.parametrize('path', CSS_FILES, ids=lambda p: p.name)
def test_vh_paired_with_dvh(path: Path) -> None:
    """Каждое `100vh` должно иметь парный `100dvh`-фолбэк, иначе
    на iOS/мобильных адресная строка съедает viewport."""
    css = _strip_comments(_read_css_text(path))
    vh_count = len(VH_RE.findall(css))
    dvh_count = len(DVH_RE.findall(css))
    if vh_count == 0:
        return
    assert dvh_count >= vh_count, (
        f'{path.name}: 100vh встречается {vh_count} раз, '
        f'100dvh — только {dvh_count}. Каждое `100vh` должно идти в паре '
        f'с `100dvh` для мобильных браузеров.'
    )


def test_motion_tokens_present() -> None:
    """motion.css содержит обязательные spring-токены и keyframes."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')
    required_tokens = [
        '--m-spring',
        '--m-decel',
        '--m-accel',
        '--m-dur-fast',
        '--m-dur-base',
        '--m-dur-medium',
        '--m-press-scale',
    ]
    for token in required_tokens:
        assert token in css, f'motion.css: отсутствует токен {token}'

    required_keyframes = [
        '@keyframes m-fade-in',
        '@keyframes m-rise',
        '@keyframes m-pop',
        '@keyframes m-modal-in',
        '@keyframes m-shimmer',
        '@keyframes m-pop-overshoot',
    ]
    for kf in required_keyframes:
        assert kf in css, f'motion.css: отсутствует {kf}'


def test_self_message_overshoot_duration_capped() -> None:
    """Своё сообщение не должно «затянуто» подскакивать — overshoot ≤ 280ms."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')
    # Ищем блок .message.msg-animate-in.msg-animate-self .bubble
    block_re = re.compile(
        r'\.message\.msg-animate-in\.msg-animate-self\s+\.bubble\s*\{[^}]*?'
        r'animation:\s*m-pop-overshoot\s+(\d+)ms',
        re.DOTALL,
    )
    match = block_re.search(css)
    assert match, 'motion.css: правило m-pop-overshoot для self-bubble не найдено'
    duration = int(match.group(1))
    assert duration <= 280, (
        f'self-bubble overshoot = {duration}ms — слишком долго '
        f'для частой переписки. Держи в районе 240-260ms.'
    )


def test_prefers_reduced_motion_present() -> None:
    """motion.css обязан полностью гасить анимации в reduced-motion."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')
    assert '@media (prefers-reduced-motion: reduce)' in css
    # И transition-duration внутри должен быть сброшен
    rm_block = css[css.find('@media (prefers-reduced-motion: reduce)'):]
    assert 'animation-duration: 0.01ms' in rm_block
    assert 'transition-duration: 0.01ms' in rm_block


def test_focus_visible_outline_present() -> None:
    """Keyboard-accessibility: интерактивные элементы имеют :focus-visible."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')
    assert ':focus-visible' in css, (
        'motion.css: нет правил :focus-visible — keyboard-навигация без '
        'видимого фокуса недоступна для accessibility.'
    )
    assert 'outline:' in css and 'outline-offset' in css


def test_overscroll_contain_present() -> None:
    """Скролл-контейнеры используют overscroll-behavior: contain — не
    ловят pull-to-refresh и не «протекают» в body."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')
    assert 'overscroll-behavior: contain' in css


def test_tap_target_44px_on_mobile() -> None:
    """На мобильных интерактивные иконки ≥ 44px (Apple HIG)."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')
    # Должна быть mobile-секция с min-width/min-height: 44px на иконках
    mobile_44 = re.search(
        r'@media\s*\(max-width:\s*768px\)\s*\{[^}]*\.icon-btn[^}]*?'
        r'min-(?:width|height):\s*44px',
        css,
        re.DOTALL,
    )
    assert mobile_44, (
        'motion.css: для мобильных нет правила min-width/height: 44px на '
        'иконочных кнопках — нарушение tap-target guideline.'
    )


def test_hover_disabled_on_touch_devices() -> None:
    """`@media (hover: none)` отключает «залипший» hover после tap."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')
    hover_block = re.search(
        r'@media\s*\(hover:\s*none\)\s*\{(.+?)\}\s*(?=/\*|@|\Z)',
        css,
        re.DOTALL,
    )
    assert hover_block, '@media (hover: none) не найден'
    body = hover_block.group(1)
    # Должен сбрасывать transform и/или background для hover
    assert 'transform: none' in body
    assert '.bubble:hover' in body or '.message-action:hover' in body, (
        'hover-сброс не покрывает баблы/действия — на тач-устройствах '
        'останется «залипший» hover-фон после tap.'
    )


def test_safe_area_inset_used_in_chat_layout() -> None:
    """Композер и floating-элементы учитывают env(safe-area-inset-*)."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    occurrences = css.count('env(safe-area-inset-bottom')
    assert occurrences >= 5, (
        f'chat.css: env(safe-area-inset-bottom) встречается всего '
        f'{occurrences} раз — мало для floating-композера и оверлеев.'
    )


def test_will_change_not_on_static_button_base() -> None:
    """`will-change: transform` не должен висеть на базовых кнопочных
    селекторах постоянно — только в :active/во время анимаций."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')

    # Ищем блок с базовым правилом для .icon-btn, .composer-btn и т.д.
    # (не :active) — там не должно быть will-change.
    block_re = re.compile(
        r'(\.icon-btn,\s*\n\s*\.composer-btn,[^{]*?)\{([^}]*)\}',
        re.DOTALL,
    )
    for match in block_re.finditer(css):
        selector = match.group(1)
        body = match.group(2)
        if ':active' in selector or ':hover' in selector:
            continue
        assert 'will-change' not in body, (
            'will-change: transform висит на базовом селекторе кнопок — '
            'это создаёт постоянные compositor-layer для каждой кнопки. '
            'Перенеси в :active.'
        )


def test_will_change_active_present() -> None:
    """При этом will-change ДОЛЖЕН быть на :active — иначе теряется
    GPU-ускорение для tactile press-эффекта."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')
    # Должен быть блок с :active селекторами и will-change: transform
    active_with_wc = re.search(
        r'\.icon-btn:active[^{]*?\{[^}]*will-change:\s*transform',
        css,
        re.DOTALL,
    )
    assert active_with_wc, (
        'motion.css: will-change: transform отсутствует на :active-блоке '
        'кнопок — пропадёт GPU-ускорение press-анимации.'
    )


def test_avatar_size_tokens_present() -> None:
    """В :root должны быть унифицированные размеры аватаров."""
    css = (STATIC / 'style.css').read_text(encoding='utf-8')
    for token in ('--avatar-xs', '--avatar-sm', '--avatar-md',
                  '--avatar-lg', '--avatar-xl'):
        assert token in css, f'style.css :root: отсутствует токен {token}'


def test_chat_toasts_do_not_stretch_to_container_width() -> None:
    """Global chat toasts should size to their text and only cap at the viewport."""
    css = (STATIC / 'style.css').read_text(encoding='utf-8')
    container = re.search(r'(^|\n)#toastContainer\s*\{([^}]*)\}', css)
    toast = re.search(r'(^|\n)\.toast-msg\s*\{([^}]*)\}', css)

    assert container, 'style.css: global #toastContainer block not found'
    assert toast, 'style.css: global .toast-msg block not found'

    container_rules = container.group(2)
    toast_rules = toast.group(2)
    assert 'align-items: center' in container_rules
    assert 'align-items: stretch' not in container_rules
    assert 'width: fit-content' in toast_rules
    assert 'max-width: 100%' in toast_rules
    assert not re.search(r'(?<!-)width:\s*100%', toast_rules)


def test_header_height_token_present() -> None:
    """`--header-h` обеспечивает выравнивание .chat-header и
    .sidebar-header по горизонтальной сетке messenger-grid."""
    style = (STATIC / 'style.css').read_text(encoding='utf-8')
    chat = _read_css_text(STATIC / 'pages' / 'chat.css')
    assert '--header-h' in style, 'style.css :root: нет токена --header-h'
    # И обе шапки используют его как min-height
    assert re.search(
        r'\.sidebar-header\s*\{[^}]*min-height:\s*var\(--header-h\)',
        style, re.DOTALL,
    ), '.sidebar-header не привязан к --header-h'
    assert re.search(
        r'\.chat-header\s*\{[^}]*min-height:\s*var\(--header-h\)',
        chat, re.DOTALL,
    ), '.chat-header не привязан к --header-h'


def test_side_resizer_hit_area_at_least_6px() -> None:
    """Drag-handle должен иметь hit-area ≥ 6px — иначе попасть курсором
    тяжело. Видимая полоса может оставаться тонкой."""
    css = (STATIC / 'style.css').read_text(encoding='utf-8')
    block = re.search(
        r'\.side-resizer\s*\{([^}]*)\}',
        css, re.DOTALL,
    )
    assert block, '.side-resizer не найден в style.css'
    width_match = re.search(r'width:\s*(\d+)px', block.group(1))
    assert width_match, '.side-resizer: width не задан в px'
    width_px = int(width_match.group(1))
    assert width_px >= 6, (
        f'.side-resizer width = {width_px}px — слишком тонкий hit-area, '
        f'попасть курсором при resize неудобно. Минимум 6-8px.'
    )
    assert 'cursor: col-resize' in block.group(1), (
        '.side-resizer: должен иметь cursor: col-resize'
    )


def test_keyboard_shortcuts_module_exists() -> None:
    """Модуль keyboard-shortcuts.js существует и экспортирует init."""
    path = STATIC / 'modules' / 'keyboard-shortcuts.js'
    assert path.exists(), 'modules/keyboard-shortcuts.js должен существовать'
    src = path.read_text(encoding='utf-8')
    assert 'export function initKeyboardShortcuts' in src
    # И покрывает три ключевые комбинации:
    assert 'Escape' in src, 'shortcut: Escape должен обрабатываться'
    assert 'ArrowUp' in src and 'ArrowDown' in src, (
        'shortcuts: Ctrl+ArrowUp/Down — переключение чатов'
    )
    # Ctrl+F — focus поиска (учитываем русскую раскладку 'а')
    assert (
        re.search(r"key\s*===\s*['\"]f['\"]", src)
        or re.search(r"key\s*===\s*['\"]F['\"]", src)
    ), 'shortcut Ctrl+F должен обрабатываться'


def test_keyboard_shortcuts_wired_in_chatjs() -> None:
    """Шорткаты подключаются к bootstrap'у chat.js."""
    src = (STATIC / 'chat-runtime.js').read_text(encoding='utf-8')
    assert 'keyboard-shortcuts.js' in src, (
        'chat-runtime.js не импортирует модуль keyboard-shortcuts.js'
    )
    assert 'initKeyboardShortcuts' in src


def test_bubble_transition_excludes_box_shadow() -> None:
    """`.message .bubble` НЕ должен анимировать box-shadow — это
    hot-path при скролле истории."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')
    block = re.search(
        r'\.message\s+\.bubble\s*\{([^}]*?transition:[^;]+;)',
        css, re.DOTALL,
    )
    assert block, '.message .bubble transition не найден'
    transition_value = block.group(1)
    assert 'box-shadow' not in transition_value, (
        'motion.css: .message .bubble анимирует box-shadow — '
        'удали его из transition (это дорого при скролле).'
    )


def test_mobile_chat_reveal_animation_present() -> None:
    """При открытии чата на мобильном чат заезжает справа
    (mobileChatRevealIn), а sidebar плавно уезжает влево
    (mobileSidebarHideOut) — никаких мгновенных display:none без анимации."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    for kf in ('@keyframes mobileChatRevealIn',
               '@keyframes mobileChatCloseOut',
               '@keyframes mobileSidebarReveal',
               '@keyframes mobileSidebarHideOut'):
        assert kf in css, f'chat.css: отсутствует {kf}'

    assert '.chat-area.mobile-open.mobile-revealing' in css, (
        'chat.css: нет правила .mobile-revealing для входной анимации чата'
    )
    assert '.sidebar.mobile-hiding' in css, (
        'chat.css: нет правила .mobile-hiding для уходящего sidebar'
    )
    reveal_kf = re.search(r'@keyframes\s+mobileChatRevealIn\s*\{([\s\S]+?)\n\s*\}', css)
    assert reveal_kf, 'chat.css: @keyframes mobileChatRevealIn не найден'
    assert 'transform: translateX(100%)' in reveal_kf.group(1), (
        'mobileChatRevealIn должен начинаться справа, иначе mobile-open сразу показывает chat-area без slide-in'
    )

    # Длительности reveal/hide должны быть tokenized (или legacy-числом в 240-380ms).
    for anim_name in ('mobileChatRevealIn', 'mobileSidebarHideOut',
                      'mobileSidebarReveal', 'mobileChatCloseOut'):
        anim_decls = re.findall(
            rf'animation:\s*{anim_name}\s+[^;]+;',
            css,
        )
        assert anim_decls, f'chat.css: длительность {anim_name} не найдена'
        if any('var(--dur-' in decl for decl in anim_decls):
            assert any(
                ('var(--dur-medium)' in decl) or ('var(--dur-slow)' in decl)
                for decl in anim_decls
            ), (
                f'{anim_name}: используется token-duration, но не ожидаемый '
                f'`var(--dur-medium|--dur-slow)`'
            )
            continue

        match = re.search(
            rf'animation:\s*{anim_name}\s+0?\.(\d+)s',
            css,
        )
        assert match, f'chat.css: длительность {anim_name} не найдена'
        ms = int(match.group(1)[:3].ljust(3, '0'))
        assert 240 <= ms <= 380, (
            f'{anim_name} = {ms}ms — выходит за комфортный диапазон 240-380ms'
        )


def test_mobile_animations_use_tweb_standard_easing() -> None:
    """Mobile sidebar/chat анимации должны использовать единый tweb-style easing
    через токен `var(--ease-quick)`.
    Проверяем @keyframes-привязки в анимациях, а не блоки правил
    (reduced-motion override может перезаписать без cubic-bezier)."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    easing_token = 'var(--ease-quick)'
    for anim_name in ('mobileChatRevealIn', 'mobileSidebarHideOut',
                      'mobileSidebarReveal', 'mobileChatCloseOut'):
        # Ищем все вхождения `animation: <name> ...;` и хотя бы одно должно
        # содержать tweb-token (reduced-motion блок задаёт `animation: none`).
        anim_decls = re.findall(
            rf'animation:\s*{anim_name}\s+[^;]+;',
            css,
        )
        assert anim_decls, f'chat.css: animation: {anim_name} не найден'
        assert any(easing_token in decl for decl in anim_decls), (
            f'{anim_name}: ни одно объявление animation не использует '
            f'tweb easing token {easing_token}'
        )


def test_mobile_animations_reduced_motion_disabled() -> None:
    """Все mobile-анимации должны выключаться в prefers-reduced-motion."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    rm_blocks = re.findall(
        r'@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(.+?)\}\s*\}',
        css, re.DOTALL,
    )
    combined = '\n'.join(rm_blocks)
    for klass in ('mobile-revealing', 'mobile-hiding',
                  'mobile-returning', 'mobile-closing'):
        assert klass in combined, (
            f'prefers-reduced-motion: класс {klass} не выключается'
        )


def test_open_chat_uses_animated_path() -> None:
    """`openChat()` в mobile thread shell должен использовать новые классы
    mobile-revealing/mobile-hiding и не делать display:none мгновенно."""
    src = (STATIC / 'chat' / 'thread-shell.js').read_text(encoding='utf-8')
    # Берём первый openChat функцию
    func = re.search(
        r'function openChat\(\)\s*\{([\s\S]+?)\n    \}\n',
        src,
    )
    assert func, 'chat/thread-shell.js: функция openChat() не найдена'
    body = func.group(1)
    assert 'mobile-revealing' in body, (
        'openChat: не выставляет .mobile-revealing — нет анимации входа'
    )
    assert 'mobile-hiding' in body, (
        'openChat: не выставляет .mobile-hiding — sidebar исчезает резко'
    )
    assert 'prefersReducedMotion' in body, (
        'openChat: не учитывает prefers-reduced-motion'
    )


def test_mobile_chat_open_keeps_message_stream_stable() -> None:
    """Mobile chat opening should animate the screen, not the message stream."""
    motion = (STATIC / 'motion.css').read_text(encoding='utf-8')
    mobile_block = re.search(
        r'@media\s*\(max-width:\s*768px\)\s*\{([\s\S]+?)\n\}',
        motion,
    )
    assert mobile_block, 'motion.css: mobile motion block not found'
    body = mobile_block.group(1)
    for selector in (
        '.chat-area.is-switching .chat-messages',
        '.chat-area.chat-surface-enter .chat-messages',
        '.chat-area.chat-history-reveal .chat-messages',
    ):
        assert selector in body, (
            f'motion.css: mobile must neutralize {selector} to avoid opening jitter'
        )
    assert 'animation: none !important' in body
    assert 'transform: none !important' in body
    assert 'opacity: 1 !important' in body


def test_mobile_chatjs_skips_inner_thread_reveal_motion() -> None:
    """Chat runtime should not start desktop thread reveal/switch motion on mobile."""
    src = (STATIC / 'chat-runtime.js').read_text(encoding='utf-8')
    selection_runtime = (STATIC / 'modules' / 'chat-contact-selection-runtime.js').read_text(encoding='utf-8')

    surface_func = re.search(
        r'function triggerChatSurfaceEnterAnimation\(\)\s*\{([\s\S]+?)\n    \}',
        src,
    )
    assert surface_func, 'chat.js: triggerChatSurfaceEnterAnimation() not found'
    assert 'isMobileViewport()' in surface_func.group(1)
    assert "chatArea.classList.remove('chat-surface-enter')" in surface_func.group(1)

    history_func = re.search(
        r'function triggerChatHistoryRevealAnimation\(\)\s*\{([\s\S]+?)\n    \}',
        src,
    )
    assert history_func, 'chat.js: triggerChatHistoryRevealAnimation() not found'
    assert 'isMobileViewport()' in history_func.group(1)
    assert "chatArea.classList.remove('chat-history-reveal', 'is-switching')" in history_func.group(1)

    assert 'const useDesktopSwitchMotion = !isMobileViewport() && !reduceMotion' in selection_runtime
    assert 'if (chatArea && useDesktopSwitchMotion)' in selection_runtime


def test_icon_button_press_keeps_glyph_centered() -> None:
    """Icon-only buttons should not shift or scale glyphs on tap/press."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')
    js = (STATIC / 'modules' / 'motion.js').read_text(encoding='utf-8')

    assert 'target.appendChild(ripple)' in js
    assert 'insertBefore(ripple' not in js

    ripple_host = re.search(r'\.sun-ripple-host\s*\{([^}]*)\}', css, re.DOTALL)
    ripple_circle = re.search(r'\.sun-ripple-circle\s*\{([^}]*)\}', css, re.DOTALL)
    assert ripple_host and 'isolation: isolate' in ripple_host.group(1)
    assert ripple_circle and 'position: absolute' in ripple_circle.group(1)
    assert 'flex: 0 0 auto' in ripple_circle.group(1)
    assert '.sun-ripple-host > .sun-ripple-circle' in css
    assert '.sun-ripple-host > :not(.sun-ripple-circle)' in css

    press_block = re.search(
        r'\.btn-icon:hover,[^{]*?#messageForm\s+\.btn-icon:active,[^{]*?'
        r'\.settings-panel-close:active\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert press_block, 'motion.css: stable icon-button press block missing'
    assert 'transform: none' in press_block.group(1)

    glyph_block = re.search(
        r'button\s*>\s*i\[class\^="bi"\],[^{]*?\.settings-panel-close\s*>\s*i\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert glyph_block, 'motion.css: bootstrap icon glyph stabilization block missing'
    glyph_rules = glyph_block.group(1)
    for rule in (
        'display: inline-flex',
        'align-items: center',
        'justify-content: center',
        'width: 1em',
        'height: 1em',
        'line-height: 1',
        'z-index: 1',
    ):
        assert rule in glyph_rules


def test_bubble_no_blur_box_shadow_in_style_css() -> None:
    """У `.message.self .bubble` и `.message.other .bubble` не должно
    быть тяжёлых blur-теней (большой 3-й параметр)."""
    css = (STATIC / 'style.css').read_text(encoding='utf-8')
    self_block = re.search(
        r'\.message\.self\s+\.bubble\s*\{([^}]*)\}',
        css, re.DOTALL,
    )
    assert self_block
    body = self_block.group(1)
    # box-shadow должна быть либо none, либо отсутствовать.
    bs = re.search(r'box-shadow:\s*([^;]+);', body)
    if bs:
        value = bs.group(1).strip().lower()
        assert 'none' in value, (
            f'.message.self .bubble имеет box-shadow="{value}" — '
            f'для hot-path bubble допустим только none.'
        )

def test_chat_messages_clips_horizontal_overflow() -> None:
    """Main chat history container must not expose horizontal scrollbar."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    block = re.search(
        r'\.chat-messages\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert block, 'chat.css: block .chat-messages not found'
    body = block.group(1)
    has_hidden = 'overflow-x: hidden' in body
    has_clip = 'overflow-x: clip' in body
    assert has_hidden or has_clip, (
        'chat.css: .chat-messages must set overflow-x hidden/clip to avoid horizontal scrollbar.'
    )

def test_emoji_picker_hidden_by_default() -> None:
    """Emoji picker must be out of layout flow until activated."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    block = re.search(r'\.emoji-picker\s*\{([^}]*)\}', css, re.DOTALL)
    assert block, 'chat.css: .emoji-picker block not found'
    body = block.group(1)
    assert 'display: none' in body, (
        'chat.css: .emoji-picker should default to display:none to avoid offscreen overflow.'
    )


def test_mobile_emoji_picker_resets_shell_scroll_before_positioning() -> None:
    """Mobile emoji positioning must ignore accidental chat shell scroll."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    reset_start = emoji.find('function resetMobileEmojiShellScroll')
    assert reset_start >= 0, 'emoji.js: mobile emoji shell scroll reset helper is missing'
    reset_end = emoji.find('function stopEmojiKeyboardHandoff', reset_start)
    reset_body = emoji[reset_start:reset_end]
    assert 'resolveEmojiChatArea(emojiPicker)' in reset_body
    assert 'chatArea.scrollTop = 0' in reset_body
    assert '#chatMessages' not in reset_body

    position_start = emoji.find('function positionEmojiPicker')
    assert position_start >= 0, 'emoji.js: positionEmojiPicker not found'
    is_mobile_idx = emoji.find('const isMobile = isMobileEmojiViewport();', position_start)
    reset_call_idx = emoji.find('resetMobileEmojiShellScroll(emojiPicker);', position_start)
    form_rect_idx = emoji.find("const formRect = emojiBtn.closest('#messageForm')", position_start)
    assert position_start < is_mobile_idx < reset_call_idx < form_rect_idx, (
        'emoji.js: mobile shell scroll must be reset before reading composer geometry'
    )

    assert 'function measureMobileEmojiTopReserve' in emoji
    assert 'MOBILE_EMOJI_COMPACT_MIN_HEIGHT' in emoji
    assert 'const MOBILE_EMOJI_MIN_HEIGHT = 320;' in emoji
    assert 'const MOBILE_EMOJI_MAX_HEIGHT = 480;' in emoji
    assert 'const MOBILE_EMOJI_HEIGHT_RATIO = 0.46;' in emoji
    assert 'const sheetViewportHeight = hasPreferredMobileSheetHeight ? layoutViewportHeight : mobileViewportHeight' in emoji
    assert 'sheetViewportHeight - topReserve' in emoji
    assert 'emojiBtn.closest(\'.chat-input-area\')' in emoji


def test_mobile_emoji_open_locks_composer_before_blur() -> None:
    """Opening the mobile emoji sheet must lock composer layout before input blur."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    open_start = emoji.find('const openPicker = async (options = {}) => {')
    assert open_start >= 0, 'emoji.js: openPicker not found'
    active_idx = emoji.find("emojiPicker.classList.add('active');", open_start)
    position_idx = emoji.find('positionEmojiPicker(emojiPicker, emojiBtn, {', open_start)
    fallback_blur_idx = emoji.find('messageInput.blur();', position_idx)
    assert 'await waitForMobileKeyboardHidden();' not in emoji
    assert open_start < active_idx < position_idx < fallback_blur_idx, (
        'emoji.js: keyboard-to-emoji must install the emoji dock before blurring the native keyboard.'
    )

    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    block = re.search(
        r'\.chat-area\.emoji-sheet-open\s+\.chat-input-area\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert block, 'chat.css: mobile .emoji-sheet-open .chat-input-area block not found'
    body = block.group(1)
    assert 'display: flex !important' in body
    assert 'visibility: visible !important' in body
    assert 'opacity: 1 !important' in body
    transition_part = block.group(1).split('transition:', 1)[1]
    assert 'bottom var(--emoji-sheet-motion-duration)' in transition_part, (
        'chat.css: emoji-open composer must animate bottom with the sheet instead of jumping.'
    )
    assert '.chat-area.emoji-sheet-open .chat-input-area.chat-input-area--hidden' in css
    composer_stack = re.search(
        r'\.chat-area\.emoji-sheet-open\s+\.composer-row\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert composer_stack, 'chat.css: mobile emoji-open composer stack rule not found'
    assert 'z-index: 2' in composer_stack.group(1)
    picker_stack = re.search(
        r'\.chat-area\.emoji-sheet-open\s+\.emoji-picker\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert picker_stack, 'chat.css: mobile emoji-open picker stack rule not found'
    assert 'z-index: 1' in picker_stack.group(1)


def test_mobile_emoji_switch_open_prevents_pointer_blur() -> None:
    """Emoji button pointerdown should open the sheet before textarea blur can drop the composer."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    pointer_start = emoji.find("emojiBtn.addEventListener('pointerdown'")
    assert pointer_start >= 0, 'emoji.js: emoji button pointerdown handler not found'
    inactive_idx = emoji.find("if (!emojiPicker.classList.contains('active'))", pointer_start)
    prevent_idx = emoji.find('event.preventDefault();', inactive_idx)
    open_idx = emoji.find('openPicker({ preferredMobileSheetHeight: keyboardInset, waitForKeyboard: true })', inactive_idx)
    return_idx = emoji.find('return;', inactive_idx)
    assert pointer_start < inactive_idx < prevent_idx < open_idx < return_idx, (
        'emoji.js: mobile keyboard-to-emoji switch must prevent default pointer blur '
        'and open with the captured keyboard height.'
    )

    open_start = emoji.find('const openPicker = async (options = {}) => {')
    render_idx = emoji.find('renderEmojiList({ forceCategoryScroll: true }).then', open_start)
    preserve_idx = emoji.find('positionEmojiPicker(emojiPicker, emojiBtn, { preserveSize: true });', render_idx)
    assert open_start < render_idx < preserve_idx < pointer_start, (
        'emoji.js: async emoji list render must preserve the locked sheet size.'
    )

    lazy_ui_runtime = (STATIC / 'modules' / 'chat-lazy-ui-runtime.js').read_text(encoding='utf-8')
    lazy_pointer_idx = lazy_ui_runtime.find("emojiBtn?.addEventListener('pointerdown'")
    lazy_click_idx = lazy_ui_runtime.find("emojiBtn?.addEventListener('click'")
    lazy_prevent_idx = lazy_ui_runtime.find('event.preventDefault();', lazy_pointer_idx)
    lazy_import_idx = lazy_ui_runtime.find('await ensureEmojiPicker();', lazy_pointer_idx)
    lazy_dispatch_idx = lazy_ui_runtime.find('dispatchEmojiOpen(keyboardInset, { waitForKeyboard: true });', lazy_pointer_idx)
    lazy_warmup_idx = lazy_ui_runtime.find('function scheduleEmojiPickerWarmup')
    lazy_focus_warmup_idx = lazy_ui_runtime.find("messageInput?.addEventListener('focus'", lazy_warmup_idx)
    assert lazy_pointer_idx >= 0, 'chat-lazy-ui-runtime.js: emoji pointerdown preload handler not found'
    assert lazy_pointer_idx < lazy_prevent_idx < lazy_import_idx < lazy_dispatch_idx < lazy_click_idx, (
        'chat-lazy-ui-runtime.js: first mobile emoji tap must preload before click/blur '
        'and dispatch the captured keyboard height.'
    )
    assert 0 <= lazy_warmup_idx < lazy_focus_warmup_idx, (
        'chat-lazy-ui-runtime.js: emoji module should warm up before the first emoji button tap.'
    )


def test_mobile_emoji_keyboard_handoff_uses_layout_bottom() -> None:
    """Keyboard-to-emoji handoff should replace the keyboard area, not render above it."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    assert 'function readMobileKeyboardInset' in emoji
    assert 'function readCurrentMobileEmojiSheetHeight' in emoji
    assert "readRootPixelVar('--mobile-composer-bottom-inset')" in emoji
    assert 'window.visualViewport' in emoji
    assert 'layoutViewportHeight - visibleBottom' in emoji
    assert 'const sheetBottom = hasPreferredMobileSheetHeight' in emoji
    assert '? Math.max(viewportOffsetTop + mobileViewportHeight, layoutViewportHeight)' in emoji
    assert ': viewportOffsetTop + mobileViewportHeight' in emoji
    assert 'const top = Math.round(sheetBottom - sheetHeight)' in emoji
    assert 'function startEmojiKeyboardHandoff(emojiPicker, { targetInset = null } = {})' in emoji
    assert 'keyboardInset >= targetKeyboardInset' in emoji
    assert 'startEmojiKeyboardHandoff(emojiPicker, { targetInset: keyboardHandoffTargetInset })' in emoji
    assert 'mobile-emoji-sheet-open' in emoji
    assert 'waitForKeyboard: true' in emoji
    assert "document.addEventListener('sun-open-emoji-picker'" in emoji


def test_mobile_chat_uses_single_bottom_dock_for_keyboard_and_emoji() -> None:
    """Mobile composer should be anchored to one dock; visualViewport handles keyboard size."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    chat_area_blocks = re.findall(r'\.chat-area\s*\{([^}]*)\}', css, re.DOTALL)
    assert any('--mobile-bottom-dock-height: 0px' in block for block in chat_area_blocks), (
        'chat.css: mobile chat area should define a single bottom dock variable.'
    )
    assert any('--emoji-sheet-motion-duration: 240ms' in block for block in chat_area_blocks), (
        'chat.css: emoji sheet and composer should share one motion duration from chat area.'
    )
    assert 'html.mobile-emoji-sheet-open .app' in css
    assert 'height: var(--layout-vh, var(--app-vh, 100dvh))' in css

    input_blocks = re.findall(r'\.chat-input-area\s*\{([^}]*)\}', css, re.DOTALL)
    assert any('bottom: var(--mobile-bottom-dock-height, 0px)' in block for block in input_blocks), (
        'chat.css: mobile composer should anchor to the bottom dock, not directly to keyboard inset.'
    )
    assert not any('bottom: var(--mobile-composer-bottom-inset' in block for block in input_blocks), (
        'chat.css: mobile composer must not double-count keyboard height after app binds to visualViewport.'
    )

    emoji_area_block = re.search(r'\.chat-area\.emoji-sheet-open\s*\{([^}]*)\}', css, re.DOTALL)
    assert emoji_area_block, 'chat.css: .chat-area.emoji-sheet-open block not found'
    emoji_area_body = emoji_area_block.group(1)
    assert '--mobile-bottom-dock-height: var(--mobile-emoji-sheet-height,' in emoji_area_body

    emoji_picker_blocks = re.findall(r'\.emoji-picker\s*\{([^}]*)\}', css, re.DOTALL)
    assert any('bottom: 0' in block and 'top: auto' in block for block in emoji_picker_blocks), (
        'chat.css: mobile emoji picker should be a fixed bottom dock.'
    )


def test_mobile_emoji_open_preserves_bottom_pinned_chat() -> None:
    """Opening emoji sheet should keep bottom-pinned messages above the composer."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    assert 'const MOBILE_EMOJI_CHAT_PIN_THRESHOLD = 96;' in emoji
    assert 'function isMobileEmojiChatPinnedToBottom(chatArea)' in emoji
    assert 'function pinMobileEmojiChatToBottom(chatArea)' in emoji
    assert '.chat-area.emoji-keyboard-handoff .chat-messages' in css
    assert 'overflow-anchor: none' in css
    assert "document.documentElement.classList.toggle('mobile-emoji-sheet-open'" in emoji

    state_start = emoji.find('function setMobileEmojiSheetState')
    assert state_start >= 0, 'emoji.js: setMobileEmojiSheetState not found'
    pinned_idx = emoji.find('const shouldPinChatToBottom', state_start)
    toggle_idx = emoji.find("chatArea.classList.toggle('emoji-sheet-open'", state_start)
    pin_idx = emoji.find('pinMobileEmojiChatToBottom(chatArea);', state_start)
    assert state_start < pinned_idx < toggle_idx < pin_idx, (
        'emoji.js: mobile emoji open must capture pinned state before changing sheet layout '
        'and then scroll the message list to the new bottom.'
    )

    open_start = emoji.find('const openPicker = async (options = {}) => {')
    active_idx = emoji.find("emojiPicker.classList.add('active');", open_start)
    position_idx = emoji.find('positionEmojiPicker(emojiPicker, emojiBtn, {', active_idx)
    open_blur_idx = emoji.find('messageInput.blur();', position_idx)
    assert open_start < active_idx < position_idx < open_blur_idx, (
        'emoji.js: keyboard-to-emoji handoff must set emoji layout before blurring the native keyboard.'
    )

    close_start = emoji.find('const closePicker = ({ focusInput = false } = {}) => {')
    handoff_idx = emoji.find('if (wantsKeyboardHandoff)', close_start)
    close_handoff_idx = emoji.find('startEmojiKeyboardHandoff(emojiPicker', handoff_idx)
    focus_idx = emoji.find('if (focusInput) focusComposerInput();', handoff_idx)
    assert close_start < handoff_idx < close_handoff_idx < focus_idx, (
        'emoji.js: emoji-to-keyboard handoff must keep the emoji layout until the native keyboard is visible.'
    )


def test_mobile_inline_message_meta_uses_shared_flex_layout() -> None:
    """Mobile inline text footer should use the same flex alignment model as desktop."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    _COMPACT_BUBBLE_CORE = (
        r'\.message:not\(\.message-emoji-only\)\s+'
        r'\.bubble\.bubble--text:not\(\.bubble--text-has-reactions\)'
        r':not\(:has\(>\s+\.message-link-preview\)\)'
        r':not\(:has\(>\s+\.message-sender-label\)\)'
        r'(?::not\(:has\(>\s+\.[^)]+\)\))*'
    )
    footer_blocks = list(re.finditer(
        _COMPACT_BUBBLE_CORE + r'\s+>\s+\.message-footer\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    ))
    bubble_blocks = list(re.finditer(
        _COMPACT_BUBBLE_CORE + r'\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    ))
    assert footer_blocks, 'chat.css: compact mobile text footer block not found'
    assert bubble_blocks, 'chat.css: compact mobile text bubble block not found'
    footer_bodies = [match.group(1) for match in footer_blocks]
    bubble_bodies = [match.group(1) for match in bubble_blocks]
    assert not any('float: right' in body for body in footer_bodies), (
        'chat.css: compact mobile text footer must not use float:right; it desynchronizes '
        'mobile text and meta baselines.'
    )
    flex_body = next((body for body in bubble_bodies if 'display: inline-flex' in body), '')
    assert flex_body, 'chat.css: mobile compact text bubble must keep inline-flex placement'
    assert 'align-items: flex-end' in flex_body, (
        'chat.css: mobile compact text bubble must align text and meta on the shared bottom edge.'
    )
    footer_body = next((body for body in footer_bodies if 'float: none' in body), '')
    assert footer_body, 'chat.css: mobile compact text footer must neutralize legacy float placement'
    assert 'padding-top: 0' in footer_body, (
        'chat.css: mobile compact text footer must not add a mobile-only vertical offset.'
    )


def test_chat_page_hides_horizontal_scrollbar_tracks_for_webkit() -> None:
    """Desktop webview: chat page should hide horizontal scrollbar tracks."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    assert '::-webkit-scrollbar:horizontal' in css, (
        'chat.css should define explicit horizontal scrollbar hiding selectors for chat page containers.'
    )
    assert '.chat-input-area::-webkit-scrollbar:horizontal' in css


def test_legacy_chat_input_shell_in_base_layer_is_not_important() -> None:
    """Legacy base styles must not lock chat input shell via !important.

    Chat page now uses layered files in pages/chat/*.css. If base style.css keeps
    `.chat-input-area` shell styles as `!important`, they can override layered
    composer rules and reintroduce a persistent bottom strip.
    """
    css = (STATIC / 'style.css').read_text(encoding='utf-8')
    block = re.search(
        r'\.chat-input,\s*\.chat-input-area,\s*\.chat-input-wrapper\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert block, 'style.css: legacy chat input shell block not found'
    body = block.group(1)
    bg_decl = re.search(r'background\s*:\s*[^;]+;', body)
    assert bg_decl, 'style.css: legacy chat input shell must declare background'
    assert '!important' not in bg_decl.group(0), (
        'style.css: legacy .chat-input-area background must not be !important'
    )
    border_decl = re.search(r'border-top\s*:\s*[^;]+;', body)
    assert border_decl, 'style.css: legacy chat input shell must declare border-top'
    assert '!important' not in border_decl.group(0), (
        'style.css: legacy .chat-input-area border-top must not be !important'
    )


def test_mobile_chat_header_partner_plate_is_overflow_safe() -> None:
    """Mobile chat header partner plate should not break layout on long names/status.

        Checks:
    - clickable partner block is clipped within header row;
    - partner text/status lines use single-line ellipsis;
    - action buttons keep fixed intrinsic width and do not collapse.
    """
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    assert '.chat-header .header-partner-clickable' in css
    assert '.chat-header .chat-partner-info' in css
    assert '.chat-header .chat-partner-name' in css

    partner_blocks = re.findall(
        r'\.chat-header\s+\.header-partner-clickable\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert partner_blocks, 'chat.css: .chat-header .header-partner-clickable block not found'
    assert any('min-width: 0' in block for block in partner_blocks), (
        'chat.css: mobile header partner block must have min-width:0'
    )
    assert any('overflow: hidden' in block for block in partner_blocks), (
        'chat.css: mobile header partner block must clip overflow'
    )

    actions_blocks = re.findall(
        r'\.chat-header\s+\.header-actions-group\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert actions_blocks, 'chat.css: .chat-header .header-actions-group block not found'
    assert any('min-width: max-content' in block for block in actions_blocks), (
        'chat.css: mobile header actions group should keep intrinsic width'
    )

    assert 'text-overflow: ellipsis' in css and 'white-space: nowrap' in css, (
        'chat.css: mobile header name/status should use ellipsis + nowrap'
    )


def test_mobile_header_search_uses_stable_header_row_height() -> None:
    """Mobile header search should not make the message stream jump vertically."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    mobile_start = css.find('@media (max-width: 768px)')
    assert mobile_start >= 0, 'chat.css: mobile media block not found'
    mobile_css = css[mobile_start:]
    blocks = re.findall(
        r'\.chat-header\s+\.header-search-wrap\s*\{([^}]*)\}',
        mobile_css,
        re.DOTALL,
    )
    assert blocks, 'chat.css: mobile .chat-header .header-search-wrap block not found'
    assert any('height: 42px' in block for block in blocks), (
        'chat.css: mobile header search must match the 42px header row'
    )


def test_header_dropdown_is_solid_above_message_stream() -> None:
    """The top-right chat menu must not reveal messages while opening."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    dropdown_blocks = re.findall(r'\.header-dropdown\s*\{([^}]*)\}', css, re.DOTALL)
    assert dropdown_blocks, 'chat.css: .header-dropdown block not found'
    dropdown_body = dropdown_blocks[0]

    assert 'top: calc(100% - 1px)' in dropdown_body, (
        'chat.css: header dropdown should bridge the header edge instead of leaving a visible gap'
    )
    assert 'margin-top: 0' in dropdown_body, (
        'chat.css: header dropdown must not leave a message-visible top margin'
    )
    assert 'var(--overlay-menu-bg' in dropdown_body, (
        'chat.css: header dropdown should use the solid overlay menu background token'
    )

    motion = (STATIC / 'motion.css').read_text(encoding='utf-8')
    generic_pop = re.search(
        r'\.emoji-picker\.active,[\s\S]+?\{\s*animation:\s*m-pop-overshoot',
        motion,
    )
    assert generic_pop, 'motion.css: generic menu overshoot block not found'
    assert '.header-dropdown.active' not in generic_pop.group(0), (
        'motion.css: header dropdown must not use the transparent generic pop animation'
    )
    assert '.header-dropdown.active' in motion and 'm-solid-pop-overshoot' in motion, (
        'motion.css: header dropdown should use the solid pop animation'
    )

    solid_start = motion.find('@keyframes m-solid-pop-overshoot')
    assert solid_start >= 0, 'motion.css: m-solid-pop-overshoot keyframes not found'
    solid_end = motion.find('.context-menu.is-opening', solid_start)
    solid_segment = motion[solid_start:solid_end if solid_end >= 0 else len(motion)]
    assert 'opacity: 0' not in solid_segment, (
        'motion.css: solid header menu animation must not fade through to messages'
    )


def test_mobile_header_dropdown_is_viewport_bounded() -> None:
    """Mobile header menu should scroll internally instead of being clipped."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    mobile_start = css.find('@media (max-width: 768px)')
    assert mobile_start >= 0, 'chat.css: mobile media block not found'
    mobile_css = css[mobile_start:]
    blocks = re.findall(
        r'\.chat-header\s+\.header-dropdown\s*\{([^}]*)\}',
        mobile_css,
        re.DOTALL,
    )
    assert blocks, 'chat.css: mobile .chat-header .header-dropdown block not found'
    assert any('--app-vh' in block and 'max-height:' in block for block in blocks), (
        'chat.css: mobile header dropdown must be capped by the visual app height'
    )
    assert any('overflow-y: auto' in block for block in blocks), (
        'chat.css: mobile header dropdown must scroll internally when viewport is short'
    )


def test_hidden_group_profile_panels_stay_out_of_direct_profile_layout() -> None:
    """Hidden group-only panels must not override [hidden] inside direct profiles."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    assert '.group-edit-side-panel {' in css and 'display: flex' in css
    assert '.group-permissions-panel {' in css and 'display: flex' in css

    hidden_block = re.search(
        r'\.group-edit-side-panel\[hidden\],\s*\.group-permissions-panel\[hidden\]\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert hidden_block, 'chat.css: hidden group profile panels must have an explicit override'
    assert 'display: none' in hidden_block.group(1), (
        'chat.css: hidden group profile panels must not remain flex-visible in direct profiles'
    )


def test_header_dropdown_close_does_not_linger() -> None:
    """The top-right chat menu should close with a short exit motion, not hang."""
    states = _read_css_text(STATIC / 'pages' / 'chat.css')
    closing_blocks = re.findall(r'\.header-dropdown\.is-closing\s*\{([^}]*)\}', states, re.DOTALL)
    assert closing_blocks, 'chat.css: .header-dropdown.is-closing block not found'
    assert any('opacity: 0' in block for block in closing_blocks), (
        'chat.css: header dropdown closing state should fade out instead of staying fully visible'
    )

    motion = (STATIC / 'motion.css').read_text(encoding='utf-8')
    assert 'm-header-dropdown-close 120ms' in motion, (
        'motion.css: header dropdown should have a short dedicated close animation'
    )
    close_keyframes = re.search(
        r'@keyframes\s+m-header-dropdown-close\s*\{([\s\S]+?)\n\}',
        motion,
    )
    assert close_keyframes, 'motion.css: m-header-dropdown-close keyframes not found'
    close_body = close_keyframes.group(1)
    assert '0%   { opacity: 1' in close_body
    assert '100% { opacity: 0' in close_body

    lazy_ui_runtime = (STATIC / 'modules' / 'chat-lazy-ui-runtime.js').read_text(encoding='utf-8')
    assert "closeFloatingPanel(headerDropdown, 'active', 120)" in lazy_ui_runtime, (
        'chat-lazy-ui-runtime.js: header dropdown close fallback should be short enough to avoid a visible hang'
    )


def test_theme_toggle_syncs_chat_and_settings_surfaces() -> None:
    """Theme changes should update root/body classes and runtime palettes."""
    theme_sync = (STATIC / 'pages' / 'chat-shell' / 'theme-sync.js').read_text(encoding='utf-8')
    apply_dark = re.search(
        r'function applyDark\(on\)\s*\{([\s\S]+?)\n    \}',
        theme_sync,
    )
    assert apply_dark, 'theme-sync.js: applyDark(on) not found'
    apply_dark_body = apply_dark.group(1)
    assert "document.documentElement.classList.toggle('dark-mode', on)" in apply_dark_body
    assert "document.body.classList.toggle('dark-mode', on)" in apply_dark_body
    assert 'interfaceThemeApi.applyCurrentTheme()' in apply_dark_body

    click_handler = re.search(
        r'sidebarThemeToggleBtn\.addEventListener\([\s\S]+?\n\s*\}\);',
        theme_sync,
    )
    assert click_handler, 'theme-sync.js: sidebar theme toggle handler not found'
    click_handler_body = click_handler.group(0)
    assert "localStorage.setItem('darkMode', next)" in click_handler_body
    assert 'applyDark(next)' in click_handler_body
    assert 'window.ChatAppearance.applyCurrentTheme()' in click_handler_body

    settings = (STATIC / 'pages' / 'settings' / 'theme-section.js').read_text(encoding='utf-8')
    assert "localStorage.setItem('darkMode', dark ? 'true' : 'false')" in settings
    assert "document.documentElement.classList.toggle('dark-mode', dark)" in settings
    assert "document.body.classList.toggle('dark-mode', dark)" in settings
    assert "notifyParent('sun-settings-theme-updated', { dark })" in settings


def test_chat_theme_boot_does_not_override_early_boot_without_explicit_theme() -> None:
    """Legacy chat boot must not turn auto/unified dark mode into light mode."""
    theme_boot = (STATIC / 'pages' / 'chat-theme-boot.js').read_text(encoding='utf-8')
    assert "const storedDark = localStorage.getItem('darkMode');" in theme_boot
    assert "if (storedDark === 'true')" in theme_boot
    assert "else if (storedDark === 'false')" in theme_boot
    assert "document.documentElement.classList.remove('dark-mode');\n        } else" not in theme_boot


def test_theme_runtime_readers_preserve_early_boot_dark_mode() -> None:
    """Runtime settings readers must not treat missing darkMode storage as light."""
    theme_state = (STATIC / 'modules' / 'theme-state.js').read_text(encoding='utf-8')
    assert "if (storedDark === 'true') return true;" in theme_state
    assert "if (storedDark === 'false') return false;" in theme_state
    assert "document.documentElement?.classList?.contains('dark-mode')" in theme_state

    for relative_path in (
        ('pages', 'chat-shell', 'theme-sync.js'),
        ('pages', 'settings', 'theme-section.js'),
        ('pages', 'settings', 'settings-transfer-section.js'),
        ('pages', 'settings', 'privacy-section.js'),
    ):
        source = (STATIC.joinpath(*relative_path)).read_text(encoding='utf-8')
        assert "readAppliedDarkMode" in source, f"{'/'.join(relative_path)} must use DOM-aware dark mode"
        assert "localStorage.getItem('darkMode') === 'true'" not in source

    chat_shell = (STATIC / 'pages' / 'chat-shell.js').read_text(encoding='utf-8')
    assert 'function readAppliedDarkMode()' in chat_shell
    assert "isDark: readAppliedDarkMode" in chat_shell

    search = (ROOT / 'templates' / 'search.html').read_text(encoding='utf-8')
    assert "{% include '_client_preferences_early_boot.html' %}" in search
    assert "document.documentElement.classList.contains('dark-mode')" in search


def test_early_boot_ignores_stale_boot_css_vars_when_theme_mode_changed() -> None:
    """A stale boot snapshot must not apply light vars after darkMode changed."""
    early_boot = (ROOT / 'templates' / '_client_preferences_early_boot.html').read_text(encoding='utf-8')
    assert "const bootDarkMode = typeof boot.darkMode === 'boolean' ? boot.darkMode : null;" in early_boot
    assert "const rawCssVars = asObject(boot.cssVars);" in early_boot
    assert "const cssVars = bootDarkMode === null || bootDarkMode === darkMode ? rawCssVars : {};" in early_boot


def test_chat_body_theme_boot_runs_before_loading_shell() -> None:
    """Chat loading UI must not paint before body receives the early theme."""
    chat_template = (ROOT / 'templates' / 'chat.html').read_text(encoding='utf-8')

    body_sync_pos = chat_template.find('window.SUN_SYNC_BODY_THEME_BOOT?.();')
    boot_overlay_pos = chat_template.find("{% include 'chat/_boot_overlay.html' %}")
    app_shell_pos = chat_template.find('<div class="app">')

    assert body_sync_pos != -1, 'chat.html: early body theme sync script is missing'
    assert boot_overlay_pos != -1, 'chat.html: boot overlay include not found'
    assert app_shell_pos != -1, 'chat.html: app shell not found'
    assert body_sync_pos < boot_overlay_pos
    assert body_sync_pos < app_shell_pos


def test_early_boot_exposes_immediate_body_theme_sync() -> None:
    """The head boot script must expose a sync hook for the first body paint."""
    early_boot = (ROOT / 'templates' / '_client_preferences_early_boot.html').read_text(encoding='utf-8')

    assert 'function syncDomThemeMode(root, body = document.body)' in early_boot
    assert "targetRoot.dataset.theme = themeKey;" in early_boot
    assert "targetRoot.dataset.bsTheme = themeKey;" in early_boot
    assert "body.classList.toggle('dark-mode', darkMode);" in early_boot
    assert "body.dataset.theme = themeKey;" in early_boot
    assert "body.dataset.bsTheme = themeKey;" in early_boot
    assert 'window.SUN_SYNC_BODY_THEME_BOOT = mirrorRootVarsToBody;' in early_boot


def test_interface_theme_runtime_updates_all_accent_variants() -> None:
    """Preset/accent changes must update every semantic accent token used by CSS."""
    interface_theme = (STATIC / 'interface-theme.js').read_text(encoding='utf-8')
    bootstrap = (STATIC / 'bootstrap.js').read_text(encoding='utf-8')
    early_boot = (ROOT / 'templates' / '_client_preferences_early_boot.html').read_text(encoding='utf-8')

    assert "target.style.setProperty('--accent-deep', tokens.deep)" in interface_theme
    assert "target.style.setProperty('--accent-soft', tokens.soft)" in interface_theme

    for name, source in (
        ('bootstrap.js', bootstrap),
        ('_client_preferences_early_boot.html', early_boot),
    ):
        assert "'--accent-deep': deep" in source, f'{name}: --accent-deep is not bootstrapped'
        assert "'--accent-soft': soft" in source, f'{name}: --accent-soft is not bootstrapped'

    assert "hasOwnProperty.call(cssVars, '--accent-deep')" in early_boot
    assert "hasOwnProperty.call(cssVars, '--accent-soft')" in early_boot


def test_settings_redesign_uses_local_fonts_only() -> None:
    """Settings CSS must not import remote fonts under production CSP."""
    settings_redesign = (STATIC / 'pages' / 'settings-redesign.css').read_text(encoding='utf-8')

    assert 'fonts.googleapis.com' not in settings_redesign
    assert 'Inter Tight' not in settings_redesign


def test_message_alignment_self_vs_other_on_chat_page() -> None:
    """Outgoing and incoming messages must not share the same left alignment.

    Regression guard:
    - `.message.self` is right-aligned;
    - `.message.other` is left-aligned;
    - self avatar slot does not reserve horizontal width.
    """
    css = _read_css_text(STATIC / 'pages' / 'chat.css')

    self_block = re.search(r'\.message\.self\s*\{([^}]*)\}', css, re.DOTALL)
    other_block = re.search(r'\.message\.other\s*\{([^}]*)\}', css, re.DOTALL)
    assert self_block, 'chat.css: .message.self block not found'
    assert other_block, 'chat.css: .message.other block not found'

    self_body = self_block.group(1)
    other_body = other_block.group(1)
    assert 'justify-content: flex-end' in self_body, (
        'chat.css: .message.self should be right-aligned (justify-content:flex-end)'
    )
    assert 'align-self: flex-end' in self_body, (
        'chat.css: .message.self should align to right edge (align-self:flex-end)'
    )
    assert 'transform-origin: right bottom' in self_body, (
        'chat.css: outgoing messages should animate from the right edge, not drift right'
    )
    assert 'from { opacity: 0; transform: translate3d(0, 8px, 0); }' in css, (
        'chat.css: outgoing message enter animation should not scale horizontally'
    )
    assert 'msgInSelf {\n            from { opacity: 0; transform: translate3d(0, 8px, 0) scale' not in css, (
        'chat.css: outgoing message scale animation causes mobile right-edge drift'
    )
    assert 'justify-content: flex-start' in other_body, (
        'chat.css: .message.other should stay left-aligned (justify-content:flex-start)'
    )
    assert 'align-self: flex-start' in other_body, (
        'chat.css: .message.other should stay on left edge (align-self:flex-start)'
    )
    assert 'transform-origin: left bottom' in other_body, (
        'chat.css: incoming messages should keep a left-edge transform origin'
    )
    assert '--chat-mobile-outgoing-edge-offset: calc(var(--composer-action-size) + 8px)' in css, (
        'chat.css: mobile outgoing messages should align to the composer input right edge'
    )
    assert 'padding-right: var(--chat-mobile-outgoing-edge-offset, 12px)' in css, (
        'chat.css: mobile outgoing row track should apply the outgoing edge inset'
    )

    self_avatar_slot_block = re.search(
        r'\.message\.self\s+\.message-avatar-slot\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert self_avatar_slot_block, 'chat.css: .message.self .message-avatar-slot block not found'
    self_avatar_slot_body = self_avatar_slot_block.group(1)
    assert 'flex: 0 0 0' in self_avatar_slot_body, (
        'chat.css: self avatar slot should not reserve horizontal width'
    )


def test_optimistic_outgoing_messages_rebuild_tail_alignment() -> None:
    """Optimistic self messages should update tail grouping without remounting media."""
    append_runtime = (STATIC / 'modules' / 'chat-message-append-runtime.js').read_text(encoding='utf-8')
    composer_send_runtime = (STATIC / 'modules' / 'chat-composer-send-runtime.js').read_text(encoding='utf-8')
    text_send = (STATIC / 'modules' / 'chat-text-send.js').read_text(encoding='utf-8')
    file_send = (STATIC / 'modules' / 'chat-file-send.js').read_text(encoding='utf-8')

    assert 'const previousTailMessage = lastIdx > 0 ? state.messages[lastIdx - 1] : null' in append_runtime
    assert 'const tailGroupWouldChange = isSameMessageGroup(previousTailMessage, inserted)' in append_runtime
    assert 'syncReusedMessageNodeState?.(previousTailNode, previousTailMessage, previousTailLayout)' in append_runtime, (
        'chat-message-append-runtime.js: fast append must refresh previous tail grouping before appending'
    )
    assert "chat-text-send.js" in composer_send_runtime
    assert "chat-file-send.js" in composer_send_runtime
    assert 'renderOptions: { scrollToBottom: true }' in text_send, (
        'chat-text-send.js: optimistic text sends should append without forcing chat media remount'
    )
    assert 'renderOptions: { force: true, scrollToBottom: true }' not in text_send, (
        'chat-text-send.js: optimistic text sends must not force full chat rerender'
    )
    assert 'renderOptions: { scrollToBottom: true }' in file_send, (
        'chat-file-send.js: optimistic file sends should append without forcing chat media remount'
    )
    assert 'renderOptions: { force: true, scrollToBottom: true }' not in file_send, (
        'chat-file-send.js: optimistic file sends must not force full chat rerender'
    )


def test_failed_image_media_does_not_become_visible_loaded_image() -> None:
    """Broken chat images must not expose the browser's native broken-image icon and alt text."""
    media_runtime = (STATIC / 'modules' / 'chat-media-runtime.js').read_text(encoding='utf-8')
    error_handler_idx = media_runtime.find('window._onMessageMediaLoadError = function(mediaEl)')
    image_guard_idx = media_runtime.find('mediaEl instanceof HTMLImageElement', error_handler_idx)
    remove_loaded_idx = media_runtime.find("mediaEl.removeAttribute('data-loaded')", image_guard_idx)
    return_idx = media_runtime.find('return;', remove_loaded_idx)
    set_loaded_idx = media_runtime.find("mediaEl.setAttribute('data-loaded', '1')", return_idx)

    assert error_handler_idx >= 0, 'chat-media-runtime.js: media load error handler is missing'
    assert image_guard_idx > error_handler_idx, (
        'chat-media-runtime.js: failed image loads must be handled separately from video/audio'
    )
    assert remove_loaded_idx > image_guard_idx and return_idx > remove_loaded_idx, (
        'chat-media-runtime.js: failed images must not keep the visible data-loaded state'
    )
    assert set_loaded_idx > return_idx, (
        'chat-media-runtime.js: non-image media can still finish the existing error path'
    )


def test_hydrated_chat_images_bypass_native_lazy_loading() -> None:
    """Custom media hydration must be the only lazy gate for chat images."""
    hydration = (STATIC / 'modules' / 'media-hydration.js').read_text(encoding='utf-8')
    force_helper_idx = hydration.find('function forceImageNetworkLoad(imageEl)')
    loading_property_idx = hydration.find("imageEl.loading = 'eager'", force_helper_idx)
    loading_attr_idx = hydration.find("imageEl.setAttribute('loading', 'eager')", force_helper_idx)
    hydrate_image_idx = hydration.find('function hydrateImage(imageEl)')
    force_call_idx = hydration.find('forceImageNetworkLoad(imageEl);', hydrate_image_idx)
    src_guard_idx = hydration.find("if (String(imageEl.getAttribute('src') || '').trim()) return true;", hydrate_image_idx)

    assert force_helper_idx >= 0, (
        'media-hydration.js: hydrated images must disable native lazy loading before assigning src'
    )
    assert loading_property_idx > force_helper_idx and loading_attr_idx > force_helper_idx, (
        'media-hydration.js: forceImageNetworkLoad must set both the property and attribute to eager'
    )
    assert hydrate_image_idx >= 0 and force_call_idx > hydrate_image_idx, (
        'media-hydration.js: hydrateImage must call forceImageNetworkLoad'
    )
    assert force_call_idx < src_guard_idx, (
        'media-hydration.js: eager loading must be applied even when src is already present'
    )


def test_portrait_chat_media_keeps_ratio_aware_bubble_width() -> None:
    """Tall mobile photos must not be cropped by square/wide media bubbles."""
    rendering = (STATIC / 'modules' / 'message-rendering.js').read_text(encoding='utf-8')
    media_runtime = (STATIC / 'modules' / 'chat-media-runtime.js').read_text(encoding='utf-8')
    mutations = (STATIC / 'modules' / 'chat-message-mutations.js').read_text(encoding='utf-8')
    css = _read_css_text(STATIC / 'pages' / 'chat.css')

    assert 'Math.max(0.46, Math.min(1.91, ratio))' in rendering, (
        'message-rendering.js: initial media aspect ratio must allow phone-portrait photos'
    )
    assert 'Math.max(0.46, Math.min(1.91, naturalWidth / naturalHeight))' in media_runtime, (
        'chat-media-runtime.js: loaded image dimensions must preserve phone-portrait aspect ratio'
    )
    assert 'Math.max(0.46, Math.min(1.91, aspectRatio))' in mutations, (
        'chat-message-mutations.js: pending upload commit must preserve phone-portrait aspect ratio'
    )
    assert 'width: min(420px, calc(420px * var(--media-aspect-ratio, 1)), 76vw);' in css, (
        'chat.css: final desktop media bubble rule must stay ratio-aware'
    )
    assert 'width: min(88vw, 380px, calc(420px * var(--media-aspect-ratio, 1)));' in css, (
        'chat.css: final mobile media bubble rule must stay ratio-aware'
    )


def test_chatjs_syncs_visual_viewport_css_vars() -> None:
    """Chat mobile viewport runtime must sync visualViewport metrics to CSS vars."""
    runtime = (STATIC / 'modules' / 'chat-mobile-viewport-runtime.js').read_text(encoding='utf-8')
    viewport = (STATIC / 'modules' / 'mobile-viewport.js').read_text(encoding='utf-8')
    assert 'function syncVisualViewportCssVars()' in runtime, (
        'chat-mobile-viewport-runtime.js: visual viewport sync helper is missing'
    )
    for token in (
        '--app-vh',
        '--app-vw',
        '--vv-keyboard-inset',
    ):
        assert token in viewport, f'mobile-viewport.js: missing CSS var sync for {token}'
    assert "let nextAppVh = '100dvh'" in viewport, (
        'mobile-viewport.js: app height must fall back to native 100dvh while keyboard handling is active'
    )
    assert 'if (!keyboardActive && vvHeight > 0)' in viewport, (
        'mobile-viewport.js: closed-keyboard mobile reload must bind app height to visualViewport.height'
    )
    assert "root.style.setProperty('--app-vh', nextAppVh)" in viewport, (
        'mobile-viewport.js: measured app height must be written through --app-vh'
    )
    assert 'function resetHorizontalViewportDrift()' in runtime, (
        'chat-mobile-viewport-runtime.js: composer focus should guard against mobile horizontal viewport drift'
    )
    assert 'target.scrollLeft = 0' in runtime, (
        'chat-mobile-viewport-runtime.js: mobile focus drift guard should reset horizontal scrollLeft'
    )
    assert 'requestAnimationFrameFn(resetHorizontalViewportDrift)' in runtime, (
        'chat-mobile-viewport-runtime.js: drift reset should run after focus/keyboard layout settles'
    )
    assert 'windowRef.visualViewport.addEventListener(\'resize\', syncViewportAndInsets)' in runtime, (
        'chat-mobile-viewport-runtime.js: visualViewport resize should use syncViewportAndInsets'
    )
    assert 'windowRef.visualViewport.addEventListener(\'scroll\', syncViewportAndInsets)' in runtime, (
        'chat-mobile-viewport-runtime.js: visualViewport scroll should use syncViewportAndInsets'
    )


def test_mobile_viewport_reload_uses_visual_height_without_reverting_keyboard_model() -> None:
    """Closed-keyboard mobile reload should use visualViewport height without old full JS layout driving."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    viewport = (STATIC / 'modules' / 'mobile-viewport.js').read_text(encoding='utf-8')
    head = (ROOT / 'templates' / 'chat' / '_head.html').read_text(encoding='utf-8')

    assert 'interactive-widget=resizes-content' in head
    assert 'minimum-scale=1' in head

    assert 'const vvHeight = roundedPx(vv.height)' in viewport
    assert 'keyboardActive = layoutHeight > 0 && vvHeight < layoutHeight * 0.85' in viewport
    assert 'keyboardInset = keyboardActive ? Math.max(0, layoutHeight - vvHeight - vvTop) : 0' in viewport
    assert 'if (!keyboardActive && vvHeight > 0)' in viewport
    assert "root.classList.toggle('mobile-keyboard-active', keyboardActive)" in viewport

    app_blocks = re.findall(r'\.app\s*\{([^}]*)\}', css, re.DOTALL)
    assert any('top: 0' in block for block in app_blocks), (
        'mobile .app should stay top-pinned in the native resizes-content model'
    )
    assert any('bottom: auto' in block for block in app_blocks), (
        'mobile .app should size by --app-vh instead of stretching top-to-bottom'
    )
    assert any('height: var(--app-vh, 100dvh)' in block for block in app_blocks), (
        'mobile .app should consume the synced visual height variable'
    )
    assert 'html.mobile-keyboard-active:not(.mobile-emoji-sheet-open) .chat-area:not(.emoji-sheet-open) .chat-input-area' in css
    assert 'var(--vv-keyboard-inset, 0px)' in css
