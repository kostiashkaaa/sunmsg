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
        r'animation:\s*m-bubble-in-self\s+(\d+)ms',
        re.DOTALL,
    )
    match = block_re.search(css)
    assert match, 'motion.css: правило m-bubble-in-self для self-bubble не найдено'
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


def test_mobile_emoji_picker_uses_css_bottom_sheet_without_js_positioning() -> None:
    """Mobile emoji picker is a CSS-docked row; JS positioning stays desktop-only."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    position_start = emoji.find('function positionEmojiPicker')
    assert position_start >= 0, 'emoji.js: positionEmojiPicker not found'
    mobile_branch_idx = emoji.find('if (isMobileEmojiViewport())', position_start)
    dataset_idx = emoji.find("emojiPicker.dataset.side = 'mobile-sheet';", mobile_branch_idx)
    return_idx = emoji.find('return;', dataset_idx)
    desktop_geometry_idx = emoji.find("const formRect = emojiBtn.closest('#messageForm')", return_idx)
    assert position_start < mobile_branch_idx < dataset_idx < return_idx < desktop_geometry_idx, (
        'emoji.js: mobile picker must skip desktop geometry reads and let CSS dock the sheet.'
    )

    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    emoji_picker_blocks = re.findall(r'\.emoji-picker\s*\{([^}]*)\}', css, re.DOTALL)
    assert any(
        'position: relative !important' in block
        and 'bottom: auto !important' in block
        and 'height: 0 !important' in block
        and 'transform: translate3d(0, 10px, 0)' in block
        for block in emoji_picker_blocks
    ), 'chat.css: mobile emoji picker should be a hidden flow row by default.'
    active_blocks = re.findall(r'\.emoji-picker\.active\s*\{([^}]*)\}', css, re.DOTALL)
    assert active_blocks, 'chat.css: .emoji-picker.active block not found'
    assert any(
        'height: var(--emoji-sheet-height) !important' in block
        and 'transform: translate3d(0, 0, 0)' in block
        and 'height var(--emoji-sheet-motion-duration' not in block
        for block in active_blocks
    ), 'chat.css: mobile .emoji-picker.active should reserve height without animating layout.'

    motion = (STATIC / 'motion.css').read_text(encoding='utf-8')
    generic_pop_idx = motion.find('.emoji-picker.active,\n    .message-scale-panel.active')
    generic_close_idx = motion.find('.attach-menu.is-closing,\n    .emoji-picker.is-closing')
    mobile_sheet_override_idx = motion.find(
        '.emoji-picker.active,\n    .emoji-picker.is-closing {\n        animation: none;\n    }',
        generic_close_idx,
    )
    assert 0 <= generic_pop_idx < mobile_sheet_override_idx, (
        'motion.css: mobile emoji sheet must override generic popup scale animation.'
    )
    assert 0 <= generic_close_idx < mobile_sheet_override_idx, (
        'motion.css: mobile emoji sheet must override generic closing popup scale.'
    )
    assert '.emoji-picker,\n    .emoji-picker.is-closing {\n        transform: translate3d(0, 10px, 0);\n    }' in motion
    assert '.emoji-picker.active {\n        transform: translate3d(0, 0, 0);\n    }' in motion


def test_mobile_emoji_open_locks_composer_before_blur() -> None:
    """Opening the mobile emoji sheet must dock composer layout before input blur."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    open_start = emoji.find('const openPicker = async (options = {}) => {')
    assert open_start >= 0, 'emoji.js: openPicker not found'
    assert 'const ensureDefaultEmojiListRendered = async ({ forceCategoryScroll = false } = {}) => {' in emoji
    prepare_idx = emoji.find('await ensureDefaultEmojiListRendered({ forceCategoryScroll: true });', open_start)
    guard_idx = emoji.find('if (renderSeq !== openRenderSeq) return;', prepare_idx)
    active_idx = emoji.find("emojiPicker.classList.add('active');", open_start)
    set_state_idx = emoji.find('setMobileEmojiSheetState(emojiPicker, true);', active_idx)
    blur_idx = emoji.find('messageInput.blur();', set_state_idx)
    mobile_return_idx = emoji.find('if (shouldOpenMobile) {\n            return;\n        }', active_idx)
    raf_idx = emoji.find('window.requestAnimationFrame(() => {', mobile_return_idx)
    raf_render_idx = emoji.find('ensureDefaultEmojiListRendered({ forceCategoryScroll: true })', raf_idx)
    assert open_start < prepare_idx < guard_idx < active_idx < set_state_idx < blur_idx, (
        'emoji.js: mobile keyboard-to-emoji must prepare the emoji DOM before showing the sheet, '
        'then dock layout before blurring the native keyboard.'
    )
    assert active_idx < mobile_return_idx < raf_idx < raf_render_idx, (
        'emoji.js: requestAnimationFrame emoji rendering should remain desktop-only after mobile open returns.'
    )

    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    composer_transition = re.search(r'\.chat-input-area\s*\{([^}]*)\}', css, re.DOTALL)
    assert composer_transition, 'chat.css: .chat-input-area block not found'
    block = re.search(
        r'\.chat-area\.emoji-sheet-open\s+\.chat-input-area\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert block, 'chat.css: mobile .emoji-sheet-open .chat-input-area block not found'
    assert 'transform: none' in block.group(1)
    instant_block = re.search(r'\.emoji-picker\.is-closing-instant\s*\{([^}]*)\}', css, re.DOTALL)
    assert instant_block, 'chat.css: instant emoji close block not found'
    assert 'transition: none !important' in instant_block.group(1)
    assert 'height: 0 !important' in instant_block.group(1)


def test_mobile_emoji_switch_open_prevents_pointer_blur() -> None:
    """Emoji button pointerdown owns mobile toggling so click/blur cannot race it."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    pointer_start = emoji.find("emojiBtn.addEventListener('pointerdown'")
    assert pointer_start >= 0, 'emoji.js: emoji button pointerdown handler not found'
    prevent_idx = emoji.find('event.preventDefault();', pointer_start)
    handled_idx = emoji.find('handledKeyboardSwitchPointer = true;', prevent_idx)
    active_idx = emoji.find("if (emojiPicker.classList.contains('active'))", handled_idx)
    close_idx = emoji.find('closePicker({ focusInput: true });', active_idx)
    open_idx = emoji.find('openPicker().catch(() => {});', close_idx)
    click_idx = emoji.find("emojiBtn.addEventListener('click'", pointer_start)
    assert pointer_start < prevent_idx < handled_idx < active_idx < close_idx < open_idx < click_idx, (
        'emoji.js: mobile pointerdown should prevent default, mark the click handled, then toggle the sheet.'
    )

    lazy_ui_runtime = (STATIC / 'modules' / 'chat-lazy-ui-runtime.js').read_text(encoding='utf-8')
    lazy_pointer_idx = lazy_ui_runtime.find("emojiBtn?.addEventListener('pointerdown'")
    lazy_click_idx = lazy_ui_runtime.find("emojiBtn?.addEventListener('click'")
    lazy_ready_idx = lazy_ui_runtime.find('if (isEmojiPickerReady) return;', lazy_pointer_idx)
    lazy_prevent_idx = lazy_ui_runtime.find('event.preventDefault();', lazy_pointer_idx)
    lazy_import_idx = lazy_ui_runtime.find('await ensureEmojiPicker();', lazy_pointer_idx)
    lazy_dispatch_idx = lazy_ui_runtime.find('dispatchEmojiOpen();', lazy_pointer_idx)
    lazy_pending_bail_idx = lazy_ui_runtime.find('if (emojiPickerInitPromise) return;', lazy_pointer_idx, lazy_prevent_idx)
    lazy_warmup_idx = lazy_ui_runtime.find('function scheduleEmojiPickerWarmup')
    lazy_focus_warmup_idx = lazy_ui_runtime.find("messageInput?.addEventListener('focus'", lazy_warmup_idx)
    assert lazy_pointer_idx >= 0, 'chat-lazy-ui-runtime.js: emoji pointerdown preload handler not found'
    assert 'let isEmojiPickerReady = false;' in lazy_ui_runtime
    assert lazy_pending_bail_idx == -1, (
        'chat-lazy-ui-runtime.js: pending emoji preload must still own mobile pointerdown.'
    )
    assert lazy_pointer_idx < lazy_ready_idx < lazy_prevent_idx < lazy_import_idx < lazy_dispatch_idx < lazy_click_idx, (
        'chat-lazy-ui-runtime.js: first mobile emoji tap must preload before click/blur and dispatch open.'
    )
    assert 0 <= lazy_warmup_idx < lazy_focus_warmup_idx, (
        'chat-lazy-ui-runtime.js: emoji module should warm up before the first emoji button tap.'
    )


def test_mobile_emoji_tap_does_not_rebuild_recent_grid_during_animation() -> None:
    """Mobile emoji tap feedback must keep the tapped node alive until animation ends."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    assert 'const deferRecentUpdate = Boolean(options.deferRecentUpdate);' in emoji
    assert 'if (!deferRecentUpdate && !compactQuery' in emoji
    assert 'void itemButton.offsetWidth' not in emoji
    assert "itemButton.classList.add(tapClass);" in emoji
    assert "selectEmojiItem(itemButton, { focusAfter: false, deferRecentUpdate: true })" in emoji

    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    tapped_block = re.search(
        r'\.emoji-item\.emoji-item--tap-a\s+\.emoji-graphic\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert tapped_block, 'chat.css: mobile emoji tap glyph animation block not found'
    assert 'animation: emojiTapPopA 220ms' in tapped_block.group(1)
    assert '.emoji-item.emoji-item--tap-a,\n            .emoji-item.emoji-item--tap-b' in css


def test_mobile_emoji_keyboard_handoff_uses_visual_viewport_release() -> None:
    """Emoji-to-keyboard handoff should release only after visualViewport confirms keyboard movement."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    assert 'const MOBILE_KEYBOARD_HANDOFF_DELTA_PX = 24;' in emoji
    assert 'const MOBILE_KEYBOARD_HANDOFF_MAX_MS = 900;' in emoji
    assert 'const visualViewport = window.visualViewport;' in emoji
    assert "chatArea?.classList.add('emoji-sheet-keyboard-handoff');" in emoji
    assert "document.documentElement.classList.add('mobile-emoji-keyboard-handoff');" in emoji
    assert "visualViewport?.addEventListener('resize', maybeReleaseKeyboardHandoff" in emoji
    assert "visualViewport?.addEventListener('scroll', maybeReleaseKeyboardHandoff" in emoji
    assert 'currentViewportHeight <= startViewportHeight - MOBILE_KEYBOARD_HANDOFF_DELTA_PX' in emoji
    assert "document.addEventListener('sun-open-emoji-picker'" in emoji


def test_mobile_chat_uses_css_emoji_sheet_flow_row() -> None:
    """Mobile emoji sheet is a flow row; visualViewport still owns keyboard size."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    chat_area_blocks = re.findall(r'\.chat-area\s*\{([^}]*)\}', css, re.DOTALL)
    assert any('--emoji-sheet-motion-duration: 220ms' in block for block in chat_area_blocks), (
        'chat.css: mobile chat area should define shared emoji sheet motion duration.'
    )
    assert any('--emoji-sheet-height: min(300px, 42dvh)' in block for block in chat_area_blocks), (
        'chat.css: mobile chat area should define fixed CSS emoji sheet height.'
    )
    assert 'height: var(--app-vh, 100dvh)' in css
    assert 'bottom: var(--mobile-composer-bottom-inset' not in css

    emoji_open_block = re.search(r'\.chat-area\.emoji-sheet-open\s+\.chat-input-area\s*\{([^}]*)\}', css, re.DOTALL)
    assert emoji_open_block, 'chat.css: .chat-area.emoji-sheet-open .chat-input-area block not found'
    assert 'transform: none' in emoji_open_block.group(1)

    emoji_picker_blocks = re.findall(r'\.emoji-picker\s*\{([^}]*)\}', css, re.DOTALL)
    assert any('position: relative !important' in block and 'height: 0 !important' in block for block in emoji_picker_blocks), (
        'chat.css: mobile emoji picker should be a collapsed flow row when closed.'
    )


def test_input_bar_panels_close_each_other() -> None:
    """Emoji and attach panels must not stack over the mobile input bar."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    attach_menu = (STATIC / 'modules' / 'chat-attach-menu.js').read_text(encoding='utf-8')

    open_start = emoji.find('const openPicker = async (options = {}) => {')
    close_attach_idx = emoji.find("document.dispatchEvent(new Event('sun-close-attach-menu'));", open_start)
    prepare_idx = emoji.find('await ensureDefaultEmojiListRendered({ forceCategoryScroll: true });', close_attach_idx)
    active_idx = emoji.find("emojiPicker.classList.add('active');", prepare_idx)
    mobile_idx = emoji.find('if (shouldOpenMobile)', active_idx)
    assert open_start < close_attach_idx < prepare_idx < active_idx < mobile_idx, (
        'emoji.js: opening emoji must close the attach menu, prepare mobile DOM, then hand off layout.'
    )

    open_attach_idx = attach_menu.find('function openAttachMenu()')
    close_emoji_idx = attach_menu.find("document.dispatchEvent(new Event('sun-close-emoji-picker'));", open_attach_idx)
    set_open_idx = attach_menu.find('setAttachMenuOpen(true);', close_emoji_idx)
    listener_idx = attach_menu.find("document.addEventListener('sun-close-attach-menu', closeAttachMenu);")
    assert open_attach_idx < close_emoji_idx < set_open_idx, (
        'chat-attach-menu.js: opening attach menu must close the emoji picker first.'
    )
    assert listener_idx >= 0, 'chat-attach-menu.js: attach menu must listen for emoji-side close requests.'


def test_mobile_emoji_open_preserves_bottom_pinned_chat() -> None:
    """Opening emoji sheet should keep bottom-pinned messages above the composer."""
    emoji = (STATIC / 'modules' / 'emoji.js').read_text(encoding='utf-8')
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    assert 'const MOBILE_EMOJI_CHAT_PIN_THRESHOLD = 96;' in emoji
    assert 'function isMobileEmojiChatPinnedToBottom(chatArea)' in emoji
    assert 'function pinMobileEmojiChatToBottom(chatArea)' in emoji
    assert '.chat-area.emoji-sheet-keyboard-handoff .chat-input-area' in css
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
    prepare_idx = emoji.find('await ensureDefaultEmojiListRendered({ forceCategoryScroll: true });', open_start)
    active_idx = emoji.find("emojiPicker.classList.add('active');", prepare_idx)
    set_state_idx = emoji.find('setMobileEmojiSheetState(emojiPicker, true);', active_idx)
    open_blur_idx = emoji.find('messageInput.blur();', set_state_idx)
    assert open_start < prepare_idx < active_idx < set_state_idx < open_blur_idx, (
        'emoji.js: keyboard-to-emoji handoff must prepare emoji DOM and set emoji layout before blurring the native keyboard.'
    )

    close_start = emoji.find('const closePicker = ({ focusInput = false, keyboardOpening = false } = {}) => {')
    handoff_idx = emoji.find('if (keyboardComing)', close_start)
    clear_idx = emoji.find('clearMobileEmojiSheetState(emojiPicker);', handoff_idx)
    focus_idx = emoji.find('if (focusInput) focusComposerInput();', clear_idx)
    assert close_start < handoff_idx < clear_idx < focus_idx, (
        'emoji.js: emoji-to-keyboard handoff must clear the CSS sheet before focusing the native keyboard.'
    )


def test_mobile_inline_message_meta_uses_shared_flex_layout() -> None:
    """Mobile inline text footer should use the same flex alignment model as desktop."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    _COMPACT_BUBBLE_CORE = (
        r'\.message:not\(\.message-emoji-only\)\s+'
        r'\.bubble\.bubble--simple-text'
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


def test_message_hot_path_avoids_has_selectors() -> None:
    """Message list hot-path selectors should use runtime classes instead of :has()."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    visual_runtime = (STATIC / 'modules' / 'chat-message-visual-runtime.js').read_text(encoding='utf-8')
    render_runtime = (STATIC / 'modules' / 'chat-message-render-runtime.js').read_text(encoding='utf-8')
    media_meta = (STATIC / 'modules' / 'chat-media-meta.js').read_text(encoding='utf-8')

    for forbidden in (
        '.message .bubble:has(> .message-text)',
        '.message-stack:has(.bubble--audio)',
        ':not(:has(> .message-link-preview))',
        '> .message-footer:has(.msg-pin)',
        '.bubble--album:has(.album-caption)',
    ):
        assert forbidden not in css, f'chat.css: hot-path selector still uses {forbidden}'

    for token in (
        'bubble--has-message-text',
        'bubble--simple-text',
        'bubble--text-meta-pinned',
        'bubble--text-meta-edited',
        'bubble--text-meta-readers',
        'message-stack--audio',
    ):
        assert token in visual_runtime, f'chat-message-visual-runtime.js: missing {token}'

    assert 'void container.offsetWidth' not in render_runtime, (
        'chat-message-render-runtime.js: reveal animation must not force synchronous layout.'
    )
    assert 'function patchChatMessageChildren(container, desiredNodes)' in render_runtime, (
        'chat-message-render-runtime.js: virtual list must patch child nodes instead of full hot-path replacement.'
    )
    assert 'unregisterMediaElementsForLazyHydration?.(node);' in render_runtime, (
        'chat-message-render-runtime.js: removed virtual rows must unregister lazy media observers.'
    )
    assert 'disconnectLazyMediaHydrationObserver?.();' not in render_runtime, (
        'chat-message-render-runtime.js: virtual render loop must not reconnect the lazy media observer.'
    )
    assert 'new globalThis.ResizeObserver' in render_runtime, (
        'chat-message-render-runtime.js: rendered message heights must stay synced after media/reaction resize.'
    )
    assert 'CHAT_MEDIA_META_RENDER_BUDGET_MS = 96' in media_meta, (
        'chat-media-meta.js: metadata probing must have a short render budget.'
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


def test_settings_detail_panel_body_scrolls_on_mobile() -> None:
    """Mobile settings detail tabs must scroll instead of being clipped by the shell."""
    css = (STATIC / 'pages' / 'settings-polish.css').read_text(encoding='utf-8')
    mobile_start = css.find('@media (max-width: 1024px)')
    mobile_end = css.find('@media (max-width: 600px)', mobile_start)
    assert mobile_start >= 0, 'settings-polish.css: max-width 1024px block not found'
    assert mobile_end > mobile_start, 'settings-polish.css: next mobile block not found'

    mobile_css = css[mobile_start:mobile_end]
    panel_body_blocks = re.findall(
        r'body\.settings-detail-open\s+\.settings-panel-body\s*\{([^}]*)\}',
        mobile_css,
        re.DOTALL,
    )
    assert panel_body_blocks, (
        'settings-polish.css: mobile settings detail panel body block not found'
    )
    assert any('overflow-y: auto !important' in block for block in panel_body_blocks), (
        'settings-polish.css: mobile settings detail panel body must keep vertical scrolling'
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


def test_liquid_glass_uses_zone_theme_backgrounds() -> None:
    """Liquid Glass should not tint the whole sidebar with a generic surface."""
    css = _strip_comments((STATIC / 'pages' / 'chat' / 'liquid-glass.css').read_text(encoding='utf-8'))

    assert '--sun-glass-sidebar-bg' not in css

    for token, theme_var in (
        ('--sun-glass-sidebar-pill-bg', 'var(--sidebar-bg)'),
        ('--sun-glass-sidebar-card-bg', 'var(--sidebar-bg)'),
        ('--sun-glass-chat-pill-bg', 'var(--chat-hdr)'),
        ('--sun-glass-chat-card-bg', 'var(--chat-hdr)'),
    ):
        token_rule = re.search(rf'{re.escape(token)}:\s*[^;]+;', css)
        assert token_rule, f'liquid-glass.css: missing {token}'
        assert theme_var in token_rule.group(0), (
            f'liquid-glass.css: {token} must inherit the local theme background {theme_var}'
        )

    sidebar_block = re.search(
        r'html\[data-interface-surface="glass"\]\s+\.sidebar:not\(\.sidebar--loading\)\s*\{([^}]*)\}',
        css,
        re.DOTALL,
    )
    assert sidebar_block, 'liquid-glass.css: glass sidebar block not found'
    sidebar_body = sidebar_block.group(1)
    assert 'background: transparent' in sidebar_body
    assert 'var(--surface)' not in sidebar_body
    assert 'backdrop-filter: var(--sun-glass-blur)' not in sidebar_body

    active_contact_block = re.search(r'\.contact-item\.active[^{]*\{([^}]*)\}', css, re.DOTALL)
    assert active_contact_block, 'liquid-glass.css: glass active contact block not found'
    active_contact_body = active_contact_block.group(1)
    assert 'var(--sidebar-bg)' in active_contact_body
    assert 'var(--surface)' not in active_contact_body


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
    assert 'const observedLazyMedia = new Set();' in hydration
    assert 'function unregisterMediaElementsForLazyHydration(root = rootElement)' in hydration
    assert 'observeLazyMediaElement(observer, imageEl)' in hydration
    assert 'observeLazyMediaElement(observer, videoEl)' in hydration


def test_portrait_chat_media_keeps_ratio_aware_bubble_width() -> None:
    """Tall mobile photos must not be cropped by square/wide media bubbles."""
    rendering = (STATIC / 'modules' / 'message-rendering.js').read_text(encoding='utf-8')
    media_runtime = (STATIC / 'modules' / 'chat-media-runtime.js').read_text(encoding='utf-8')
    mutations = (STATIC / 'modules' / 'chat-message-mutations.js').read_text(encoding='utf-8')
    css = _read_css_text(STATIC / 'pages' / 'chat.css')

    assert 'Math.max(0.46, Math.min(1.91, ratio))' in rendering, (
        'message-rendering.js: initial media aspect ratio must allow phone-portrait photos'
    )
    assert 'data-media-aspect-ratio-source="${aspectRatio.source}"' in rendering, (
        'message-rendering.js: fallback media ratios must be marked so reload hydration cannot resize the bubble'
    )
    assert "source = 'fallback'" in rendering, (
        'message-rendering.js: media aspect-ratio resolver must distinguish real metadata from fallback'
    )
    assert 'Math.max(0.46, Math.min(1.91, naturalWidth / naturalHeight))' in media_runtime, (
        'chat-media-runtime.js: loaded image dimensions must preserve phone-portrait aspect ratio'
    )
    assert "getAttribute('data-media-aspect-ratio-source') || '') === 'fallback'" in media_runtime, (
        'chat-media-runtime.js: loaded media must not replace fallback ratio after first paint'
    )
    assert 'applyLoadedMediaAspectRatio(mediaWrap, naturalWidth, naturalHeight)' in media_runtime, (
        'chat-media-runtime.js: image load path must use the guarded aspect-ratio updater'
    )
    assert 'applyLoadedMediaAspectRatio(preview, videoWidth, videoHeight)' in media_runtime, (
        'chat-media-runtime.js: video metadata path must use the guarded aspect-ratio updater'
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
        '--vv-top-offset',
        '--vv-left-offset',
        '--vv-keyboard-inset',
    ):
        assert token in viewport, f'mobile-viewport.js: missing CSS var sync for {token}'
    assert "let nextAppVh = '100dvh'" in viewport, (
        'mobile-viewport.js: app height must keep a native 100dvh fallback'
    )
    assert 'const composerFocused = Boolean(' in viewport, (
        'mobile-viewport.js: composer focus must keep keyboard state scoped to the composer'
    )
    assert "activeElement.closest?.('#messageForm, #composerRow')" in viewport, (
        'mobile-viewport.js: composer focus guard must target the message composer only'
    )
    assert 'nextAppVh = `${vvHeight}px`' in viewport, (
        'mobile-viewport.js: mobile app height must bind to visualViewport.height'
    )
    assert 'const shouldUseVisualViewportHeight = Boolean(' in viewport, (
        'mobile-viewport.js: visualViewport height must be gated to keyboard/composer states.'
    )
    assert 'const KEYBOARD_RELEASE_LOCK_MS = 420;' in viewport, (
        'mobile-viewport.js: keyboard dismiss must keep app height locked through the release animation.'
    )
    assert 'let keyboardReleaseUntil = 0;' in viewport, (
        'mobile-viewport.js: keyboard release state must persist across visualViewport frames.'
    )
    assert 'keyboardReleaseActive' in viewport, (
        'mobile-viewport.js: app height must remain visualViewport-bound while the keyboard is releasing.'
    )
    assert "root.classList.contains('mobile-emoji-keyboard-handoff')" in viewport, (
        'mobile-viewport.js: emoji-to-keyboard handoff must keep visual viewport height locked.'
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
    assert 'windowRef.visualViewport.addEventListener(\'resize\', scheduleViewportAndInsets)' in runtime, (
        'chat-mobile-viewport-runtime.js: visualViewport resize should use RAF-scheduled sync'
    )
    assert 'windowRef.visualViewport.addEventListener(\'scroll\', scheduleViewportAndInsets)' in runtime, (
        'chat-mobile-viewport-runtime.js: visualViewport scroll should use RAF-scheduled sync'
    )


def test_mobile_viewport_uses_visual_height_for_keyboard_model() -> None:
    """Mobile keyboard layout should use visualViewport height, not composer paint offsets."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    viewport = (STATIC / 'modules' / 'mobile-viewport.js').read_text(encoding='utf-8')
    runtime = (STATIC / 'modules' / 'chat-mobile-viewport-runtime.js').read_text(encoding='utf-8')
    head = (ROOT / 'templates' / 'chat' / '_head.html').read_text(encoding='utf-8')

    assert 'interactive-widget=resizes-content' in head
    assert 'minimum-scale=1' in head

    assert 'const vvHeight = roundedPx(vv.height)' in viewport
    assert 'const vvTop = roundedPx(vv.offsetTop)' in viewport
    assert 'const vvLeft = roundedPx(vv.offsetLeft)' in viewport
    assert 'nextAppVh = `${vvHeight}px`' in viewport
    assert 'nextViewportTop = `${vvTop}px`' in viewport
    assert 'nextViewportLeft = `${vvLeft}px`' in viewport
    assert 'const keyboardInsetCandidate = Math.max(0, layoutHeight - vvHeight - vvTop)' in viewport
    assert 'const minKeyboardInset = Math.max(160, Math.round(layoutHeight * 0.22))' in viewport
    assert 'const keyboardGeometryActive = layoutHeight > 0 && vvHeight < layoutHeight * 0.85' in viewport
    assert 'const composerViewportActive = composerFocused && vvHeight > 0' in viewport
    assert 'keyboardActive = composerViewportActive && (' in viewport
    assert 'keyboardGeometryActive\n                    ? keyboardInsetCandidate >= minKeyboardInset\n                    : true' in viewport
    assert 'keyboardInset = keyboardGeometryActive && keyboardInsetCandidate >= minKeyboardInset' in viewport
    assert 'keyboardActive || keyboardReleaseActive || keyboardHandoffActive || wasKeyboardActive' in viewport
    assert 'composerViewportActive || keyboardActive || keyboardReleaseActive || keyboardHandoffActive || wasKeyboardActive' in viewport
    assert "root.classList.toggle('mobile-keyboard-active', keyboardActive)" in viewport
    assert "setTimeoutFn(() => scheduleViewportAndInsets({ immediate: true }), 520)" in runtime

    app_blocks = re.findall(r'\.app\s*\{([^}]*)\}', css, re.DOTALL)
    assert any('top: var(--vv-top-offset, 0px)' in block for block in app_blocks), (
        'mobile .app should follow visualViewport.offsetTop when iOS pans the keyboard viewport'
    )
    assert any('bottom: auto' in block for block in app_blocks), (
        'mobile .app should size by --app-vh instead of stretching top-to-bottom'
    )
    assert any('height: var(--app-vh, 100dvh)' in block for block in app_blocks), (
        'mobile .app should consume the synced visual height variable'
    )
    assert 'html.mobile-keyboard-active:not(.mobile-emoji-sheet-open) .chat-area:not(.emoji-sheet-open) .chat-input-area' not in css
    assert 'transform: translate3d(0, calc(-1 * var(--vv-keyboard-inset' not in css
    assert '.chat-area.emoji-sheet-keyboard-handoff .chat-input-area' in css


def test_mobile_pwa_shell_locks_body_scroll_bleed_and_safe_tabbar() -> None:
    """Mobile PWA shell must paint safe areas and keep scroll inside app containers."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    service_worker = (STATIC / 'service-worker.js').read_text(encoding='utf-8')

    assert 'body.chat-page-body {' in css
    assert 'position: fixed;' in css
    assert 'min-height: 100svh;' in css
    assert 'overscroll-behavior-y: none;' in css
    assert '.app::before' not in css
    assert '--mobile-tabbar-safe-bottom: env(safe-area-inset-bottom, 0px);' in css
    assert '--mobile-tabbar-block-size: calc(64px + var(--mobile-tabbar-safe-bottom));' in css
    assert 'background: transparent;' in css
    assert 'padding-bottom: var(--sidebar-bottom-user-reserve' in css
    assert 'touch-action: pan-y;' in css
    assert '-webkit-overflow-scrolling: touch;' in css
    assert "const VERSION = '2026-05-23-pwa-v2';" in service_worker


def test_mobile_touch_gestures_do_not_block_scroll_until_dragging() -> None:
    """Mobile scroll surfaces should keep touchmove passive until a horizontal drag is confirmed."""
    touch_context = (STATIC / 'chat' / 'message-touch-context.js').read_text(encoding='utf-8')
    back_swipe = (STATIC / 'chat' / 'mobile-back-swipe.js').read_text(encoding='utf-8')
    profile_drawer = (STATIC / 'modules' / 'profile-drawer.js').read_text(encoding='utf-8')
    surface_events = (STATIC / 'modules' / 'chat-message-surface-events-runtime.js').read_text(encoding='utf-8')

    assert "chatMessages.addEventListener('touchmove', handlePassiveMessageTouchMove, { passive: true });" in touch_context
    assert "chatMessages.addEventListener('touchmove', handleBlockingMessageTouchMove, { passive: false });" in touch_context
    assert "chatMessages.addEventListener('touchmove', handleMessageTouchMove, { passive: false });" not in touch_context

    bind_idx = back_swipe.find('function bindMobileBackSwipeTrackingMove()')
    tracking_idx = back_swipe.find("chatArea.addEventListener('touchmove', handleMobileBackSwipePassiveMove, { passive: true });")
    blocking_idx = back_swipe.find("chatArea.addEventListener('touchmove', handleMobileBackSwipeBlockingMove, { passive: false });")
    permanent_start_idx = back_swipe.find("chatArea.addEventListener('touchstart', handleMobileBackSwipeStart, { passive: true });")
    assert 0 <= bind_idx < tracking_idx < blocking_idx < permanent_start_idx, (
        'mobile-back-swipe.js: touchmove must track passively before binding a blocking drag listener.'
    )
    assert 'bindMobileBackSwipeBlockingMove();' in back_swipe

    assert "sheet.addEventListener('touchmove', moveSwipePassive, { passive: true });" in profile_drawer
    assert "sheet.addEventListener('touchmove', moveSwipeBlocking, { passive: false });" in profile_drawer
    assert "sheet.addEventListener('touchmove', moveSwipe, { passive: false });" not in profile_drawer
    assert 'bindTouchBlocker: true' in profile_drawer

    assert 'scrollWorkFrame = requestAnimationFrameFn(runMessageScrollWork)' in surface_events
    assert "chatMessages?.addEventListener('scroll', () => {" in surface_events


def test_chat_uses_single_mobile_message_gesture_runtime() -> None:
    """Message touch context owns long-press and swipe-to-reply gestures."""
    runtime = (STATIC / 'chat-runtime.js').read_text(encoding='utf-8')
    touch_context = (STATIC / 'chat' / 'message-touch-context.js').read_text(encoding='utf-8')

    assert "import { initSwipeReply } from './modules/chat-swipe-reply.js';" not in runtime
    assert 'const swipeReplyController = initSwipeReply' not in runtime
    assert '.file-msg-media-trigger,.file-msg-link,.message-link-preview,.reply-quote,' in touch_context
    assert 'button,a[href],[role="button"],' in touch_context


def test_message_interactive_clicks_are_scoped() -> None:
    """Message media and reply controls must not also trigger selection/context handlers."""
    rendering = (STATIC / 'modules' / 'message-rendering.js').read_text(encoding='utf-8')
    surface_events = (STATIC / 'modules' / 'chat-message-surface-events-runtime.js').read_text(encoding='utf-8')

    assert "if (isMessageSelectionActive(messageDiv)) return;\n            event.preventDefault();\n            event.stopPropagation();" in rendering
    assert "trigger.addEventListener('click', (event) => {" in rendering
    assert "linkEl.addEventListener('click', async (event) => {" in rendering
    assert 'event.stopPropagation();\n            const resolver = window.__sunMediaCacheResolveSource;' in rendering
    assert "const cell = event.target?.closest?.('.album-cell.file-msg-media-trigger');" in surface_events
    assert 'event.preventDefault();\n        event.stopPropagation();\n        if (typeof openLightbox === \'function\') openLightbox(cell);' in surface_events


def test_link_preview_and_media_share_scroll_stabilizer() -> None:
    """Async link previews and media load mutations must use the central scroll anchor helper."""
    preview = (STATIC / 'modules' / 'message-link-preview.js').read_text(encoding='utf-8')
    media = (STATIC / 'modules' / 'chat-media-runtime.js').read_text(encoding='utf-8')

    assert "import { withStableChatScroll } from './chat-scroll-stability.js';" in preview
    assert 'withStableChatScroll,' in media
    assert 'const runWithStableChatScroll = typeof withStableChatScroll === \'function\'' in media
    assert 'function withStableChatScroll(referenceNode, mutateFn)' not in preview
    assert 'runWithStableChatScroll(mediaEl, () => {' in media
    assert 'runWithStableChatScroll(videoEl, () => {' in media


def test_automatic_bottom_scroll_is_instant_by_default() -> None:
    """Automatic bottom pinning must not animate during mobile viewport/composer changes."""
    render_runtime = (STATIC / 'modules' / 'chat-message-render-runtime.js').read_text(encoding='utf-8')
    surface_events = (STATIC / 'modules' / 'chat-message-surface-events-runtime.js').read_text(encoding='utf-8')

    assert 'function requestAutoScrollToBottom({ ifNearBottom = false, smooth = false } = {})' in render_runtime
    assert 'requestAutoScrollToBottom({ ifNearBottom: false, smooth: true });' in surface_events


def test_message_selection_adjacency_does_not_use_hot_has_selector() -> None:
    """Selection adjacency should be a JS-synced class, not a message-list :has() selector."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    selection_runtime = (STATIC / 'modules' / 'message-selection.js').read_text(encoding='utf-8')
    render_runtime = (STATIC / 'modules' / 'chat-message-render-runtime.js').read_text(encoding='utf-8')

    assert '.chat-messages.selecting .message.selected:has(+ .message.selected)' not in css
    assert '.chat-messages.selecting .message.selected-followed-by-selected' in css
    assert 'export function syncSelectedMessageAdjacency(chatMessages)' in selection_runtime
    assert "message.classList.toggle(SELECTED_FOLLOWED_BY_SELECTED_CLASS, isFollowedBySelected)" in selection_runtime
    assert 'withStableChatScroll(element || chatMessages' in selection_runtime
    assert 'syncSelectedMessageAdjacency = () => {}' in render_runtime
    assert 'syncSelectedMessageAdjacency(chatMessages);' in render_runtime


def test_voice_wave_and_static_media_layers_avoid_layout_animation() -> None:
    """Voice waveform should animate transforms, and static blur layers should not reserve compositor hints."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    voice_runtime = (STATIC / 'modules' / 'voice-recorder.js').read_text(encoding='utf-8')

    assert 'bar.style.height = \'3px\'' not in voice_runtime
    assert 'waveBarElements[i].style.height' not in voice_runtime
    assert "bar.style.setProperty('--voice-wave-scale', '0.125')" in voice_runtime
    assert "waveBarElements[i].style.setProperty('--voice-wave-scale', scale.toFixed(3))" in voice_runtime

    assert '.voice-record-wave-bar' in css
    assert 'transform: scaleY(var(--voice-wave-scale, 0.125));' in css
    assert 'transition: transform 0.04s linear;' in css
    assert '#composerRow.is-voice-recording .voice-record-wave-bar' in css
    assert 'will-change: height;' not in css

    assert 'will-change: transform, filter;' not in css


def test_profile_spotify_progress_uses_transform_not_width_animation() -> None:
    """Profile Spotify progress is RAF-updated, so it must avoid width layout writes."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    profile_runtime = (STATIC / 'modules' / 'profile-drawer.js').read_text(encoding='utf-8')

    assert "fillEl.style.width = '0%'" not in profile_runtime
    assert 'fillEl.style.width = `${progressPct.toFixed(3)}%`' not in profile_runtime
    assert "fillEl.style.setProperty('--spotify-progress-scale', '0')" in profile_runtime
    assert "fillEl.style.setProperty('--spotify-progress-scale', (progressPct / 100).toFixed(4))" in profile_runtime
    assert 'transform: scaleX(var(--spotify-progress-scale, 0));' in css
    assert 'transform-origin: left center;' in css
    assert '.profile-spotify-card--revealing' in css


def test_composer_edit_state_uses_form_class_instead_of_has_selector() -> None:
    """Composer edit state changes during typing/editing, so avoid dynamic :has()."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    edit_controller = (STATIC / 'chat' / 'message-edit-controller.js').read_text(encoding='utf-8')
    runtime = (STATIC / 'chat-runtime.js').read_text(encoding='utf-8')

    assert '#messageForm:has(#messageInput.editing-active)' not in css
    assert '#messageForm.editing-active' in css
    assert 'messageForm?.classList.add(\'editing-active\')' in edit_controller
    assert 'messageForm?.classList.remove(\'editing-active\')' in edit_controller
    assert 'messageForm,' in runtime


def test_delete_modal_checkbox_state_uses_row_class_instead_of_has_selector() -> None:
    """Delete modal checkbox row state is JS-known, so keep CSS off parent :has()."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    overlays = (STATIC / 'modules' / 'chat-overlays.js').read_text(encoding='utf-8')

    assert '.delete-checkbox-row:has(input[type="checkbox"]:checked)' not in css
    assert '.delete-checkbox-row.is-checked' in css
    assert ".classList.toggle('is-checked', deleteForBothCheckEl.checked)" in overlays
    assert ".classList.remove('is-checked')" in overlays
