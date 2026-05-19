from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / 'templates' / 'chat.html'
AUTH_TEMPLATE = ROOT / 'templates' / 'index.html'
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


def test_auth_login_does_not_render_remember_device_checkbox() -> None:
    src = AUTH_TEMPLATE.read_text(encoding='utf-8')

    assert 'id="rememberDeviceCheckbox"' not in src
    assert 'id="rememberDeviceLabel"' not in src


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


def test_chat_stage_loader_is_wired_to_thread_shell() -> None:
    chat_area_src = (ROOT / 'templates' / 'chat' / '_chat_area.html').read_text(encoding='utf-8')
    dom_refs_src = (STATIC / 'modules' / 'chat-dom-refs.js').read_text(encoding='utf-8')
    runtime_src = (STATIC / 'chat-runtime.js').read_text(encoding='utf-8')
    thread_shell_src = (STATIC / 'chat' / 'thread-shell.js').read_text(encoding='utf-8')

    assert 'id="chatStageLoader"' in chat_area_src
    assert "chatStageLoader: byId('chatStageLoader')" in dom_refs_src
    assert 'chatStageLoader,' in runtime_src
    assert 'setLoadingElementActive(chatStageLoader, shouldShow)' in thread_shell_src


def test_sidebar_loading_preview_is_not_reused_for_avatar_loading() -> None:
    contacts_src = (STATIC / 'modules' / 'contacts.js').read_text(encoding='utf-8')
    sidebar_runtime_src = (STATIC / 'modules' / 'chat-contacts-sidebar.js').read_text(encoding='utf-8')
    sidebar_template_src = (ROOT / 'templates' / 'chat' / '_sidebar.html').read_text(encoding='utf-8')
    components_css = (STATIC / 'pages' / 'chat' / 'components.css').read_text(encoding='utf-8')

    assert 'contact-last-msg-loading__lines' in contacts_src
    assert 'contact-last-msg-loading__lines' in sidebar_template_src
    assert 'contact-avatar-loading__bar' not in contacts_src
    assert 'contact-avatar-loading__bar' not in sidebar_runtime_src
    assert 'contact-avatar-loading__bar' not in sidebar_template_src
    assert '.contact-avatar-loading::after' in components_css
    assert '.contact-last-msg-loading__line' in components_css


def test_sidebar_loading_preview_expands_to_full_contact_row() -> None:
    contacts_src = (STATIC / 'modules' / 'contacts.js').read_text(encoding='utf-8')
    sidebar_runtime_src = (STATIC / 'modules' / 'chat-contacts-sidebar.js').read_text(encoding='utf-8')
    sidebar_template_src = (ROOT / 'templates' / 'chat' / '_sidebar.html').read_text(encoding='utf-8')
    components_css = (STATIC / 'pages' / 'chat' / 'components.css').read_text(encoding='utf-8')
    responsive_css = (STATIC / 'pages' / 'chat' / 'responsive.css').read_text(encoding='utf-8')
    states_css = (STATIC / 'pages' / 'chat' / 'states.css').read_text(encoding='utf-8')
    loading_states_css = (STATIC / 'pages' / 'chat' / 'states' / 'loading.css').read_text(encoding='utf-8')

    assert 'contact-item--preview-loading' in contacts_src
    assert 'data-preview-loading="${isPreviewLoading ? \'1\' : \'0\'}"' in contacts_src
    assert "CustomEvent('sun-sidebar-preview-loading-change'" in contacts_src
    assert "contactsList.closest('.sidebar')" in sidebar_runtime_src
    assert "sidebar.classList.toggle('sidebar--loading', shouldShowShellLoading)" in sidebar_runtime_src
    assert "contactsList.dataset.contactsLoadingPartial" in sidebar_runtime_src
    assert 'contact-item--preview-loading' in sidebar_template_src
    assert 'data-sidebar-loading="{{ \'1\' if sidebar_loading.active else \'0\' }}"' in sidebar_template_src
    assert (
        "{% set preview_loading = (not has_draft) and "
        "contact.initial_last_message_preview == '__SUN_ENCRYPTED_LOADING__' %}"
    ) in sidebar_template_src
    assert 'data-preview-loading="{{ \'1\' if preview_loading else \'0\' }}"' in sidebar_template_src
    assert '.contact-item.contact-item--preview-loading .contact-avatar::after' in components_css
    assert '.contact-item.contact-item--preview-loading .contact-name' in components_css
    assert '.contact-item.contact-item--preview-loading .contact-time-meta' in components_css
    assert '.sidebar.sidebar--loading .search-input-wrapper::before' in components_css
    assert '.sidebar.sidebar--loading #contactsList .contact-item:not(.contact-item--preview-loading) .contact-last-msg' in components_css
    assert '.sidebar.sidebar--loading .sidebar-bottom-avatar::after' in components_css
    assert '.sidebar.sidebar--loading .sidebar-status-chip--inline' in components_css
    assert '.contact-item.contact-item--preview-loading.active .contact-name' in states_css
    assert '.contact-item.contact-item--preview-loading.active .contact-name' in loading_states_css
    assert '.sidebar.sidebar--loading .contact-item.active .contact-last-msg' in states_css
    assert '.sidebar.sidebar--loading .contact-item.active .contact-last-msg' in loading_states_css
    assert 'html[data-motion-level="lite"] .contact-item--preview-loading .contact-avatar::after' in responsive_css
    assert 'html[data-motion-level="lite"] .sidebar.sidebar--loading .search-input-wrapper::after' in responsive_css
