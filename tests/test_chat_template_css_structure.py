from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / 'templates' / 'chat.html'
STATIC = ROOT / 'static'
CHAT_CSS = STATIC / 'pages' / 'chat.css'

CHAT_PARTIALS = [
    'chat/_head.html',
    'chat/_boot_overlay.html',
    'chat/_sidebar.html',
    'chat/_chat_area.html',
    'chat/_search_overlay.html',
    'chat/_modals.html',
    'chat/_context_menus.html',
    'chat/_scripts.html',
]

CHAT_IMPORT_PATHS = {
    'layout': './chat/layout.css',
    'components': './chat/components.css',
    'states': './chat/states.css',
    'responsive': './chat/responsive.css',
}


def test_chat_template_is_composed_from_partials() -> None:
    src = TEMPLATE.read_text(encoding='utf-8')

    for partial in CHAT_PARTIALS:
        expected_include = "{% include '" + partial + "' %}"
        assert expected_include in src, (
            f'chat.html must include partial {partial!r} for maintainable template composition.'
        )


def test_chat_template_partials_exist() -> None:
    for partial in CHAT_PARTIALS:
        path = ROOT / 'templates' / partial
        assert path.exists(), f'Missing chat partial: {path}'


def test_chat_template_keeps_inline_styles_to_minimum() -> None:
    src = TEMPLATE.read_text(encoding='utf-8')
    inline_styles = re.findall(r'\bstyle\s*=\s*"', src)
    assert len(inline_styles) <= 12, (
        'chat.html still has too many inline styles; move them into chat CSS layers. '
        f'Found inline style attributes: {len(inline_styles)}'
    )


def test_chat_partials_do_not_use_inline_styles() -> None:
    for partial in CHAT_PARTIALS:
        path = ROOT / 'templates' / partial
        src = path.read_text(encoding='utf-8')
        inline_styles = re.findall(r'\bstyle\s*=\s*"', src)
        assert not inline_styles, (
            f'Inline styles are not allowed in {partial}; use CSS layer files instead.'
        )


def test_chat_css_uses_import_aggregator() -> None:
    css = CHAT_CSS.read_text(encoding='utf-8')

    for layer_name, import_path in CHAT_IMPORT_PATHS.items():
        plain_stmt = f"@import url('{import_path}');"
        layered_stmt = f"@import url('{import_path}') layer({layer_name});"
        assert plain_stmt in css or layered_stmt in css, (
            f'chat.css must import {layer_name} file ({import_path}).'
        )


def test_chat_css_layer_files_exist() -> None:
    for layer_name in CHAT_IMPORT_PATHS:
        path = STATIC / 'pages' / 'chat' / f'{layer_name}.css'
        assert path.exists(), f'Missing layer file: {path}'
        content = path.read_text(encoding='utf-8').strip()
        assert content, f'Layer file is empty: {path}'


def test_outgoing_message_bubbles_use_chat_appearance_tokens() -> None:
    css = (STATIC / 'pages' / 'chat' / 'components.css').read_text(encoding='utf-8')
    block_match = re.search(r'\.message\.self\s+\.bubble\s*\{(?P<body>[^}]*)\}', css, re.DOTALL)

    assert block_match, 'components.css must define outgoing message bubble colors.'
    block_body = block_match.group('body')
    assert 'background: var(--chat-bubble-out-bg)' in block_body
    assert 'color: var(--chat-bubble-out-text)' in block_body
    assert 'body:not(.dark-mode) .message.self .bubble {\n            color: #fff;' not in css


def test_chat_css_aggregator_contains_only_import_directives() -> None:
    css = CHAT_CSS.read_text(encoding='utf-8')
    non_directive_lines = []
    for raw_line in css.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith('/*') or line.startswith('*') or line.startswith('*/'):
            continue
        if line.startswith('@layer') or line.startswith('@import'):
            continue
        non_directive_lines.append(line)

    assert not non_directive_lines, (
        'chat.css should be a thin aggregator file. '
        f'Unexpected non-directive lines: {non_directive_lines[:5]}'
    )


def test_chat_template_contains_message_favorites_ui_hooks() -> None:
    context_menu_src = (ROOT / 'templates' / 'chat' / '_context_menus.html').read_text(encoding='utf-8')
    chat_area_src = (ROOT / 'templates' / 'chat' / '_chat_area.html').read_text(encoding='utf-8')

    assert 'id="cmFavorite"' in context_menu_src
    assert 'id="favoriteBar"' in chat_area_src
    assert 'id="favoriteBarText"' in chat_area_src


def test_chat_template_contains_message_forward_ui_hooks() -> None:
    context_menu_src = (ROOT / 'templates' / 'chat' / '_context_menus.html').read_text(encoding='utf-8')
    chat_area_src = (ROOT / 'templates' / 'chat' / '_chat_area.html').read_text(encoding='utf-8')
    modals_src = (ROOT / 'templates' / 'chat' / '_modals.html').read_text(encoding='utf-8')

    assert 'id="cmForward"' in context_menu_src
    assert 'id="cmReport"' in context_menu_src
    assert 'id="bulkForwardBtn"' in chat_area_src
    assert 'id="forwardDraftBar"' in chat_area_src
    assert 'id="forwardDraftLabel"' in chat_area_src
    assert 'id="forwardDraftText"' in chat_area_src
    assert 'id="cancelForwardDraftBtn"' in chat_area_src
    assert 'id="messageForwardModal"' in modals_src
    assert 'id="messageForwardSelectedInfo"' in modals_src
    assert 'id="messageForwardSubmitBtn"' in modals_src
