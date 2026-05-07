from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

CHAT_UI_TEMPLATES = (
    ROOT / 'templates' / 'chat' / '_chat_area.html',
    ROOT / 'templates' / 'chat' / '_modals.html',
    ROOT / 'templates' / 'chat' / '_sidebar.html',
    ROOT / 'templates' / 'chat' / '_context_menus.html',
)

FORBIDDEN_ENGLISH_UI_PHRASES = (
    'Report user',
    'Create group',
    'Group name',
    'Add members',
    'Edit group',
    'Change photo',
    'Report Content',
    'Submit report',
    'Reason',
    'Comment (optional)',
    'SYNC',
    'powered by',
    'Group info',
    'Members',
    'Media',
    'Files',
    'Links',
    'Previous image',
    'Next image',
    'Play video',
    'Play or pause',
    'Video progress',
    'Volume',
    'Fullscreen',
    'Zoom out',
    'Zoom in',
    'Zoom level',
    'Preview',
)


def test_chat_templates_do_not_hardcode_english_ui_strings() -> None:
    for path in CHAT_UI_TEMPLATES:
        src = path.read_text(encoding='utf-8')
        text_nodes = re.findall(r'>\s*([^<]+?)\s*<', src)
        attr_values = re.findall(r'(?:placeholder|title|aria-label|alt)\s*=\s*"([^"]+)"', src)
        user_visible_fragments = '\n'.join(text_nodes + attr_values)
        for phrase in FORBIDDEN_ENGLISH_UI_PHRASES:
            assert phrase not in user_visible_fragments, (
                f'English UI hardcode "{phrase}" detected in {path.relative_to(ROOT)}. '
                'Use Russian base strings and i18n runtime translation.'
            )
