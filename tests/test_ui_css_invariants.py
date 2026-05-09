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
    src = (STATIC / 'chat.js').read_text(encoding='utf-8')
    assert 'keyboard-shortcuts.js' in src, (
        'chat.js не импортирует модуль keyboard-shortcuts.js'
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
    """`openChat()` в chat.js должен использовать новые классы
    mobile-revealing/mobile-hiding и не делать display:none мгновенно."""
    src = (STATIC / 'chat.js').read_text(encoding='utf-8')
    # Берём первый openChat функцию
    func = re.search(
        r'function openChat\(\)\s*\{([\s\S]+?)\n    \}\n',
        src,
    )
    assert func, 'chat.js: функция openChat() не найдена'
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
    """chat.js should not start desktop thread reveal/switch motion on mobile."""
    src = (STATIC / 'chat.js').read_text(encoding='utf-8')

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

    assert 'const useDesktopSwitchMotion = !isMobileViewport() && !reduceMotion' in src
    assert 'if (chatArea && useDesktopSwitchMotion)' in src


def test_icon_button_press_keeps_glyph_centered() -> None:
    """Icon-only buttons should not shift or scale glyphs on tap/press."""
    css = (STATIC / 'motion.css').read_text(encoding='utf-8')
    js = (STATIC / 'modules' / 'motion.js').read_text(encoding='utf-8')

    assert 'target.appendChild(ripple)' in js
    assert 'insertBefore(ripple' not in js

    ripple_host = re.search(r'\.tg-ripple-host\s*\{([^}]*)\}', css, re.DOTALL)
    ripple_circle = re.search(r'\.tg-ripple-circle\s*\{([^}]*)\}', css, re.DOTALL)
    assert ripple_host and 'isolation: isolate' in ripple_host.group(1)
    assert ripple_circle and 'position: absolute' in ripple_circle.group(1)
    assert 'flex: 0 0 auto' in ripple_circle.group(1)
    assert '.tg-ripple-host > .tg-ripple-circle' in css
    assert '.tg-ripple-host > :not(.tg-ripple-circle)' in css

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

    chat_js = (STATIC / 'chat.js').read_text(encoding='utf-8')
    assert "closeFloatingPanel(headerDropdown, 'active', 120)" in chat_js, (
        'chat.js: header dropdown close fallback should be short enough to avoid a visible hang'
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

    settings = (STATIC / 'pages' / 'settings.js').read_text(encoding='utf-8')
    assert "localStorage.setItem('darkMode', dark)" in settings
    assert "document.documentElement.classList.toggle('dark-mode', dark)" in settings
    assert "document.body.classList.toggle('dark-mode', dark)" in settings
    assert "notifyParent('sun-settings-theme-updated', { dark })" in settings


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
    assert '--chat-mobile-outgoing-edge-offset: 0px' in css, (
        'chat.css: mobile outgoing messages should not have extra right-edge inset drift'
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
    """Optimistic self messages should reuse the same rendered layout as history."""
    chat_js = (STATIC / 'chat.js').read_text(encoding='utf-8')
    text_send = (STATIC / 'modules' / 'chat-text-send.js').read_text(encoding='utf-8')
    file_send = (STATIC / 'modules' / 'chat-file-send.js').read_text(encoding='utf-8')

    assert 'const previousTailMessage = lastIdx > 0 ? state.messages[lastIdx - 1] : null' in chat_js
    assert 'const tailGroupWouldChange = isSameMessageGroup(previousTailMessage, inserted)' in chat_js
    assert '&& !tailGroupWouldChange' in chat_js, (
        'chat.js: fast append must not leave stale grouped tail DOM next to new messages'
    )
    assert "chat-text-send.js" in chat_js
    assert "chat-file-send.js" in chat_js
    assert 'renderOptions: { force: true, scrollToBottom: true }' in text_send, (
        'chat-text-send.js: optimistic text sends should force a tail rerender for alignment'
    )
    assert 'renderOptions: { force: true, scrollToBottom: true }' in file_send, (
        'chat-file-send.js: optimistic file sends should force a tail rerender for alignment'
    )


def test_chatjs_syncs_visual_viewport_css_vars() -> None:
    """chat.js must sync visualViewport metrics to CSS vars for mobile keyboards."""
    src = (STATIC / 'chat.js').read_text(encoding='utf-8')
    assert 'function syncVisualViewportCssVars()' in src, (
        'chat.js: visual viewport sync helper is missing'
    )
    for token in (
        '--app-vh',
        '--app-vw',
        '--vv-top-offset',
        '--vv-left-offset',
        '--vv-keyboard-inset',
        '--mobile-composer-bottom-inset',
        '--mobile-keyboard-layout-inset',
    ):
        assert token in src, f'chat.js: missing CSS var sync for {token}'
    assert 'function resetHorizontalViewportDrift()' in src, (
        'chat.js: composer focus should guard against mobile horizontal viewport drift'
    )
    assert 'target.scrollLeft = 0' in src, (
        'chat.js: mobile focus drift guard should reset horizontal scrollLeft'
    )
    assert 'requestAnimationFrame(resetHorizontalViewportDrift)' in src, (
        'chat.js: drift reset should run after focus/keyboard layout settles'
    )
    assert 'window.visualViewport.addEventListener(\'resize\', syncViewportAndInsets)' in src, (
        'chat.js: visualViewport resize should use syncViewportAndInsets'
    )
    assert 'window.visualViewport.addEventListener(\'scroll\', syncViewportAndInsets)' in src, (
        'chat.js: visualViewport scroll should use syncViewportAndInsets'
    )


def test_mobile_keyboard_binds_chat_surface_to_visual_viewport() -> None:
    """Keyboard-open mobile chat should resize the whole app, not push inner layers."""
    css = _read_css_text(STATIC / 'pages' / 'chat.css')
    viewport = (STATIC / 'modules' / 'mobile-viewport.js').read_text(encoding='utf-8')
    head = (ROOT / 'templates' / 'chat' / '_head.html').read_text(encoding='utf-8')

    assert 'interactive-widget=resizes-visual' in head
    assert 'minimum-scale=1' in head

    assert 'const appHeight = hasKeyboardViewport ? vvHeight : layoutViewportHeight' in viewport
    assert 'const appTopOffset = hasKeyboardViewport ? vvTop : 0' in viewport
    assert 'const vvWidth = roundedPx(vv.width)' in viewport
    assert 'const vvLeft = roundedPx(vv.offsetLeft)' in viewport
    assert 'const appWidth = hasKeyboardViewport && vvWidth > 0 ? vvWidth : layoutViewportWidth' in viewport
    assert 'const appLeftOffset = hasKeyboardViewport ? vvLeft : 0' in viewport
    assert "root.classList.toggle('mobile-keyboard-active', hasKeyboardViewport)" in viewport
    assert "root.style.setProperty(appVwVar, `${appWidth}px`)" in viewport
    assert "root.style.setProperty(leftOffsetVar, `${appLeftOffset}px`)" in viewport
    assert "root.style.setProperty(layoutKeyboardInsetVar, '0px')" in viewport
    assert "root.style.setProperty(composerBottomInsetVar, `${keyboardInset}px`)" in viewport

    app_blocks = re.findall(r'\.app\s*\{([^}]*)\}', css, re.DOTALL)
    assert any('top: var(--vv-top-offset, 0px)' in block for block in app_blocks), (
        'mobile .app should follow visualViewport offset as one surface'
    )
    assert any('left: var(--vv-left-offset, 0px)' in block for block in app_blocks), (
        'mobile .app should follow visualViewport horizontal offset as one surface'
    )
    assert any('width: var(--app-vw, 100vw)' in block for block in app_blocks), (
        'mobile .app should bind width to the visual viewport when keyboard/focus changes'
    )

    header_blocks = re.findall(r'\.chat-header\s*\{([^}]*)\}', css, re.DOTALL)
    assert any('position: relative' in block and 'top: auto' in block for block in header_blocks), (
        'mobile .chat-header should not independently sticky-jump on visualViewport changes'
    )

    assert 'html.mobile-keyboard-active .chat-messages' in css
    assert 'html.mobile-keyboard-active .chat-input-area' in css
    assert '--mobile-keyboard-layout-inset' in css

    keyboard_layout_segment = css[css.find('--mobile-keyboard-layout-inset'):]
    assert 'var(--mobile-keyboard-layout-inset, 0px)' in keyboard_layout_segment
